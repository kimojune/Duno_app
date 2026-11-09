// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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

/** 아래 탭 순서와 처음 열리는 탭(PM 5, 디자인 명세 ⑩): 상태보기 · 할 일 · 타이머 · 내 정보, 처음 탭은 할 일 */
const home = {
  today: {
    todos: { ok: true, data: { day: { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 }, todos: [] } },
    categories: { ok: true, data: { categories: [] } },
  },
  settings: { ok: false, error: "unavailable" },
} as HomeRead;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  class FakeObserver {
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

describe("아래 탭 순서와 처음 탭", () => {
  it("탭 이름이 「상태보기 · 할 일 · 타이머 · 내 정보」 순서로 나오고 처음 열린 탭은 할 일이다", async () => {
    await act(async () => {
      render(<AppShell home={home} />);
    });
    const nav = screen.getByRole("navigation", { name: "화면 이동" });
    const buttons = Array.from(nav.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["상태보기", "할 일", "타이머", "내 정보"]);
    expect(buttons.map((b) => b.getAttribute("aria-current"))).toEqual([null, "page", null, null]);
  });
});
