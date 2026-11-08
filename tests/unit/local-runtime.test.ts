import { describe, expect, it, vi } from "vitest";
import { deriveEveningState, deriveFocusState, deriveGoalSummary, deriveGrowth, derivePastDay, deriveToday, deriveYesterday } from "../../lib/local/derive";
import { createMemoryKv, kvKeys, wipeOtherUsers } from "../../lib/local/kv";
import { applyOp, emptyMirror, mergeSnapshot, replay } from "../../lib/local/reduce";
import { createRuntime, RETRY_MAX_MS, STALLED_AFTER_ATTEMPTS, type RuntimeDeps } from "../../lib/local/runtime";
import type { Mirror, MirrorSnapshot, MirrorTodo, Op, QueuedOp, SendResult } from "../../lib/local/types";

/**
 * 기기 먼저 저장(고침 3바퀴)의 핵심: 쓰기 → 기기 거울 → 화면 → 보낼 줄. 서버는 가짜(send·fetchSnapshot)로 바꾼다.
 */

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const S1 = "51515151-5151-4151-8151-515151515151";
const E1 = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";

// 서울 2026-11-07 15:00(토) = 두노 하루 11-07, 이 주의 월요일은 11-02
const NOON = Date.parse("2026-11-07T06:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function todo(id: string, text: string, day = "2026-11-07", over: Partial<MirrorTodo> = {}): MirrorTodo {
  return { id, day, text, done: false, createdAt: `${day}T01:00:00.000Z`, categoryId: null, position: null, ...over };
}

function syncedMirror(over: Partial<Mirror> = {}): Mirror {
  return {
    ...emptyMirror(),
    synced: true,
    categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" }],
    settings: { goal: null, goalReadable: true, onboardingDone: true, notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 }, ratios: [{ categoryId: C1, percent: 100 }] },
    ...over,
  };
}
const q = (op: Op, clientAt = iso(NOON)): QueuedOp => ({ key: "k", clientAt, attempts: 0, op });
const snapshot = (over: Partial<MirrorSnapshot> = {}): MirrorSnapshot => ({
  serverNow: iso(NOON),
  todos: [],
  categories: [],
  settings: null,
  logs: [],
  goal: null,
  sessions: [],
  ...over,
});

