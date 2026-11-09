// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeRead } from "../../lib/home-types";
import type { TodayRead } from "../../lib/today-types";

vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({ editTodo: vi.fn(), deleteTodo: vi.fn(), reorderTodos: vi.fn(), carryOverTodos: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/views/actions", () => ({ recordView: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(async () => ({ ok: true, data: { offer: null } })), dismissOffer: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
const fetchToday = vi.fn();
vi.mock("../../lib/read-client", () => ({ fetchToday: (...a: unknown[]) => fetchToday(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { AppShell } from "../../components/app-shell";

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const DAY = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const read = (names: [string, string][]): TodayRead => ({
  todos: { ok: true, data: { day: DAY, todos: [] } },
  categories: { ok: true, data: { categories: names.map(([id, name]) => ({ id, readable: true as const, name, createdAt: "x" })) } },
});
const home = {
  today: read([[C1, "어학"]]),
  settings: {
    ok: true,
    data: {
      goal: null,
      goalReadable: true,
      onboardingDone: true,
      notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 },
      ratios: [{ categoryId: C1, percent: 100 }],
    },
  },
} as HomeRead;

beforeEach(() => {
  fetchToday.mockReset();
  fetchToday.mockResolvedValue(read([[C1, "어학"]]));
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("내 정보 탭의 분야 목록 (A15·B12)", () => {
  it("탭을 열 때마다 분야를 다시 읽어, 그사이 더한 분야가 비율 목록에 보인다", async () => {
    render(<AppShell home={home} />);
    await act(async () => {});
    fetchToday.mockResolvedValue(read([[C1, "어학"], [C2, "새 분야"]]));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    expect(fetchToday).toHaveBeenCalled();
    // 고침9: 비율 목록은 S8-a 안에 있다(카드를 눌러 연다)
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^목표 비율, / })));
    expect(screen.getAllByText("새 분야").length).toBeGreaterThan(0);
    await act(async () => fireEvent.click(within(screen.getByRole("dialog", { name: "목표 비율" })).getByRole("button", { name: "이전" })));
    // 다시 열 때도 다시 읽는다
    const calls = fetchToday.mock.calls.length;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "할 일" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    expect(fetchToday.mock.calls.length).toBeGreaterThan(calls);
  });

  it("다시 읽기가 실패하면 앞서 가진 목록을 그대로 둔다", async () => {
    render(<AppShell home={home} />);
    await act(async () => {});
    fetchToday.mockResolvedValue({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^목표 비율, / })));
    expect(screen.getAllByText("어학").length).toBeGreaterThan(0);
  });
});
