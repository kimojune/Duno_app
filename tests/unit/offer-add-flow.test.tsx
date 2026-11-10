// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusApi, FocusStartInput } from "../../lib/focus-api";
import type { FocusSession } from "../../lib/focus/types";
import type { HomeRead } from "../../lib/home-types";
import { offerCopyId } from "../../lib/offers/copy-id";
import type { OffersApi } from "../../lib/offers-api";
import type { Offer } from "../../lib/offers/types";

/**
 * 고침 11-2(d-232): 먼저 할 일 카드 — 「30분 시작」이 없고 주 단추는 경우마다 하나다.
 * L1~L4 지난 날 할 일(추가) · L5 추가한 뒤(할 일 탭에 머묾 · 「타이머에서 시작 ›」) · L6/L7 이미 목록(목록에서 보기) · L8 분야만({분야} 할 일 적기) · K7 · K8 · K9.
 * 시계는 서울 2026-11-07 12:00(두노 하루 11-07)로 둔다.
 */
const hoisted = vi.hoisted(() => ({ today: null as unknown, addTodo: vi.fn(), setTodoDone: vi.fn() }));
vi.mock("../../app/todos/actions", () => ({ addTodo: hoisted.addTodo, setTodoDone: hoisted.setTodoDone, addCategory: vi.fn() }));
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
const T2 = "22222222-2222-4222-8222-222222222222"; // 「추가」로 만든 오늘 사본 · 이미 오늘 목록에 있는 할 일
const T3 = "33333333-3333-4333-8333-333333333333";
const OFFER_ID = "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f";
const DAY = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };

const row = (id: string, text: string, categoryId: string | null) => ({ id, readable: true as const, text, done: false, createdAt: "x", categoryId });
const todayRead = (...todos: ReturnType<typeof row>[]) =>
  ({
    todos: { ok: true, data: { day: DAY, todos } },
    categories: { ok: true, data: { categories: [{ id: C1, readable: true, name: "어학", createdAt: "x" }] } },
  }) as HomeRead["today"];
const withoutCopy = () => todayRead(row(T3, "다른 일", null));
const withCopy = () => todayRead(row(T3, "다른 일", null), row(T2, "어제 적은 단어", C1));
vi.mock("../../lib/read-client", () => ({ fetchToday: vi.fn(async () => hoisted.today) }));

import { AppShell } from "../../components/app-shell";

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
/** 추가가 서버에서 끝나면 오늘 목록에 사본이 들어 있다 */
const addingTodo = () =>
  vi.fn(async () => {
    hoisted.today = withCopy();
    return ADDED;
  });
