import { describe, expect, it } from "vitest";
import { startFocusForUser } from "../../lib/focus/core";
import { dismissOfferForUser, requestOfferForUser } from "../../lib/offers/core";
import { OFFER_OTHER, offerKey, pickOfferCategory, pickOfferTodo } from "../../lib/offers/logic";
import { encryptCategoryName, encryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

const KEY = parseTodoKey(Buffer.alloc(32, 8).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const MORNING = new Date("2026-11-07T01:00:00.000Z"); // 서울 10:00, 토요일
const EVENING = new Date("2026-11-07T10:00:00.000Z"); // 서울 19:00

describe("건넬 분야 고르기 (G6 나, D-108)", () => {
  const ratios = [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }];
  it("목표가 없고 주 초면 처음 정한 비율이 가장 큰 분야", () => {
    expect(pickOfferCategory({ ratios, goalItems: null, totals: [] })).toBe(C1);
  });
  it("목표가 없고 쓴 시간이 있으면 비율보다 가장 덜 한 분야", () => {
    const totals = [{ categoryId: C1, minutes: 120 }, { categoryId: C2, minutes: 0 }];
    expect(pickOfferCategory({ ratios, goalItems: null, totals })).toBe(C2);
  });
  it("비율이 없으면 건넬 분야가 없다(null)", () => {
    expect(pickOfferCategory({ ratios: [], goalItems: null, totals: [] })).toBeNull();
  });
  it("이번 주 목표가 있으면 목표 안에서 남은 시간이 가장 많은 분야만(목표에 안 든 분야는 건네지 않는다)", () => {
    const goalItems = [{ categoryId: C2, minutes: 120 }, { categoryId: C3, minutes: 300 }];
    const totals = [{ categoryId: C2, minutes: 100 }, { categoryId: C1, minutes: 0 }];
    expect(pickOfferCategory({ ratios, goalItems, totals })).toBe(C3);
    expect(pickOfferCategory({ ratios, goalItems: [{ categoryId: C2, minutes: 120 }], totals: [] })).toBe(C2);
  });
  it("목표를 다 채운 주는 목표에 든 분야 안에서 처음 정한 비율이 큰 분야", () => {
    const goalItems = [{ categoryId: C1, minutes: 60 }, { categoryId: C2, minutes: 60 }];
    const totals = [{ categoryId: C1, minutes: 60 }, { categoryId: C2, minutes: 60 }];
    expect(pickOfferCategory({ ratios, goalItems, totals })).toBe(C1);
    expect(pickOfferCategory({ ratios: [], goalItems, totals })).toBe(C1); // 비율도 없으면 목표의 첫 분야
  });
});

describe("건넬 할 일 고르기", () => {
  it("오늘 끝내지 않은 첫 할 일, 없으면 최근 날의 첫 할 일, 없으면 null", () => {
    const c = (id: string, day: string, createdAt: string) => ({ id, day, createdAt });
    expect(pickOfferTodo([c(T1, "2026-11-05", "a"), c(T2, "2026-11-07", "b"), c(T3, "2026-11-07", "a")], "2026-11-07")).toBe(T3);
    expect(pickOfferTodo([c(T1, "2026-11-04", "a"), c(T2, "2026-11-06", "b")], "2026-11-07")).toBe(T2);
    expect(pickOfferTodo([], "2026-11-07")).toBeNull();
  });
  it("제시 열쇠는 자리·분야·할 일", () => {
    expect(offerKey("card", C1, T1)).toBe(`card|${C1}|${T1}`);
    expect(offerKey("timer_tab", C1, null)).toBe(`timer_tab|${C1}|-`);
  });
});

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const [id, name] of [[C1, "어학"], [C2, "글쓰기"]] as const) {
    store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName(name, ME, KEY!), archived_at: null });
  }
  store.seed("categories", { id: C3, user_id: OTHER, name_encrypted: "x", archived_at: null });
  store.seed("category_ratios", { user_id: ME, category_id: C1, percent: 60 });
  store.seed("category_ratios", { user_id: ME, category_id: C2, percent: 40 });
  const todo = (id: string, text: string, categoryId: string | null, day = "2026-11-07", done = false, user = ME) =>
    store.seed("todos", { id, user_id: user, day, text_encrypted: encryptTodoText(text, user, KEY!), done, category_id: categoryId });
  return { store, todo };
}
const deps = (store: FakeStore, now = MORNING, sub: string | null = ME) => {
  store.fixedNow = now;
  return { supabase: fakeTablesClient(store, { sub }), key: KEY, now: () => now };
};

