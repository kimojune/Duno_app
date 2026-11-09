// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerScreen } from "../../components/timer-screen";
import type { FocusStartInput, FocusApi } from "../../lib/focus-api";
import type { FocusSession, FocusState } from "../../lib/focus/types";
import type { TodayRead } from "../../lib/today-types";

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
const todayRead = (todos: { id: string; text: string; done?: boolean; categoryId?: string | null }[] = []): TodayRead => ({
  todos: {
    ok: true,
    data: {
      day: { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 },
      todos: todos.map((t) => ({ id: t.id, readable: true as const, text: t.text, done: t.done ?? false, createdAt: "x", categoryId: t.categoryId ?? null })),
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
function focusState(over: Partial<FocusState> = {}): FocusState {
  return { serverNow: new Date(START).toISOString(), active: null, today: [], ...over };
}
function fakeApi(state: FocusState = focusState(), over: Partial<FocusApi> = {}): FocusApi {
  return {
    fetchState: vi.fn(async () => ({ ok: true as const, data: state })),
    start: vi.fn(async (input: FocusStartInput) => ({
      ok: true as const,
      data: {
        session: session({ id: input.id, todoId: input.todoId ?? null, categoryId: input.categoryId ?? null, offerId: input.offerId ?? null, surface: input.surface }),
        serverNow: new Date(START).toISOString(),
      },
    })),
    end: vi.fn(async (id: string) => ({ ok: true as const, data: { session: session({ id, endedAt: "x", elapsedSeconds: 720 }) } })),
    ...over,
  };
}

let clock = START;
const now = () => clock;
async function mount(api: FocusApi, read: TodayRead = todayRead(), extra: Partial<React.ComponentProps<typeof TimerScreen>> = {}) {
  const onActiveChange = vi.fn();
  const view = render(<TimerScreen api={api} fetchToday={async () => read} active activation={1} now={now} onActiveChange={onActiveChange} {...extra} />);
  await act(async () => {});
  return { onActiveChange, ...view };
}
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

beforeEach(() => {
  clock = START;
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("타이머 탭 (7-6, ④)", () => {
  it("오늘 끝내지 않은 할 일이 고를 목록이고, 처음에는 첫 할 일이 골라져 있다", async () => {
    await mount(fakeApi(), todayRead([{ id: T1, text: "단어 외우기", categoryId: C1 }, { id: T2, text: "이미 끝냄", done: true }, { id: T3, text: "글쓰기 정리" }]));
    expect((screen.getByRole("radio", { name: /단어 외우기/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("radio", { name: /이미 끝냄/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /글쓰기 정리/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "할 일 없이 시작" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "30분 시작" })).toBeTruthy();
  });

  it("할 일을 골라 시작하면 먼저 한 기록(할 일·분야·어디서)이 서버로 가고 타이머가 돈다", async () => {
    const api = fakeApi();
    const { onActiveChange } = await mount(api, todayRead([{ id: T1, text: "단어 외우기", categoryId: C1 }]));
    await press("30분 시작");
    expect(api.start).toHaveBeenCalledWith({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      todoId: T1,
      categoryId: C1,
      offerId: null,
      surface: "manual",
      clientStartedAt: new Date(START).toISOString(),
    });
    expect(screen.getByRole("timer").textContent).toBe("30:00");
    expect(screen.getByText("단어 외우기")).toBeTruthy();
    expect(screen.getByText("30분 타이머를 시작했어요")).toBeTruthy();
    expect(onActiveChange).toHaveBeenLastCalledWith(expect.objectContaining({ todoId: T1 }));
    expect(screen.queryByRole("button", { name: "30분 시작" })).toBeNull();
  });

  it("남은 시간이 1초마다 줄고, 서버와 기기 시계 차이를 맞춘다", async () => {
    vi.useFakeTimers();
    // 서버는 기기보다 10초 빠르다: 서버 시각 START+10s에 시작했다고 알려 오면 남은 시간은 30:00 − (기기 경과 + 10s − 10s)
    const api = fakeApi(focusState({ serverNow: new Date(START + 10_000).toISOString(), active: session({ startedAt: new Date(START).toISOString() }) }));
    await mount(api);
    expect(screen.getByRole("timer").textContent).toBe("29:50"); // 서버 시각 기준으로 10초 지났다
    clock = START + 5_000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("timer").textContent).toBe("29:45");
  });

  it("30분이 지나면 00:00과 「30분이 지났어요」만 알린다(평가·재촉 없음)", async () => {
    vi.useFakeTimers();
    await mount(fakeApi(focusState({ active: session() })));
    clock = START + 31 * 60_000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("timer").textContent).toBe("00:00");
    expect(screen.getByText("30분이 지났어요")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/실패|늦|못 했|포기|대단|잘했/);
  });

  it("끝내기: 진행한 시간이 남고 오늘 기록 줄에 숫자만 보인다", async () => {
    const api = fakeApi(focusState({ active: session({ categoryId: C1 }) }), {
      end: vi.fn(async (id: string) => ({ ok: true as const, data: { session: session({ id, categoryId: C1, endedAt: "x", elapsedSeconds: 720 }) } })),
    });
    const { onActiveChange } = await mount(api);
    await press("끝내기");
    expect(api.end).toHaveBeenCalledWith("51515151-5151-4151-8151-515151515151");
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByText("타이머 · 어학 12분")).toBeTruthy();
    expect(onActiveChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText(/중간에|멈춤/)).toBeNull();
  });

  it("5분 하고 끝내도 기록 줄에 5분으로 남는다", async () => {
    const api = fakeApi(focusState({ active: session({ categoryId: C2 }) }), {
      end: vi.fn(async (id: string) => ({ ok: true as const, data: { session: session({ id, categoryId: C2, endedAt: "x", elapsedSeconds: 300 }) } })),
    });
    await mount(api);
    await press("끝내기");
    expect(screen.getByText("타이머 · 글쓰기 5분")).toBeTruthy();
  });

  it("할 일 없이 시작: 분야 칩에서 고르면 그 분야로, 안 고르면 기타로 시작한다", async () => {
    const api = fakeApi();
    await mount(api, todayRead([]));
    expect((screen.getByRole("radio", { name: "할 일 없이 시작" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "글쓰기" }));
    await press("30분 시작");
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ todoId: null, categoryId: C2, surface: "manual" }));
  });

  it("고침9 ⑬ 13·15: 이름표 「분야」 + 맨 앞 「기타」가 골라진 채 시작, 고른 칩을 다시 누르면 기타로, 기타로 시작하면 분야 없음(null). 기록 없음은 「0개」", async () => {
    const api = fakeApi();
    await mount(api, todayRead([]));
    expect(document.getElementById("timer-category-label")!.textContent).toBe("분야");
    expect(screen.queryByText(/고르지 않으면 기타/)).toBeNull();
    const group = screen.getByRole("group", { name: "분야" });
    const chips = () => [...group.querySelectorAll("button[aria-pressed]")];
    expect(chips().map((b) => b.textContent)).toEqual(["기타", "어학", "글쓰기"]);
    expect(chips().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    fireEvent.click(screen.getByRole("button", { name: "글쓰기" }));
    expect(chips().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    fireEvent.click(screen.getByRole("button", { name: "글쓰기" })); // 다시 눌러 풀면 기타
    expect(chips().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    fireEvent.click(screen.getByRole("button", { name: "어학" }));
    fireEvent.click(screen.getByRole("button", { name: "기타" })); // 기타를 누르면 고른 분야가 풀림
    expect(chips().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    await press("30분 시작");
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ todoId: null, categoryId: null, surface: "manual" }));
  });

  it("고침9 ⑬ 15: 오늘 시작한 타이머가 없으면 「0개」(옛 「아직 없어요」)", async () => {
    await mount(fakeApi(), todayRead([]));
    const section = screen.getByRole("heading", { name: "오늘 시작한 타이머" }).closest("section")!;
    expect(section.querySelector("p")!.textContent).toBe("0개");
    expect(screen.queryByText("아직 없어요")).toBeNull();
  });

  it("시작이 실패하면 안내를 보이고 같은 고름으로 다시 누르면 같은 id", async () => {
    const start = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unavailable" })
      .mockImplementation(async (input: FocusStartInput) => ({ ok: true, data: { session: session({ id: input.id }), serverNow: new Date(START).toISOString() } }));
    await mount(fakeApi(focusState(), { start }), todayRead([{ id: T1, text: "할 일" }]));
    await press("30분 시작");
    expect(screen.getByText("시작하지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    await press("30분 시작");
    expect(start.mock.calls[0][0].id).toBe(start.mock.calls[1][0].id);
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it("끝내기가 실패하면 안내를 보이고 타이머는 그대로 돈다", async () => {
    const api = fakeApi(focusState({ active: session() }), { end: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    await mount(api);
    await press("끝내기");
    expect(screen.getByText("끝내지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it("오프라인이면 시작하지 않고 안내한다", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const api = fakeApi();
    await mount(api, todayRead([{ id: T1, text: "할 일" }]));
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    await press("30분 시작");
    expect(api.start).not.toHaveBeenCalled();
    expect(screen.getAllByText("인터넷에 연결되면 시작할 수 있어요.").length).toBeGreaterThan(0);
  });

  it("진행 중인 타이머가 있으면 새로 못 시작한다(끝내기만)", async () => {
    await mount(fakeApi(focusState({ active: session() })));
    expect(screen.queryByRole("button", { name: "30분 시작" })).toBeNull();
    expect(screen.getByRole("button", { name: "끝내기" })).toBeTruthy();
  });

  it("앱의 추천이 있으면 그 할 일이 처음에 골라지고, 그대로 켜면 timer_tab과 제시 번호로 남는다", async () => {
    const api = fakeApi();
    const OFFER = "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f";
    await mount(api, todayRead([{ id: T1, text: "첫 할 일" }, { id: T2, text: "추천된 할 일", categoryId: C1 }]), {
      recommended: { offerId: OFFER, todoId: T2, categoryId: C1, label: "추천" },
    });
    expect((screen.getByRole("radio", { name: /추천된 할 일/ }) as HTMLInputElement).checked).toBe(true);
    await press("30분 시작");
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ todoId: T2, surface: "timer_tab", offerId: OFFER }));
  });

  it("추천과 다른 할 일로 바꿔 켜면 manual이고 제시 번호는 없다", async () => {
    const api = fakeApi();
    await mount(api, todayRead([{ id: T1, text: "첫 할 일" }, { id: T2, text: "추천된 할 일" }]), {
      recommended: { offerId: "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f", todoId: T2, categoryId: null, label: "추천" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /첫 할 일/ }));
    await press("30분 시작");
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ todoId: T1, surface: "manual", offerId: null }));
  });

  it("보이지 않는 탭은 읽지 않고, 다시 열면 읽는다", async () => {
    const api = fakeApi();
    const read = todayRead();
    const { rerender } = render(<TimerScreen api={api} fetchToday={async () => read} active={false} activation={0} now={now} />);
    await act(async () => {});
    expect(api.fetchState).not.toHaveBeenCalled();
    rerender(<TimerScreen api={api} fetchToday={async () => read} active activation={1} now={now} />);
    await act(async () => {});
    expect(api.fetchState).toHaveBeenCalledTimes(1);
  });

  it("읽기가 실패하면 안내와 다시 불러오기", async () => {
    const fetchState = vi.fn().mockResolvedValueOnce({ ok: false, error: "unavailable" }).mockResolvedValue({ ok: true, data: focusState() });
    await mount(fakeApi(focusState(), { fetchState }));
    expect(screen.getByText("타이머를 불러오지 못했어요.")).toBeTruthy();
    await press("다시 불러오기");
    expect(screen.getByRole("button", { name: "30분 시작" })).toBeTruthy();
  });

  it("오늘 할 일을 못 불러와도 할 일 없이 시작할 수 있다", async () => {
    const api = fakeApi();
    const failed: TodayRead = { todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } };
    await mount(api, failed);
    expect(screen.getByText("오늘 할 일을 불러오지 못했어요. 할 일 없이 시작할 수 있어요.")).toBeTruthy();
    await press("30분 시작");
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ todoId: null, categoryId: null }));
  });

  it("할 일 글·분야 이름은 글자 그대로 보인다", async () => {
    const evil = '<img src=x onerror="window.__t=1">';
    await mount(fakeApi(), todayRead([{ id: T1, text: evil }]));
    expect(screen.getByRole("radio", { name: evil })).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
