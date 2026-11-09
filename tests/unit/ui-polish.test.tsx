// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeRead } from "../../lib/home-types";
import type { GrowthData } from "../../lib/growth/types";
import type { GrowthApi } from "../../lib/growth-api";
import type { ManageApi } from "../../lib/manage-api";
import type { OffersApi } from "../../lib/offers-api";
import type { TodayRead } from "../../lib/today-types";
import type { TodoItem } from "../../lib/todos/types";

const signOut = vi.fn();
vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({ editTodo: vi.fn(), deleteTodo: vi.fn(), reorderTodos: vi.fn(), carryOverTodos: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/views/actions", () => ({ recordView: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(async () => ({ ok: true, data: { offer: null } })), dismissOffer: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/actions", () => ({ signOut: (...a: unknown[]) => signOut(...a) }));
vi.mock("../../lib/read-client", () => ({
  fetchToday: vi.fn(async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { AppShell } from "../../components/app-shell";
import { GrowthScreen } from "../../components/growth-screen";
import { TodoScreen } from "../../components/todo-screen";

const DAY = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const item = (id: string, text: string): TodoItem => ({ id, readable: true, text, done: false, createdAt: "x", categoryId: null });
const today = (todos: TodoItem[]): TodayRead => ({ todos: { ok: true, data: { day: DAY, todos } }, categories: { ok: true, data: { categories: [] } } });
const home = (todos: TodoItem[] = []) =>
  ({
    today: today(todos),
    settings: {
      ok: true,
      data: { goal: null, goalReadable: true, onboardingDone: true, notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 }, ratios: [] },
    },
  }) as HomeRead;
const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

function manage(over: Partial<ManageApi> = {}): ManageApi {
  return {
    editTodo: vi.fn(),
    deleteTodo: vi.fn(),
    reorderTodos: vi.fn(),
    addNote: vi.fn(),
    deleteNote: vi.fn(),
    fetchNotes: vi.fn(async () => ({ ok: true as const, data: { notes: [] } })),
    fetchYesterday: vi.fn(async () => ({ ok: true as const, data: { todos: [] as TodoItem[] } })),
    carryOver: vi.fn(),
    ...over,
  } as ManageApi;
}

beforeEach(() => {
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("「자세히」는 줄 오른쪽 작은 단추 (B16)", () => {
  it("줄 글 영역 밖, 줄의 오른쪽에 놓이고 누르는 면은 48px 이상으로 남는다", () => {
    render(<TodoScreen initial={today([item(A, "이력서")])} manage={manage()} />);
    const button = screen.getByRole("button", { name: "자세히 보기: 이력서" });
    const row = document.getElementById(`row-${A}`)!;
    expect(row.contains(button)).toBe(true);
    expect(row.querySelector(".todo-body")!.contains(button)).toBe(false);
    expect(button.closest(".row-detail")?.parentElement).toBe(row);
    // 줄 안 순서: 체크 칸 → 글 → 자세히(오른쪽 끝)
    expect(row.lastElementChild).toBe(button.closest(".row-detail"));
    expect(css).toMatch(/\.row-detail-btn\s*\{[^}]*min-width:\s*var\(--tap-min\)/);
    expect(css).toMatch(/\.btn\s*\{[^}]*min-height:\s*var\(--tap-min\)/); // 높이 48 이상은 단추 공통 규칙
  });

  it("목록 위에 얹는 카드·목표 줄은 응답 전에 자리를 비워 두고, 응답이 오면 자리가 카드로 바뀌거나 접힌다", async () => {
    let resolveCard: (v: unknown) => void = () => {};
    const offers = {
      request: vi.fn(() => new Promise((r) => (resolveCard = r))),
      dismiss: vi.fn(),
    } as unknown as OffersApi;
    const { container } = render(<AppShell home={home([item(A, "이력서")])} apis={{ offers }} />);
    expect(container.querySelector(".slot-card")).not.toBeNull();
    expect(container.querySelector(".slot-goal")).not.toBeNull();
    await act(async () => resolveCard({ ok: true, data: { offer: null, reason: "no_target" } }));
    expect(container.querySelector(".slot-card")).toBeNull(); // 카드가 없으면 자리는 접힌다
    expect(css).toMatch(/\.slot-card\s*\{[^}]*min-height/);
    expect(css).toMatch(/\.slot-goal\s*\{[^}]*min-height/);
    expect(css).toMatch(/\.slot-carry\s*\{[^}]*min-height/);
  });

  it("어제 못 끝낸 할 일 줄도 응답 전에는 자리를 비워 둔다", async () => {
    let resolveYesterday: (v: unknown) => void = () => {};
    const api = manage({ fetchYesterday: vi.fn(() => new Promise((r) => (resolveYesterday = r))) as never });
    const { container } = render(<TodoScreen initial={today([])} manage={api} />);
    expect(container.querySelector(".slot-carry")).not.toBeNull();
    await act(async () => resolveYesterday({ ok: true, data: { todos: [] } }));
    expect(container.querySelector(".slot-carry")).toBeNull();
  });
});

describe("상태보기 기록 없음의 「오늘 기록」 단추 (B17, 고침5: PM 4 「오늘 기록」)", () => {
  const empty: GrowthData = {
    today: "2026-11-07",
    weekStart: "2026-11-02",
    lastWeekStart: "2026-10-26",
    lastMonthRange: { from: "2026-10-01", to: "2026-10-31" },
    categories: [],
    ratios: [],
    thisWeek: [],
    lastWeek: [],
    lastMonth: [],
    cumulative: [],
    loggedDaysThisWeek: 0,
    loggedDaysTotal: 0,
    goal: null,
    goalText: null,
  };
  const api = (data: GrowthData): GrowthApi =>
    ({ fetchGrowth: async () => ({ ok: true as const, data }), fetchCategoryPage: vi.fn(), recordView: vi.fn() }) as unknown as GrowthApi;

  it("이번 주 기록이 없으면 빈 안내 아래에 단추가 보이고, 누르면 저녁 기록을 연다", async () => {
    const onOpenEvening = vi.fn();
    await act(async () => {
      render(<GrowthScreen api={api(empty)} active activation={1} entry="self" onOpenCategory={() => {}} onOpenEvening={onOpenEvening} />);
    });
    expect(screen.getByText(/아직 이번 주 오늘 기록이 없어요/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "저녁 기록 남기기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "오늘 기록" }));
    expect(onOpenEvening).toHaveBeenCalledTimes(1);
  });
  it("기록이 있으면 단추가 없다", async () => {
    await act(async () => {
      render(
        <GrowthScreen
          api={api({ ...empty, thisWeek: [{ categoryId: null, minutes: 30 }] })}
          active
          activation={1}
          entry="self"
          onOpenCategory={() => {}}
          onOpenEvening={() => {}}
        />,
      );
    });
    expect(screen.queryByRole("button", { name: "오늘 기록" })).toBeNull();
    expect(screen.queryByRole("button", { name: "저녁 기록 남기기" })).toBeNull();
  });
});

describe("내 정보 맨 아래 로그아웃 (B18)", () => {
  it("할 일 탭의 로그아웃 흐름을 부른다: 저장 안 된 글이 없으면 바로 로그아웃", async () => {
    render(<AppShell home={home()} />);
    await act(async () => {});
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    expect(signOut).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(document.getElementById("me-logout-button")!));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "할 일" }).getAttribute("aria-current")).toBe("page");
  });
  it("적던 글이 있으면 할 일 탭에서 확인을 거친다(바로 로그아웃하지 않는다)", async () => {
    render(<AppShell home={home()} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /^(할 일 적기|적던 글 이어 적기)$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: "적던 글" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    await act(async () => fireEvent.click(document.getElementById("me-logout-button")!));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByText("아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.")).toBeTruthy();
  });
});

describe("이름 통일 (B14)", () => {
  it("저녁 기록 입구 단추는 「오늘 기록 남기기」다", async () => {
    render(
      <AppShell
        home={home([item(A, "이력서")])}
        apis={{ offers: { request: async () => ({ ok: true as const, data: { offer: null } }), dismiss: vi.fn() } as unknown as OffersApi }}
      />,
    );
    await act(async () => {});
    expect(screen.getByRole("button", { name: "오늘 기록 남기기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "오늘 기록하기" })).toBeNull();
  });
  it("내 정보의 목표 제목은 「이루고 싶은 것」이고 알림 이름 「오늘 기록 알림」은 그대로다", async () => {
    render(<AppShell home={home()} />);
    await act(async () => {});
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    expect(screen.getByRole("heading", { name: "이루고 싶은 것" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "오늘 기록 알림" })).toBeTruthy();
  });
});
