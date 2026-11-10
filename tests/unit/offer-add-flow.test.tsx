// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusApi, FocusStartInput } from "../../lib/focus-api";
import type { FocusSession } from "../../lib/focus/types";
import type { HomeRead } from "../../lib/home-types";
import type { OffersApi } from "../../lib/offers-api";
import type { Offer } from "../../lib/offers/types";

/**
 * 고침 11: 먼저 할 일 카드의 「오늘 할 일에 추가」(K1~K4 · K6 · K7 · K8 · K9). d-227: 단추 글은 「오늘 할 일에 추가」, 진행 글 「추가하는 중」.
 * 시계는 서울 2026-11-07 12:00(두노 하루 11-07)로 둔다.
 */
vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({ editTodo: vi.fn(), deleteTodo: vi.fn(), reorderTodos: vi.fn(), carryOverTodos: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/views/actions", () => ({ recordView: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(), dismissOffer: vi.fn(), addOfferTodo: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const T1 = "11111111-1111-4111-8111-111111111111"; // 어제 것(오늘 목록에 없다)
const T2 = "22222222-2222-4222-8222-222222222222"; // 「추가」로 만든 오늘 사본
const T3 = "33333333-3333-4333-8333-333333333333";
const OFFER_ID = "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f";
const DAY = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };

/** 타이머 탭이 읽는 오늘 할 일: 추가한 뒤에는 사본(T2)이 들어 있다(서버가 먼저 만들어 응답) */
const todayWithCopy = {
  todos: {
    ok: true,
    data: {
      day: DAY,
      todos: [
        { id: T3, readable: true, text: "다른 일", done: false, createdAt: "x", categoryId: null },
        { id: T2, readable: true, text: "어제 적은 단어", done: false, createdAt: "y", categoryId: C1 },
      ],
    },
  },
  categories: { ok: true, data: { categories: [{ id: C1, readable: true, name: "어학", createdAt: "x" }] } },
} as HomeRead["today"];
vi.mock("../../lib/read-client", () => ({ fetchToday: vi.fn(async () => todayWithCopy) }));

import { AppShell } from "../../components/app-shell";

const home: HomeRead = { today: todayWithCopy, settings: { ok: false, error: "unavailable" } };

function offer(over: Partial<Offer> = {}): Offer {
  return { id: OFFER_ID, surface: "card", day: "2026-11-07", categoryId: C1, categoryName: "어학", todoId: T1, todoText: "어제 적은 단어", todoDay: "2026-11-06", state: "new", ...over };
}
function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: "51515151-5151-4151-8151-515151515151", startedAt: new Date().toISOString(), day: "2026-11-07", plannedMinutes: 30, endedAt: null, elapsedSeconds: null,
    todoId: null, categoryId: null, offerId: null, surface: "manual", oppositeByGoal: null, oppositeByRatio: false, ...over,
  };
}
const ADDED = { ok: true as const, data: { added: true as const, todoId: T2, todoText: "어제 적은 단어", day: "2026-11-07" } };
function offersApi(card: Offer | null = offer(), addTodo: OffersApi["addTodo"] = vi.fn(async () => ADDED), tab: Offer | null = null): OffersApi {
  return {
    request: vi.fn(async (surface) => ({ ok: true as const, data: { offer: surface === "card" ? card : tab } })),
    dismiss: vi.fn(async (id: string) => ({ ok: true as const, data: { id } })),
    addTodo,
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
async function mount(apis: { offers: OffersApi; focus: FocusApi }, initialOpen: "evening" | "offer" | null = null) {
  render(<AppShell home={home} apis={apis} initialOpen={initialOpen} />);
  await act(async () => {});
}
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const card = () => screen.getByRole("region", { name: "오늘 먼저 할 일" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T03:00:00.000Z"));
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as never;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("카드 K1: 지난 날 할 일 — 적은 날 줄 + 「오늘 할 일에 추가」 · 「넘기기」", () => {
  it("어제 것이면 「어제 적은 할 일」과 「오늘 할 일에 추가」·「넘기기」, 「30분 시작」은 없다. 순서는 추가 → 넘기기", async () => {
    await mount({ offers: offersApi(), focus: focusApi() });
    const c = card();
    expect(c.textContent).toContain("오늘 먼저 할 일 · 어학");
    expect(within(c).getByText("어제 적은 할 일")).toBeTruthy();
    const buttons = within(c).getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["오늘 할 일에 추가", "넘기기"]);
    expect(within(c).queryByRole("button", { name: "30분 시작" })).toBeNull();
    // 건넨 할 일 바로 아래에 적은 날 줄이 온다
    const text = within(c).getByText("어제 적은 단어");
    expect(text.nextElementSibling?.textContent).toBe("어제 적은 할 일");
  });

  it("그 전 날 것이면 「{M}월 {D}일에 적은 할 일」", async () => {
    await mount({ offers: offersApi(offer({ todoDay: "2026-11-03" })), focus: focusApi() });
    expect(within(card()).getByText("11월 3일에 적은 할 일")).toBeTruthy();
    expect(within(card()).getByRole("button", { name: "오늘 할 일에 추가" })).toBeTruthy();
  });

  it("저녁 21시에도 같은 꼴로 보인다(시간대 규칙 없음, d-223)", async () => {
    vi.setSystemTime(new Date("2026-11-07T12:30:00.000Z")); // 서울 21:30
    await mount({ offers: offersApi(), focus: focusApi() });
    expect(within(card()).getByRole("button", { name: "오늘 할 일에 추가" })).toBeTruthy();
    expect(within(card()).getByText("어제 적은 할 일")).toBeTruthy();
  });

  it("오늘 것이면 현행 「30분 시작」 · 「넘기기」, 적은 날 줄도 추가 단추도 없다", async () => {
    await mount({ offers: offersApi(offer({ todoDay: "2026-11-07" })), focus: focusApi() });
    expect(within(card()).getAllByRole("button").map((b) => b.textContent)).toEqual(["30분 시작", "넘기기"]);
    expect(card().textContent).not.toMatch(/적은 할 일|오늘 할 일에 추가/);
  });

  it("K6 분야만 건넬 때(할 일 없음)는 현행 「어학 30분」 · 「30분 시작」 그대로(K5 「할 일 적기」는 없다)", async () => {
    await mount({ offers: offersApi(offer({ todoId: null, todoText: null, todoDay: null })), focus: focusApi() });
    expect(card().textContent).toContain("어학 30분");
    expect(within(card()).getAllByRole("button").map((b) => b.textContent)).toEqual(["30분 시작", "넘기기"]);
    expect(card().textContent).not.toMatch(/할 일 적기|오늘 할 일에 추가/);
  });

  it("옛 기기 사본처럼 날짜를 모르면(todoDay 없음) 현행 「30분 시작」", async () => {
    const legacy = { ...offer(), todoDay: undefined } as unknown as Offer;
    await mount({ offers: offersApi(legacy), focus: focusApi() });
    expect(within(card()).getByRole("button", { name: "30분 시작" })).toBeTruthy();
  });
});

describe("K2~K4: 추가하는 중 · 오프라인 · 실패", () => {
  it("K2: 누르면 단추 글이 「추가하는 중」(aria-busy), 「넘기기」는 막히고, 연타해도 한 번만 보낸다", async () => {
    let finish: (v: typeof ADDED) => void = () => {};
    const addTodo = vi.fn(() => new Promise<typeof ADDED>((resolve) => (finish = resolve)));
    await mount({ offers: offersApi(offer(), addTodo as unknown as OffersApi["addTodo"]), focus: focusApi() });
    const add = within(card()).getByRole("button", { name: "오늘 할 일에 추가" });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    const busy = within(card()).getByRole("button", { name: "추가하는 중" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect((within(card()).getByRole("button", { name: "넘기기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(addTodo).toHaveBeenCalledTimes(1);
    expect(addTodo).toHaveBeenCalledWith(OFFER_ID);
    await act(async () => finish(ADDED));
  });

  it("K3: 오프라인이면 보내지 않고 알림 상자 「인터넷에 연결되면 추가할 수 있어요.」", async () => {
    const addTodo = vi.fn(async () => ADDED);
    await mount({ offers: offersApi(offer(), addTodo), focus: focusApi() });
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await press("오늘 할 일에 추가");
    expect(addTodo).not.toHaveBeenCalled();
    const alert = within(card()).getByRole("alert");
    expect(alert.textContent).toBe("인터넷에 연결되면 추가할 수 있어요.");
    expect(within(card()).getByRole("button", { name: "오늘 할 일에 추가" })).toBeTruthy(); // 다시 누를 수 있다
  });

  it("K4: 실패하면 「추가하지 못했어요. 다시 눌러 주세요.」, 카드는 남고 다시 누르면 보낸다(타이머 탭으로 가지 않는다)", async () => {
    const addTodo = vi.fn().mockResolvedValueOnce({ ok: false, error: "unavailable" }).mockResolvedValue(ADDED);
    await mount({ offers: offersApi(offer(), addTodo), focus: focusApi() });
    await press("오늘 할 일에 추가");
    expect(within(card()).getByRole("alert").textContent).toBe("추가하지 못했어요. 다시 눌러 주세요.");
    expect(screen.getByRole("button", { name: "할 일" }).getAttribute("aria-current")).toBe("page");
    await press("오늘 할 일에 추가");
    expect(addTodo).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "타이머" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("「오늘 할 일에 추가」 → 타이머 탭 (K9)", () => {
  it("타이머 탭으로 가서 그 할 일이 골라져 있고 안내 상자가 있다. 포커스는 타이머 탭 제목, 타이머는 켜지지 않는다(시작은 사용자가)", async () => {
    const focus = focusApi();
    await mount({ offers: offersApi(), focus });
    await press("오늘 할 일에 추가");
    expect(screen.getByRole("button", { name: "타이머" }).getAttribute("aria-current")).toBe("page");
    expect((await screen.findByRole("radio", { name: /어제 적은 단어/ }) as HTMLInputElement).checked).toBe(true);
    const box = screen.getByText("「어제 적은 단어」를 오늘 할 일에 넣었어요.");
    expect(box.closest("[role='status']")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "타이머" }));
    expect(focus.start).not.toHaveBeenCalled(); // focus_sessions에 줄이 생기지 않는다(D-092)
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByRole("button", { name: "30분 시작" })).toBeTruthy();
  });

  it("할 일 탭으로 돌아오면 카드는 그 사본으로 현행 「30분 시작」 꼴(같은 제시), 켜면 offerId는 원래 제시 번호·todoId는 사본", async () => {
    const focus = focusApi();
    await mount({ offers: offersApi(), focus });
    await press("오늘 할 일에 추가");
    await press("할 일");
    expect(within(card()).getAllByRole("button").map((b) => b.textContent)).toEqual(["30분 시작", "넘기기"]);
    expect(card().textContent).not.toMatch(/적은 할 일|오늘 할 일에 추가/);
    await press("30분 시작");
    expect(focus.start).toHaveBeenCalledWith(expect.objectContaining({ todoId: T2, offerId: OFFER_ID, surface: "card" }));
  });

  it("타이머 탭을 떠나면 안내는 사라진다", async () => {
    await mount({ offers: offersApi(), focus: focusApi() });
    await press("오늘 할 일에 추가");
    expect(screen.getByText(/오늘 할 일에 넣었어요/)).toBeTruthy();
    await press("할 일");
    await press("타이머");
    expect(screen.queryByText(/오늘 할 일에 넣었어요/)).toBeNull();
  });

  it("원본이 그새 끝났거나 지워졌으면(added: false) 실패 대신 카드를 다시 받고 타이머 탭으로 가지 않는다", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { offer: offer() } })
      .mockResolvedValue({ ok: true, data: { offer: offer({ id: "1f1f1f1f-1f1f-41f1-81f1-1f1f1f1f1f1f", todoId: T3, todoText: "다른 일", todoDay: "2026-11-07" }) } });
    const addTodo = vi.fn(async () => ({ ok: true as const, data: { added: false as const } }));
    await mount({ offers: { request, dismiss: vi.fn(), addTodo } as unknown as OffersApi, focus: focusApi() });
    await press("오늘 할 일에 추가");
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "할 일" }).getAttribute("aria-current")).toBe("page");
    expect(within(card()).getByText("다른 일")).toBeTruthy();
    expect(within(card()).getByRole("button", { name: "30분 시작" })).toBeTruthy();
  });

  it("서버가 not_found로 거절해도(넘긴·지난 제시) 실패 글 없이 카드를 다시 받는다", async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true, data: { offer: offer() } }).mockResolvedValue({ ok: true, data: { offer: null, reason: "no_target" } });
    const addTodo = vi.fn(async () => ({ ok: false as const, error: "not_found" as const }));
    await mount({ offers: { request, dismiss: vi.fn(), addTodo } as unknown as OffersApi, focus: focusApi() });
    await press("오늘 할 일에 추가");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("region", { name: "오늘 먼저 할 일" })).toBeNull();
  });
});

