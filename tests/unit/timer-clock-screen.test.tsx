// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerScreen } from "../../components/timer-screen";
import type { FocusApi, FocusStartInput } from "../../lib/focus-api";
import type { FocusSession, FocusState } from "../../lib/focus/types";
import type { TodayRead } from "../../lib/today-types";

/** 고침 11: 타이머 시계 배경(T1·T5·T6, 23 명세 4절)과 「오늘 할 일에 추가」 뒤 타이머 탭(K9) */
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const START = Date.parse("2026-11-07T03:00:00.000Z");

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: "51515151-5151-4151-8151-515151515151",
    startedAt: new Date(START).toISOString(),
    day: "2026-11-07",
    plannedMinutes: 30,
    endedAt: null,
    elapsedSeconds: null,
    todoId: null,
    categoryId: null,
    offerId: null,
    surface: "manual",
    oppositeByGoal: null,
    oppositeByRatio: false,
    ...over,
  };
}
const todayRead = (todos: { id: string; text: string; categoryId?: string | null }[] = []): TodayRead => ({
  todos: {
    ok: true,
    data: {
      day: { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 },
      todos: todos.map((t) => ({ id: t.id, readable: true as const, text: t.text, done: false, createdAt: "x", categoryId: t.categoryId ?? null })),
    },
  },
  categories: {
    ok: true,
    data: {
      categories: [
        { id: C1, readable: true, name: "어학", createdAt: "x" },
        { id: C2, readable: true, name: "글쓰기", createdAt: "x" },
      ],
    },
  },
});
const focusState = (over: Partial<FocusState> = {}): FocusState => ({ serverNow: new Date(START).toISOString(), active: null, today: [], ...over });
function fakeApi(state: FocusState = focusState()): FocusApi {
  return {
    fetchState: vi.fn(async () => ({ ok: true as const, data: state })),
    start: vi.fn(async (input: FocusStartInput) => ({
      ok: true as const,
      data: { session: session({ id: input.id, todoId: input.todoId ?? null, categoryId: input.categoryId ?? null, surface: input.surface }), serverNow: new Date(START).toISOString() },
    })),
    end: vi.fn(async (id: string) => ({ ok: true as const, data: { session: session({ id, endedAt: "x", elapsedSeconds: 1 }) } })),
  };
}

let clock = START;
const now = () => clock;
async function mount(api: FocusApi, read: TodayRead = todayRead(), extra: Partial<React.ComponentProps<typeof TimerScreen>> = {}) {
  const view = render(<TimerScreen api={api} fetchToday={async () => read} active activation={1} now={now} {...extra} />);
  await act(async () => {});
  return view;
}
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const tick = async (ms: number) => {
  clock = START + ms;
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
};
const sector = () => document.querySelector(".clock-sector");
const reduced = (matches: boolean) =>
  vi.fn((query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() }));

