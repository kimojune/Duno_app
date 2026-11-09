// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeRead } from "../../lib/home-types";
import type { TodayRead } from "../../lib/today-types";
import { computeGrowth } from "../../lib/growth/compute";

/**
 * 고침10 H(PM 16, 동작): 내 정보 S8-b에서 목표 한 문장을 바꾸면 상태보기 맨 위 줄이 바로 바뀐다.
 * 서버 길(AppShell: 저장은 서버 행동, 상태보기는 GET /growth)에서 같은 흐름을 재현한다.
 * 기기 먼저 저장 길(LocalAppShell)은 tests/unit/local-app-shell.test.tsx 「고침6 ③」이 같은 흐름을 본다.
 */
vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({ editTodo: vi.fn(), deleteTodo: vi.fn(), reorderTodos: vi.fn(), carryOverTodos: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
const serverGoal = { value: "토익 900점" as string | null };
const saveSettings = vi.fn(async (patch: { goal?: string | null }) => {
  if (patch.goal !== undefined) serverGoal.value = patch.goal;
  return { ok: true as const, data: { goal: serverGoal.value, goalReadable: true, onboardingDone: true, notify: NOTIFY } };
});
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: (p: { goal?: string | null }) => saveSettings(p) }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/views/actions", () => ({ recordView: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(async () => ({ ok: true, data: { offer: null } })), dismissOffer: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
const fetchToday = vi.fn();
vi.mock("../../lib/read-client", () => ({ fetchToday: (...a: unknown[]) => fetchToday(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { AppShell } from "../../components/app-shell";

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const NOTIFY = { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 };
const DAY = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const read: TodayRead = {
  todos: { ok: true, data: { day: DAY, todos: [] } },
  categories: { ok: true, data: { categories: [{ id: C1, readable: true as const, name: "어학", createdAt: "x" }] } },
};
const home = {
  today: read,
  settings: { ok: true, data: { goal: "토익 900점", goalReadable: true, onboardingDone: true, notify: NOTIFY, ratios: [{ categoryId: C1, percent: 100 }] } },
} as HomeRead;

beforeEach(() => {
  serverGoal.value = "토익 900점";
  saveSettings.mockClear();
  fetchToday.mockReset();
  fetchToday.mockResolvedValue(read);
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
  // GET /growth: 서버가 지금 저장된 목표 한 문장으로 계산한 상태보기
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).startsWith("/growth")) {
        const data = computeGrowth({ today: "2026-11-07", logs: [], categories: [{ id: C1, name: "어학" }], ratios: [{ categoryId: C1, percent: 100 }], goalItems: null, goalText: serverGoal.value });
        return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: "unavailable" }), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const goalLine = () => document.querySelector(".growth-goal-line")?.textContent ?? null;

describe("PM 16: 내 정보에서 바꾼 목표 한 문장 → 상태보기 맨 위 줄", () => {
  it("서버 길: 바꿔 저장하고 상태보기를 열면 새 문장, 비우고 저장하면 줄이 사라진다 · 값은 글자 그대로", async () => {
    render(<AppShell home={home} />);
    await act(async () => {});
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "상태보기" })));
    await waitFor(() => expect(goalLine()).toBe("목표, 토익 900점"));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "목표, 토익 900점, 고치기" })));
    const dlg = screen.getByRole("dialog", { name: "목표" });
    await act(async () => fireEvent.change(within(dlg).getByRole("textbox", { name: "목표" }), { target: { value: "<img src=x> 글 한 편 끝내기" } }));
    await act(async () => fireEvent.click(within(dlg).getByRole("button", { name: "저장" })));
    expect(saveSettings).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "상태보기" })));
    await waitFor(() => expect(goalLine()).toBe("목표, <img src=x> 글 한 편 끝내기"));
    expect(document.querySelector(".growth-goal-line img")).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^목표, .*고치기$/ })));
    const dlg2 = screen.getByRole("dialog", { name: "목표" });
    await act(async () => fireEvent.change(within(dlg2).getByRole("textbox", { name: "목표" }), { target: { value: "" } }));
    await act(async () => fireEvent.click(within(dlg2).getByRole("button", { name: "저장" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "상태보기" })));
    await waitFor(() => expect(goalLine()).toBeNull());
  });
});
