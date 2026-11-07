// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusApi, FocusStartInput } from "../../lib/focus-api";
import type { FocusSession } from "../../lib/focus/types";
import type { HomeRead } from "../../lib/home-types";
import type { OffersApi } from "../../lib/offers-api";
import type { Offer } from "../../lib/offers/types";

vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({
  editTodo: vi.fn(),
  deleteTodo: vi.fn(),
  reorderTodos: vi.fn(),
  carryOverTodos: vi.fn(),
  addNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/views/actions", () => ({ recordView: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(), dismissOffer: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const T1 = "11111111-1111-4111-8111-111111111111";
const OFFER_ID = "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f";
const DAY = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const todayRead = {
  todos: { ok: true, data: { day: DAY, todos: [{ id: T1, readable: true, text: "단어 외우기", done: false, createdAt: "x", categoryId: C1 }] } },
  categories: { ok: true, data: { categories: [{ id: C1, readable: true, name: "어학", createdAt: "x" }] } },
} as HomeRead["today"];
vi.mock("../../lib/read-client", () => ({ fetchToday: vi.fn(async () => todayRead) }));

import { AppShell } from "../../components/app-shell";

const home: HomeRead = { today: todayRead, settings: { ok: false, error: "unavailable" } };

function offer(over: Partial<Offer> = {}): Offer {
  return { id: OFFER_ID, surface: "card", day: "2026-11-07", categoryId: C1, categoryName: "어학", todoId: T1, todoText: "단어 외우기", state: "new", ...over };
}
function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: "51515151-5151-4151-8151-515151515151", startedAt: new Date().toISOString(), day: "2026-11-07", plannedMinutes: 30, endedAt: null, elapsedSeconds: null,
    todoId: null, categoryId: null, offerId: null, surface: "manual", oppositeByGoal: null, oppositeByRatio: false, ...over,
  };
}
function offersApi(card: Offer | null = offer(), tab: Offer | null = offer({ surface: "timer_tab" })): OffersApi {
  return {
    request: vi.fn(async (surface) => ({ ok: true as const, data: { offer: surface === "card" ? card : tab } })),
    dismiss: vi.fn(async (id: string) => ({ ok: true as const, data: { id } })),
  };
}
function focusApi(over: Partial<FocusApi> = {}): FocusApi {
  return {
    fetchState: vi.fn(async () => ({ ok: true as const, data: { serverNow: new Date().toISOString(), active: null, today: [] } })),
    start: vi.fn(async (input: FocusStartInput) => ({
      ok: true as const,
      data: { session: session({ id: input.id, todoId: input.todoId ?? null, categoryId: input.categoryId ?? null, offerId: input.offerId ?? null, surface: input.surface }), serverNow: new Date().toISOString() },
    })),
    end: vi.fn(),
    ...over,
  };
}
async function mount(apis: { offers: OffersApi; focus: FocusApi }) {
  render(<AppShell home={home} apis={apis} />);
  await act(async () => {});
}
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