beforeEach(() => {
  clock = START;
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("타이머 시계 (T1 · T5 · T6)", () => {
  it("도는 중: SVG는 꾸밈(aria-hidden · focusable=false)이고, 글이 정보를 맡는다(「남은 시간」 · role=timer · aria-label 그대로 · 상태 글)", async () => {
    await mount(fakeApi(focusState({ active: session({ categoryId: C1 }) })));
    const svg = document.querySelector(".timer-face svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelectorAll("line")).toHaveLength(30);
    expect([...svg.querySelectorAll("text")].map((t) => t.textContent)).toEqual(["0", "5", "10", "15", "20", "25"]);
    expect(svg.querySelectorAll("[tabindex]")).toHaveLength(0);
    expect(screen.getByText("남은 시간")).toBeTruthy();
    const timer = screen.getByRole("timer");
    expect(timer.textContent).toBe("30:00");
    expect(timer.getAttribute("aria-label")).toBe("30분 타이머가 돌고 있어요");
    expect(screen.getByText("30분 타이머가 돌고 있어요", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "끝내기" })).toBeTruthy();
  });

  it("부채꼴 색은 분야 순서의 토큰, 기타(분야 없음)는 기타 색, 윤곽은 공통 클래스(chart-outline-svg)", async () => {
    const first = await mount(fakeApi(focusState({ active: session({ categoryId: C2 }) })));
    expect(sector()!.getAttribute("style")).toContain("var(--color-category-2)"); // 두 번째 분야
    expect(sector()!.getAttribute("class")).toContain("chart-outline-svg");
    first.unmount();
    await mount(fakeApi(focusState({ active: session({ categoryId: null }) })));
    expect(sector()!.getAttribute("style")).toContain("var(--color-category-other)");
  });

  it("시작 직후(30:00)는 꽉 찬 원, 1초마다 부채꼴이 다시 그려지고 숫자와 함께 줄어든다", async () => {
    vi.useFakeTimers();
    await mount(fakeApi(focusState({ active: session({ categoryId: C1 }) })));
    expect(sector()!.tagName.toLowerCase()).toBe("circle");
    await tick(1_000);
    expect(screen.getByRole("timer").textContent).toBe("29:59");
    const first = sector()!.getAttribute("d");
    expect(first).toMatch(/^M0 0L/);
    await tick(2_000);
    expect(screen.getByRole("timer").textContent).toBe("29:58");
    expect(sector()!.getAttribute("d")).not.toBe(first);
  });

  it("24:12가 남았을 때 부채꼴 시작 점은 −20.4°(반지름 116)", async () => {
    vi.useFakeTimers();
    await mount(fakeApi(focusState({ active: session({ categoryId: C1 }) })));
    await tick((30 * 60 - (24 * 60 + 12)) * 1000);
    expect(screen.getByRole("timer").textContent).toBe("24:12");
    const m = /^M0 0L(-?[\d.]+) (-?[\d.]+)A116 116 0 1 1 0 -116Z$/.exec(sector()!.getAttribute("d")!);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(108.73, 1);
    expect(Number(m![2])).toBeCloseTo(-40.4, 1);
  });

  it("30분이 지나면(T5) 부채꼴이 없고 「00:00」 · 「30분이 지났어요」, 판과 끝내기는 그대로", async () => {
    vi.useFakeTimers();
    await mount(fakeApi(focusState({ active: session({ categoryId: C1 }) })));
    await tick(31 * 60_000);
    expect(screen.getByRole("timer").textContent).toBe("00:00");
    expect(screen.getByText("30분이 지났어요")).toBeTruthy();
    expect(sector()).toBeNull();
    expect(document.querySelectorAll(".timer-face svg line")).toHaveLength(30);
    expect(screen.getByRole("button", { name: "끝내기" })).toBeTruthy();
  });

  it("움직임 줄이기: 숫자는 1초마다, 부채꼴은 남은 분이 바뀔 때만 바뀐다", async () => {
    window.matchMedia = reduced(true) as never;
    vi.useFakeTimers();
    await mount(fakeApi(focusState({ active: session({ categoryId: C1 }) })));
    await tick(5_000); // 29:55 → 올림한 분 30분 = 꽉 찬 원
    expect(screen.getByRole("timer").textContent).toBe("29:55");
    expect(sector()!.tagName.toLowerCase()).toBe("circle");
    await tick(59_000); // 29:01도 같은 분
    expect(screen.getByRole("timer").textContent).toBe("29:01");
    expect(sector()!.tagName.toLowerCase()).toBe("circle");
    await tick(60_000); // 29:00 → 29분이 되는 순간 바뀐다
    expect(screen.getByRole("timer").textContent).toBe("29:00");
    const at29 = sector()!.getAttribute("d");
    expect(at29).toMatch(/^M0 0L/);
    await tick(89_000); // 28:31 → 28분으로 올림되어 한 번 더 바뀌었다
    const at28 = sector()!.getAttribute("d");
    await tick(90_000); // 28:30 → 같은 분 안에서는 그대로
    expect(screen.getByRole("timer").textContent).toBe("28:30");
    expect(sector()!.getAttribute("d")).toBe(at28);
    await tick(119_000); // 28:01
    expect(screen.getByRole("timer").textContent).toBe("28:01");
    expect(sector()!.getAttribute("d")).toBe(at28);
    await tick(120_000); // 28:00 → 바뀐다
    expect(sector()!.getAttribute("d")).not.toBe(at28);
  });

  it("움직임 줄이기를 끄면 같은 구간에서도 1초마다 바뀐다", async () => {
    window.matchMedia = reduced(false) as never;
    vi.useFakeTimers();
    await mount(fakeApi(focusState({ active: session({ categoryId: C1 }) })));
    await tick(2_000);
    const a = sector()!.getAttribute("d");
    await tick(3_000);
    expect(sector()!.getAttribute("d")).not.toBe(a);
  });
});

describe("「오늘 할 일에 추가」 뒤 타이머 탭 (K9)", () => {
  const read = () => todayRead([{ id: T1, text: "첫 할 일", categoryId: C1 }, { id: T2, text: "어제 적은 단어", categoryId: C1 }, { id: T3, text: "다른 일" }]);

  it("그 할 일이 골라져 있고, 안내 상자(role=status)가 위에 있고, 포커스는 타이머 탭 제목, 타이머는 켜지지 않는다", async () => {
    const api = fakeApi();
    await mount(api, read(), { added: { todoId: T2, text: "어제 적은 단어" } });
    expect((screen.getByRole("radio", { name: /어제 적은 단어/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /첫 할 일/ }) as HTMLInputElement).checked).toBe(false);
    const box = screen.getByText("「어제 적은 단어」를 오늘 할 일에 넣었어요.");
    expect(box.closest("[role='status']")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "타이머" }));
    expect(api.start).not.toHaveBeenCalled(); // 시작은 사용자가(D-092)
    expect(screen.queryByRole("timer")).toBeNull();
    await press("30분 시작"); // 시작 단추를 누르면 그 할 일로 켜진다
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ todoId: T2, surface: "manual" }));
  });

  it("다른 줄을 고르면 안내가 사라진다. 할 일 글은 React 텍스트로만(태그가 해석되지 않는다)", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    await mount(fakeApi(), todayRead([{ id: T2, text: evil }, { id: T3, text: "다른 일" }]), { added: { todoId: T2, text: evil } });
    expect(screen.getByText(`「${evil}」를 오늘 할 일에 넣었어요.`)).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /다른 일/ }));
    expect(screen.queryByText(/오늘 할 일에 넣었어요/)).toBeNull();
  });

  it("추가 안내가 없으면 상자도 없다. 읽을 수 없는 할 일은 안내 글로", async () => {
    await mount(fakeApi(), read());
    expect(screen.queryByText(/오늘 할 일에 넣었어요/)).toBeNull();
    cleanup();
    await mount(fakeApi(), read(), { added: { todoId: T2, text: null } });
    expect(screen.getByText("「읽을 수 없는 할 일」를 오늘 할 일에 넣었어요.")).toBeTruthy();
  });

  it("앱의 추천이 다른 할 일이어도 방금 넣은 할 일이 골라진다", async () => {
    await mount(fakeApi(), read(), { added: { todoId: T2, text: "어제 적은 단어" }, recommended: { offerId: "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f", todoId: T1, categoryId: C1, label: "추천" } });
    expect((screen.getByRole("radio", { name: /어제 적은 단어/ }) as HTMLInputElement).checked).toBe(true);
  });
});
