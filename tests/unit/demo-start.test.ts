import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDemo } from "../../app/demo/actions";
import { DEMO_LIMIT_MAX_FAILURES, DEMO_LIMIT_WINDOW_MS, DemoAttemptLimiter } from "../../lib/demo/access";
import { DemoSeedError, seedDemoData, type DemoSeedCounts } from "../../lib/demo/seed";
import { startDemoCore, type DemoStartDeps } from "../../lib/demo/start";
import { parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

// 시험용 코드(진짜 값이 아니다)
const CODE = "TEST-CODE-42";
const ANON = "33333333-3333-4333-8333-333333333333";
const REAL = "44444444-4444-4444-8444-444444444444";
const key = parseTodoKey(randomBytes(32).toString("base64"))!;
const COUNTS: DemoSeedCounts = { categories: 4, todos: 1, eveningLogs: 1, ratios: 4, ratioHistory: 1, weeklyGoals: 1, settings: 1 };

type Claims = { sub: string; is_anonymous?: boolean } | null;

function fakeAuth(initial: Claims, signIn: { error?: { status: number; code: string } } = {}) {
  let claims = initial;
  const auth = {
    getClaims: vi.fn(async () => ({ data: claims ? { claims } : null, error: null })),
    signInAnonymously: vi.fn(async () => {
      if (signIn.error) return { data: { user: null, session: null }, error: { name: "AuthApiError", message: "x", ...signIn.error } };
      claims = { sub: ANON, is_anonymous: true };
      return { data: { user: { id: ANON }, session: {} }, error: null };
    }),
  };
  return { auth } as unknown as SupabaseClient & { auth: typeof auth };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  vi.unstubAllEnvs();
});

function deps(over: Partial<DemoStartDeps> = {}, client = fakeAuth(null)) {
  const seed = vi.fn(async () => COUNTS);
  const getSupabase = vi.fn(async () => client as SupabaseClient);
  const d: DemoStartDeps = {
    expectedCode: CODE,
    limiter: new DemoAttemptLimiter(),
    limitKeys: ["ip:1.2.3.4", "device:a"],
    now: () => 0,
    getSupabase,
    key,
    today: () => "2026-11-09",
    seed,
    ...over,
  };
  return { d, seed: (over.seed ?? seed) as typeof seed, getSupabase, client };
}

