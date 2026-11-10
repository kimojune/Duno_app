import { beforeEach, describe, expect, it, vi } from "vitest";

const requestOffer = vi.fn();
vi.mock("../../app/offers/actions", () => ({ requestOffer: (...a: unknown[]) => requestOffer(...a), dismissOffer: vi.fn() }));
vi.mock("../../lib/push/subscribe", () => ({ defaultPushApi: { enable: vi.fn(async () => "ok") } }));

import { createLocalApis } from "../../lib/local/apis";
import { createMemoryKv, kvKeys } from "../../lib/local/kv";
import { emptyMirror } from "../../lib/local/reduce";
import { createRuntime } from "../../lib/local/runtime";
import type { Mirror, MirrorTodo, QueuedOp, SendResult } from "../../lib/local/types";
import { offerCopyId } from "../../lib/offers/copy-id";
import type { Offer } from "../../lib/offers/types";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const S1 = "51515151-5151-4151-8151-515151515151";
const NOON = Date.parse("2026-11-07T06:00:00.000Z"); // 서울 15:00, 두노 하루 11-07
const iso = (ms: number) => new Date(ms).toISOString();

const todo = (id: string, text: string, day = "2026-11-07", over: Partial<MirrorTodo> = {}): MirrorTodo => ({
  id,
  day,
  text,
  done: false,
  createdAt: `${day}T01:00:00.000Z`,
  categoryId: null,
  position: null,
  ...over,
});

async function setup(over: Partial<Mirror> = {}) {
  const mirror: Mirror = {
    ...emptyMirror(),
    synced: true,
    categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" }],
    settings: { goal: null, goalReadable: true, onboardingDone: true, notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 }, ratios: [{ categoryId: C1, percent: 100 }] },
    ...over,
  };
  const kv = createMemoryKv();
  await kv.set(kvKeys.base(USER), mirror);
  const sent: QueuedOp[] = [];
  const send = vi.fn(async (q: QueuedOp): Promise<SendResult> => {
    sent.push(q);
    return { ok: true };
  });
  const runtime = createRuntime({ userKey: USER, kv, send, fetchSnapshot: async () => ({ ok: false, error: "unavailable" }), now: () => NOON, online: () => false });
  await runtime.boot();
  return { runtime, apis: createLocalApis(runtime), sent };
}

beforeEach(() => {
  requestOffer.mockReset();
  vi.restoreAllMocks();
});