describe("applyOp: 쓰기를 거울에 입힌다(순수)", () => {
  it("할 일 적기: 적은 때의 두노 하루로 들어가고(새벽 4시 전은 전날), 같은 id는 한 번만", () => {
    const m = applyOp(syncedMirror(), q({ kind: "todo.add", id: T1, text: "단어", categoryId: C1 }));
    expect(m.todos).toEqual([expect.objectContaining({ id: T1, day: "2026-11-07", text: "단어", done: false, categoryId: C1 })]);
    expect(applyOp(m, q({ kind: "todo.add", id: T1, text: "단어", categoryId: C1 })).todos).toHaveLength(1);
    const lateNight = applyOp(syncedMirror(), q({ kind: "todo.add", id: T2, text: "새벽" }, "2026-11-07T18:30:00.000Z")); // 서울 11-08 03:30
    expect(lateNight.todos[0].day).toBe("2026-11-07");
    const morning = applyOp(syncedMirror(), q({ kind: "todo.add", id: T3, text: "아침" }, "2026-11-07T19:30:00.000Z")); // 서울 11-08 04:30
    expect(morning.todos[0].day).toBe("2026-11-08");
  });
  it("끝냄·고치기·지우기·순서", () => {
    let m = syncedMirror({ todos: [todo(T1, "a"), todo(T2, "b")] });
    m = applyOp(m, q({ kind: "todo.done", id: T1, done: true }));
    expect(m.todos[0].done).toBe(true);
    m = applyOp(m, q({ kind: "todo.edit", id: T2, text: "b2", categoryId: C1 }));
    expect(m.todos[1]).toMatchObject({ text: "b2", categoryId: C1 });
    m = applyOp(m, q({ kind: "todo.reorder", ids: [T2, T1] }));
    expect(deriveToday(m, NOON).todos.ok && (deriveToday(m, NOON).todos as { data: { todos: { id: string }[] } }).data.todos.map((t) => t.id)).toEqual([T2, T1]);
    m = applyOp(m, q({ kind: "todo.delete", id: T1 }));
    expect(m.todos.map((t) => t.id)).toEqual([T2]);
  });
  it("없는 대상은 던지지 않고 넘어간다(앞선 쓰기가 거절돼 대상이 없을 때)", () => {
    const m = syncedMirror();
    for (const op of [
      { kind: "todo.done", id: T1, done: true },
      { kind: "todo.edit", id: T1, text: "x" },
      { kind: "todo.delete", id: T1 },
      { kind: "note.add", id: "n", todoId: T1, text: "x" },
      { kind: "focus.end", id: S1 },
    ] as Op[]) {
      expect(applyOp(m, q(op))).toEqual(m);
    }
  });
  it("어제 못 끝낸 것 가져오기: 어제 것의 글·분야를 오늘로 복사하고 가져온 순서가 보인다. 어제 것은 그대로", () => {
    let m = syncedMirror({ todos: [todo(T1, "어제 일 1", "2026-11-06", { categoryId: C1 }), todo(T2, "어제 일 2", "2026-11-06")] });
    m = applyOp(m, q({ kind: "todo.carry", items: [{ from: T2, id: "n2n2n2n2-n2n2-4n2n-8n2n-n2n2n2n2n2n2" }, { from: T1, id: "n1n1n1n1-n1n1-4n1n-8n1n-n1n1n1n1n1n1" }] }));
    const today = deriveToday(m, NOON).todos;
    expect(today.ok && today.data.todos.map((t) => t.readable && t.text)).toEqual(["어제 일 2", "어제 일 1"]);
    expect(m.todos.filter((t) => t.day === "2026-11-06")).toHaveLength(2);
    expect(today.ok && today.data.todos[1].categoryId).toBe(C1);
  });
  it("저녁 기록: 그날 가장 늦은 기록이 현재 값이고, 상태보기가 바로 바뀐다", () => {
    let m = syncedMirror();
    const save = (id: string, minutes: number, at: number) => q({ kind: "evening.save", input: { id, targetDay: "2026-11-07", totalMinutes: minutes, items: [{ categoryId: C1, minutes }], saveMode: "edited", clientSavedAt: iso(at) } }, iso(at));
    m = applyOp(m, save(E1, 60, NOON));
    m = applyOp(m, save("e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2", 90, NOON + 1000));
    expect(m.logs).toHaveLength(1);
    const growth = deriveGrowth(m, NOON + 2000);
    expect(growth.ok && growth.data.thisWeek).toEqual([{ categoryId: C1, minutes: 90 }]);
    const state = deriveEveningState(m, undefined, NOON + 2000);
    expect(state.ok && state.data.existing?.totalMinutes).toBe(90);
  });
  it("타이머: 시작하면 진행 중, 끝내면 기기 시각으로 진행한 시간이 정해진다(정한 길이를 넘기지 않는다)", () => {
    let m = syncedMirror();
    m = applyOp(m, q({ kind: "focus.start", input: { id: S1, categoryId: C1, surface: "manual", clientStartedAt: iso(NOON) } }, iso(NOON)));
    const running = deriveFocusState(m, NOON + 60_000);
    expect(running.ok && running.data.active?.id).toBe(S1);
    m = applyOp(m, q({ kind: "focus.end", id: S1 }, iso(NOON + 750_000)));
    const ended = deriveFocusState(m, NOON + 800_000);
    expect(ended.ok && ended.data.active).toBeNull();
    expect(ended.ok && ended.data.today[0]).toMatchObject({ endedAt: iso(NOON + 750_000), elapsedSeconds: 750 });
    // 정한 길이(30분)를 넘기지 않는다
    let m2 = applyOp(syncedMirror(), q({ kind: "focus.start", input: { id: S1, surface: "manual", clientStartedAt: iso(NOON) } }, iso(NOON)));
    m2 = applyOp(m2, q({ kind: "focus.end", id: S1 }, iso(NOON + 3 * 3600_000)));
    expect(m2.sessions[0].elapsedSeconds).toBe(1800);
  });
  it("이번 주 목표: 기기가 정한 때의 주에 저장하고 없앤다", () => {
    let m = syncedMirror();
    m = applyOp(m, q({ kind: "goal.save", items: [{ categoryId: C1, minutes: 120 }] }));
    const summary = deriveGoalSummary(m, NOON);
    expect(summary.ok && summary.data).toMatchObject({ weekStart: "2026-11-02", goal: [{ categoryId: C1, minutes: 120 }] });
    m = applyOp(m, q({ kind: "goal.clear" }));
    expect(deriveGoalSummary(m, NOON).ok && (deriveGoalSummary(m, NOON) as { data: { goal: unknown } }).data.goal).toBeNull();
  });
  it("설정·비율·분야 더하기·작업 기록", () => {
    let m = syncedMirror({ notes: { [T1]: [] }, todos: [todo(T1, "a")] });
    m = applyOp(m, q({ kind: "settings.save", patch: { goal: "토익", completeOnboarding: true, notify: { eveningEnabled: true } } }));
    expect(m.settings).toMatchObject({ goal: "토익", onboardingDone: true, notify: { eveningEnabled: true, morningEnabled: false } });
    m = applyOp(m, q({ kind: "ratios.save", ratios: [{ categoryId: C1, percent: 60 }, { categoryId: null, percent: 40 }] }));
    expect(m.settings?.ratios).toHaveLength(2);
    m = applyOp(m, q({ kind: "category.add", id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2", name: "글쓰기" }));
    expect(m.categories.map((c) => c.readable && c.name)).toEqual(["어학", "글쓰기"]);
    m = applyOp(m, q({ kind: "note.add", id: "nnn", todoId: T1, text: "메모" }));
    expect(m.notes[T1]).toHaveLength(1);
    m = applyOp(m, q({ kind: "note.delete", id: "nnn" }));
    expect(m.notes[T1]).toHaveLength(0);
  });
  it("설정이 아직 없는 거울에도 입힌다(처음 쓰는 기기)", () => {
    const m = applyOp(emptyMirror(), q({ kind: "settings.save", patch: { completeOnboarding: true } }));
    expect(m.settings?.onboardingDone).toBe(true);
  });
  it("replay: 서버 거울에 보낼 줄을 차례로 입힌다", () => {
    const base = syncedMirror({ todos: [todo(T1, "a")] });
    const out = replay(base, [q({ kind: "todo.done", id: T1, done: true }), q({ kind: "todo.add", id: T2, text: "b" })]);
    expect(out.todos.map((t) => [t.id, t.done])).toEqual([[T1, true], [T2, false]]);
    expect(base.todos[0].done).toBe(false); // 원래 거울은 바뀌지 않는다
  });
  it("mergeSnapshot: 받은 칸은 바꾸고, 못 읽은 칸(null)은 옛 값을 둔다", () => {
    const base = syncedMirror({ todos: [todo(T1, "옛")] });
    const merged = mergeSnapshot(base, snapshot({ todos: [todo(T2, "새")], categories: null, settings: null, goal: { weekStart: "2026-11-02", items: null } }));
    expect(merged.todos.map((t) => t.id)).toEqual([T2]);
    expect(merged.categories).toHaveLength(1);
    expect(merged.settings).not.toBeNull();
    expect(merged.goals["2026-11-02"]).toBeNull();
    expect(merged.synced).toBe(true);
  });
});

describe("derive: 거울에서 화면이 읽는 값", () => {
  it("처음 쓰는 기기(서버 사본을 한 번도 못 받음)는 비어 있는 것이 아니라 읽을 수 없음", () => {
    expect(deriveToday(emptyMirror(), NOON)).toEqual({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } });
    expect(deriveGrowth(emptyMirror(), NOON)).toEqual({ ok: false, error: "unavailable" });
    expect(deriveYesterday(emptyMirror(), NOON)).toEqual({ ok: false, error: "unavailable" });
  });
  it("기기에 적은 것이 있으면 사본을 못 받았어도 읽는다", () => {
    const m = applyOp(emptyMirror(), q({ kind: "todo.add", id: T1, text: "오프라인으로 적음" }));
    expect(deriveToday(m, NOON).todos.ok).toBe(true);
  });
  it("오늘 목록은 만든 순서, 순서를 정한 행이 앞. 어제 것은 안 나온다", () => {
    const m = syncedMirror({ todos: [todo(T1, "a", "2026-11-07", { createdAt: "2026-11-07T02:00:00.000Z" }), todo(T2, "b", "2026-11-07", { createdAt: "2026-11-07T01:00:00.000Z" }), todo(T3, "어제", "2026-11-06")] });
    const t = deriveToday(m, NOON).todos;
    expect(t.ok && t.data.todos.map((x) => x.id)).toEqual([T2, T1]);
    expect(t.ok && t.data.day.date).toBe("2026-11-07");
  });
  it("어제 못 끝낸 후보: 끝낸 것과 이미 가져온 것(오늘 글과 같음)은 뺀다", () => {
    const m = syncedMirror({ todos: [todo(T1, "못 끝냄", "2026-11-06"), todo(T2, "끝냄", "2026-11-06", { done: true }), todo(T3, "가져옴", "2026-11-06"), todo("44444444-4444-4444-8444-444444444444", "가져옴", "2026-11-07")] });
    const y = deriveYesterday(m, NOON);
    expect(y.ok && y.data.todos.map((t) => t.id)).toEqual([T1]);
  });
  it("지난 날 보기: 기기에 둔 8일 안이면 기기에서, 밖이면 서버로(null), 오늘·앞날은 거절", () => {
    const m = syncedMirror({ todos: [todo(T1, "어제 글", "2026-11-06")] });
    const y = derivePastDay(m, "2026-11-06", NOON);
    expect(y && y.ok && y.data.todos.map((t) => t.id)).toEqual([T1]);
    expect(derivePastDay(m, "2026-10-20", NOON)).toBeNull();
    expect(derivePastDay(m, "2026-11-07", NOON)).toEqual({ ok: false, error: "invalid_input" });
    expect(derivePastDay(m, "2026-11-08", NOON)).toEqual({ ok: false, error: "invalid_input" });
    expect(derivePastDay(emptyMirror(), "2026-11-06", NOON)).toBeNull();
  });
  it("저녁 기록 상태: 그 날 끝낸 할 일의 분야와 타이머 시간으로 미리 채울 재료를 낸다. 범위 밖 날은 거절", () => {
    const m = syncedMirror({ todos: [todo(T1, "a", "2026-11-07", { done: true, categoryId: C1 })] });
    const withTimer = applyOp(m, q({ kind: "focus.start", input: { id: S1, categoryId: C1, surface: "manual", clientStartedAt: iso(NOON - 900_000) } }, iso(NOON - 900_000)));
    const ended = applyOp(withTimer, q({ kind: "focus.end", id: S1 }, iso(NOON - 900_000 + 600_000)));
    const s = deriveEveningState(ended, undefined, NOON);
    expect(s.ok && s.data).toMatchObject({ today: "2026-11-07", day: "2026-11-07", doneCategoryIds: [C1], timerByCategory: [{ categoryId: C1, minutes: 10 }] });
    expect(deriveEveningState(m, "2026-11-08", NOON)).toEqual({ ok: false, error: "invalid_input" });
    expect(deriveEveningState(m, "2026-10-01", NOON)).toEqual({ ok: false, error: "invalid_input" });
    expect(deriveEveningState(m, "2026-11-06", NOON).ok).toBe(true);
  });
});

// ---- 운영 장치 ----
function harness(over: Partial<RuntimeDeps> = {}, mirror: Mirror = syncedMirror()) {
  const kv = createMemoryKv();
  const sent: QueuedOp[] = [];
  let replies: SendResult[] = [];
  let reply: (q: QueuedOp) => SendResult = () => ({ ok: true });
  const send = vi.fn(async (queued: QueuedOp): Promise<SendResult> => {
    sent.push(structuredClone(queued));
    return replies.shift() ?? reply(queued);
  });
  let snapshotReply: () => Promise<{ ok: true; data: MirrorSnapshot } | { ok: false; error: string }> = async () => ({ ok: true, data: snapshot() });
  const timers: { fn: () => void; ms: number }[] = [];
  let online = true;
  let clock = NOON;
  const runtime = createRuntime({
    userKey: USER,
    kv,
    send,
    fetchSnapshot: () => snapshotReply(),
    now: () => clock,
    online: () => online,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as { fn: () => void; ms: number });
      if (i >= 0) timers.splice(i, 1);
    },
    ...over,
  });
  void kv.set(kvKeys.base(USER), mirror);
  return {
    runtime,
    kv,
    sent,
    send,
    setReplies: (r: SendResult[]) => (replies = r),
    setReply: (fn: (q: QueuedOp) => SendResult) => (reply = fn),
    setSnapshot: (fn: typeof snapshotReply) => (snapshotReply = fn),
    setOnline: (v: boolean) => (online = v),
    tick: (ms: number) => (clock += ms),
    timers,
    runTimers: async () => {
      const due = timers.splice(0);
      for (const t of due) t.fn();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("runtime: 쓰기는 화면을 먼저 바꾸고 보낼 줄에 넣는다", () => {
  it("쓰기 직후(동기)에 거울이 바뀌고 구독자에게 알린다. 서버 응답을 기다리지 않는다", async () => {
    const h = harness();
    await h.runtime.boot();
    let notified = 0;
    h.runtime.subscribe(() => notified++);
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "단어" });
    expect(h.runtime.getMirror().todos.map((t) => t.id)).toEqual([T1]); // 동기: await 없이 바로
    expect(notified).toBe(1);
    expect(h.runtime.pendingCount()).toBe(1);
    expect(h.send).not.toHaveBeenCalled(); // 보내기는 뒤에서
  });
  it("보낼 줄은 기기 저장소에 적히고, 새로 열면(boot) 그대로 되살아난다", async () => {
    const h = harness();
    await h.runtime.boot();
    h.setOnline(false);
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "끊긴 채 적음" });
    h.runtime.enqueue({ kind: "todo.done", id: T1, done: true });
    await settle();
    expect(await h.kv.keys(kvKeys.opPrefix(USER))).toHaveLength(2);
    // 새 탭·새로고침: 같은 저장소로 새 운영 장치를 연다
    const reopened = createRuntime({ userKey: USER, kv: h.kv, send: h.send, fetchSnapshot: async () => ({ ok: false, error: "unavailable" }), now: () => NOON, online: () => false });
    await reopened.boot();
    expect(reopened.pendingCount()).toBe(2);
    expect(reopened.getMirror().todos).toEqual([expect.objectContaining({ id: T1, text: "끊긴 채 적음", done: true })]);
  });
  it("연결되면 차례로 서버에 한 번씩 보내고, 다 보내면 줄이 비고 저장소도 비며 서버 것을 받아 맞춘다", async () => {
    const h = harness();
    await h.runtime.boot();
    h.setOnline(false);
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    h.runtime.enqueue({ kind: "todo.add", id: T2, text: "b" });
    const offline = await h.runtime.flush();
    expect(offline).toMatchObject({ sent: 0, remaining: 2, stopped: "offline" });
    expect(h.send).not.toHaveBeenCalled();
    h.setOnline(true);
    h.setSnapshot(async () => ({ ok: true, data: snapshot({ todos: [todo(T1, "a"), todo(T2, "b")] }) }));
    const result = await h.runtime.flush();
    expect(result).toMatchObject({ sent: 2, remaining: 0 });
    expect(h.sent.map((s) => (s.op.kind === "todo.add" ? s.op.id : "?"))).toEqual([T1, T2]); // 적은 순서대로
    expect(h.sent.every((s) => s.clientAt === iso(NOON))).toBe(true); // 누른 때를 함께 보낸다
    await settle();
    expect(await h.kv.keys(kvKeys.opPrefix(USER))).toEqual([]);
    expect(h.runtime.pendingCount()).toBe(0);
    expect(h.runtime.getMirror().todos.map((t) => t.id).sort()).toEqual([T1, T2]);
  });
  it("서버에 닿지 못하면(network) 멈추고 줄은 그대로, 나중에 다시 보낸다. 횟수에 세지 않는다", async () => {
    const h = harness();
    await h.runtime.boot();
    h.setReplies([{ ok: false, error: "unavailable", network: true }]);
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    const first = await h.runtime.flush();
    expect(first).toMatchObject({ sent: 0, remaining: 1, stopped: "offline" });
    expect(h.runtime.pendingOps()[0].attempts).toBe(0);
    const second = await h.runtime.flush();
    expect(second).toMatchObject({ sent: 1, remaining: 0 });
  });
  it("서버가 거절하면(권한·검사 실패) 그 쓰기를 빼고 기기 것을 되돌리고 알린다. 뒤의 쓰기는 계속 보낸다", async () => {
    const h = harness();
    await h.runtime.boot();
    h.setReply((s) => (s.op.kind === "todo.add" && s.op.id === T1 ? { ok: false, error: "invalid_category" } : { ok: true }));
    h.setSnapshot(async () => ({ ok: true, data: snapshot({ todos: [todo(T2, "받아질 글")] }) })); // 서버에는 받아진 글만 있다
    const rejected: unknown[] = [];
    h.runtime.subscribeRejections((r) => rejected.push(...r));
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "거절될 글", categoryId: C1 });
    h.runtime.enqueue({ kind: "todo.add", id: T2, text: "받아질 글" });
    expect(h.runtime.getMirror().todos).toHaveLength(2);
    const result = await h.runtime.flush();
    expect(result.rejected).toEqual([{ kind: "todo.add", error: "invalid_category" }]);
    expect(result.sent).toBe(1);
    expect(h.runtime.getMirror().todos.map((t) => t.id)).toEqual([T2]); // 되돌렸다
    expect(rejected).toEqual([{ kind: "todo.add", error: "invalid_category" }]);
    expect(h.runtime.takeRejections()).toHaveLength(1);
    expect(h.runtime.takeRejections()).toHaveLength(0);
  });
  it("거절된 쓰기에 기대던 뒤의 쓰기(끝냄)도 서버가 not_found로 거절하면 함께 되돌아간다", async () => {
    const h = harness();
    await h.runtime.boot();
    h.setReply((s) => (s.op.kind === "todo.add" ? { ok: false, error: "daily_limit" } : s.op.kind === "todo.done" ? { ok: false, error: "not_found" } : { ok: true }));
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    h.runtime.enqueue({ kind: "todo.done", id: T1, done: true });
    const result = await h.runtime.flush();
    expect(result.rejected.map((r) => r.kind)).toEqual(["todo.add", "todo.done"]);
    expect(h.runtime.getMirror().todos).toEqual([]);
  });
  it("이미 없는 것을 지우는 쓰기가 not_found로 와도 성공으로 본다(다른 탭이 먼저 보냈거나 재시도)", async () => {
    const h = harness({}, syncedMirror({ todos: [todo(T1, "a")] }));
    await h.runtime.boot();
    h.setReply(() => ({ ok: false, error: "not_found" }));
    h.runtime.enqueue({ kind: "todo.delete", id: T1 });
    const result = await h.runtime.flush();
    expect(result).toMatchObject({ sent: 1, remaining: 0, rejected: [] });
  });
  it("로그인이 풀리면 멈추고 줄은 그대로 둔다(거절로 보지 않는다)", async () => {
    const h = harness();
    await h.runtime.boot();
    h.setReply(() => ({ ok: false, error: "unauthenticated" }));
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    const result = await h.runtime.flush();
    expect(result).toMatchObject({ sent: 0, remaining: 1, stopped: "unauthenticated" });
    expect(h.runtime.isAuthLost()).toBe(true);
    expect(h.runtime.getMirror().todos).toHaveLength(1); // 되돌리지 않는다
  });
  // 고침 4바퀴(F3)에서 규칙이 바뀌었다: 예전에는 일시 오류 6번(MAX_ATTEMPTS)이면 거절로 보고 글을 버렸다. 이제는 버리지 않고 계속 다시 보내며,
  // STALLED_AFTER_ATTEMPTS번을 넘기면 「보내지 못함」(isStalled)으로 화면에 알린다
  it(`서버가 일시 오류로 ${STALLED_AFTER_ATTEMPTS}번 넘게 답해도 버리지 않고 줄에 둔 채 「보내지 못함」이 된다`, async () => {
    const h = harness();
    await h.runtime.boot();
    h.setReply(() => ({ ok: false, error: "unavailable" }));
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    for (let i = 1; i <= STALLED_AFTER_ATTEMPTS + 2; i++) {
      const r = await h.runtime.flush();
      expect(r.stopped).toBe("server_error");
      expect(r.rejected).toEqual([]);
      expect(h.runtime.pendingOps()[0].attempts).toBe(i);
      expect(h.runtime.isStalled()).toBe(i >= STALLED_AFTER_ATTEMPTS);
    }
    expect(h.runtime.pendingCount()).toBe(1);
    expect(h.runtime.getMirror().todos.map((t) => t.id)).toEqual([T1]); // 되돌리지 않는다
    expect(h.timers.every((t) => t.ms <= RETRY_MAX_MS)).toBe(true);
  });
  it("여러 번 flush를 불러도 동시에 한 번만 돈다. 보내는 사이에 새로 들어온 쓰기도 곧 보낸다", async () => {
    const h = harness();
    await h.runtime.boot();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    h.send.mockImplementationOnce(async (queued) => {
      h.sent.push(structuredClone(queued));
      await gate;
      return { ok: true };
    });
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    const a = h.runtime.flush();
    const b = h.runtime.flush();
    expect(a).toBe(b);
    h.runtime.enqueue({ kind: "todo.add", id: T2, text: "b" });
    release();
    await a;
    await h.runTimers();
    await h.runtime.flush();
    expect(h.sent.map((s) => (s.op.kind === "todo.add" ? s.op.id : "?"))).toEqual([T1, T2]);
  });
});

