// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginButton } from "../../components/login-button";
import { DEMO_CLIENT_TIMEOUT_MS, DEMO_SERVER_TIMEOUT_MS } from "../../lib/demo/limits";
import type { DemoStartResult } from "../../lib/demo/start";
import { DemoAttemptLimiter, demoLimitChecks } from "../../lib/demo/access";
import { startDemoCore, type DemoStartDeps } from "../../lib/demo/start";
import { DEMO_TEXT } from "../../lib/login-text";
import { parseTodoKey } from "../../lib/todos/crypto";

vi.mock("../../lib/supabase/server", () => ({ createClient: async () => null }));

/** 체험 「시작 중」 멈춤 고침: 화면 20초 · 서버 25초(임시) 상한. 시험은 가짜 응답 · 가짜 시계, 코드는 자리표시자 */
const CODE = "TEST-CODE-42";
const ANON = "33333333-3333-4333-8333-333333333333";
const key = parseTodoKey(randomBytes(32).toString("base64"))!;

const codeInput = () => screen.getByRole("textbox", { name: DEMO_TEXT.label }) as HTMLInputElement;
const startButton = () => screen.getByRole("button", { name: DEMO_TEXT.buttonName }) as HTMLButtonElement;

describe("화면 시간 상한(20초): startDemo가 답이 없어도 「시작 중」에서 멈추지 않는다", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("상한은 서버(25초)보다 짧은 20초다", () => {
    expect(DEMO_CLIENT_TIMEOUT_MS).toBe(20_000);
    expect(DEMO_SERVER_TIMEOUT_MS).toBe(25_000);
    expect(DEMO_CLIENT_TIMEOUT_MS).toBeLessThan(DEMO_SERVER_TIMEOUT_MS);
  });

  it("19초까지는 「시작 중」, 20초가 지나면 풀리고 실패 글(role=alert)과 다시 누를 수 있는 단추, 이동하지 않는다", async () => {
    const startDemo = vi.fn(() => new Promise<DemoStartResult>(() => {})); // 끝내 답이 없다
    const onDemoStarted = vi.fn();
    render(<LoginButton startDemo={startDemo} onDemoStarted={onDemoStarted} />);
    fireEvent.change(codeInput(), { target: { value: "DUNO" } });
    await act(async () => {
      fireEvent.click(startButton());
    });
    await act(async () => void vi.advanceTimersByTime(19_999));
    expect(startButton().textContent).toBe(DEMO_TEXT.busy);
    expect(startButton().disabled).toBe(true);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(startButton().textContent).toBe(DEMO_TEXT.button);
    expect(startButton().disabled).toBe(false);
    expect(startButton().getAttribute("aria-busy")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(DEMO_TEXT.failed);
    expect(onDemoStarted).not.toHaveBeenCalled();
    // 다시 누를 수 있다
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(startDemo).toHaveBeenCalledTimes(2);
    expect(startButton().textContent).toBe(DEMO_TEXT.busy);
  });

  it("시간 제한 중 두 번 누름은 무시한다(서버 행동 한 번)", async () => {
    const startDemo = vi.fn(() => new Promise<DemoStartResult>(() => {}));
    render(<LoginButton startDemo={startDemo} />);
    fireEvent.change(codeInput(), { target: { value: "DUNO" } });
    await act(async () => {
      fireEvent.click(startButton());
    });
    fireEvent.submit(codeInput().form!);
    await act(async () => void vi.advanceTimersByTime(10_000));
    fireEvent.submit(codeInput().form!);
    expect(startDemo).toHaveBeenCalledTimes(1);
  });

  it("제때 온 응답은 시간 상한에 걸리지 않는다: ok면 이동, 실패면 글, 타이머는 남지 않는다", async () => {
    let resolve!: (r: DemoStartResult) => void;
    const startDemo = vi.fn(() => new Promise<DemoStartResult>((r) => (resolve = r)));
    const onDemoStarted = vi.fn();
    render(<LoginButton startDemo={startDemo} onDemoStarted={onDemoStarted} />);
    fireEvent.change(codeInput(), { target: { value: "DUNO" } });
    await act(async () => {
      fireEvent.click(startButton());
    });
    await act(async () => void vi.advanceTimersByTime(5_000));
    await act(async () => resolve({ ok: true }));
    expect(onDemoStarted).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => void vi.advanceTimersByTime(30_000));
    expect(onDemoStarted).toHaveBeenCalledTimes(1);
  });

  it("늦게 온 응답: ok이면(시간 제한 뒤) 그때 이동한다 · 실패면 무시한다(실패 글은 이미 보였다)", async () => {
    let resolveOk!: (r: DemoStartResult) => void;
    const startOk = vi.fn(() => new Promise<DemoStartResult>((r) => (resolveOk = r)));
    const movedOk = vi.fn();
    const first = render(<LoginButton startDemo={startOk} onDemoStarted={movedOk} />);
    fireEvent.change(codeInput(), { target: { value: "DUNO" } });
    await act(async () => {
      fireEvent.click(startButton());
    });
    await act(async () => void vi.advanceTimersByTime(20_000));
    expect(screen.getByRole("alert").textContent).toContain(DEMO_TEXT.failed);
    expect(movedOk).not.toHaveBeenCalled();
    await act(async () => resolveOk({ ok: true }));
    expect(movedOk).toHaveBeenCalledTimes(1);
    first.unmount();

    let resolveFail!: (r: DemoStartResult) => void;
    const startFail = vi.fn(() => new Promise<DemoStartResult>((r) => (resolveFail = r)));
    const movedFail = vi.fn();
    render(<LoginButton startDemo={startFail} onDemoStarted={movedFail} />);
    fireEvent.change(codeInput(), { target: { value: "DUNO" } });
    await act(async () => {
      fireEvent.click(startButton());
    });
    await act(async () => void vi.advanceTimersByTime(20_000));
    await act(async () => resolveFail({ ok: false, error: "rate_limited" }));
    expect(movedFail).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(DEMO_TEXT.failed); // 늦은 실패가 글을 바꾸지 않는다
  });

  it("startDemo가 던져도(서버 행동 호출 실패) 실패 글로 풀린다", async () => {
    const startDemo = vi.fn(async (): Promise<DemoStartResult> => {
      throw new Error("network");
    });
    render(<LoginButton startDemo={startDemo} />);
    fireEvent.change(codeInput(), { target: { value: "DUNO" } });
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(startButton().disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain(DEMO_TEXT.failed);
  });
});

