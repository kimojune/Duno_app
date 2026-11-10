import { describe, expect, it } from "vitest";
import { z } from "zod";
import { startFocusForUser } from "../../lib/focus/core";
import { offerCopyId } from "../../lib/offers/copy-id";
import { addOfferTodoForUser, dismissOfferForUser, requestOfferForUser } from "../../lib/offers/core";
import { needsAddToToday, writtenDayLine } from "../../lib/offers/logic";
import { decryptTodoText, encryptCategoryName, encryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/**
 * 고침 11: 「오늘 할 일에 추가」(d-227). 서버가 제시 id에서 사본 id를 정하고, 제시 줄은 고치지 않는다(todo_offers는 dismissed_at만 고친다).
 * 공개 엔드포인트라 악용 시나리오를 둘 다(악성 거절·정상 통과) 본다.
 */
const KEY = parseTodoKey(Buffer.alloc(32, 8).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const T1 = "11111111-1111-4111-8111-111111111111"; // 어제 것
const T2 = "22222222-2222-4222-8222-222222222222"; // 오늘 것
const T3 = "33333333-3333-4333-8333-333333333333"; // 남의 것
const T4 = "44444444-4444-4444-8444-444444444444"; // 8일 전 것
const MORNING = new Date("2026-11-07T01:00:00.000Z"); // 서울 10:00, 2026-11-07
const EVENING = new Date("2026-11-07T10:00:00.000Z"); // 서울 19:00

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const [id, name] of [[C1, "어학"], [C2, "글쓰기"]] as const) {
    store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName(name, ME, KEY!), archived_at: null });
  }
  store.seed("category_ratios", { user_id: ME, category_id: C1, percent: 60 });
  store.seed("category_ratios", { user_id: ME, category_id: C2, percent: 40 });
  const todo = (id: string, text: string, categoryId: string | null, day: string, done = false, user = ME) =>
    store.seed("todos", { id, user_id: user, day, text_encrypted: encryptTodoText(text, user, KEY!), done, category_id: categoryId });
  return { store, todo };
}
const deps = (store: FakeStore, now = MORNING, sub: string | null = ME) => {
  store.fixedNow = now;
  return { supabase: fakeTablesClient(store, { sub }), key: KEY, now: () => now };
};
/** 어제 것 하나를 건네받은 카드 제시 */
async function cardOffer(store: FakeStore, now = MORNING) {
  const res = await requestOfferForUser(deps(store, now), { surface: "card" });
  if (!res.ok || !res.data.offer) throw new Error("카드 제시가 없다");
  return res.data.offer;
}
const writes = (store: FakeStore) => store.calls.filter((c) => c.op !== "select");
const todayTodos = (store: FakeStore) => store.table("todos").filter((t) => t.user_id === ME && t.day === "2026-11-07");

describe("사본 id 식(offerCopyId) — 같은 제시 → 늘 같은 uuid", () => {
  const A = "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f";
  const B = "1f1f1f1f-1f1f-41f1-81f1-1f1f1f1f1f1f";
  it("제시 id의 버전 칸만 5로 바꾼다. 형식이 맞는 uuid이고 같은 제시는 늘 같다", () => {
    expect(offerCopyId(A)).toBe("0f0f0f0f-0f0f-50f0-80f0-0f0f0f0f0f0f");
    expect(offerCopyId(A)).toBe(offerCopyId(A));
    expect(z.uuid().safeParse(offerCopyId(A)).success).toBe(true);
    expect(offerCopyId("ABCDEF01-0f0f-40f0-80f0-0f0f0f0f0f0f")).toBe("abcdef01-0f0f-50f0-80f0-0f0f0f0f0f0f"); // 대문자도 같은 식
  });
  it("제시가 다르면 사본도 다르고, 사본 id는 제시 id와 다르다. uuid가 아니면 null", () => {
    expect(offerCopyId(A)).not.toBe(offerCopyId(B));
    expect(offerCopyId(A)).not.toBe(A);
    for (const bad of ["", "x", "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0", `${A}0`, "0f0f0f0f0f0f40f080f00f0f0f0f0f0f"]) expect(offerCopyId(bad)).toBeNull();
  });
});

