// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginButton } from "../../components/login-button";
import { LOGIN_TEXT, noticeFromErrorParam } from "../../lib/login-text";

const signInWithOAuth = vi.fn();
vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth } }),
}));

function setOnline(value: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
}

beforeEach(() => {
  signInWithOAuth.mockReset();
  setOnline(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("로그인 상태 L1~L5", () => {
  it("L1 기본: Google 단추 하나, 로고는 장식(alt 빈 값)", () => {
    render(<LoginButton />);
    const button = screen.getByRole("button", { name: LOGIN_TEXT.button });
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(button.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("L2 이동 중: aria-busy, 글이 바뀌고, 연달아 세 번 눌러도 요청은 한 번", async () => {
    signInWithOAuth.mockReturnValue(new Promise(() => {})); // 돌아오지 않음(페이지가 떠나는 중)
    render(<LoginButton />);
    const button = screen.getByRole("button", { name: LOGIN_TEXT.button });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain(LOGIN_TEXT.busy);
    // LiveRegion에도 같은 글
    expect(screen.getAllByRole("status").some((el) => el.textContent === LOGIN_TEXT.busy)).toBe(true);
  });

  it("L3 실패: role=alert 안내, 단추는 다시 눌린다", async () => {
    signInWithOAuth.mockResolvedValueOnce({ error: new Error("x") }).mockReturnValueOnce(new Promise(() => {}));
    render(<LoginButton />);
    const button = screen.getByRole("button", { name: LOGIN_TEXT.button });
    fireEvent.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(LOGIN_TEXT.failed);
    expect(button.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(button);
    expect(signInWithOAuth).toHaveBeenCalledTimes(2);
  });

  it("L4 취소: role=status이고 L3과 다른 문구", () => {
    render(<LoginButton initialNotice="cancelled" />);
    const notice = screen.getAllByRole("status").find((el) => el.textContent === LOGIN_TEXT.cancelled);
    expect(notice).toBeTruthy();
    expect(LOGIN_TEXT.cancelled).not.toBe(LOGIN_TEXT.failed);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("L5 오프라인: 눌러도 Google로 가지 않고, 연결되면 안내가 사라진다", async () => {
    setOnline(false);
    render(<LoginButton />);
    expect(screen.getAllByRole("status").some((el) => el.textContent === LOGIN_TEXT.offline)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: LOGIN_TEXT.button }));
    expect(signInWithOAuth).not.toHaveBeenCalled();
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getAllByRole("status").some((el) => el.textContent === LOGIN_TEXT.offline)).toBe(false);
  });

  it("L5 안내를 다시 읽힌다: 눌렀을 때 LiveRegion을 비웠다가 100ms 뒤에 다시 넣는다", () => {
    vi.useFakeTimers();
    setOnline(false);
    render(<LoginButton />);
    const live = () => screen.getAllByRole("status").find((el) => el.className.includes("sr-only"))!;
    fireEvent.click(screen.getByRole("button", { name: LOGIN_TEXT.button }));
    expect(live().textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(live().textContent).toBe(LOGIN_TEXT.offline);
  });

  it("뒤로 가기로 돌아올 때(pageshow persisted) L2에 멈추지 않고 L1로 돌아간다", () => {
    signInWithOAuth.mockReturnValue(new Promise(() => {}));
    render(<LoginButton />);
    const button = screen.getByRole("button", { name: LOGIN_TEXT.button });
    fireEvent.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    act(() => {
      const event = new Event("pageshow") as Event & { persisted: boolean };
      event.persisted = true;
      window.dispatchEvent(event);
    });
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(button.textContent).toContain(LOGIN_TEXT.button);
  });
});

describe("noticeFromErrorParam (D2)", () => {
  it("취소·설정 값 없음·그 밖을 가르고, 모르는 값은 L3, 값을 그대로 내지 않는다", () => {
    expect(noticeFromErrorParam(undefined)).toBeNull();
    expect(noticeFromErrorParam("cancelled")).toBe("cancelled");
    expect(noticeFromErrorParam("config")).toBe("config");
    expect(noticeFromErrorParam("login")).toBe("failed");
    expect(noticeFromErrorParam("<script>")).toBe("failed");
    expect(noticeFromErrorParam(["cancelled", "x"])).toBe("cancelled");
  });
});

describe("토큰·단추 값 (명세 2-1, 2-4)", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
  it("명세 2-1 토큰 값이 그대로 있고, 빠졌던 --color-secondary-pressed가 더해졌다", () => {
    const expected: Record<string, string> = {
      "--color-bg": "#FAFAF7",
      "--color-surface": "#FFFFFF",
      "--color-text": "#1C1C1A",
      "--color-text-sub": "#5C5B55",
      "--color-primary": "#2F5D50",
      "--color-primary-pressed": "#24493F",
      "--color-secondary-pressed": "#E3E1D9",
      "--color-on-primary": "#FFFFFF",
      "--color-border-input": "#7A7972",
      "--color-border-check": "#5C5B55",
      "--color-divider": "#E6E4DD",
      "--color-notice-bg": "#EFEDE6",
      "--color-skeleton": "#E6E4DD",
      "--tap-min": "48px",
      "--page-x": "16px",
      "--page-max": "480px",
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(css, name).toContain(`${name}: ${value};`);
    }
    expect(css).toContain("--font-name: 700 32px/40px");
    expect(css).toContain("--font-title: 700 24px/32px");
    expect(css).toContain("--font-body: 400 16px/24px");
    expect(css).toContain("--font-sub: 400 14px/20px");
  });

  it("단추·입력·할 일 줄에 고정 height가 없고(min-height만), 노랑 알림 색이 없다 (D12)", () => {
    // height를 쓰는 규칙은 크기가 뜻인 장식뿐이다: 안 보이는 .sr-only(1px), G 로고(20px), 체크 모양(24px·체크 표시), 로딩 뼈대(24px)
    const allowed = [".sr-only", ".google-btn img", ".check-box", ".check-hit input:checked + .check-box::after", ".skeleton-box"];
    const withHeight: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (/(^|[;\s])height\s*:/.test(m[2])) withHeight.push(selector);
    }
    for (const selector of withHeight) expect(allowed, selector).toContain(selector);
    expect(css.toLowerCase()).not.toContain("#fdf0d5");
  });

  it("Google 단추 Light 값: 면 #FFFFFF, 테두리 1px #747775, 글자 #1F1F1F, 안쪽 12px, 로고와 글 10px", () => {
    const block = /\.google-btn\s*\{([^}]*)\}/.exec(css)![1];
    expect(block).toContain("background: #FFFFFF");
    expect(block).toContain("border: 1px solid #747775");
    expect(block).toContain("color: #1F1F1F");
    expect(block).toContain("padding: 0 12px");
    expect(block).toContain("gap: 10px");
    expect(block).toContain("min-height: var(--tap-min)");
  });
});
