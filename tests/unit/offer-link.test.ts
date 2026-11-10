import { describe, expect, it } from "vitest";
import { startFocusForUser } from "../../lib/focus/core";
import { offerCopyId } from "../../lib/offers/copy-id";
import { dismissOfferForUser, requestOfferForUser } from "../../lib/offers/core";
import { encryptCategoryName, encryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/**
 * 고침 11-2(d-232): 카드에 「30분 시작」이 없다. 카드 제시가 가리키는 오늘 할 일을 서버가 알아보고(분야만 제시에서 적은 새 할 일 · 이미 오늘 목록의 할 일),
 * 끝냄·지움이면 그날 카드를 접으며(새 제시 줄 없음), 분자(타이머)는 카드 제시 번호 · surface card로 센다.
 */
const KEY = parseTodoKey(Buffer.alloc(32, 8).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const T1 = "11111111-1111-4111-8111-111111111111";
const MORNING = new Date("2026-11-07T01:00:00.000Z"); // 서울 2026-11-07 10:00

function setup(ratios: [string, number][] = [[C1, 100]]) {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const [id, name] of [[C1, "어학"], [C2, "글쓰기"]] as const) {
    store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName(name, ME, KEY!), archived_at: null });
  }
  for (const [id, percent] of ratios) store.seed("category_ratios", { user_id: ME, category_id: id, percent });
  const todo = (id: string, text: string, categoryId: string | null, day: string, done = false, user = ME) =>
    store.seed("todos", { id, user_id: user, day, text_encrypted: encryptTodoText(text, user, KEY!), done, category_id: categoryId });
  return { store, todo };
}
const deps = (store: FakeStore, now = MORNING, sub: string | null = ME) => {
  store.fixedNow = now;
  return { supabase: fakeTablesClient(store, { sub }), key: KEY, now: () => now };
};
const card = async (store: FakeStore) => {
  const res = await requestOfferForUser(deps(store), { surface: "card" });
  if (!res.ok) throw new Error(res.error);
  return res.data;
};

describe("분야만 제시 → 그 제시 id에서 정한 id의 오늘 할 일이 생기면 그 할 일과 함께 돌려준다(L8 → L6)", () => {
  it("분야만 건넨 뒤 파생 id로 적은 같은 분야의 오늘 할 일이 있으면 같은 제시가 그 할 일을 가리킨다. 새 제시 줄은 없다", async () => {
    const { store, todo } = setup();
    const first = await card(store);
    expect(first.offer).toMatchObject({ categoryId: C1, todoId: null, todoText: null, todoDay: null });
    const offerId = first.offer!.id;
    todo(offerCopyId(offerId)!, "새로 적은 단어", C1, "2026-11-07");
    const again = await card(store);
    expect(again.offer).toEqual({
      id: offerId, surface: "card", day: "2026-11-07", categoryId: C1, categoryName: "어학",
      todoId: offerCopyId(offerId), todoText: "새로 적은 단어", todoDay: "2026-11-07", state: "new",
    });
    expect(store.table("todo_offers")).toHaveLength(1); // 분모는 한 번
    expect((await card(store)).offer?.id).toBe(offerId);
    expect(store.table("todo_offers")).toHaveLength(1);
  });

  it("악용: 파생 id가 아닌 id로 만든 할 일 · 다른 분야 할 일 · 어제 날짜 할 일은 잇지 않는다(분야만 그대로)", async () => {
    const { store, todo } = setup();
    const offerId = (await card(store)).offer!.id;
    todo(T1, "내가 아무 id로 적음", C1, "2026-11-07");
    todo(offerCopyId(offerId)!.replace(/^./, "9"), "다른 파생", C1, "2026-11-07");
    expect((await card(store)).offer?.todoId).toBe(T1); // 파생 id가 아니니 잇지 않고, 평소 규칙(오늘 첫 할 일)으로 정한 새 제시(제시 줄 둘)
    expect(store.table("todo_offers").length).toBe(2);
    // 파생 id이지만 다른 분야 · 어제 날짜
    const other = setup();
    const id2 = (await card(other.store)).offer!.id;
    other.todo(offerCopyId(id2)!, "다른 분야로 적음", C2, "2026-11-07");
    other.todo("33333333-3333-4333-8333-333333333333", "dummy", C1, "2026-11-06");
    const res = await card(other.store);
    expect(res.offer?.todoId).not.toBe(offerCopyId(id2)); // 분야가 달라 잇지 않는다
    const yday = setup();
    const id3 = (await card(yday.store)).offer!.id;
    yday.todo(offerCopyId(id3)!, "어제 날짜", C1, "2026-11-06");
    const ydayRes = await card(yday.store);
    expect(ydayRes.offer?.id).not.toBe(id3); // 어제 날짜라 오늘 사본으로 잇지 않고 평소 규칙으로 새 제시(그 할 일은 지난 날 것)
    expect(ydayRes.offer?.todoDay).toBe("2026-11-06");
  });

  it("악용: 남의 제시 id에서 파생한 id의 할 일(내 계정)은 내 제시와 이어지지 않는다 · 남의 할 일은 보이지 않는다", async () => {
    const { store, todo } = setup();
    const mine = (await card(store)).offer!.id;
    const OTHER_OFFER = "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f";
    store.seed("todo_offers", { id: OTHER_OFFER, user_id: OTHER, day: "2026-11-07", surface: "card", category_id: C1, todo_id: null, offer_key: "x", offered_at: "x", dismissed_at: null });
    todo(offerCopyId(OTHER_OFFER)!, "남의 제시로 파생", C1, "2026-11-07", false, OTHER);
    todo(offerCopyId(OTHER_OFFER)!.replace(/^./, "8"), "내 계정의 다른 파생", C1, "2026-11-07");
    const res = await card(store);
    expect(res.offer?.todoId).not.toBe(offerCopyId(mine)); // 내 제시와 이어진 사본 아님
    expect(res.offer?.todoText).not.toBe("남의 제시로 파생");
  });
});