describe("K7 · K8", () => {
  it("K7: 타이머가 이미 돌면 카드는 안내와 「타이머 탭 열기」(추가 단추 없음)", async () => {
    const running = session({ startedAt: new Date().toISOString() });
    const focus = focusApi({ fetchState: vi.fn(async () => ({ ok: true as const, data: { serverNow: new Date().toISOString(), active: running, today: [running] } })) });
    await mount({ offers: offersApi(), focus });
    await press("타이머");
    await press("할 일");
    expect(within(card()).getByText("타이머가 돌고 있어요. 타이머 탭에서 볼 수 있어요.")).toBeTruthy();
    expect(within(card()).getByRole("button", { name: "타이머 탭 열기" })).toBeTruthy();
    expect(within(card()).queryByRole("button", { name: "오늘 할 일에 추가" })).toBeNull();
  });

  it("K8: 「넘기기」로 카드가 사라지면 아래 줄이 올라오고 포커스는 할 일 탭 제목 「오늘」로 간다", async () => {
    const offers = offersApi();
    await mount({ offers, focus: focusApi() });
    const skip = within(card()).getByRole("button", { name: "넘기기" });
    skip.focus();
    await press("넘기기");
    expect(screen.queryByRole("region", { name: "오늘 먼저 할 일" })).toBeNull();
    expect(offers.dismiss).toHaveBeenCalledWith(OFFER_ID);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "오늘" }));
  });
});

describe("아침 알림으로 열기(/?open=offer)", () => {
  it("할 일 탭 맨 위에서 열린다: 할 일 탭이 보이고 카드가 있으며, 저녁 기록 창은 열리지 않는다", async () => {
    await mount({ offers: offersApi(), focus: focusApi() }, "offer");
    expect(screen.getByRole("button", { name: "할 일" }).getAttribute("aria-current")).toBe("page");
    expect(card()).toBeTruthy();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(screen.queryByRole("dialog", { name: "오늘 기록" })).toBeNull();
  });
  it("저녁 알림(/?open=evening)은 그대로 저녁 기록을 연다", async () => {
    await mount({ offers: offersApi(), focus: focusApi() }, "evening");
    expect(await screen.findByRole("dialog", { name: "오늘 기록" })).toBeTruthy();
  });
});