beforeEach(() => {
  // 카드의 날짜가 오늘인지 보므로(A13) 시계는 시험의 하루(서울 2026-11-07 12:00)로 고정한다. 타이머(setTimeout)는 건드리지 않는다
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T03:00:00.000Z"));
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("오늘 먼저 할 일 카드 (7-5, ⑤)", () => {
  it("앱을 열면 카드 제시를 한 번 받고, 「오늘 먼저 할 일 · 분야」와 할 일·단추가 보인다", async () => {
    const offers = offersApi();
    await mount({ offers, focus: focusApi() });
    expect(offers.request).toHaveBeenCalledTimes(1);
    expect(offers.request).toHaveBeenCalledWith("card");
    const card = screen.getByRole("region", { name: "오늘 먼저 할 일" });
    expect(card.textContent).toContain("오늘 먼저 할 일 · 어학");
    expect(card.textContent).toContain("단어 외우기");
    expect(screen.getByRole("button", { name: "30분 시작" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "넘기기" })).toBeTruthy();
  });

  it("할 일이 없으면 분야와 길이만 건넨다", async () => {
    await mount({ offers: offersApi(offer({ todoId: null, todoText: null })), focus: focusApi() });
    expect(screen.getByRole("region", { name: "오늘 먼저 할 일" }).textContent).toContain("어학 30분");
  });

  it("건네지 않는 경우(저녁·건넬 분야 없음·이미 넘김·이미 켬)에는 카드가 없다", async () => {
    for (const card of [null, offer({ state: "dismissed" }), offer({ state: "started" })]) {
      cleanup();
      await mount({ offers: offersApi(card), focus: focusApi() });
      expect(screen.queryByRole("region", { name: "오늘 먼저 할 일" })).toBeNull();
    }
  });

  it("「30분 시작」: 건넨 것으로 타이머를 켜고(card, 제시 번호) 타이머 탭으로 가며 카드는 거둔다", async () => {
    const focus = focusApi();
    await mount({ offers: offersApi(), focus });
    await press("30분 시작");
    expect(focus.start).toHaveBeenCalledWith({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      todoId: T1,
      categoryId: C1,
      offerId: OFFER_ID,
      surface: "card",
      clientStartedAt: expect.any(String),
    });
    expect(screen.queryByRole("region", { name: "오늘 먼저 할 일" })).toBeNull();
    expect(screen.getByRole("button", { name: "타이머" }).getAttribute("aria-current")).toBe("page");
  });

  it("시작이 실패하면 안내를 보이고 카드는 남으며, 다시 누르면 같은 id", async () => {
    const start = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unavailable" })
      .mockImplementation(async (input: FocusStartInput) => ({ ok: true, data: { session: session({ id: input.id }), serverNow: new Date().toISOString() } }));
    await mount({ offers: offersApi(), focus: focusApi({ start }) });
    await press("30분 시작");
    expect(screen.getByText("시작하지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "오늘 먼저 할 일" })).toBeTruthy();
    await press("30분 시작");
    expect(start.mock.calls[0][0].id).toBe(start.mock.calls[1][0].id);
  });

  it("오프라인이면 켜지 않고 안내한다", async () => {
    const focus = focusApi();
    await mount({ offers: offersApi(), focus });
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await press("30분 시작");
    expect(focus.start).not.toHaveBeenCalled();
    expect(within(screen.getByRole("region", { name: "오늘 먼저 할 일" })).getByText("인터넷에 연결되면 시작할 수 있어요.")).toBeTruthy();
  });

  it("「넘기기」: 카드를 거두고 넘김을 기록한다(타이머는 켜지 않는다)", async () => {
    const offers = offersApi();
    const focus = focusApi();
    await mount({ offers, focus });
    await press("넘기기");
    expect(screen.queryByRole("region", { name: "오늘 먼저 할 일" })).toBeNull();
    expect(offers.dismiss).toHaveBeenCalledWith(OFFER_ID);
    expect(focus.start).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "할 일" }).getAttribute("aria-current")).toBe("page");
  });

  it("재촉하는 말·평가하는 말·경고가 없다", async () => {
    await mount({ offers: offersApi(), focus: focusApi() });
    const card = screen.getByRole("region", { name: "오늘 먼저 할 일" });
    expect(card.textContent).not.toMatch(/밀렸|부족|꼭|빨리|지금 바로|해야/);
  });
});

describe("카드 다시 받기·타이머가 돌 때 (A13·B3)", () => {
  const visible = () => act(async () => void document.dispatchEvent(new Event("visibilitychange")));

  it("화면이 다시 보일 때 카드 제시를 다시 받고, 이미 넘긴 것으로 바뀌었으면 카드를 거둔다", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { offer: offer() } })
      .mockResolvedValue({ ok: true, data: { offer: offer({ state: "dismissed" }) } });
    await mount({ offers: { request, dismiss: vi.fn() } as unknown as OffersApi, focus: focusApi() });
    expect(screen.getByRole("region", { name: "오늘 먼저 할 일" })).toBeTruthy();
    await visible();
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("region", { name: "오늘 먼저 할 일" })).toBeNull();
  });

  it("다시 받은 제시의 날짜가 오늘이 아니면 카드가 나오지 않는다. 새벽 4시를 넘기면 새 하루의 카드를 받는다", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-07T18:59:00.000Z")); // 서울 11-08 03:59 → 두노 하루는 11-07
    const request = vi.fn(async () => ({ ok: true as const, data: { offer: offer() } }));
    await mount({ offers: { request, dismiss: vi.fn() } as unknown as OffersApi, focus: focusApi() });
    expect(screen.getByRole("region", { name: "오늘 먼저 할 일" })).toBeTruthy();
    // 4시를 넘기면(1분 + 1초) 다시 받는다. 서버가 새 하루(11-08)의 제시를 주면 그것으로 바뀐다
    request.mockResolvedValue({ ok: true, data: { offer: offer({ day: "2026-11-08", categoryName: "포트폴리오" }) } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("region", { name: "오늘 먼저 할 일" }).textContent).toContain("포트폴리오");
    // 날짜가 오늘이 아닌 제시(옛 하루)는 보이지 않는다
    request.mockResolvedValue({ ok: true, data: { offer: offer({ day: "2026-11-07" }) } });
    await visible();
    expect(screen.queryByRole("region", { name: "오늘 먼저 할 일" })).toBeNull();
  });

  it("서버가 이미 진행 중이라고 답하면 「시작하지 못했어요」 대신 타이머 탭 안내가 보이고 시작 단추가 없다", async () => {
    const start = vi.fn(async () => ({ ok: false as const, error: "already_running" as const }));
    await mount({ offers: offersApi(), focus: focusApi({ start }) });
    await press("30분 시작");
    const card = screen.getByRole("region", { name: "오늘 먼저 할 일" });
    expect(within(card).getByText("타이머가 돌고 있어요. 타이머 탭에서 볼 수 있어요.")).toBeTruthy();
    expect(screen.queryByText("시작하지 못했어요. 다시 눌러 주세요.")).toBeNull();
    expect(screen.queryByRole("button", { name: "30분 시작" })).toBeNull();
    await press("타이머 탭 열기");
    expect(screen.getByRole("button", { name: "타이머" }).getAttribute("aria-current")).toBe("page");
  });

  it("타이머 탭이 도는 타이머를 알려 주면 카드는 안내로 바뀌고, 끝내면 시작 단추가 돌아온다", async () => {
    const running = session({ startedAt: new Date().toISOString() });
    let active: FocusSession | null = running;
    const focus = focusApi({
      fetchState: vi.fn(async () => ({ ok: true as const, data: { serverNow: new Date().toISOString(), active, today: active ? [active] : [] } })),
      end: vi.fn(async () => {
        active = null;
        return { ok: true as const, data: { session: { ...running, endedAt: new Date().toISOString(), elapsedSeconds: 10 } } };
      }),
    });
    await mount({ offers: offersApi(), focus });
    await press("타이머");
    await press("할 일");
    expect(within(screen.getByRole("region", { name: "오늘 먼저 할 일" })).getByText("타이머가 돌고 있어요. 타이머 탭에서 볼 수 있어요.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "30분 시작" })).toBeNull();
    await press("타이머");
    await press("끝내기");
    await press("할 일");
    expect(screen.getByRole("button", { name: "30분 시작" })).toBeTruthy();
  });
});