describe("끝냄 · 지움 → 그날 카드를 접는다(새 제시 줄 없음)", () => {
  it("이미 오늘 목록에 있는 할 일을 카드가 건넸고 그 할 일을 끝내면 offer null · done, 다시 열어도 새 제시 줄은 0", async () => {
    const { store, todo } = setup();
    todo(T1, "오늘 단어", C1, "2026-11-07");
    const offer = (await card(store)).offer!;
    expect(offer).toMatchObject({ todoId: T1, todoDay: "2026-11-07" });
    expect(store.table("todo_offers")).toHaveLength(1);
    store.table("todos").find((t) => t.id === T1)!.done = true;
    for (let i = 0; i < 3; i++) expect(await requestOfferForUser(deps(store), { surface: "card" })).toEqual({ ok: true, data: { offer: null, reason: "done" } });
    expect(store.table("todo_offers")).toHaveLength(1);
  });

  it("카드가 가리킨 할 일을 지우면(없음)도 접는다", async () => {
    const { store, todo } = setup();
    todo(T1, "오늘 단어", C1, "2026-11-07");
    await card(store);
    store.tables["todos"] = [];
    expect(await requestOfferForUser(deps(store), { surface: "card" })).toEqual({ ok: true, data: { offer: null, reason: "done" } });
    expect(store.table("todo_offers")).toHaveLength(1);
  });

  it("분야만 제시에서 적은 할 일을 끝내도 접는다. 넘긴 제시 · 타이머 탭 추천은 이 규칙과 상관없다", async () => {
    const { store, todo } = setup();
    const offerId = (await card(store)).offer!.id;
    todo(offerCopyId(offerId)!, "새로 적은 단어", C1, "2026-11-07");
    store.table("todos").find((t) => t.id === offerCopyId(offerId))!.done = true;
    expect((await card(store)).reason).toBe("done");
    const tab = await requestOfferForUser(deps(store), { surface: "timer_tab" });
    expect(tab.ok && tab.data.offer).toMatchObject({ surface: "timer_tab" }); // 타이머 탭 추천은 지금 규칙 그대로
  });

  it("지난 날 할 일(아직 안 넣음)은 접히지 않는다: 원본이 살아 있으면 같은 제시를 돌려준다", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 단어", C1, "2026-11-06");
    const first = (await card(store)).offer!;
    const again = await card(store);
    expect(again.offer?.id).toBe(first.id);
    expect(again.offer?.todoDay).toBe("2026-11-06");
  });

  it("넘긴 제시는 접힘과 상관없이 다시 나오지 않는다(기존 규칙)", async () => {
    const { store, todo } = setup();
    todo(T1, "오늘 단어", C1, "2026-11-07");
    const offer = (await card(store)).offer!;
    await dismissOfferForUser(deps(store), offer.id);
    const res = await card(store);
    expect(res.offer === null || res.offer?.state === "dismissed").toBe(true);
  });
});

