// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeRead } from "../../lib/home-types";

vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({ editTodo: vi.fn(), deleteTodo: vi.fn(), reorderTodos: vi.fn(), carryOverTodos: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/views/actions", () => ({ recordView: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(async () => ({ ok: true, data: { offer: null } })), dismissOffer: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("../../lib/read-client", () => ({
  fetchToday: vi.fn(async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { AppShell } from "../../components/app-shell";

const home = {
  today: {
    todos: { ok: true, data: { day: { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 }, todos: [] } },
    categories: { ok: true, data: { categories: [] } },
  },
  settings: { ok: false, error: "unavailable" },
} as HomeRead;

const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

let observed: (() => void) | null = null;
beforeEach(() => {
  observed = null;
  Element.prototype.scrollIntoView = vi.fn();
  class FakeObserver {
    constructor(cb: () => void) {
      observed = cb;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", FakeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("아래 탭 줄 높이 (B8·B9)", () => {
  it("탭 줄의 실제 높이를 재어 --tabbar-h에 넣고, 글자가 커져 두 줄이 되면 따라 바뀐다", async () => {
    let height = 64; // 고침9 A6: 한 줄 탭 줄 높이 64(Figma 50:185)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains("tabbar") ? height : 0 } as DOMRect;
    });
    const { container } = render(<AppShell home={home} />);
    await act(async () => {});
    const shell = container.querySelector<HTMLElement>(".app-shell")!;
    expect(shell.style.getPropertyValue("--tabbar-h")).toBe("64px");
    height = 104; // 200% 글자: 두 줄
    await act(async () => observed?.());
    expect(shell.style.getPropertyValue("--tabbar-h")).toBe("104px");
  });

  it("재기 전·아직 그려지지 않았을 때(0)는 한 줄 기준 값 + 안전 영역을 쓴다", async () => {
    const { container } = render(<AppShell home={home} />);
    await act(async () => {});
    expect(container.querySelector<HTMLElement>(".app-shell")!.style.getPropertyValue("--tabbar-h")).toBe("calc(64px + env(safe-area-inset-bottom))");
  });

  it("CSS: 탭 칸은 글에 밀려 넘치지 않고(min-width: 0) 글이 두 줄로 내려갈 수 있다. 스크롤 여백은 탭 줄 높이를 더한다", () => {
    expect(css).toMatch(/\.tabbar-item\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.tabbar-btn\s*\{[^}]*min-height:\s*64px/); // 높이는 최소값이라 늘어날 수 있다(고침9 A6: Figma 아래 탭 64)
    expect(css).toMatch(/\.tabbar-btn\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/html\s*\{\s*scroll-padding-bottom:[^;]*var\(--tabbar-h/);
  });

  it("CSS: 내 정보 탭도 상태보기와 같은 폭·아래 여백을 가진다(B1)", () => {
    expect(css).toMatch(/\.growth,\s*\.me\s*\{[^}]*max-width:[^}]*padding-bottom:\s*calc\(var\(--tabbar-h/);
  });

  it("CSS: 내 정보의 글 칸은 글자 200%에서도 자리 폭을 넘지 않는다(기본 폭 대신 100%, 스테퍼 칸은 그대로)", () => {
    expect(css).toMatch(/\.me \.input:not\(\.stepper-input\)\s*\{\s*width:\s*100%/);
  });
});