describe("requestOfferForUser (제시 기록)", () => {
  it("건네고 제시를 기록한다: 분야·할 일·자리·두노 하루, 서버 시각은 DB 기본값", async () => {
    const { store, todo } = setup();
    todo(T1, "단어 외우기", C1);
    const res = await requestOfferForUser(deps(store), { surface: "card" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.offer).toMatchObject({ surface: "card", day: "2026-11-07", categoryId: C1, categoryName: "어학", todoId: T1, todoText: "단어 외우기", state: "new" });
    expect(store.table("todo_offers")).toHaveLength(1);
    const row = store.table("todo_offers")[0];
    expect(row).toMatchObject({ user_id: ME, surface: "card", category_id: C1, todo_id: T1, day: "2026-11-07" });
    expect(row["offer_key"]).toBe(offerKey("card", C1, T1));
    const upsert = store.calls.find((c) => c.table === "todo_offers" && c.op === "upsert");
    expect(Object.keys(upsert!.payload as object)).not.toContain("offered_at");
    expect(Object.keys(upsert!.payload as object)).not.toContain("dismissed_at");
  });
  it("같은 제시를 다시 받아도 기록은 한 번만 늘고 같은 번호를 돌려준다(Q4 임시: 같은 날·자리·분야·할 일은 한 번)", async () => {
    const { store, todo } = setup();
    todo(T1, "단어 외우기", C1);
    const a = await requestOfferForUser(deps(store), { surface: "card" });
    const b = await requestOfferForUser(deps(store), { surface: "card" });
    expect(a.ok && b.ok && a.data.offer?.id === b.data.offer?.id).toBe(true);
    expect(store.table("todo_offers")).toHaveLength(1);
  });
  it("자리가 다르면(카드·타이머 탭) 따로 센다", async () => {
    const { store, todo } = setup();
    todo(T1, "단어 외우기", C1);
    await requestOfferForUser(deps(store), { surface: "card" });
    await requestOfferForUser(deps(store), { surface: "timer_tab" });
    expect(store.table("todo_offers").map((r) => r.surface)).toEqual(["card", "timer_tab"]);
  });
  it("건넬 분야가 바뀌면 새 제시(다른 날도 새로 센다)", async () => {
    const { store, todo } = setup();
    todo(T1, "단어 외우기", C1);
    await requestOfferForUser(deps(store), { surface: "card" });
    store.seed("evening_logs", { id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", user_id: ME, target_day: "2026-11-05", total_minutes: 200, items: [{ categoryId: C1, minutes: 200 }], save_mode: "edited", saved_at: "2026-11-05T14:00:00.000Z" });
    const second = await requestOfferForUser(deps(store), { surface: "card" });
    expect(second.ok && second.data.offer?.categoryId).toBe(C2);
    expect(store.table("todo_offers")).toHaveLength(2);
    await requestOfferForUser(deps(store, new Date(MORNING.getTime() + 24 * 3600_000)), { surface: "card" });
    expect(store.table("todo_offers")).toHaveLength(3);
  });
  it("그 분야에 끝내지 않은 할 일이 없으면 분야만 건넨다(할 일 null)", async () => {
    const { store, todo } = setup();
    todo(T1, "끝낸 일", C1, "2026-11-07", true);
    const res = await requestOfferForUser(deps(store), { surface: "card" });
    expect(res.ok && res.data.offer).toMatchObject({ categoryId: C1, todoId: null, todoText: null });
    expect(store.table("todo_offers")[0]["offer_key"]).toBe(offerKey("card", C1, null));
  });
  it("오늘 것이 없으면 최근(7일 안) 끝내지 않은 할 일을, 8일 전 것은 안 가져온다", async () => {
    const { store, todo } = setup();
    todo(T1, "엿새 전 일", C1, "2026-11-01");
    todo(T2, "열흘 전 일", C1, "2026-10-28");
    const res = await requestOfferForUser(deps(store), { surface: "card" });
    expect(res.ok && res.data.offer?.todoId).toBe(T1);
  });
  it("남의 할 일은 건네지 않는다", async () => {
    const { store, todo } = setup();
    todo(T3, "남의 일", C1, "2026-11-07", false, OTHER);
    const res = await requestOfferForUser(deps(store), { surface: "card" });
    expect(res.ok && res.data.offer?.todoId).toBeNull();
  });
  it("저녁에는 카드를 건네지 않고 기록도 안 한다. 타이머 탭 추천은 저녁에도 한다", async () => {
    const { store, todo } = setup();
    todo(T1, "단어 외우기", C1);
    const card = await requestOfferForUser(deps(store, EVENING), { surface: "card" });
    expect(card).toEqual({ ok: true, data: { offer: null, reason: "evening" } });
    expect(store.table("todo_offers")).toHaveLength(0);
    const tab = await requestOfferForUser(deps(store, EVENING), { surface: "timer_tab" });
    expect(tab.ok && tab.data.offer?.surface).toBe("timer_tab");
    expect(store.table("todo_offers")).toHaveLength(1);
  });
  it("새벽 4시 전은 아직 저녁이다(카드를 안 건넨다)", async () => {
    const { store } = setup();
    const res = await requestOfferForUser(deps(store, new Date("2026-11-07T18:00:00.000Z")), { surface: "card" }); // 서울 03:00
    expect(res.ok && res.data.reason).toBe("evening");
  });
  it("비율이 없으면 건넬 분야가 없다(no_target)", async () => {
    const store = setup().store;
    store.tables.category_ratios = [];
    expect(await requestOfferForUser(deps(store), { surface: "card" })).toEqual({ ok: true, data: { offer: null, reason: "no_target" } });
    expect(store.table("todo_offers")).toHaveLength(0);
  });
  it("넘긴 제시는 다시 받아도 dismissed, 그 제시로 타이머를 켰으면 started", async () => {
    const { store, todo } = setup();
    todo(T1, "단어 외우기", C1);
    const first = await requestOfferForUser(deps(store), { surface: "card" });
    const id = first.ok ? first.data.offer!.id : "";
    expect(await dismissOfferForUser(deps(store), id)).toEqual({ ok: true, data: { id } });
    const again = await requestOfferForUser(deps(store), { surface: "card" });
    expect(again.ok && again.data.offer?.state).toBe("dismissed");
    expect(store.table("todo_offers")).toHaveLength(1);

    const tab = await requestOfferForUser(deps(store), { surface: "timer_tab" });
    const tabId = tab.ok ? tab.data.offer!.id : "";
    const S = "51515151-5151-4151-8151-515151515151";
    await startFocusForUser(deps(store), { id: S, todoId: T1, categoryId: C1, offerId: tabId, surface: "timer_tab" });
    const after = await requestOfferForUser(deps(store), { surface: "timer_tab" });
    expect(after.ok && after.data.offer?.state).toBe("started");
  });
  it("모르는 자리·키는 거절하고 DB를 부르지 않는다. 로그인이 없으면 unauthenticated", async () => {
    const { store } = setup();
    const before = store.calls.length;
    expect(await requestOfferForUser(deps(store), { surface: "push" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await requestOfferForUser(deps(store), { surface: "card", categoryId: C1 })).toEqual({ ok: false, error: "invalid_input" });
    expect(await requestOfferForUser(deps(store), {})).toEqual({ ok: false, error: "invalid_input" });
    expect(store.calls.length).toBe(before);
    expect(await requestOfferForUser(deps(store, MORNING, null), { surface: "card" })).toEqual({ ok: false, error: "unauthenticated" });
  });
});

describe("dismissOfferForUser", () => {
  it("넘긴 시각을 서버 시계로 남기고, 다시 눌러도 같다. 남의 것·없는 것은 not_found", async () => {
    const { store, todo } = setup();
    todo(T1, "단어 외우기", C1);
    const res = await requestOfferForUser(deps(store), { surface: "card" });
    const id = res.ok ? res.data.offer!.id : "";
    await dismissOfferForUser(deps(store), id);
    expect(store.table("todo_offers")[0].dismissed_at).toBe(MORNING.toISOString());
    const at = store.table("todo_offers")[0].dismissed_at;
    await dismissOfferForUser(deps(store, new Date(MORNING.getTime() + 60_000)), id);
    expect(store.table("todo_offers")[0].dismissed_at).toBe(at);
    store.seed("todo_offers", { id: "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f", user_id: OTHER, day: "2026-11-07", surface: "card", category_id: null, todo_id: null, offer_key: "x", offered_at: "x", dismissed_at: null });
    expect(await dismissOfferForUser(deps(store), "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f")).toEqual({ ok: false, error: "not_found" });
    expect(await dismissOfferForUser(deps(store), "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0fffff")).toEqual({ ok: false, error: "not_found" });
    expect(await dismissOfferForUser(deps(store), "x")).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("기타도 건넨다 (고침 3바퀴, PM 답 d-69)", () => {
  const ratios = [{ categoryId: C1, percent: 30 }, { categoryId: null, percent: 70 }];
  const settingsRow = { user_id: ME, ratio_other_percent: 100, onboarding_done_at: null, goal_encrypted: null, notify_evening_enabled: false, notify_evening_minute: 1170, notify_morning_enabled: false, notify_morning_minute: 600 };
  it("처음 정한 비율에 기타가 있고 주 초면 가장 큰 비율인 기타를 건넨다", () => {
    expect(pickOfferCategory({ ratios, goalItems: null, totals: [] })).toBe(OFFER_OTHER);
  });
  it("쓴 시간이 있으면 비율보다 가장 덜 한 쪽(기타 포함)", () => {
    expect(pickOfferCategory({ ratios, goalItems: null, totals: [{ categoryId: null, minutes: 200 }, { categoryId: C1, minutes: 0 }] })).toBe(C1);
    expect(pickOfferCategory({ ratios, goalItems: null, totals: [{ categoryId: C1, minutes: 200 }] })).toBe(OFFER_OTHER);
  });
  it("비율에 기타가 없으면 기타는 건네지 않는다(예전 그대로)", () => {
    expect(pickOfferCategory({ ratios: [{ categoryId: C1, percent: 100 }], goalItems: null, totals: [{ categoryId: null, minutes: 60 }] })).toBe(C1);
    expect(pickOfferCategory({ ratios: [{ categoryId: C1, percent: 100 }], goalItems: null, totals: [{ categoryId: C1, minutes: 60 }] })).toBeNull();
  });
  it("이번 주 목표가 있으면 목표 안에서만 건넨다(목표에는 기타가 없다)", () => {
    const goalItems = [{ categoryId: C1, minutes: 120 }];
    expect(pickOfferCategory({ ratios, goalItems, totals: [] })).toBe(C1);
  });
  it("서버: 기타를 건네면 분야 없는 오늘 끝내지 않은 할 일을 담고 제시는 분야 null로 기록된다", async () => {
    const { store, todo } = setup();
    store.table("category_ratios").length = 0;
    store.seed("user_settings", settingsRow);
    todo(T1, "분야 없는 할 일", null);
    todo(T2, "어학 할 일", C1);
    const res = await requestOfferForUser(deps(store), { surface: "card" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.offer).toMatchObject({ categoryId: null, categoryName: "기타", todoId: T1, todoText: "분야 없는 할 일", state: "new" });
    expect(store.table("todo_offers")[0]).toMatchObject({ category_id: null, todo_id: T1, offer_key: offerKey("card", null, T1) });
  });
  it("서버: 기타를 건네는데 할 일이 없으면 분야만(기타 30분) 건넨다", async () => {
    const { store } = setup();
    store.table("category_ratios").length = 0;
    store.seed("user_settings", settingsRow);
    const res = await requestOfferForUser(deps(store), { surface: "timer_tab" });
    expect(res.ok && res.data.offer).toMatchObject({ categoryId: null, categoryName: "기타", todoId: null, todoText: null });
  });
});