describe("runtime: 서버 것 받기와 맞추기", () => {
  it("받으면 서버 것으로 바꾸되, 보낼 줄에 남은 쓰기는 다시 입힌다(기기 것이 이긴다)", async () => {
    const h = harness({}, syncedMirror({ todos: [todo(T1, "옛 글")] }));
    await h.runtime.boot();
    h.setOnline(false);
    h.runtime.enqueue({ kind: "todo.edit", id: T1, text: "기기에서 고침" });
    h.runtime.enqueue({ kind: "todo.add", id: T2, text: "기기에서 적음" });
    h.setSnapshot(async () => ({ ok: true, data: snapshot({ todos: [todo(T1, "서버의 글"), todo(T3, "다른 기기에서 적음")] }) }));
    expect((await h.runtime.pull()).ok).toBe(true);
    const texts = Object.fromEntries(h.runtime.getMirror().todos.map((t) => [t.id, t.text]));
    expect(texts).toEqual({ [T1]: "기기에서 고침", [T3]: "다른 기기에서 적음", [T2]: "기기에서 적음" });
  });
  it("보낼 줄에 없는 것은 서버 것이 이긴다(다른 기기에서 고친 글)", async () => {
    const h = harness({}, syncedMirror({ todos: [todo(T1, "옛 글")] }));
    await h.runtime.boot();
    h.setSnapshot(async () => ({ ok: true, data: snapshot({ todos: [todo(T1, "다른 기기에서 고침", "2026-11-07", { done: true })] }) }));
    await h.runtime.pull();
    expect(h.runtime.getMirror().todos[0]).toMatchObject({ text: "다른 기기에서 고침", done: true });
  });
  it("받는 사이에 보낸 쓰기가 서버에 들어갔으면 그 쓰기가 빠진 사본으로 덮지 않고 한 번 더 받는다", async () => {
    const h = harness();
    await h.runtime.boot();
    h.setOnline(false);
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    h.setOnline(true);
    let calls = 0;
    h.setSnapshot(async () => {
      calls += 1;
      if (calls === 1) {
        await h.runtime.flush(); // 첫 사본을 받는 사이에 쓰기가 서버에 들어갔다: 이 사본에는 T1이 없다
        return { ok: true, data: snapshot({ todos: [] }) };
      }
      return { ok: true, data: snapshot({ todos: [todo(T1, "a")] }) };
    });
    await h.runtime.pull();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(h.runtime.getMirror().todos.map((t) => t.id)).toEqual([T1]);
  });
  it("받지 못하면 기기 것을 그대로 둔다. 로그인이 풀렸으면 알린다", async () => {
    const h = harness({}, syncedMirror({ todos: [todo(T1, "a")] }));
    await h.runtime.boot();
    h.setSnapshot(async () => ({ ok: false, error: "unavailable" }));
    expect(await h.runtime.pull()).toEqual({ ok: false, error: "unavailable" });
    expect(h.runtime.getMirror().todos).toHaveLength(1);
    h.setSnapshot(async () => ({ ok: false, error: "unauthenticated" }));
    await h.runtime.pull();
    expect(h.runtime.isAuthLost()).toBe(true);
  });
  it("서버 거울은 기기 저장소에 남아 새로 열면 바로 읽힌다(네트워크 없이)", async () => {
    const h = harness();
    await h.runtime.boot();
    h.setSnapshot(async () => ({ ok: true, data: snapshot({ todos: [todo(T1, "저장될 글")], categories: [{ id: C1, readable: true, name: "어학", createdAt: "x" }] }) }));
    await h.runtime.pull();
    await h.runtime.persistNow();
    const reopened = createRuntime({ userKey: USER, kv: h.kv, send: h.send, fetchSnapshot: async () => ({ ok: false, error: "unavailable" }), now: () => NOON, online: () => false });
    await reopened.boot();
    expect(reopened.getMirror().todos[0]).toMatchObject({ id: T1, text: "저장될 글" });
  });
  it("보낸 쓰기가 서버 거울에도 입혀져, 줄을 다 보낸 뒤 새로 열어도 그 쓰기가 남아 있다", async () => {
    const h = harness();
    await h.runtime.boot();
    h.setSnapshot(async () => ({ ok: false, error: "unavailable" }));
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "보낸 글" });
    await h.runtime.flush();
    await h.runtime.persistNow();
    const reopened = createRuntime({ userKey: USER, kv: h.kv, send: h.send, fetchSnapshot: async () => ({ ok: false, error: "unavailable" }), now: () => NOON, online: () => false });
    await reopened.boot();
    expect(reopened.pendingCount()).toBe(0);
    expect(reopened.getMirror().todos.map((t) => t.id)).toEqual([T1]);
  });
});