describe("타이머 탭의 추천 (7-6)", () => {
  it("타이머 탭을 열 때마다 timer_tab 제시를 받고, 추천 할 일이 처음에 골라진다", async () => {
    const offers = offersApi();
    await mount({ offers, focus: focusApi() });
    await press("타이머");
    expect(offers.request).toHaveBeenCalledWith("timer_tab");
    expect((screen.getByRole("radio", { name: /단어 외우기/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("추천")).toBeTruthy();
  });

  it("추천 그대로 켜면 timer_tab과 제시 번호로 남는다", async () => {
    const focus = focusApi();
    await mount({ offers: offersApi(null, offer({ surface: "timer_tab" })), focus });
    await press("타이머");
    await press("30분 시작");
    expect(focus.start).toHaveBeenCalledWith(expect.objectContaining({ surface: "timer_tab", offerId: OFFER_ID, todoId: T1, categoryId: C1 }));
  });

  it("추천이 분야만이면 그 분야가 골라져 있고 그대로 켜면 추천으로 센다", async () => {
    const focus = focusApi();
    await mount({ offers: offersApi(null, offer({ surface: "timer_tab", todoId: null, todoText: null })), focus });
    await press("타이머");
    expect(screen.getByText("추천 · 어학 30분")).toBeTruthy();
    expect((screen.getByRole("button", { name: "어학" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("radio", { name: "할 일 없이 시작" }) as HTMLInputElement).checked).toBe(true);
    await press("30분 시작");
    expect(focus.start).toHaveBeenCalledWith(expect.objectContaining({ surface: "timer_tab", offerId: OFFER_ID, todoId: null, categoryId: C1 }));
  });

  it("추천이 없으면(건넬 분야 없음) 추천 표시도 없다", async () => {
    await mount({ offers: offersApi(null, null), focus: focusApi() });
    await press("타이머");
    expect(screen.queryByText("추천")).toBeNull();
  });
});