describe("ManageApi (기기)", () => {
  it("고치기: 글 검사를 기기에서 하고(빈 글·200자 넘음), 고친 줄을 바로 돌려준다. 없는 할 일·남의 분야는 거절", async () => {
    const { runtime, apis } = await setup({ todos: [todo(T1, "옛 글")] });
    expect(await apis.manage.editTodo(T1, { text: "  " })).toEqual({ ok: false, error: "empty" });
    expect(await apis.manage.editTodo(T1, { text: "가".repeat(201) })).toEqual({ ok: false, error: "too_long" });
    expect(await apis.manage.editTodo(T2, { text: "x" })).toEqual({ ok: false, error: "not_found" });
    expect(await apis.manage.editTodo(T1, { categoryId: C2 })).toEqual({ ok: false, error: "invalid_category" });
    expect(await apis.manage.editTodo(T1, {})).toEqual({ ok: false, error: "invalid_input" });
    expect(runtime.pendingCount()).toBe(0); // 거절한 것은 줄에 넣지 않는다
    const res = await apis.manage.editTodo(T1, { text: " 새 글 ", categoryId: C1 });
    expect(res).toEqual({ ok: true, data: { todo: expect.objectContaining({ id: T1, text: "새 글", categoryId: C1 }) } });
    expect(runtime.pendingOps().map((o) => o.op)).toEqual([{ kind: "todo.edit", id: T1, text: "새 글", categoryId: C1 }]);
  });
  it("지우기·순서: 바로 거울이 바뀌고 줄에 들어간다. 순서는 모르는 id·중복을 거절", async () => {
    const { runtime, apis } = await setup({ todos: [todo(T1, "a"), todo(T2, "b")] });
    expect(await apis.manage.reorderTodos([T2, T1])).toEqual({ ok: true, data: { ids: [T2, T1] } });
    expect(await apis.manage.reorderTodos([T1, T1])).toEqual({ ok: false, error: "invalid_input" });
    expect(await apis.manage.reorderTodos([T3])).toEqual({ ok: false, error: "not_found" });
    expect(await apis.manage.deleteTodo(T1)).toEqual({ ok: true, data: { id: T1 } });
    expect(runtime.getMirror().todos.map((t) => t.id)).toEqual([T2]);
    expect(await apis.manage.deleteTodo(T1)).toEqual({ ok: false, error: "not_found" });
  });
  it("작업 기록: 글 검사를 하고, 바로 목록에 보인다. 열어 보지 않은 할 일은 서버에서 받을 때까지 한 줄을 만들어 준다", async () => {
    const { apis } = await setup({ todos: [todo(T1, "a")], notes: { [T1]: [] } });
    expect(await apis.manage.addNote("aaaa1111-1111-4111-8111-111111111111", T1, " ")).toEqual({ ok: false, error: "empty" });
    expect(await apis.manage.addNote("aaaa1111-1111-4111-8111-111111111111", T3, "x")).toEqual({ ok: false, error: "not_found" });
    const added = await apis.manage.addNote("aaaa1111-1111-4111-8111-111111111111", T1, "메모");
    expect(added.ok && added.data.note).toMatchObject({ text: "메모", todoId: T1 });
    const listed = await apis.manage.fetchNotes(T1);
    expect(listed.ok && listed.data.notes.map((n) => n.id)).toEqual(["aaaa1111-1111-4111-8111-111111111111"]);
    await apis.manage.deleteNote("aaaa1111-1111-4111-8111-111111111111");
    const after = await apis.manage.fetchNotes(T1);
    expect(after.ok && after.data.notes).toEqual([]);
  });
  it("작업 기록 읽기: 서버에 아직 없는 할 일은 서버에 묻지 않고 빈 목록, 있으면 서버 목록에 못 보낸 쓰기를 입혀 준다", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: true, data: { notes: [{ id: "n-server", todoId: T2, day: "2026-11-07", createdAt: "x", readable: true, text: "서버 기록" }] } }),
    );
    const { runtime, apis } = await setup({ todos: [todo(T2, "서버에 있는 할 일")] });
    runtime.enqueue({ kind: "todo.add", id: T1, text: "방금 적음" });
    expect(await apis.manage.fetchNotes(T1)).toEqual({ ok: true, data: { notes: [] } });
    expect(fetchSpy).not.toHaveBeenCalled();
    const fromServer = await apis.manage.fetchNotes(T2);
    expect(fromServer.ok && fromServer.data.notes.map((n) => n.id)).toEqual(["n-server"]);
    // 한 번 받으면 거울에 있어 다시 묻지 않는다
    await apis.manage.fetchNotes(T2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it("어제 못 끝낸 것: 후보는 기기에서 읽고, 가져오면 오늘 목록에 바로 생기며 줄에 들어간다. 어제 것이 아닌 id는 거절", async () => {
    const { runtime, apis } = await setup({ todos: [todo(T1, "어제 일", "2026-11-06"), todo(T2, "그제 일", "2026-11-05")] });
    const candidates = await apis.manage.fetchYesterday();
    expect(candidates.ok && candidates.data.todos.map((t) => t.id)).toEqual([T1]);
    expect(await apis.manage.carryOver([{ from: T2, id: T3 }])).toEqual({ ok: false, error: "not_found" });
    const res = await apis.manage.carryOver([{ from: T1, id: T3 }]);
    expect(res.ok && res.data.todos.map((t) => t.readable && t.text)).toEqual(["어제 일"]);
    expect(res.ok && res.data.day.date).toBe("2026-11-07");
    expect(runtime.getMirror().todos.some((t) => t.id === T3 && t.day === "2026-11-07")).toBe(true);
    expect(runtime.pendingOps()[0].op).toEqual({ kind: "todo.carry", items: [{ from: T1, id: T3 }] });
  });
  it("지난 날 보기: 기기에 둔 8일 안은 기기에서, 밖은 서버(GET /todos/day)에서 읽는다", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true, data: { day: { date: "2026-10-01", year: 2026, month: 10, dayOfMonth: 1, weekday: 4 }, todos: [] } }));
    const { apis } = await setup({ todos: [todo(T1, "어제 글", "2026-11-06")] });
    const near = await apis.manage.fetchDay?.("2026-11-06");
    expect(near && near.ok && near.data.todos.map((t) => t.id)).toEqual([T1]);
    expect(fetchSpy).not.toHaveBeenCalled();
    await apis.manage.fetchDay?.("2026-10-01");
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/todos/day?date=2026-10-01"), expect.anything());
  });
  it("기기 먼저 저장 표시(localFirst)가 켜져 있다 — 화면이 끊김 때 막지 않는다", async () => {
    const { apis } = await setup();
    for (const api of Object.values(apis)) expect(api.localFirst).toBe(true);
  });
});