describe("적은 날 줄 · 추가 꼴 판정(순수)", () => {
  it("어제 것은 「어제 적은 할 일」, 그 전은 「{M}월 {D}일에 적은 할 일」, 오늘 것·모르는 날은 줄 없음", () => {
    expect(writtenDayLine("2026-11-12", "2026-11-13")).toBe("어제 적은 할 일");
    expect(writtenDayLine("2026-11-10", "2026-11-13")).toBe("11월 10일에 적은 할 일");
    expect(writtenDayLine("2026-10-31", "2026-11-03")).toBe("10월 31일에 적은 할 일");
    expect(writtenDayLine("2026-02-28", "2026-03-01")).toBe("어제 적은 할 일"); // 달이 넘어가도
    expect(writtenDayLine("2026-11-13", "2026-11-13")).toBeNull();
    expect(writtenDayLine(null, "2026-11-13")).toBeNull();
    expect(writtenDayLine(undefined, "2026-11-13")).toBeNull();
    expect(writtenDayLine("어제", "2026-11-13")).toBeNull();
  });
  it("건넨 할 일이 있고 지난 날 것일 때만 「오늘 할 일에 추가」", () => {
    expect(needsAddToToday({ todoId: T1, todoDay: "2026-11-06" }, "2026-11-07")).toBe(true);
    expect(needsAddToToday({ todoId: T1, todoDay: "2026-11-07" }, "2026-11-07")).toBe(false);
    expect(needsAddToToday({ todoId: null, todoDay: null }, "2026-11-07")).toBe(false); // 분야만(K6)
    expect(needsAddToToday({ todoId: T1 }, "2026-11-07")).toBe(false); // 옛 기기 사본(날짜 모름)
  });
});

describe("제시에 건넨 할 일의 날짜(todoDay)", () => {
  it("어제 것을 건네면 어제 날짜, 오늘 것이면 오늘, 분야만 건네면 null", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    expect((await cardOffer(store)).todoDay).toBe("2026-11-06");
    todo(T2, "오늘 단어", C1, "2026-11-07");
    store.tables["todo_offers"] = [];
    expect((await cardOffer(store)).todoDay).toBe("2026-11-07");
    const empty = setup();
    expect((await cardOffer(empty.store)).todoDay).toBeNull();
  });
});