describe("runtime: 사용자별 저장소와 로그아웃", () => {
  it("다른 사용자의 기기 저장소 항목은 읽지 않고, 로그인 직후 지운다", async () => {
    const h = harness();
    await h.kv.set(kvKeys.base(OTHER), syncedMirror({ todos: [todo(T1, "남의 글")] }));
    await h.kv.set(kvKeys.op(OTHER, "0000000000001-0000-aaaa"), { key: "0000000000001-0000-aaaa", clientAt: iso(NOON), attempts: 0, op: { kind: "todo.add", id: T2, text: "남의 보낼 글" } });
    await h.runtime.boot();
    expect(h.runtime.getMirror().todos.some((t) => t.id === T1 || t.id === T2)).toBe(false);
    expect(h.runtime.pendingCount()).toBe(0);
    await wipeOtherUsers(h.kv, USER);
    expect(await h.kv.keys("base/")).toEqual([kvKeys.base(USER)]);
    expect(await h.kv.keys(kvKeys.opPrefix(OTHER))).toEqual([]);
  });
  it("wipe: 이 사용자의 거울과 보낼 줄을 모두 지우고 더는 보내지 않는다", async () => {
    const h = harness();
    await h.runtime.boot();
    h.setOnline(false);
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    await settle();
    await h.runtime.wipe();
    expect(await h.kv.keys("base/")).toEqual([]);
    expect(await h.kv.keys("op/")).toEqual([]);
    expect(h.runtime.getMirror().todos).toEqual([]);
    h.setOnline(true);
    h.runtime.enqueue({ kind: "todo.add", id: T2, text: "지운 뒤" });
    await h.runtime.flush();
    expect(h.send).not.toHaveBeenCalled(); // 멈춘 장치는 보내지 않는다
  });
  it("줄 열쇠는 기기 시계가 거꾸로 가도 줄어들지 않아 적은 순서가 지켜진다", async () => {
    let clock = NOON;
    const h = harness({ now: () => clock });
    await h.runtime.boot();
    h.setOnline(false);
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    clock -= 60_000; // 시계가 1분 뒤로
    h.runtime.enqueue({ kind: "todo.add", id: T2, text: "b" });
    const keys = h.runtime.pendingOps().map((o) => o.key);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(2);
  });
  it("기기 저장소가 막혀도(쓰기 실패) 던지지 않고 메모리로 돈다", async () => {
    const broken = {
      persistent: true,
      get: async () => {
        throw new Error("blocked");
      },
      set: async () => {
        throw new Error("blocked");
      },
      delete: async () => {
        throw new Error("blocked");
      },
      keys: async () => {
        throw new Error("blocked");
      },
    };
    const h = harness({ kv: broken });
    await h.runtime.boot();
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    expect(h.runtime.getMirror().todos).toHaveLength(1);
    const result = await h.runtime.flush();
    expect(result.sent).toBe(1); // 적지 못한 줄은 다른 탭이 보낸 것으로 오해하지 않고 보낸다
  });
});

