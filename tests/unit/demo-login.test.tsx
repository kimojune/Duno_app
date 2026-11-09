// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginButton } from "../../components/login-button";
import type { DemoStartResult } from "../../lib/demo/start";
import { DEMO_TEXT } from "../../lib/login-text";

vi.mock("../../lib/supabase/server", () => ({ createClient: async () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function codeInput() {
  return screen.getByRole("textbox", { name: DEMO_TEXT.label }) as HTMLInputElement;
}
function startButton() {
  return screen.getByRole("button", { name: DEMO_TEXT.buttonName }) as HTMLButtonElement;
}
function googleButton() {
  return screen.getByRole("button", { name: /Google로 로그인|Google로 이동하는 중/ }) as HTMLButtonElement;
}

describe("로그인 화면 체험 코드 칸(23 S0)", () => {
  it("startDemo가 없으면(꺼짐) 칸·단추를 그리지 않는다 — Google 단추만", () => {
    render(<LoginButton />);
    expect(googleButton()).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: DEMO_TEXT.buttonName })).toBeNull();
    expect(screen.queryByText(DEMO_TEXT.label)).toBeNull();
  });

  it("켜지면 Google 단추 아래에 보이는 이름표 「체험 코드」 + 칸(흐린 글 없음) + 「시작」(이름 「체험 코드로 시작」)", () => {
    render(<LoginButton startDemo={vi.fn()} />);
    const input = codeInput();
    expect(screen.getByText(DEMO_TEXT.label).tagName).toBe("LABEL");
    expect(input.getAttribute("placeholder")).toBeNull();
    expect(startButton().textContent).toBe("시작");
    // 문서 순서: Google 단추가 먼저, 체험 칸이 그 아래
    expect(googleButton().compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("쓰는 글은 대문자로 바뀐다(붙여넣기도)", () => {
    render(<LoginButton startDemo={vi.fn()} />);
    fireEvent.change(codeInput(), { target: { value: "duno-2026" } });
    expect(codeInput().value).toBe("DUNO-2026");
  });

  it("틀린 코드: 서버 행동에 쓴 값을 넘기고, 칸 아래 오류(role=alert, 칸의 aria-describedby) · 값 남음 · 초점은 칸으로", async () => {
    vi.useFakeTimers();
    const startDemo = vi.fn(async (): Promise<DemoStartResult> => ({ ok: false, error: "wrong_code" }));
    render(<LoginButton startDemo={startDemo} />);
    fireEvent.change(codeInput(), { target: { value: "nope-1" } });
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(startDemo).toHaveBeenCalledWith("NOPE-1");
    const alert = screen.getAllByRole("alert").find((el) => el.textContent?.includes(DEMO_TEXT.wrong_code))!;
    expect(alert).toBeTruthy();
    expect(codeInput().getAttribute("aria-invalid")).toBe("true");
    expect(codeInput().getAttribute("aria-describedby")).toBe(alert.id);
    expect(codeInput().value).toBe("NOPE-1");
    await act(async () => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(codeInput());
  });

  it("시작 중: 「시작 중」 + 두 단추 막힘, 다시 눌러도 서버 행동은 한 번", async () => {
    let resolve!: (r: DemoStartResult) => void;
    const startDemo = vi.fn(() => new Promise<DemoStartResult>((r) => (resolve = r)));
    const onDemoStarted = vi.fn();
    render(<LoginButton startDemo={startDemo} onDemoStarted={onDemoStarted} />);
    fireEvent.change(codeInput(), { target: { value: "DUNO" } });
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(startButton().textContent).toBe(DEMO_TEXT.busy);
    expect(startButton().disabled).toBe(true);
    expect(startButton().getAttribute("aria-busy")).toBe("true");
    expect(googleButton().disabled).toBe(true);
    fireEvent.submit(codeInput().form!);
    fireEvent.click(googleButton());
    expect(startDemo).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true }));
    expect(onDemoStarted).toHaveBeenCalledTimes(1);
  });

  it("빈 칸으로 누르면 서버 행동을 부르지 않고 안내", async () => {
    const startDemo = vi.fn();
    render(<LoginButton startDemo={startDemo} />);
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(startDemo).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes(DEMO_TEXT.empty))).toBe(true);
  });

  it("서버가 한도로 막으면 그 안내, 실패면 실패 안내(단추는 다시 눌린다)", async () => {
    const startDemo = vi
      .fn<(code: string) => Promise<DemoStartResult>>()
      .mockResolvedValueOnce({ ok: false, error: "rate_limited" })
      .mockRejectedValueOnce(new Error("network"));
    render(<LoginButton startDemo={startDemo} />);
    fireEvent.change(codeInput(), { target: { value: "X" } });
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes(DEMO_TEXT.rate_limited))).toBe(true);
    expect(startButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes(DEMO_TEXT.failed))).toBe(true);
    expect(startDemo).toHaveBeenCalledTimes(2);
  });
});

describe("첫 화면(app/page.tsx) — 켜짐 여부만 넘긴다", () => {
  it("DEMO_ACCESS_CODE가 비면 로그인 화면에 체험 칸이 없다", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    const { default: Home } = await import("../../app/page");
    render(await Home({ searchParams: Promise.resolve({}) }));
    expect(googleButton()).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: DEMO_TEXT.label })).toBeNull();
  });

  it("값이 있으면 칸이 있고, 그린 HTML에 코드 값이 없다", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "TEST-SECRET-77");
    const { default: Home } = await import("../../app/page");
    const { container } = render(await Home({ searchParams: Promise.resolve({}) }));
    expect(codeInput()).toBeTruthy();
    expect(container.innerHTML).not.toContain("TEST-SECRET-77");
  });
});