describe("addOfferTodoForUser — 정상", () => {
  it("어제 할 일을 오늘 할 일로 복사한다: 글·분야를 복사하고 원본은 그대로, 사본 id는 제시 id에서 정한 값, 제시 줄은 그대로", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    const offersBefore = JSON.stringify(store.table("todo_offers"));
    const callsBefore = store.calls.length;
    const copyId = offerCopyId(offer.id)!;
    const res = await addOfferTodoForUser(deps(store), { offerId: offer.id });
    expect(res).toEqual({ ok: true, data: { added: true, todoId: copyId, todoText: "어제 단어", day: "2026-11-07" } });
    const copy = todayTodos(store);
    expect(copy).toHaveLength(1);
    expect(copy[0]).toMatchObject({ id: copyId, user_id: ME, day: "2026-11-07", category_id: C1, done: false });
    expect(decryptTodoText(copy[0].text_encrypted as string, ME, KEY!)).toEqual({ ok: true, text: "어제 단어" });
    // 원본은 그대로
    expect(store.table("todos").find((t) => t.id === T1)).toMatchObject({ day: "2026-11-06", done: false });
    // 제시 줄은 고치지 않는다(todo_offers에는 쓰기가 없다)
    expect(JSON.stringify(store.table("todo_offers"))).toBe(offersBefore);
    const added = store.calls.slice(callsBefore);
    expect(added.filter((c) => c.table === "todo_offers" && c.op !== "select")).toHaveLength(0);
    // 먼저 한 기록은 만들지 않는다(D-092)
    expect(store.table("focus_sessions")).toHaveLength(0);
    expect(added.filter((c) => c.table === "focus_sessions" && c.op !== "select")).toHaveLength(0);
    // 쓴 곳은 todos 하나(insert 하나)뿐이다
    expect(added.filter((c) => c.op !== "select").map((c) => `${c.table}.${c.op}`)).toEqual(["todos.insert"]);
  });

  it("연타·같은 제시로 다시 눌러도 오늘 할 일은 하나, 같은 사본을 돌려준다(저녁에도 같다)", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store, EVENING);
    const results = await Promise.all([1, 2, 3].map(() => addOfferTodoForUser(deps(store, EVENING), { offerId: offer.id })));
    for (const r of results) expect(r).toEqual({ ok: true, data: { added: true, todoId: offerCopyId(offer.id), todoText: "어제 단어", day: "2026-11-07" } });
    const again = await addOfferTodoForUser(deps(store, EVENING), { offerId: offer.id });
    expect(again.ok && again.data).toMatchObject({ added: true, todoId: offerCopyId(offer.id) });
    expect(todayTodos(store)).toHaveLength(1);
  });

  it("추가한 뒤 카드를 다시 받으면 같은 제시가 그 사본·오늘 날짜로 돌아오고, 제시 줄은 새로 생기지 않는다", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    await addOfferTodoForUser(deps(store), { offerId: offer.id });
    expect(store.table("todo_offers")).toHaveLength(1);
    const again = await requestOfferForUser(deps(store), { surface: "card" });
    expect(again.ok && again.data.offer).toEqual({
      id: offer.id, surface: "card", day: "2026-11-07", categoryId: C1, categoryName: "어학",
      todoId: offerCopyId(offer.id), todoText: "어제 단어", todoDay: "2026-11-07", state: "new",
    });
    expect(store.table("todo_offers")).toHaveLength(1); // 분모는 한 번
    // 다시 받아도 같다
    const third = await requestOfferForUser(deps(store), { surface: "card" });
    expect(third.ok && third.data.offer?.id).toBe(offer.id);
    expect(store.table("todo_offers")).toHaveLength(1);
  });

  it("그 사본으로 켠 타이머의 offer_id는 원래 제시 번호이고, 켠 뒤 카드 상태는 started다. 분모는 그대로 한 줄", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    await addOfferTodoForUser(deps(store), { offerId: offer.id });
    const card = await requestOfferForUser(deps(store), { surface: "card" });
    const copyId = card.ok ? card.data.offer!.todoId : null;
    const S = "51515151-5151-4151-8151-515151515151";
    const started = await startFocusForUser(deps(store), { id: S, todoId: copyId, categoryId: C1, offerId: offer.id, surface: "card" });
    expect(started.ok).toBe(true);
    expect(store.table("focus_sessions")).toHaveLength(1);
    expect(store.table("focus_sessions")[0]).toMatchObject({ offer_id: offer.id, todo_id: offerCopyId(offer.id), surface: "card" });
    const after = await requestOfferForUser(deps(store), { surface: "card" });
    expect(after.ok && after.data.offer).toMatchObject({ id: offer.id, state: "started" });
    expect(store.table("todo_offers")).toHaveLength(1);
  });

  it("사본을 오늘 끝내면 그날 카드는 접힌다(offer null · 이유 done), 새 제시 줄은 없다 — 고침 11-2: 끝냄을 먼저 할 일을 했다로 본다", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    await addOfferTodoForUser(deps(store), { offerId: offer.id });
    store.table("todos").find((t) => t.id === offerCopyId(offer.id))!.done = true;
    const again = await requestOfferForUser(deps(store), { surface: "card" });
    expect(again).toEqual({ ok: true, data: { offer: null, reason: "done" } });
    await requestOfferForUser(deps(store), { surface: "card" });
    expect(store.table("todo_offers")).toHaveLength(1);
  });

  it("타이머 탭 추천은 카드 제시와 따로 센다(사본 재사용은 카드에만)", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    await addOfferTodoForUser(deps(store), { offerId: offer.id });
    const tab = await requestOfferForUser(deps(store), { surface: "timer_tab" });
    expect(tab.ok && tab.data.offer).toMatchObject({ surface: "timer_tab", todoId: offerCopyId(offer.id), todoDay: "2026-11-07" }); // 오늘 것을 먼저 건넨다
    expect(tab.ok && tab.data.offer?.id).not.toBe(offer.id);
  });
});