describe("분자: 타이머는 카드 제시 id · surface card로 센다(서버가 제시를 확인)", () => {
  const S = "51515151-5151-4151-8151-515151515151";
  const S2 = "52525252-5252-4252-8252-525252525252";
  const start = (store: FakeStore, over: Record<string, unknown>) =>
    startFocusForUser(deps(store), { id: S, todoId: null, categoryId: C1, surface: "card", clientStartedAt: MORNING.toISOString(), ...over });

  it("정상: 카드 제시 id · surface card로 켜면 기록되고 카드 상태는 started가 된다. 분모(제시 줄)는 그대로 한 줄", async () => {
    const { store, todo } = setup();
    todo(T1, "오늘 단어", C1, "2026-11-07");
    const offer = (await card(store)).offer!;
    const res = await start(store, { todoId: T1, offerId: offer.id });
    expect(res.ok).toBe(true);
    expect(store.table("focus_sessions")[0]).toMatchObject({ offer_id: offer.id, surface: "card", todo_id: T1 });
    expect((await card(store)).offer?.state).toBe("started");
    expect(store.table("todo_offers")).toHaveLength(1);
  });

  it("악용: 남의 제시 · 없는 제시 · 다른 자리(timer_tab) 제시 · 지난 날 제시는 거절, 기록 0", async () => {
    const { store, todo } = setup();
    todo(T1, "오늘 단어", C1, "2026-11-07");
    const offer = (await card(store)).offer!;
    const tab = await requestOfferForUser(deps(store), { surface: "timer_tab" });
    const tabId = tab.ok ? tab.data.offer!.id : "";
    const OTHER_OFFER = "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f";
    store.seed("todo_offers", { id: OTHER_OFFER, user_id: OTHER, day: "2026-11-07", surface: "card", category_id: null, todo_id: null, offer_key: "o", offered_at: "x", dismissed_at: null });
    const OLD = "0e0e0e0e-0e0e-40e0-80e0-0e0e0e0e0e0e";
    store.seed("todo_offers", { id: OLD, user_id: ME, day: "2026-11-06", surface: "card", category_id: C1, todo_id: null, offer_key: "old", offered_at: "x", dismissed_at: null });
    expect(await start(store, { offerId: OTHER_OFFER })).toEqual({ ok: false, error: "not_found" });
    expect(await start(store, { offerId: "0d0d0d0d-0d0d-40d0-80d0-0d0d0d0d0d0d" })).toEqual({ ok: false, error: "not_found" });
    expect(await start(store, { offerId: tabId })).toEqual({ ok: false, error: "invalid_input" }); // timer_tab 제시를 card로
    expect(await start(store, { offerId: OLD })).toEqual({ ok: false, error: "invalid_input" });
    expect(await start(store, { offerId: offer.id, surface: "timer_tab" })).toEqual({ ok: false, error: "invalid_input" }); // card 제시를 timer_tab으로
    expect(store.table("focus_sessions")).toHaveLength(0);
    // 타이머 탭 추천 줄로 켜면 지금처럼 timer_tab 제시
    const ok = await startFocusForUser(deps(store), { id: S2, todoId: T1, categoryId: C1, offerId: tabId, surface: "timer_tab", clientStartedAt: MORNING.toISOString() });
    expect(ok.ok).toBe(true);
  });
});

describe("접는 것은 가장 최근 제시만 본다", () => {
  it("오래된 제시가 가리키던 오늘 할 일이 지워졌어도 더 최근 제시가 살아 있으면 접지 않는다", async () => {
    const { store, todo } = setup();
    todo(T1, "오늘 단어", C1, "2026-11-07");
    const older = (await card(store)).offer!;
    expect(older.todoId).toBe(T1);
    // 더 최근 제시(다른 분야, 아직 할 일 없음)를 직접 심는다
    store.seed("todo_offers", { id: "0a0a0a0a-0a0a-40a0-80a0-0a0a0a0a0a0a", user_id: ME, day: "2026-11-07", surface: "card", category_id: C2, todo_id: null, offer_key: "card|c2|-", offered_at: "2099-01-01T00:00:00.000Z", dismissed_at: null });
    store.tables["todos"] = []; // 오래된 제시의 할 일이 지워졌다
    const res = await requestOfferForUser(deps(store), { surface: "card" });
    expect(res.ok && res.data.reason).not.toBe("done");
  });
});