function offersApi(card: Offer | null = offer(), addTodo: OffersApi["addTodo"] = addingTodo()): OffersApi {
  return {
    request: vi.fn(async (surface) => ({ ok: true as const, data: { offer: surface === "card" ? card : null } })),
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
async function mount(apis: { offers: OffersApi; focus: FocusApi }, initialOpen: "evening" | "offer" | null = null, today = withoutCopy()) {
  hoisted.today = today;
  render(<AppShell home={{ today, settings: { ok: false, error: "unavailable" } } as HomeRead} apis={apis} initialOpen={initialOpen} />);
  await act(async () => {});
}
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const card = () => screen.getByRole("region", { name: "오늘 먼저 할 일" });
const rowEl = (id: string) => document.getElementById(`row-${id}`)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T03:00:00.000Z"));
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as never;
  hoisted.addTodo.mockReset();
  hoisted.setTodoDone.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("카드 세 경우 — 주 단추는 하나, 「30분 시작」은 어디에도 없다", () => {
  it("L1: 지난 날 할 일(어제)이면 적은 날 줄 + 「오늘 할 일에 추가」 · 「넘기기」 — 건넨 할 일 바로 아래에 줄", async () => {
    await mount({ offers: offersApi(), focus: focusApi() });
    const c = card();
    expect(c.textContent).toContain("오늘 먼저 할 일 · 어학");
    expect(within(c).getAllByRole("button").map((b) => b.textContent)).toEqual(["오늘 할 일에 추가", "넘기기"]);
    expect(within(c).getByText("어제 적은 단어").nextElementSibling?.textContent).toBe("어제 적은 할 일");
    expect(screen.queryByRole("button", { name: "30분 시작" })).toBeNull();
  });

  it("그 전 날 것이면 「{M}월 {D}일에 적은 할 일」. 저녁 21시에도 같은 꼴(시간대 규칙 없음)", async () => {
    await mount({ offers: offersApi(offer({ todoDay: "2026-11-03" })), focus: focusApi() });
    expect(within(card()).getByText("11월 3일에 적은 할 일")).toBeTruthy();
    cleanup();
    vi.setSystemTime(new Date("2026-11-07T12:30:00.000Z")); // 서울 21:30
    await mount({ offers: offersApi(), focus: focusApi() });
    expect(within(card()).getByRole("button", { name: "오늘 할 일에 추가" })).toBeTruthy();
  });

  it("L6: 이미 오늘 목록에 있는 할 일이면 「오늘 할 일 목록에 있어요」 + 「목록에서 보기」 · 「넘기기」, 그 줄에 꼬리표 「오늘 먼저」", async () => {
    await mount({ offers: offersApi(offer({ todoId: T2, todoDay: "2026-11-07" })), focus: focusApi() }, null, withCopy());
    const c = card();
    expect(within(c).getByText("오늘 할 일 목록에 있어요")).toBeTruthy();
    expect(within(c).getAllByRole("button").map((b) => b.textContent)).toEqual(["목록에서 보기", "넘기기"]);
    expect(c.textContent).not.toMatch(/적은 할 일|30분 시작|오늘 할 일에 추가/);
    const tag = within(rowEl(T2)).getByText("오늘 먼저");
    expect(tag.className).toContain("first-tag");
    expect(within(rowEl(T3)).queryByText("오늘 먼저")).toBeNull(); // 다른 줄에는 없다
    // 화면 읽기: 체크 칸 설명에 분야와 꼬리표가 이어진다
    const input = rowEl(T2).querySelector("input")!;
    expect(input.getAttribute("aria-describedby")).toContain(tag.id);
  });

  it("L8: 분야만 건넬 때(할 일 없음) 주 단추 「어학 할 일 적기」 · 「넘기기」, 「어학 30분」 글", async () => {
    await mount({ offers: offersApi(offer({ todoId: null, todoText: null, todoDay: null })), focus: focusApi() });
    const c = card();
    expect(c.textContent).toContain("어학 30분");
    expect(within(c).getAllByRole("button").map((b) => b.textContent)).toEqual(["어학 할 일 적기", "넘기기"]);
    expect(screen.queryByRole("button", { name: "30분 시작" })).toBeNull();
  });

  it("옛 기기 사본처럼 날짜를 모르는 제시(todoDay 없음)는 L6 꼴이다(추가 단추 없음)", async () => {
    const legacy = { ...offer({ todoId: T2 }), todoDay: undefined } as unknown as Offer;
    await mount({ offers: offersApi(legacy), focus: focusApi() }, null, withCopy());
    expect(within(card()).getByRole("button", { name: "목록에서 보기" })).toBeTruthy();
  });
});

describe("L2~L4: 추가하는 중 · 오프라인 · 실패", () => {
  it("L2: 누르면 「추가하는 중」(aria-busy), 「넘기기」 막힘, 연타해도 한 번만 보낸다", async () => {
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

  it("L3: 오프라인이면 보내지 않고 「인터넷에 연결되면 추가할 수 있어요.」, 다시 누를 수 있다", async () => {
    const addTodo = vi.fn(async () => ADDED);
    await mount({ offers: offersApi(offer(), addTodo), focus: focusApi() });
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await press("오늘 할 일에 추가");
    expect(addTodo).not.toHaveBeenCalled();
    expect(within(card()).getByRole("alert").textContent).toBe("인터넷에 연결되면 추가할 수 있어요.");
    expect(within(card()).getByRole("button", { name: "오늘 할 일에 추가" })).toBeTruthy();
  });

  it("L4: 실패하면 「추가하지 못했어요. 다시 눌러 주세요.」, 카드는 L1 그대로이고 다시 누르면 보낸다", async () => {
    const addTodo = vi.fn().mockResolvedValueOnce({ ok: false, error: "unavailable" }).mockImplementation(addingTodo());
    await mount({ offers: offersApi(offer(), addTodo), focus: focusApi() });
    await press("오늘 할 일에 추가");
    expect(within(card()).getByRole("alert").textContent).toBe("추가하지 못했어요. 다시 눌러 주세요.");
    expect(within(card()).getByRole("button", { name: "오늘 할 일에 추가" })).toBeTruthy();
    await press("오늘 할 일에 추가");
    expect(addTodo).toHaveBeenCalledTimes(2);
    expect(within(card()).getByText("오늘 할 일에 넣었어요")).toBeTruthy();
  });
});

describe("L5: 「오늘 할 일에 추가」 뒤 — 할 일 탭에 머문다", () => {
  it("탭을 옮기지 않고, 카드는 「오늘 할 일에 넣었어요」(role=status) + 글 단추 「타이머에서 시작 ›」 하나, 포커스는 그 단추, 타이머는 안 켜진다", async () => {
    const focus = focusApi();
    await mount({ offers: offersApi(), focus });
    await press("오늘 할 일에 추가");
    expect(screen.getByRole("button", { name: "할 일", exact: true } as never).getAttribute("aria-current")).toBe("page");
    const c = card();
    expect(within(c).getByText("오늘 할 일에 넣었어요").closest("[role='status']")).toBeTruthy();
    expect(within(c).getAllByRole("button").map((b) => b.textContent)).toEqual(["타이머에서 시작 ›"]);
    expect(within(c).queryByText("넘기기")).toBeNull();
    expect(document.activeElement).toBe(within(c).getByRole("button", { name: "타이머에서 시작 ›" }));
    expect(focus.start).not.toHaveBeenCalled(); // focus_sessions에 줄이 생기지 않는다(D-092)
  });

  it("새 줄이 목록에 생기고(꼬리표 「오늘 먼저」) 강조되며 그 줄로 부드럽게 스크롤한다. 강조는 2초 뒤 페이드, 꼬리표는 남는다", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-07T03:00:00.000Z"));
    await mount({ offers: offersApi(), focus: focusApi() });
    expect(document.getElementById(`row-${T2}`)).toBeNull();
    await press("오늘 할 일에 추가");
    await act(async () => {});
    const el = rowEl(T2);
    expect(el.textContent).toContain("어제 적은 단어");
    expect(within(el).getByText("오늘 먼저")).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(el.classList.contains("todo-row-flash")).toBe(true);
    expect(el.classList.contains("todo-row-ring")).toBe(false); // 포커스는 카드 단추에 있다
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(el.classList.contains("todo-row-fade")).toBe(true);
    await act(async () => void vi.advanceTimersByTime(400));
    expect(el.classList.contains("todo-row-flash")).toBe(false);
    expect(within(el).getByText("오늘 먼저")).toBeTruthy();
  });

  it("움직임 줄이기: 스크롤은 바로(auto), 강조는 페이드 없이 2초 뒤 사라진다", async () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as never;
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-07T03:00:00.000Z"));
    await mount({ offers: offersApi(), focus: focusApi() });
    await press("오늘 할 일에 추가");
    await act(async () => {});
    const el = rowEl(T2);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(el.classList.contains("todo-row-flash")).toBe(false);
    expect(el.classList.contains("todo-row-fade")).toBe(false);
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("「타이머에서 시작 ›」 → 타이머 탭, 그 할 일이 골라져 있고 안내(K9), 포커스는 타이머 탭 제목. 켜면 카드 제시 번호 · surface card로 센다", async () => {
    const focus = focusApi();
    await mount({ offers: offersApi(), focus });
    await press("오늘 할 일에 추가");
    await press("타이머에서 시작 ›");
    expect(screen.getByRole("button", { name: "타이머" }).getAttribute("aria-current")).toBe("page");
    expect((await screen.findByRole("radio", { name: /어제 적은 단어/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("「어제 적은 단어」를 오늘 할 일에 넣었어요.").closest("[role='status']")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "타이머" }));
    expect(focus.start).not.toHaveBeenCalled();
    await press("30분 시작");
    expect(focus.start).toHaveBeenCalledWith(expect.objectContaining({ todoId: T2, offerId: OFFER_ID, surface: "card" }));
  });

  it("타이머 탭에서 다른 줄을 골라 켜면 manual(제시 번호 없음)", async () => {
    const focus = focusApi();
    await mount({ offers: offersApi(), focus });
    await press("오늘 할 일에 추가");
    await press("타이머에서 시작 ›");
    fireEvent.click(await screen.findByRole("radio", { name: /다른 일/ }));
    await press("30분 시작");
    expect(focus.start).toHaveBeenCalledWith(expect.objectContaining({ todoId: T3, surface: "manual", offerId: null }));
  });

  it("탭을 떠났다 돌아오면 카드는 L6 꼴(목록에 있어요 · 목록에서 보기)이고 꼬리표는 남는다", async () => {
    await mount({ offers: offersApi(), focus: focusApi() });
    await press("오늘 할 일에 추가");
    await press("타이머");
    await press("할 일");
    const c = card();
    expect(within(c).getByText("오늘 할 일 목록에 있어요")).toBeTruthy();
    expect(within(c).getAllByRole("button").map((b) => b.textContent)).toEqual(["목록에서 보기", "넘기기"]);
    expect(within(rowEl(T2)).getByText("오늘 먼저")).toBeTruthy();
  });

  it("원본이 그새 끝났거나 지워졌으면(added: false · not_found) 실패 글 없이 카드를 다시 받고 탭을 옮기지 않는다", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { offer: offer() } })
      .mockResolvedValue({ ok: true, data: { offer: null, reason: "done" } });
    const addTodo = vi.fn(async () => ({ ok: true as const, data: { added: false as const } }));
    await mount({ offers: { request, dismiss: vi.fn(), addTodo } as unknown as OffersApi, focus: focusApi() });
    await press("오늘 할 일에 추가");
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("region", { name: "오늘 먼저 할 일" })).toBeNull();
  });
});

describe("L6 → L7 「목록에서 보기」", () => {
  it("그 줄로 스크롤하고 강조하며 포커스가 그 줄로 간다(줄 묶음 tabindex=-1, 고리 클래스)", async () => {
    await mount({ offers: offersApi(offer({ todoId: T2, todoDay: "2026-11-07" })), focus: focusApi() }, null, withCopy());
    await press("목록에서 보기");
    const el = rowEl(T2);
    expect(el.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(el);
    expect(el.classList.contains("todo-row-ring")).toBe(true);
    expect(el.classList.contains("todo-row-flash")).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(within(el).getByText("오늘 먼저")).toBeTruthy();
    // 포커스가 떠나면 고리가 사라진다
    await act(async () => el.blur());
    expect(el.classList.contains("todo-row-ring")).toBe(false);
  });
});

describe("L8 「{분야} 할 일 적기」", () => {
  it("적는 창을 그 분야를 골라 둔 채 연다. 닫으면 아무것도 안 생기고 카드는 L8 그대로", async () => {
    await mount({ offers: offersApi(offer({ todoId: null, todoText: null, todoDay: null })), focus: focusApi() });
    await press("어학 할 일 적기");
    expect(screen.getByRole("textbox", { name: "할 일 적기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "어학", pressed: true })).toBeTruthy();
    await press("닫기");
    expect(hoisted.addTodo).not.toHaveBeenCalled();
    expect(within(card()).getByRole("button", { name: "어학 할 일 적기" })).toBeTruthy();
  });

  it("저장하면 그 할 일의 id는 제시 id에서 정한 id, 카드는 L6 꼴(그 줄에 꼬리표)이 된다. 두 번째 글은 새 id", async () => {
    hoisted.addTodo.mockImplementation(async (id: string, text: string, categoryId: string | null) => ({ ok: true, data: { day: DAY, todo: { id, readable: true, text, done: false, createdAt: "x", categoryId } } }));
    await mount({ offers: offersApi(offer({ todoId: null, todoText: null, todoDay: null })), focus: focusApi() });
    await press("어학 할 일 적기");
    fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: "새 단어" } });
    await press("적기");
    expect(hoisted.addTodo).toHaveBeenCalledWith(offerCopyId(OFFER_ID), "새 단어", C1);
    const c = card();
    expect(within(c).getByText("오늘 할 일 목록에 있어요")).toBeTruthy();
    expect(within(c).getByText("새 단어")).toBeTruthy();
    expect(within(rowEl(offerCopyId(OFFER_ID)!)).getByText("오늘 먼저")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: "또 하나" } });
    await press("적기");
    expect(hoisted.addTodo.mock.calls[1][0]).not.toBe(offerCopyId(OFFER_ID));
  });

  it("창을 닫았다 다시 열고 저장해도 첫 글은 제시 id에서 정한 id(닫을 때 버린 id를 다시 받는다)", async () => {
    hoisted.addTodo.mockImplementation(async (id: string, text: string, categoryId: string | null) => ({ ok: true, data: { day: DAY, todo: { id, readable: true, text, done: false, createdAt: "x", categoryId } } }));
    await mount({ offers: offersApi(offer({ todoId: null, todoText: null, todoDay: null })), focus: focusApi() });
    await press("어학 할 일 적기");
    await press("닫기");
    await press("어학 할 일 적기");
    fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: "다시 연 창" } });
    await press("적기");
    expect(hoisted.addTodo).toHaveBeenCalledWith(offerCopyId(OFFER_ID), "다시 연 창", C1);
  });
});

