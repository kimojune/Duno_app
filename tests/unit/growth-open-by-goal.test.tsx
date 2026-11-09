// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GrowthData } from "../../lib/growth/types";
import type { GrowthApi } from "../../lib/growth-api";

vi.mock("../../app/views/actions", () => ({ recordView: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));

import { GrowthScreen } from "../../components/growth-screen";

/**
 * 고침9(23 흐름도 135:2): 오늘 기록 저장 직후 「상태보기에서 보기 ›」로 열면(app-shell이 openByGoal) 목표 세운 주 → 「이번 주 목표」 탭,
 * 목표 없는 주 → 「목표 비율」 탭. 기억한 탭(그 주에 고른 탭)보다 이 이동이 먼저다. 그 열림에서 사용자가 고르면 고른 탭.
 */

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
function growth(goal: boolean): GrowthData {
  return {
    today: "2026-11-07",
    weekStart: "2026-11-02",
    lastWeekStart: "2026-10-26",
    lastMonthRange: { from: "2026-10-01", to: "2026-10-31" },
    categories: [{ id: C1, name: "어학" }],
    ratios: [{ categoryId: C1, percent: 100 }],
    thisWeek: [{ categoryId: C1, minutes: 60 }],
    lastWeek: [],
    lastMonth: [],
    cumulative: [{ categoryId: C1, minutes: 60 }],
    loggedDaysThisWeek: 1,
    loggedDaysTotal: 1,
    streakWeeks: 0,
    goal: goal ? { weekStart: "2026-11-02", items: [{ categoryId: C1, minutes: 300 }] } : null,
    goalText: null,
  };
}
/** 그 주에 사용자가 고른 탭을 기억한 상태 */
function api(data: GrowthData, rememberedTab: "goal" | "ratio"): GrowthApi {
  return {
    fetchGrowth: vi.fn(async () => ({ ok: true as const, data })),
    fetchCategoryPage: vi.fn(),
    recordView: vi.fn(async () => ({ ok: true as const })),
    viewPref: { load: async () => ({ tab: rememberedTab, tabWeek: "2026-11-02" }), save: vi.fn(async () => {}) },
  };
}
const selected = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")!.textContent;
async function mount(a: GrowthApi, openByGoal: boolean, activation = 1) {
  const view = render(<GrowthScreen api={a} active activation={activation} entry={openByGoal ? "after_save" : "self"} openByGoal={openByGoal} onOpenCategory={vi.fn()} />);
  await screen.findAllByRole("tab");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  return view;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("저장 직후 「상태보기에서 보기 ›」가 여는 탭(openByGoal)", () => {
  it("목표 세운 주 → 「이번 주 목표」(기억한 탭이 「목표 비율」이어도). 그냥 열면 기억한 탭 그대로", async () => {
    await mount(api(growth(true), "ratio"), true);
    expect(selected()).toBe("이번 주 목표");
    cleanup();
    await mount(api(growth(true), "ratio"), false);
    expect(selected()).toBe("목표 비율");
  });

  it("목표 없는 주 → 「목표 비율」(기억한 탭이 「이번 주 목표」여도). 그냥 열면 기억한 탭 그대로", async () => {
    await mount(api(growth(false), "goal"), true);
    expect(selected()).toBe("목표 비율");
    cleanup();
    await mount(api(growth(false), "goal"), false);
    expect(selected()).toBe("이번 주 목표");
  });

  it("그 열림에서 사용자가 탭을 고르면 고른 탭이 이긴다", async () => {
    const a = api(growth(true), "ratio");
    await mount(a, true);
    expect(selected()).toBe("이번 주 목표");
    await act(async () => fireEvent.click(screen.getByRole("tab", { name: "목표 비율" })));
    expect(selected()).toBe("목표 비율");
    expect(a.viewPref!.save).toHaveBeenCalledWith(expect.objectContaining({ tab: "ratio", tabWeek: "2026-11-02" }));
  });
});