describe("서버 시간 상한(25초): 넘으면 failed로 끝내고 [demo] timeout 한 줄", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
  });

  function setup(seed: DemoStartDeps["seed"], over: Partial<DemoStartDeps> = {}) {
    const auth = {
      getClaims: vi.fn(async () => ({ data: null, error: null })),
      signInAnonymously: vi.fn(async () => ({ data: { user: { id: ANON }, session: {} }, error: null })),
    };
    const client = { auth } as unknown as SupabaseClient;
    const d: DemoStartDeps = {
      expectedCode: CODE,
      limiter: new DemoAttemptLimiter(),
      limitChecks: demoLimitChecks("203.0.113.7", "0b5f6c1e-3a1b-4c2d-8e9f-00000000000a"),
      now: () => 0,
      getSupabase: async () => client,
      key,
      today: () => "2026-11-09",
      seed,
      ...over,
    };
    return { d, auth };
  }

  it("예시 데이터가 25초 안에 안 끝나면 failed, 로그는 「[demo] timeout」 한 줄(값 없음). 끊긴 일은 뒤에서 끝까지 돈다", async () => {
    vi.useFakeTimers();
    let finishSeed!: () => void;
    let seedDone = false;
    const seed = vi.fn(
      () =>
        new Promise<never>((resolve) => {
          finishSeed = () => {
            seedDone = true;
            resolve(undefined as never);
          };
        }),
    );
    const { d } = setup(seed as unknown as DemoStartDeps["seed"]);
    const run = startDemoCore(d, CODE);
    await vi.advanceTimersByTimeAsync(24_999);
    let settled = false;
    void run.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await run).toEqual({ ok: false, error: "failed" });
    expect(warn.mock.calls.map((c: unknown[]) => c[0])).toContain("[demo] timeout");
    expect(warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n")).not.toContain(CODE);
    expect(seedDone).toBe(false);
    finishSeed(); // 뒤에서 끝까지 돌아도 던지지 않는다
    await Promise.resolve();
    expect(seedDone).toBe(true);
  });

  it("제때 끝나면 상한 타이머가 남지 않고 로그도 없다", async () => {
    vi.useFakeTimers();
    const { d } = setup(vi.fn(async () => ({ categories: 4, todos: 1, eveningLogs: 1, ratios: 4, ratioHistory: 1, weeklyGoals: 1, settings: 1 })));
    expect(await startDemoCore(d, CODE)).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("틀린 코드는 상한 타이머를 만들지 않는다(코드가 맞은 뒤의 일만 상한이 있다)", async () => {
    vi.useFakeTimers();
    const { d } = setup(vi.fn());
    expect(await startDemoCore(d, "WRONG")).toEqual({ ok: false, error: "wrong_code" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("상한은 값을 줄 수 있다(시험용): 짧게 주면 그 시간에 끊긴다", async () => {
    vi.useFakeTimers();
    const { d } = setup(vi.fn(() => new Promise<never>(() => {})) as unknown as DemoStartDeps["seed"], { timeoutMs: 1000 });
    const run = startDemoCore(d, CODE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await run).toEqual({ ok: false, error: "failed" });
  });

  it("다시 눌러도 익명 사용자는 하나: 첫 요청이 상한에 걸린 뒤 세션이 생겼으면 두 번째는 익명 로그인을 다시 부르지 않는다", async () => {
    vi.useFakeTimers();
    const claims: { sub: string; is_anonymous: boolean } | null = null;
    let current = claims as { sub: string; is_anonymous: boolean } | null;
    const auth = {
      getClaims: vi.fn(async () => ({ data: current ? { claims: current } : null, error: null })),
      signInAnonymously: vi.fn(async () => {
        current = { sub: ANON, is_anonymous: true }; // 첫 요청이 세션 쿠키를 만들었다
        return { data: { user: { id: ANON }, session: {} }, error: null };
      }),
    };
    const client = { auth } as unknown as SupabaseClient;
    let calls = 0;
    const seed = vi.fn(() => (++calls === 1 ? new Promise<never>(() => {}) : Promise.resolve({ categories: 0, todos: 0, eveningLogs: 0, ratios: 0, ratioHistory: 0, weeklyGoals: 0, settings: 0 })));
    const { d } = setup(seed as unknown as DemoStartDeps["seed"], { getSupabase: async () => client });
    const first = startDemoCore(d, CODE);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await first).toEqual({ ok: false, error: "failed" });
    expect(await startDemoCore(d, CODE)).toEqual({ ok: true });
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(seed.mock.calls.every((c) => (c as unknown as [{ userId: string }])[0].userId === ANON)).toBe(true);
  });
});