describe("체험 코드로 시작 — 서버 순서", () => {
  it("코드가 맞으면: 익명 로그인 한 번 → 그 사용자로 예시 데이터(오늘·키 함께) → 성공", async () => {
    const { d, seed, client } = deps();
    expect(await startDemoCore(d, "test-code-42")).toEqual({ ok: true });
    expect(client.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledWith({ supabase: client, userId: ANON, key, today: "2026-11-09" });
  });

  it("코드가 틀리면: 거절, 익명 로그인 0번·예시 데이터 0번·Supabase 클라이언트도 안 만든다", async () => {
    const { d, seed, getSupabase, client } = deps();
    expect(await startDemoCore(d, "WRONG")).toEqual({ ok: false, error: "wrong_code" });
    expect(await startDemoCore(d, "")).toEqual({ ok: false, error: "wrong_code" });
    expect(await startDemoCore(d, undefined)).toEqual({ ok: false, error: "wrong_code" });
    expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it("체험이 꺼졌으면(코드 환경 변수 없음): 맞는 코드처럼 보내도 거절, 아무것도 부르지 않고 한도도 세지 않는다", async () => {
    const { d, seed, getSupabase } = deps({ expectedCode: null });
    for (let i = 0; i < DEMO_LIMIT_MAX_FAILURES + 1; i += 1) expect(await startDemoCore(d, CODE)).toEqual({ ok: false, error: "off" });
    expect(await startDemoCore(d, "")).toEqual({ ok: false, error: "off" });
    expect(seed).not.toHaveBeenCalled();
    expect(getSupabase).not.toHaveBeenCalled();
    expect(d.limiter.size()).toBe(0);
  });

  it("서버 행동을 직접 불러도 DEMO_ACCESS_CODE가 비면 거절(off)", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    expect(await startDemo(CODE)).toEqual({ ok: false, error: "off" });
    expect(await startDemo("")).toEqual({ ok: false, error: "off" });
  });

  it("틀린 코드 5번 뒤에는 맞는 코드도 막히고(로그인 0번), 10분 창이 지나면 맞는 코드가 다시 된다", async () => {
    let now = 0;
    const { d, seed, client } = deps({ now: () => now });
    for (let i = 0; i < DEMO_LIMIT_MAX_FAILURES; i += 1) expect((await startDemoCore(d, `WRONG-${i}`)).ok).toBe(false);
    expect(await startDemoCore(d, CODE)).toEqual({ ok: false, error: "rate_limited" });
    expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
    now = DEMO_LIMIT_WINDOW_MS;
    expect(await startDemoCore(d, CODE)).toEqual({ ok: true });
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it("한도 전에는 맞는 코드가 통과한다(틀린 코드 4번 뒤)", async () => {
    const { d } = deps();
    for (let i = 0; i < DEMO_LIMIT_MAX_FAILURES - 1; i += 1) await startDemoCore(d, "WRONG");
    expect(await startDemoCore(d, CODE)).toEqual({ ok: true });
  });

  it("이미 체험(익명) 세션이면 익명 로그인을 다시 하지 않고 그 사용자로 예시 데이터 — 「시작」 연타·재시도에 익명 사용자가 늘지 않는다", async () => {
    const client = fakeAuth({ sub: ANON, is_anonymous: true });
    const { d, seed } = deps({}, client);
    expect(await startDemoCore(d, CODE)).toEqual({ ok: true });
    expect(await startDemoCore(d, CODE)).toEqual({ ok: true });
    expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(seed).toHaveBeenCalledTimes(2);
    expect(seed.mock.calls.every((c) => (c as unknown as [{ userId: string }])[0].userId === ANON)).toBe(true);
  });

  it("처음엔 로그인, 두 번째 누름은 같은 세션을 다시 쓴다(익명 로그인은 한 번)", async () => {
    const { d, client } = deps();
    await startDemoCore(d, CODE);
    await startDemoCore(d, CODE);
    expect(client.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("정식 계정으로 이미 로그인돼 있으면 예시 데이터를 넣지 않고 그대로 들여보낸다", async () => {
    const client = fakeAuth({ sub: REAL, is_anonymous: false });
    const { d, seed } = deps({}, client);
    expect(await startDemoCore(d, CODE)).toEqual({ ok: true });
    expect(seed).not.toHaveBeenCalled();
    expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("Supabase가 익명 로그인을 막으면(꺼짐·CAPTCHA) 짧은 실패, 예시 데이터 0번, 로그는 status·code만", async () => {
    const client = fakeAuth(null, { error: { status: 422, code: "anonymous_provider_disabled" } });
    const { d, seed } = deps({}, client);
    expect(await startDemoCore(d, CODE)).toEqual({ ok: false, error: "failed" });
    expect(seed).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[demo] sign_in_failed status=422 code=anonymous_provider_disabled");
    expect(String(warn.mock.calls)).not.toContain(CODE);
  });

  it("암호화 키가 없으면 로그인 전에 실패(익명 사용자를 만들지 않는다)", async () => {
    const { d, client, seed } = deps({ key: null });
    expect(await startDemoCore(d, CODE)).toEqual({ ok: false, error: "failed" });
    expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
  });

  it("예시 데이터가 실패하면 짧은 실패(로그에 단계·코드만)", async () => {
    const seed = vi.fn(async () => {
      throw new DemoSeedError("todos", "P0001");
    });
    const { d } = deps({ seed });
    expect(await startDemoCore(d, CODE)).toEqual({ ok: false, error: "failed" });
    expect(warn).toHaveBeenCalledWith("[demo] seed_failed_todos code=P0001");
  });

  it("끝까지(가짜 표): 맞는 코드 → 익명 로그인 → 예시 데이터가 그 사용자 행으로 → 처음 설정 끝 표시", async () => {
    const store = new FakeStore();
    store.rules = v2Rules();
    const tables = fakeTablesClient(store, { sub: ANON });
    const auth = fakeAuth(null);
    const client = Object.assign(Object.create(null), { from: tables.from.bind(tables), auth: auth.auth }) as SupabaseClient;
    const { d } = deps({ seed: seedDemoData, getSupabase: async () => client });
    expect(await startDemoCore(d, CODE)).toEqual({ ok: true });
    expect(auth.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(store.table("todos").length).toBeGreaterThan(0);
    expect(store.table("todos").every((t) => t.user_id === ANON)).toBe(true);
    expect(store.table("user_settings")[0]).toMatchObject({ user_id: ANON });
    expect(store.table("user_settings")[0].onboarding_done_at).toEqual(expect.any(String));
  });
});