describe("끝냄 · 지움 → 그날 카드를 접는다(K8 꼴)", () => {
  it("카드가 가리키는 오늘 할 일을 끝냄 체크하면 카드가 접히고 꼬리표도 떨어진다", async () => {
    hoisted.setTodoDone.mockResolvedValue({ ok: true, data: { id: T2, done: true } });
    await mount({ offers: offersApi(offer({ todoId: T2, todoDay: "2026-11-07" })), focus: focusApi() }, null, withCopy());
    expect(within(rowEl(T2)).getByText("오늘 먼저")).toBeTruthy();
    await act(async () => fireEvent.click(within(rowEl(T2)).getByRole("checkbox")));
    expect(screen.queryByRole("region", { name: "오늘 먼저 할 일" })).toBeNull();
    expect(within(rowEl(T2)).queryByText("오늘 먼저")).toBeNull();
  });

  it("다른 줄을 끝내면 카드는 그대로", async () => {
    hoisted.setTodoDone.mockResolvedValue({ ok: true, data: { id: T3, done: true } });
    await mount({ offers: offersApi(offer({ todoId: T2, todoDay: "2026-11-07" })), focus: focusApi() }, null, withCopy());
    await act(async () => fireEvent.click(within(rowEl(T3)).getByRole("checkbox")));
    expect(card()).toBeTruthy();
  });
});