describe("저녁 기록·타이머·이번 주 목표 API (기기)", () => {
  it("저녁 기록 읽기·저장: 거울에서 바로 읽고, 저장하면 바뀐 시간 한 줄(delta)을 바로 돌려주고 상태보기가 바뀐다", async () => {
    const { runtime, apis } = await setup({ todos: [todo(T1, "a", "2026-11-07", { done: true, categoryId: C1 })] });
    const state = await apis.evening.fetchState();
    expect(state.ok && state.data).toMatchObject({ day: "2026-11-07", doneCategoryIds: [C1], existing: null });
    const input = { id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", targetDay: "2026-11-07", totalMinutes: 90, items: [{ categoryId: C1, minutes: 60 }, { categoryId: null, minutes: 30 }], saveMode: "edited" as const, clientSavedAt: iso(NOON) };
    const saved = await apis.evening.save(input);
    expect(saved.ok && saved.data.delta).toEqual([{ categoryId: C1, minutes: 60 }, { categoryId: null, minutes: 30 }]);
    expect(saved.ok && saved.data.log).toMatchObject({ id: input.id, totalMinutes: 90, targetDay: "2026-11-07" });
    const growth = await apis.growth.fetchGrowth();
    expect(growth.ok && growth.data.thisWeek).toEqual([{ categoryId: C1, minutes: 60 }, { categoryId: null, minutes: 30 }]);
    // 고쳐 저장하면 앞선 기록 대비 바뀐 만큼
    const again = await apis.evening.save({ ...input, id: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2", totalMinutes: 100, items: [{ categoryId: C1, minutes: 100 }], clientSavedAt: iso(NOON + 1000) });
    expect(again.ok && again.data.delta).toEqual([{ categoryId: C1, minutes: 40 }, { categoryId: null, minutes: -30 }]);
    expect(runtime.pendingCount()).toBe(2);
  });
  it("저녁 기록 저장 거절: 합이 안 맞음·범위 밖 날·남의 분야", async () => {
    const { runtime, apis } = await setup();
    const base = { id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", targetDay: "2026-11-07", saveMode: "edited" as const, clientSavedAt: iso(NOON) };
    expect(await apis.evening.save({ ...base, totalMinutes: 50, items: [{ categoryId: null, minutes: 30 }] })).toEqual({ ok: false, error: "invalid_input" });
    expect(await apis.evening.save({ ...base, targetDay: "2026-11-08", totalMinutes: 30, items: [{ categoryId: null, minutes: 30 }] })).toEqual({ ok: false, error: "invalid_input" });
    expect(await apis.evening.save({ ...base, totalMinutes: 30, items: [{ categoryId: C2, minutes: 30 }] })).toEqual({ ok: false, error: "not_found" });
    expect(runtime.pendingCount()).toBe(0);
  });
  it("타이머: 시작하면 바로 진행 중, 이미 도는 것이 있으면 already_running, 끝내면 진행한 시간이 정해진다. 같은 끝내기를 두 번 눌러도 줄에는 한 번", async () => {
    const { runtime, apis } = await setup();
    const started = await apis.focus.start({ id: S1, categoryId: C1, surface: "manual", clientStartedAt: iso(NOON) });
    expect(started.ok && started.data.session).toMatchObject({ id: S1, endedAt: null, plannedMinutes: 30 });
    expect(await apis.focus.start({ id: "52525252-5252-4252-8252-525252525252", surface: "manual", clientStartedAt: iso(NOON) })).toEqual({ ok: false, error: "already_running" });
    expect((await apis.focus.start({ id: S1, categoryId: C1, surface: "manual", clientStartedAt: iso(NOON) })).ok).toBe(true); // 같은 id 재시도
    const ended = await apis.focus.end(S1);
    expect(ended.ok && ended.data.session.endedAt).not.toBeNull();
    await apis.focus.end(S1);
    expect(runtime.pendingOps().map((o) => o.op.kind)).toEqual(["focus.start", "focus.end"]);
    expect(await apis.focus.end("53535353-5353-4353-8353-535353535353")).toEqual({ ok: false, error: "not_found" });
  });
  it("이번 주 목표: 검사(60분 단위·분야 확인)를 기기에서 하고 바로 한 줄에 반영한다", async () => {
    const { apis } = await setup();
    expect(await apis.goals.save([{ categoryId: C1, minutes: 90 }])).toEqual({ ok: false, error: "invalid_input" });
    expect(await apis.goals.save([{ categoryId: C2, minutes: 60 }])).toEqual({ ok: false, error: "not_found" });
    const saved = await apis.goals.save([{ categoryId: C1, minutes: 120 }]);
    expect(saved).toEqual({ ok: true, data: { weekStart: "2026-11-02", items: [{ categoryId: C1, minutes: 120 }] } });
    const summary = await apis.goals.fetchSummary();
    expect(summary.ok && summary.data.goal).toEqual([{ categoryId: C1, minutes: 120 }]);
    expect(await apis.goals.clear()).toEqual({ ok: true, data: { weekStart: "2026-11-02" } });
  });
  it("본 것 기록: 바로 성공으로 답하고 줄에 넣는다", async () => {
    const { runtime, apis } = await setup();
    expect(await apis.growth.recordView({ id: "77777777-7777-4777-8777-777777777777", screen: "growth", entry: "after_save" })).toEqual({ ok: true, data: { id: "77777777-7777-4777-8777-777777777777" } });
    expect(runtime.pendingOps()[0].op).toEqual({ kind: "view.record", id: "77777777-7777-4777-8777-777777777777", screen: "growth", entry: "after_save" });
  });
});

describe("설정 API (기기)", () => {
  it("분야 더하기: 서버와 같은 규칙을 기기에서 본다(이름 검사·같은 이름·기타·50개 상한). 같은 id 재시도는 그 분야로 성공", async () => {
    const { runtime, apis } = await setup();
    expect(await apis.settings.addCategory(C2, "기타")).toEqual({ ok: false, error: "reserved" });
    expect(await apis.settings.addCategory(C2, "  ")).toEqual({ ok: false, error: "empty" });
    expect(await apis.settings.addCategory(C2, "가".repeat(21))).toEqual({ ok: false, error: "too_long" });
    expect(await apis.settings.addCategory(C2, "어학")).toEqual({ ok: false, error: "duplicate", existing: { id: C1, name: "어학" } });
    const made = await apis.settings.addCategory(C2, "글쓰기");
    expect(made.ok && made.data.category).toMatchObject({ id: C2, name: "글쓰기", readable: true });
    const retry = await apis.settings.addCategory(C2, "글쓰기");
    expect(retry.ok).toBe(true);
    expect(runtime.pendingCount()).toBe(1);
    const many = await setup({ categories: Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, readable: true as const, name: `분야${i}`, createdAt: "x" })) });
    expect(await many.apis.settings.addCategory(C2, "새 분야")).toEqual({ ok: false, error: "category_limit" });
  });
  it("비율·설정 저장: 검사(합이 0·남의 분야·긴 목표)를 기기에서 하고, 저장하면 거울에 바로 반영한다", async () => {
    const { runtime, apis } = await setup();
    expect(await apis.settings.saveRatios([{ categoryId: C1, percent: 0 }])).toEqual({ ok: false, error: "invalid_input" });
    expect(await apis.settings.saveRatios([{ categoryId: C2, percent: 50 }])).toEqual({ ok: false, error: "not_found" });
    expect((await apis.settings.saveRatios([{ categoryId: C1, percent: 60 }, { categoryId: null, percent: 40 }])).ok).toBe(true);
    expect(runtime.getMirror().settings?.ratios).toHaveLength(2);
    expect(await apis.settings.saveSettings({ goal: "가".repeat(101) })).toEqual({ ok: false, error: "too_long" });
    expect(await apis.settings.saveSettings({})).toEqual({ ok: false, error: "invalid_input" });
    const saved = await apis.settings.saveSettings({ goal: "  토익   900점 ", notify: { eveningEnabled: true }, completeOnboarding: true });
    expect(saved).toEqual({ ok: true, data: expect.objectContaining({ goal: "토익 900점", onboardingDone: true, notify: expect.objectContaining({ eveningEnabled: true }) }) });
    expect(runtime.pendingOps().at(-1)?.op).toEqual({ kind: "settings.save", patch: { goal: "토익 900점", notify: { eveningEnabled: true }, completeOnboarding: true } });
  });
});

describe("먼저 할 일 건네기 API (제시는 서버만 정한다)", () => {
  const offer = (over: Partial<Offer> = {}): Offer => ({ id: "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f", surface: "card", day: "2026-11-07", categoryId: C1, categoryName: "어학", todoId: T1, todoText: "단어", todoDay: "2026-11-07", state: "new", ...over });
  it("기기에 오늘 건넨 제시가 있으면 그것을 먼저 돌려주고, 뒤에서 서버에 다시 물어 바뀌면 거울을 바꾼다", async () => {
    const { runtime, apis } = await setup();
    runtime.patchBase((m) => ({ ...m, offers: { ...m.offers, card: offer() } }));
    requestOffer.mockResolvedValue({ ok: true, data: { offer: offer({ id: "1f1f1f1f-1f1f-41f1-81f1-1f1f1f1f1f1f", todoText: "새 할 일" }) } });
    const res = await apis.offers.request("card");
    expect(res.ok && res.data.offer?.todoText).toBe("단어"); // 기다리지 않고 기기 것
    await vi.waitFor(() => expect(runtime.getMirror().offers.card?.todoText).toBe("새 할 일"));
    expect(requestOffer).toHaveBeenCalledWith({ surface: "card" });
  });
  it("기기에 없으면(처음) 서버를 기다린다. 서버에 닿지 못하면 건네지 못한 것으로 둔다", async () => {
    const { runtime, apis } = await setup();
    requestOffer.mockResolvedValue({ ok: true, data: { offer: offer() } });
    const first = await apis.offers.request("card");
    expect(first.ok && first.data.offer?.id).toBe(offer().id);
    expect(runtime.getMirror().offers.card?.id).toBe(offer().id);
    requestOffer.mockRejectedValue(new Error("offline"));
    const other = await apis.offers.request("timer_tab");
    expect(other).toEqual({ ok: false, error: "unavailable" });
  });
  it("넘기기·타이머 시작은 제시를 거울에서 거두고 줄에 넣는다(서버가 반응을 기록)", async () => {
    const { runtime, apis } = await setup();
    runtime.patchBase((m) => ({ ...m, offers: { ...m.offers, card: offer() } }));
    await apis.offers.dismiss(offer().id);
    expect(runtime.getMirror().offers.card).toBeNull();
    expect(runtime.pendingOps()[0].op).toEqual({ kind: "offer.dismiss", id: offer().id });
    runtime.patchBase((m) => ({ ...m, offers: { ...m.offers, timer_tab: offer({ surface: "timer_tab" }) } }));
    await apis.focus.start({ id: S1, categoryId: C1, offerId: offer().id, surface: "timer_tab", clientStartedAt: iso(NOON) });
    expect(runtime.getMirror().offers.timer_tab).toBeNull();
  });
});

describe("「오늘 할 일에 추가」(고침 11): 기기 먼저 저장도 서버와 같은 사본 id 식", () => {
  const YESTERDAY = "2026-11-06";
  const offer = (over: Partial<Offer> = {}): Offer => ({ id: "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f", surface: "card", day: "2026-11-07", categoryId: C1, categoryName: "어학", todoId: T1, todoText: "단어", todoDay: "2026-11-07", state: "new", ...over });
  const pastOffer = () => offer({ todoId: T1, todoText: "어제 단어", todoDay: YESTERDAY });
  const withPast = (over: Partial<MirrorTodo> = {}) => setup({ todos: [todo(T1, "어제 단어", YESTERDAY, { categoryId: C1, ...over })] });

  it("사본을 오늘 할 일로 거울에 먼저 입히고(제시 id에서 정한 id) 카드를 그 사본으로 바꾸며 보낼 줄에 넣는다. 원본은 그대로", async () => {
    const { runtime, apis } = await withPast();
    runtime.patchBase((m) => ({ ...m, offers: { ...m.offers, card: pastOffer() } }));
    const copyId = offerCopyId(offer().id)!;
    const res = await apis.offers.addTodo(offer().id);
    expect(res).toEqual({ ok: true, data: { added: true, todoId: copyId, todoText: "어제 단어", day: "2026-11-07" } });
    const copy = runtime.getMirror().todos.find((t) => t.id === copyId);
    expect(copy).toMatchObject({ day: "2026-11-07", text: "어제 단어", done: false, categoryId: C1 });
    expect(runtime.getMirror().todos.find((t) => t.id === T1)).toMatchObject({ day: YESTERDAY, done: false });
    expect(runtime.getMirror().offers.card).toMatchObject({ id: offer().id, todoId: copyId, todoDay: "2026-11-07" });
    expect(runtime.pendingOps().map((o) => o.op)).toEqual([{ kind: "offer.addTodo", offerId: offer().id, from: T1 }]);
  });
  it("다시 눌러도 사본 하나(줄에 한 번만), 원본이 그새 끝났으면 사본 없이 added: false, 모르는 제시는 not_found", async () => {
    const { runtime, apis } = await withPast();
    runtime.patchBase((m) => ({ ...m, offers: { ...m.offers, card: pastOffer() } }));
    await apis.offers.addTodo(offer().id);
    const again = await apis.offers.addTodo(offer().id);
    expect(again.ok && again.data).toMatchObject({ added: true, todoId: offerCopyId(offer().id) });
    expect(runtime.pendingOps()).toHaveLength(1);
    expect(runtime.getMirror().todos.filter((t) => t.day === "2026-11-07")).toHaveLength(1);
    expect(await apis.offers.addTodo("0a0a0a0a-0a0a-40a0-80a0-0a0a0a0a0a0a")).toEqual({ ok: false, error: "not_found" });
    expect(await apis.offers.addTodo("nope")).toEqual({ ok: false, error: "not_found" });
    const done = await withPast({ done: true });
    done.runtime.patchBase((m) => ({ ...m, offers: { ...m.offers, card: pastOffer() } }));
    expect(await done.apis.offers.addTodo(offer().id)).toEqual({ ok: true, data: { added: false } });
    expect(done.runtime.pendingCount()).toBe(0);
  });
  it("쓰기(reduce)는 카드가 이미 사본을 가리켜도 같은 사본을 입힌다: 줄에 남은 쓰기를 다시 입혀도(replay) 한 번만", async () => {
    const { applyOp } = await import("../../lib/local/reduce");
    const copyId = offerCopyId(offer().id)!;
    const base: Mirror = { ...emptyMirror(), todos: [todo(T1, "어제 단어", YESTERDAY, { categoryId: C1 })], offers: { card: { ...pastOffer(), todoId: copyId, todoDay: "2026-11-07" }, timer_tab: null } };
    const q = { clientAt: iso(NOON), op: { kind: "offer.addTodo" as const, offerId: offer().id, from: T1 } };
    const once = applyOp(base, q);
    expect(once.todos.filter((t) => t.id === copyId)).toHaveLength(1);
    expect(applyOp(once, q).todos.filter((t) => t.id === copyId)).toHaveLength(1);
    expect(once.offers.card).toMatchObject({ todoId: copyId, todoDay: "2026-11-07", todoText: "어제 단어" });
    // 원본이 없으면(줄 앞쪽 쓰기가 거절돼 지워졌을 때) 던지지 않고 그대로
    expect(applyOp({ ...base, todos: [] }, q).todos).toHaveLength(0);
  });
});

describe("분야 페이지", () => {
  it("처음 열 때는 서버를 기다리고, 열어 본 적이 있으면 그것을 먼저 보여 준다", async () => {
    const page = (text: string) => ({ ok: true, data: { categoryId: C1, days: [{ day: "2026-11-07", todos: [{ id: T1, text, done: false, notes: [] }] }] } });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(page("처음"))).mockResolvedValueOnce(Response.json(page("나중")));
    const { apis } = await setup();
    const first = await apis.growth.fetchCategoryPage(C1);
    expect(first.ok && first.data.days[0].todos[0].text).toBe("처음");
    const second = await apis.growth.fetchCategoryPage(C1);
    expect(second.ok && second.data.days[0].todos[0].text).toBe("처음"); // 먼저 보여 주는 것은 기억해 둔 것
    expect(fetchSpy).toHaveBeenCalledTimes(2); // 뒤에서 새로 받아 둔다
  });
});