describe("addOfferTodoForUser — 악용 시나리오(악성 거절)", () => {
  it("비로그인: 세션 없이 호출하면 unauthenticated, 쓰기 0", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    const before = writes(store).length;
    expect(await addOfferTodoForUser(deps(store, MORNING, null), { offerId: offer.id })).toEqual({ ok: false, error: "unauthenticated" });
    expect(writes(store).length).toBe(before);
    expect(todayTodos(store)).toHaveLength(0);
  });

  it("다른 사용자: 남의 제시 id로 부르면 not_found, 쓰기 0 (남의 할 일은 복사되지 않는다)", async () => {
    const { store, todo } = setup();
    todo(T3, "남의 어제 글", null, "2026-11-06", false, OTHER);
    const OTHER_OFFER = "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f";
    store.seed("todo_offers", { id: OTHER_OFFER, user_id: OTHER, day: "2026-11-07", surface: "card", category_id: null, todo_id: T3, offer_key: "x", offered_at: "x", dismissed_at: null });
    const before = writes(store).length;
    expect(await addOfferTodoForUser(deps(store), { offerId: OTHER_OFFER })).toEqual({ ok: false, error: "not_found" });
    expect(await addOfferTodoForUser(deps(store), { offerId: "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0fffff" })).toEqual({ ok: false, error: "not_found" }); // 없는 것
    expect(writes(store).length).toBe(before);
    expect(store.table("todos").filter((t) => t.user_id === ME)).toHaveLength(0);
  });

  it("내 제시가 남의 할 일 번호를 가리켜도(위조된 줄) 복사하지 않는다: 자기 할 일만 찾는다 → 사본 없음, 쓰기 0", async () => {
    const { store, todo } = setup();
    todo(T3, "남의 어제 글", C1, "2026-11-06", false, OTHER);
    const MINE = "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f";
    store.seed("todo_offers", { id: MINE, user_id: ME, day: "2026-11-07", surface: "card", category_id: C1, todo_id: T3, offer_key: "x", offered_at: "x", dismissed_at: null });
    const before = writes(store).length;
    expect(await addOfferTodoForUser(deps(store), { offerId: MINE })).toEqual({ ok: true, data: { added: false } });
    expect(writes(store).length).toBe(before);
  });

  it("자기 계정 남용: 넘긴 제시 · 지난 날 제시 · 타이머 탭 제시 · 할 일 없는(분야만) 제시는 거절, 쓰기 0", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    const tab = await requestOfferForUser(deps(store), { surface: "timer_tab" });
    const tabId = tab.ok ? tab.data.offer!.id : "";
    const OLD = "0e0e0e0e-0e0e-40e0-80e0-0e0e0e0e0e0e";
    store.seed("todo_offers", { id: OLD, user_id: ME, day: "2026-11-06", surface: "card", category_id: C1, todo_id: T1, offer_key: "old", offered_at: "x", dismissed_at: null });
    const NONE = "0d0d0d0d-0d0d-40d0-80d0-0d0d0d0d0d0d";
    store.seed("todo_offers", { id: NONE, user_id: ME, day: "2026-11-07", surface: "card", category_id: C2, todo_id: null, offer_key: "none", offered_at: "x", dismissed_at: null });
    const before = writes(store).length;
    for (const id of [tabId, OLD, NONE]) expect(await addOfferTodoForUser(deps(store), { offerId: id })).toEqual({ ok: false, error: "not_found" });
    await dismissOfferForUser(deps(store), offer.id);
    const afterDismiss = writes(store).length;
    expect(await addOfferTodoForUser(deps(store), { offerId: offer.id })).toEqual({ ok: false, error: "not_found" });
    expect(writes(store).length).toBe(afterDismiss);
    expect(afterDismiss).toBeGreaterThan(before); // 넘김 쓰기 하나만 늘었다
    expect(todayTodos(store)).toHaveLength(0);
  });

  it("자기 계정 남용: 화면이 사본 id를 정해 보낼 수 없다 — id·todoId 같은 남는 필드는 invalid_input, 쓰기 0", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    const before = store.calls.length;
    const forged = "99999999-9999-4999-8999-999999999999";
    for (const bad of [{ offerId: offer.id, id: forged }, { offerId: offer.id, todoId: forged }, { offerId: offer.id, from: T1 }]) {
      expect(await addOfferTodoForUser(deps(store), bad)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(store.calls.length).toBe(before);
    expect(todayTodos(store)).toHaveLength(0);
  });

  it("자기 계정 남용: uuid 아님·빈 값·큰 문자열·객체 아님은 invalid_input, DB를 부르지 않는다", async () => {
    const { store } = setup();
    const before = store.calls.length;
    for (const bad of [undefined, null, "x", 7, [], {}, { offerId: "nope" }, { offerId: "" }, { offerId: "a".repeat(10_000) }, { offerId: 5 }, { offerId: null }]) {
      expect(await addOfferTodoForUser(deps(store), bad)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(store.calls.length).toBe(before);
  });

  it("원본이 그새 끝났거나 지워졌거나 7일을 넘었거나 오늘 것이 되면 실패 대신 { added: false }(새 사본 없음)", async () => {
    // 끝남
    const a = setup();
    a.todo(T1, "어제 단어", C1, "2026-11-06");
    const offerA = await cardOffer(a.store);
    a.store.table("todos").find((t) => t.id === T1)!.done = true;
    expect(await addOfferTodoForUser(deps(a.store), { offerId: offerA.id })).toEqual({ ok: true, data: { added: false } });
    expect(todayTodos(a.store)).toHaveLength(0);
    // 지워짐
    const b = setup();
    b.todo(T1, "어제 단어", C1, "2026-11-06");
    const offerB = await cardOffer(b.store);
    b.store.tables["todos"] = [];
    expect(await addOfferTodoForUser(deps(b.store), { offerId: offerB.id })).toEqual({ ok: true, data: { added: false } });
    // 7일을 넘음(제시 줄이 8일 전 할 일을 가리키는 경우)
    const c = setup();
    c.todo(T4, "오래된 글", C1, "2026-10-30");
    const OFFER_C = "0c0c0c0c-0c0c-40c0-80c0-0c0c0c0c0c0c";
    c.store.seed("todo_offers", { id: OFFER_C, user_id: ME, day: "2026-11-07", surface: "card", category_id: C1, todo_id: T4, offer_key: "c", offered_at: "x", dismissed_at: null });
    expect(await addOfferTodoForUser(deps(c.store), { offerId: OFFER_C })).toEqual({ ok: true, data: { added: false } });
    // 이미 오늘 것
    const d = setup();
    d.todo(T2, "오늘 단어", C1, "2026-11-07");
    const offerD = await cardOffer(d.store);
    expect(await addOfferTodoForUser(deps(d.store), { offerId: offerD.id })).toEqual({ ok: true, data: { added: false } });
    expect(todayTodos(d.store)).toHaveLength(1);
  });

  it("자기 계정: DB 오류는 짧은 코드만, 원문은 내지 않는다", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    store.alwaysError = { code: "XX000", message: "secret internal detail: relation todos at 10.0.0.1" };
    const res = await addOfferTodoForUser(deps(store), { offerId: offer.id });
    expect(res).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(res)).not.toMatch(/secret|10\.0\.0\.1|relation/);
  });

  it("키가 없으면 config, 예상 못 한 예외는 unavailable(던지지 않는다)", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    expect(await addOfferTodoForUser({ ...deps(store), key: null }, { offerId: offer.id })).toEqual({ ok: false, error: "config" });
    const boom = { ...deps(store), supabase: { auth: { getClaims: async () => ({ data: { claims: { sub: ME } }, error: null }) }, from: () => { throw new Error("boom"); } } as never };
    expect(await addOfferTodoForUser(boom, { offerId: offer.id })).toEqual({ ok: false, error: "unavailable" });
  });

  it("DB의 하루 할 일 수 상한(P0001)에 걸리면 limit 코드만(기존 상한 트리거 유지). 이미 사본이 있으면 그 사본을 돌려준다", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const offer = await cardOffer(store);
    store.rules["todos"] = { ...store.rules["todos"], limit: { count: 1, hint: "todos_daily_limit" } };
    // 이미 어제 것 하나가 있어 상한 1에 걸린다
    const res = await addOfferTodoForUser(deps(store), { offerId: offer.id });
    expect(res).toEqual({ ok: false, error: "limit" });
    expect(todayTodos(store)).toHaveLength(0);
  });
});