describe("K7 · K8", () => {
  it("K7: 타이머가 이미 돌면 카드는 안내와 「타이머 탭 열기」(주 단추 없음)", async () => {
    const running = session({ startedAt: new Date().toISOString() });
    const focus = focusApi({ fetchState: vi.fn(async () => ({ ok: true as const, data: { serverNow: new Date().toISOString(), active: running, today: [running] } })) });
    await mount({ offers: offersApi(), focus });
    await press("타이머");
    await press("할 일");
    expect(within(card()).getByText("타이머가 돌고 있어요. 타이머 탭에서 볼 수 있어요.")).toBeTruthy();
    expect(within(card()).getByRole("button", { name: "타이머 탭 열기" })).toBeTruthy();
    expect(within(card()).queryByRole("button", { name: "오늘 할 일에 추가" })).toBeNull();
  });

  it("K8: 「넘기기」로 카드가 사라지면 포커스는 할 일 탭 제목 「오늘」로 간다", async () => {
    const offers = offersApi();
    await mount({ offers, focus: focusApi() });
    within(card()).getByRole("button", { name: "넘기기" }).focus();
    await press("넘기기");
    expect(screen.queryByRole("region", { name: "오늘 먼저 할 일" })).toBeNull();
    expect(offers.dismiss).toHaveBeenCalledWith(OFFER_ID);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "오늘" }));
  });
});

describe("아침 알림으로 열기(/?open=offer)", () => {
  it("할 일 탭 맨 위에서 열린다: 할 일 탭이 보이고 카드가 있으며, 저녁 기록 창은 열리지 않는다", async () => {
    await mount({ offers: offersApi(), focus: focusApi() }, "offer");
    expect(screen.getByRole("button", { name: "할 일", exact: true } as never).getAttribute("aria-current")).toBe("page");
    expect(card()).toBeTruthy();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(screen.queryByRole("dialog", { name: "오늘 기록" })).toBeNull();
  });
  it("저녁 알림(/?open=evening)은 그대로 저녁 기록을 연다", async () => {
    await mount({ offers: offersApi(), focus: focusApi() }, "evening");
    expect(await screen.findByRole("dialog", { name: "오늘 기록" })).toBeTruthy();
  });
});