describe("먼저 할 일 카드: 저녁·새벽에도 기기에 둔 오늘 제시를 먼저 쓴다(시간대 규칙 없음, d-223)", () => {
  it.each([
    ["서울 19:00", "2026-11-07T10:00:00.000Z"],
    ["서울 22:00", "2026-11-07T13:00:00.000Z"],
    ["서울 다음 날 02:00", "2026-11-07T17:00:00.000Z"],
  ])("%s에도 오늘 건넨 카드를 기기에서 바로 쓰고 뒤에서 서버에 다시 묻는다", async (_label, iso) => {
    const evening = Date.parse(iso);
    const mirror: Mirror = { ...emptyMirror(), synced: true };
    const kv = createMemoryKv();
    await kv.set(kvKeys.base(USER), mirror);
    const runtime = createRuntime({ userKey: USER, kv, send: async () => ({ ok: true }), fetchSnapshot: async () => ({ ok: false, error: "unavailable" }), now: () => evening, online: () => false });
    await runtime.boot();
    const card = { id: "0f0f0f0f-0f0f-40f0-80f0-0f0f0f0f0f0f", surface: "card" as const, day: "2026-11-07", categoryId: C1, categoryName: "어학", todoId: null, todoText: null, todoDay: null, state: "new" as const };
    runtime.patchBase((m) => ({ ...m, offers: { ...m.offers, card } }));
    requestOffer.mockResolvedValue({ ok: true, data: { offer: card } });
    const res = await createLocalApis(runtime).offers.request("card");
    expect(res).toEqual({ ok: true, data: { offer: card } });
    expect(requestOffer).toHaveBeenCalledWith({ surface: "card" });
    expect(runtime.getMirror().offers.card).toEqual(card);
  });
});