describe("runtime: 로그아웃 뒤에는 기기 저장소에 다시 적지 않는다", () => {
  it("wipe 뒤에 닫히며 거울을 적으려 해도(persistNow) 지운 것이 되살아나지 않는다", async () => {
    const h = harness();
    await h.runtime.boot();
    h.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    await h.runtime.wipe();
    await h.runtime.persistNow();
    h.runtime.enqueue({ kind: "todo.add", id: T2, text: "지운 뒤" });
    await settle();
    expect(await h.kv.keys("base/")).toEqual([]);
    expect(await h.kv.keys("op/")).toEqual([]);
  });
});

describe("runtime: 서버가 첫 화면과 함께 실어 보낸 사본(applySnapshot)", () => {
  it("네트워크 없이 서버 사본을 거울에 합치고, 보낼 줄의 쓰기는 다시 입힌다", async () => {
    const h = harness({ fetchSnapshot: async () => ({ ok: false, error: "unavailable" }) }, emptyMirror());
    await h.runtime.boot();
    h.setOnline(false);
    h.runtime.enqueue({ kind: "todo.add", id: T2, text: "기기에서 적음" });
    h.runtime.applySnapshot(snapshot({ todos: [todo(T1, "서버 글")], categories: [{ id: C1, readable: true, name: "어학", createdAt: "x" }] }));
    expect(h.runtime.getMirror().synced).toBe(true);
    expect(h.runtime.getMirror().todos.map((t) => t.id).sort()).toEqual([T1, T2]);
    expect(h.runtime.getMirror().categories).toHaveLength(1);
    await h.runtime.persistNow();
    const saved = await h.kv.get<Mirror>(kvKeys.base(USER));
    expect(saved?.synced).toBe(true);
  });
});
