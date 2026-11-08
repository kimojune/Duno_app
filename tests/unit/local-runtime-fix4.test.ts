import { afterEach, describe, expect, it, vi } from "vitest";

// 진짜 BroadcastChannel 감싸개(lib/local/browser.ts)를 쓰려고, 그 파일이 가져오는 서버 입구만 가짜로 둔다
vi.mock("../../app/local/actions", () => ({ sendLocalOp: vi.fn() }));

import { createBroadcastChannel } from "../../lib/local/browser";
import { createIdbKv, createMemoryKv, kvKeys, type KvStore } from "../../lib/local/kv";
import { emptyMirror } from "../../lib/local/reduce";
import { createRuntime, RETRY_MAX_MS, WIPE_WAIT_MS, type ResetReason, type RuntimeDeps } from "../../lib/local/runtime";
import { createLocalTodos } from "../../lib/local/todos";
import type { LocalApis } from "../../lib/local/apis";
import type { Mirror, MirrorSnapshot, Op, QueuedOp, SendResult } from "../../lib/local/types";

/**
 * 기기 먼저 저장 고침 4바퀴(R2 발견 S1·S2·F1~F4): 계정 섞임·로그아웃 뒤 다시 적기·글 사라짐.
 * 「persistent: true」 저장소(IndexedDB를 흉내 낸, 탭끼리 나눠 쓰는 저장소)로 다른 탭과 같은 줄을 나눠 쓰는 길을 탄다.
 */

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C_NEW = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C_OLD = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const E1 = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
const NOON = Date.parse("2026-11-07T06:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** 기기에 남는 저장소(IndexedDB 흉내): 탭끼리 같은 것을 쓴다 */
function persistentKv(): KvStore {
  return { ...createMemoryKv(), persistent: true };
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
const snapshot = (over: Partial<MirrorSnapshot> = {}): MirrorSnapshot => ({ serverNow: iso(NOON), todos: [], categories: [], settings: null, logs: [], goal: null, sessions: [], ...over });

type Timer = { fn: () => void; ms: number };

function tab(kv: KvStore, over: Partial<RuntimeDeps> = {}) {
  const sent: QueuedOp[] = [];
  let reply: (q: QueuedOp) => SendResult | Promise<SendResult> = () => ({ ok: true });
  const send = vi.fn(async (q: QueuedOp): Promise<SendResult> => {
    sent.push(structuredClone(q));
    return reply(q);
  });
  const timers: Timer[] = [];
  let online = true;
  const resets: ResetReason[] = [];
  const runtime = createRuntime({
    userKey: USER,
    kv,
    send,
    fetchSnapshot: async () => ({ ok: true, data: snapshot({ userId: over.userKey ?? USER }) }),
    now: () => NOON,
    online: () => online,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as Timer);
      if (i >= 0) timers.splice(i, 1);
    },
    onReset: (r) => resets.push(r),
    ...over,
  });
  return {
    runtime,
    sent,
    send,
    timers,
    resets,
    setReply: (fn: typeof reply) => (reply = fn),
    setOnline: (v: boolean) => (online = v),
    runTimers: async () => {
      const due = timers.splice(0);
      for (const t of due) t.fn();
      await settle();
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const waitFor = async (check: () => boolean | Promise<boolean>, ms = 2000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
};
async function userKeys(kv: KvStore): Promise<string[]> {
  const out: string[] = [];
  for (const prefix of ["base/", "op/", "pref/", "sent/", "rej/"]) out.push(...(await kv.keys(prefix)));
  return out;
}

const opened: { close(): void }[] = [];
function channel() {
  const c = createBroadcastChannel("duno-local-test")!;
  opened.push(c);
  return c;
}
afterEach(() => {
  for (const c of opened.splice(0)) c.close();
});

describe("S1 두 탭: 한 탭이 로그아웃하면 다른 탭도 지우고 다시 적지 않는다(BroadcastChannel)", () => {
  it("탭 1 로그아웃 → 알림 → 탭 2가 지우고 멈춘다. 탭 2가 닫히며 적으려 해도 base/·op/·pref/가 비어 있다", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const tab1 = tab(kv, { channel: channel() });
    const tab2 = tab(kv, { channel: channel() });
    await tab1.runtime.boot();
    await tab2.runtime.boot();
    tab2.setOnline(false);
    tab2.runtime.enqueue({ kind: "todo.add", id: T1, text: "탭 2에서 적은 A의 글" });
    await tab2.runtime.setPref("status-view", { period: "week" });
    await tab2.runtime.persistNow();
    expect((await userKeys(kv)).length).toBeGreaterThan(0);

    // 탭 1: 로그아웃(지우고 다른 탭에 알림)
    await createLocalTodos(tab1.runtime, {} as LocalApis).discard();
    expect(await waitFor(() => tab2.resets.length > 0)).toBe(true);
    expect(tab2.resets).toEqual(["signed_out_elsewhere"]);
    expect(tab2.runtime.isReset()).toBe(true);
    await waitFor(async () => (await userKeys(kv)).length === 0);

    // 탭 2: 가려지거나 닫히며 거울을 적고, 늦게 쓰기·고른 값 쓰기가 와도 다시 적지 않는다
    await tab2.runtime.persistNow();
    tab2.runtime.enqueue({ kind: "todo.add", id: T2, text: "지운 뒤" });
    await tab2.runtime.setPref("status-view", { period: "month" });
    tab2.setOnline(true);
    await tab2.runtime.flush();
    await settle();
    expect(await userKeys(kv)).toEqual([]);
    expect(tab2.send).not.toHaveBeenCalled();
  });
  it("다른 사용자가 다른 탭에서 열리면(active 알림) 이 탭은 자기 사용자 것을 지운다", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const tabA = tab(kv, { channel: channel() });
    await tabA.runtime.boot();
    await tabA.runtime.persistNow();
    const tabB = tab(kv, { userKey: OTHER, channel: channel() });
    await tabB.runtime.boot();
    expect(await waitFor(() => tabA.resets.length > 0)).toBe(true);
    expect(tabA.resets).toEqual(["account_mismatch"]);
    await tabA.runtime.persistNow();
    expect(await kv.keys(`base/${USER}`)).toEqual([]);
  });
});

describe("S1 계정 불일치: 서버가 account_mismatch로 거절하면 멈추고 자기 것을 지운다", () => {
  it("보내기: 거절을 받으면 그 뒤로 보내지 않고 이 사용자의 기기 저장소를 지운 뒤 알린다", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t = tab(kv);
    await t.runtime.boot();
    t.setReply(() => ({ ok: false, error: "account_mismatch" }));
    t.runtime.enqueue({ kind: "todo.add", id: T1, text: "A의 글" });
    t.runtime.enqueue({ kind: "todo.add", id: T2, text: "A의 둘째 글" });
    const r = await t.runtime.flush();
    expect(r.stopped).toBe("account_mismatch");
    expect(await waitFor(() => t.resets.length > 0)).toBe(true);
    expect(t.resets).toEqual(["account_mismatch"]);
    expect(t.send).toHaveBeenCalledTimes(1); // 둘째 것은 보내지 않는다
    await t.runtime.persistNow();
    expect(await userKeys(kv)).toEqual([]);
    t.runtime.resume();
    await t.runTimers();
    expect(t.send).toHaveBeenCalledTimes(1);
  });
  it("받기(/mirror): account_mismatch면 B의 사본을 A 열쇠에 적지 않고 지운다", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t = tab(kv, { fetchSnapshot: async () => ({ ok: false, error: "account_mismatch" }) });
    await t.runtime.boot();
    await t.runtime.pull();
    expect(await waitFor(() => t.resets.length > 0)).toBe(true);
    expect(await userKeys(kv)).toEqual([]);
  });
  it("받기: 사본의 주인(userId)이 다르면 합치지 않는다(서버가 확인을 빠뜨려도 기기가 막는다)", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t = tab(kv, { fetchSnapshot: async () => ({ ok: true, data: snapshot({ userId: OTHER, todos: [{ id: T1, day: "2026-11-07", text: "B의 글", done: false, createdAt: iso(NOON), categoryId: null, position: null }] }) }) });
    await t.runtime.boot();
    expect(await t.runtime.pull()).toEqual({ ok: false, error: "account_mismatch" });
    expect(t.runtime.getMirror().todos).toEqual([]);
    await waitFor(() => t.resets.length > 0);
    await t.runtime.persistNow();
    expect(String(JSON.stringify(await kv.get(kvKeys.base(USER))))).not.toContain("B의 글");
    expect(await kv.keys("base/")).toEqual([]);
  });
});

describe("F1·F2 「저장소에 없으면 건너뜀」: 보냈다는 표시(비석)가 있을 때만 건너뛴다", () => {
  async function queuedTab() {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t = tab(kv);
    await t.runtime.boot();
    t.setOnline(false);
    const q = t.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    await settle();
    t.setOnline(true);
    return { kv, t, q };
  }
  it("저장소에 없고 비석도 없으면 보낸다(다른 탭이 보낸 것으로 오해하지 않는다)", async () => {
    const { kv, t, q } = await queuedTab();
    await kv.delete(kvKeys.op(USER, q.key)); // 예: 다른 탭의 로그아웃이 지움
    const r = await t.runtime.flush();
    expect(r.sent).toBe(1);
    expect(t.send).toHaveBeenCalledTimes(1);
  });
  it("저장소에 없고 비석이 있으면 다른 탭이 보낸 것이라 건너뛴다", async () => {
    const { kv, t, q } = await queuedTab();
    await kv.set(kvKeys.sent(USER, q.key), NOON);
    await kv.delete(kvKeys.op(USER, q.key));
    await t.runtime.flush();
    expect(t.send).not.toHaveBeenCalled();
    expect(t.runtime.pendingCount()).toBe(0);
  });
  it("저장소 읽기가 실패하면(「없음」이 아님) 보낸다(F2)", async () => {
    const { kv, t, q } = await queuedTab();
    const get = kv.get.bind(kv);
    kv.get = (async (key: string) => {
      if (key === kvKeys.op(USER, q.key)) throw new Error("InvalidStateError");
      return get(key);
    }) as KvStore["get"];
    const r = await t.runtime.flush();
    expect(r.sent).toBe(1);
  });
  it("보내고 나면 비석을 남긴다. 그래서 같은 줄을 가진 다른 탭은 다시 보내지 않는다", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t1 = tab(kv);
    await t1.runtime.boot();
    t1.setOnline(false);
    t1.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    await settle();
    const t2 = tab(kv); // 같은 줄을 읽어 들인 다른 탭
    await t2.runtime.boot();
    expect(t2.runtime.pendingCount()).toBe(1);
    t1.setOnline(true);
    await t1.runtime.flush();
    expect(await kv.keys(kvKeys.sentPrefix(USER))).toHaveLength(1);
    await t2.runtime.flush();
    expect(t2.send).not.toHaveBeenCalled();
    expect(t2.runtime.pendingCount()).toBe(0);
  });
  it("지난 비석은 열 때 지운다(하루)", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.sent(USER, "old"), NOON - 25 * 3600_000);
    await kv.set(kvKeys.sent(USER, "new"), NOON - 3600_000);
    const t = tab(kv);
    await t.runtime.boot();
    await waitFor(async () => (await kv.keys(kvKeys.sentPrefix(USER))).length === 1);
    expect(await kv.keys(kvKeys.sentPrefix(USER))).toEqual([kvKeys.sent(USER, "new")]);
  });
  it("로그아웃 확인은 기기 저장소의 op/<사용자>/ 수로 센다(다른 탭이 적은 못 보낸 쓰기도 센다)", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t1 = tab(kv);
    await t1.runtime.boot();
    const t2 = tab(kv);
    await t2.runtime.boot();
    t1.setOnline(false);
    t2.setOnline(false);
    t2.runtime.enqueue({ kind: "todo.add", id: T1, text: "탭 2의 못 보낸 글" });
    await settle();
    expect(t1.runtime.pendingCount()).toBe(0);
    const left = await createLocalTodos(t1.runtime, {} as LocalApis).flushBeforeSignOut();
    expect(left).toBe(1);
  });
  it("로그아웃 전 보내기는 다른 탭이 적은 줄도 함께 보낸다", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t1 = tab(kv);
    await t1.runtime.boot();
    const t2 = tab(kv);
    await t2.runtime.boot();
    t2.setOnline(false);
    t2.runtime.enqueue({ kind: "todo.add", id: T1, text: "탭 2의 글" });
    await settle();
    const left = await createLocalTodos(t1.runtime, {} as LocalApis).flushBeforeSignOut();
    expect(left).toBe(0);
    expect(t1.sent.map((s) => s.op)).toEqual([{ kind: "todo.add", id: T1, text: "탭 2의 글" }]);
  });
});

describe("F2 IndexedDB: 다른 탭이 판을 올려 DB가 닫히면 다음 읽기·쓰기가 다시 연다", () => {
  it("onversionchange 뒤에도 읽기·쓰기가 된다", async () => {
    const fake = installFakeIndexedDb();
    try {
      const kv = createIdbKv("t")!;
      await kv.set("a", 1);
      expect(fake.opens()).toBe(1);
      fake.lastDb()!.onversionchange?.();
      expect(fake.lastDb()!.closed).toBe(true);
      expect(await kv.get("a")).toBe(1);
      await kv.set("b", 2);
      expect(fake.opens()).toBe(2);
    } finally {
      fake.uninstall();
    }
  });
});

describe("S2 로그아웃 뒤 늦게 온 응답은 기기에 다시 적지 않는다", () => {
  it("보내는 중에 로그아웃(지움)하고 그 뒤 일시 오류 응답이 와도 op/가 되살아나지 않는다", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t = tab(kv);
    await t.runtime.boot();
    let release: (r: SendResult) => void = () => {};
    t.setReply(() => new Promise<SendResult>((r) => (release = r)));
    t.runtime.enqueue({ kind: "todo.add", id: T1, text: "a" });
    await settle();
    const flushing = t.runtime.flush();
    await settle();
    expect(t.send).toHaveBeenCalledTimes(1);
    const started = Date.now();
    await t.runtime.wipe();
    expect(Date.now() - started).toBeLessThan(WIPE_WAIT_MS + 1000); // 응답을 끝없이 기다리지 않는다
    release({ ok: false, error: "unavailable" });
    await flushing;
    await settle();
    expect(await kv.keys("op/")).toEqual([]);
    expect(await userKeys(kv)).toEqual([]);
  });
  it("지우기는 끝나지 않는 고른 값 쓰기를 시간 상한까지만 기다린다", async () => {
    const kv = persistentKv();
    const set = kv.set.bind(kv);
    kv.set = (async (key: string, value: unknown) => {
      if (key.startsWith("pref/")) return new Promise<void>(() => {}); // 끝나지 않는 쓰기
      return set(key, value);
    }) as KvStore["set"];
    const t = tab(kv);
    await t.runtime.boot();
    void t.runtime.setPref("x", 1);
    const started = Date.now();
    await t.runtime.wipe();
    expect(Date.now() - started).toBeLessThan(WIPE_WAIT_MS + 1000);
  }, 6000);
});

describe("F3 서버가 오래 일시 오류여도 글을 버리지 않는다", () => {
  it("12번 일시 오류 뒤 회복되면 한 번 들어간다. 간격은 60초를 넘지 않고, 실패마다 다시 보내기는 하나만 건다(폭주 없음)", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t = tab(kv);
    await t.runtime.boot();
    const server = new Set<string>();
    let failures = 12;
    t.setReply((q) => {
      if (failures > 0) {
        failures -= 1;
        return { ok: false, error: q.attempts % 2 === 0 ? "unavailable" : "config" };
      }
      if (q.op.kind === "todo.add") server.add(q.op.id);
      return { ok: true };
    });
    t.runtime.enqueue({ kind: "todo.add", id: T1, text: "버리면 안 되는 글" });
    await settle();
    const delays: number[] = [];
    for (let i = 0; i < 20 && t.runtime.pendingCount() > 0; i++) {
      expect(t.timers.length).toBeLessThanOrEqual(1);
      delays.push(...t.timers.map((x) => x.ms));
      await t.runTimers();
      await settle();
    }
    expect(t.runtime.pendingCount()).toBe(0);
    expect([...server]).toEqual([T1]);
    expect(t.send).toHaveBeenCalledTimes(13);
    expect(Math.max(...delays)).toBe(RETRY_MAX_MS);
    expect(delays.every((d) => d <= RETRY_MAX_MS)).toBe(true);
    expect(t.runtime.archivedWrites()).toEqual([]);
  });
});

describe("F4 (a) 거절된 쓰기의 내용을 보관한다", () => {
  it("글이 있는 쓰기가 거절되면 내용을 기기 저장소에 남기고, 새로 열어도 남아 있고, 로그아웃 때 지운다", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t = tab(kv);
    await t.runtime.boot();
    const long = `<script>alert(1)</script>${"아".repeat(400)}`;
    t.setReply((q) => (q.op.kind === "todo.add" ? { ok: false, error: "daily_limit" } : q.op.kind === "evening.save" ? { ok: false, error: "invalid_input" } : { ok: true }));
    t.runtime.enqueue({ kind: "todo.add", id: T1, text: long });
    t.runtime.enqueue({ kind: "todo.done", id: T1, done: true });
    t.runtime.enqueue({ kind: "evening.save", input: { id: E1, targetDay: "2026-11-07", totalMinutes: 90, items: [{ categoryId: C1, minutes: 60 }, { categoryId: null, minutes: 30 }], saveMode: "edited", clientSavedAt: iso(NOON) } });
    await t.runtime.flush();
    const archived = t.runtime.archivedWrites();
    expect(archived.map((a) => [a.kind, a.text])).toEqual([
      ["todo.add", long],
      ["evening.save", "2026-11-07 1시간 30분 (어학 1시간 · 기타 30분)"],
    ]);
    expect(await kv.keys(kvKeys.rejectedPrefix(USER))).toHaveLength(2);

    const reopened = tab(kv);
    await reopened.runtime.boot();
    expect(reopened.runtime.archivedWrites().map((a) => a.text)).toEqual([long, "2026-11-07 1시간 30분 (어학 1시간 · 기타 30분)"]);
    await reopened.runtime.dismissArchived(archived[1].key);
    expect(reopened.runtime.archivedWrites()).toHaveLength(1);
    expect(await kv.keys(kvKeys.rejectedPrefix(USER))).toHaveLength(1);

    await createLocalTodos(reopened.runtime, {} as LocalApis).discard();
    expect(await kv.keys("rej/")).toEqual([]);
    expect(reopened.runtime.archivedWrites()).toEqual([]);
  });
});

describe("F4 (b) 분야 만들기가 duplicate면 뒤의 쓰기를 서버의 그 분야 번호로 바꿔 보낸다", () => {
  it("끊긴 채 분야 「운동」 + 그 분야 할 일·저녁 기록·비율 → 다른 기기가 「운동」을 먼저 만듦 → 연결: 거절 없이 기존 분야로 들어간다", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    // 다 보낸 뒤의 받기는 실패로 둔다(기기 거울이 스스로 기존 분야로 맞춰졌는지 본다)
    const t = tab(kv, { fetchSnapshot: async () => ({ ok: false, error: "unavailable" }) });
    await t.runtime.boot();
    t.setOnline(false);
    const ops: Op[] = [
      { kind: "category.add", id: C_NEW, name: "운동" },
      { kind: "todo.add", id: T1, text: "달리기", categoryId: C_NEW },
      { kind: "evening.save", input: { id: E1, targetDay: "2026-11-07", totalMinutes: 60, items: [{ categoryId: C_NEW, minutes: 40 }, { categoryId: null, minutes: 20 }], saveMode: "edited", clientSavedAt: iso(NOON) } },
      { kind: "ratios.save", ratios: [{ categoryId: C1, percent: 50 }, { categoryId: C_NEW, percent: 50 }] },
      { kind: "goal.save", items: [{ categoryId: C_NEW, minutes: 120 }] },
      { kind: "focus.start", input: { id: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1", categoryId: C_NEW, surface: "manual", clientStartedAt: iso(NOON) } },
    ];
    for (const op of ops) t.runtime.enqueue(op);
    await settle();
    // 서버: 「운동」은 이미 C_OLD로 있다. C_NEW를 가리키는 쓰기는 거절한다(없는 분야)
    t.setReply((q) => {
      if (q.op.kind === "category.add") return { ok: false, error: "duplicate", existing: { id: C_OLD, name: "운동" } };
      if (JSON.stringify(q.op).includes(C_NEW)) return { ok: false, error: "invalid_category" };
      return { ok: true };
    });
    t.setOnline(true);
    const r = await t.runtime.flush();
    expect(r.rejected).toEqual([]);
    expect(r.remaining).toBe(0);
    const sent = t.sent.slice(1).map((s) => s.op);
    expect(JSON.stringify(sent)).not.toContain(C_NEW);
    expect(sent[0]).toEqual({ kind: "todo.add", id: T1, text: "달리기", categoryId: C_OLD });
    expect(sent[1]).toMatchObject({ kind: "evening.save", input: { items: [{ categoryId: C_OLD, minutes: 40 }, { categoryId: null, minutes: 20 }] } });
    expect(sent[2]).toEqual({ kind: "ratios.save", ratios: [{ categoryId: C1, percent: 50 }, { categoryId: C_OLD, percent: 50 }] });
    expect(sent[3]).toEqual({ kind: "goal.save", items: [{ categoryId: C_OLD, minutes: 120 }] });
    expect(sent[4]).toMatchObject({ kind: "focus.start", input: { categoryId: C_OLD } });
    const mirror = t.runtime.getMirror();
    expect(mirror.categories.map((c) => c.id)).toEqual([C1, C_OLD]);
    expect(mirror.todos.find((x) => x.id === T1)?.categoryId).toBe(C_OLD);
  });
  it("바꾼 쓰기는 기기 저장소에도 다시 적혀, 보내기 전에 닫혀도 새 번호로 남는다", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t = tab(kv);
    await t.runtime.boot();
    t.setOnline(false);
    t.runtime.enqueue({ kind: "category.add", id: C_NEW, name: "운동" });
    t.runtime.enqueue({ kind: "todo.add", id: T1, text: "달리기", categoryId: C_NEW });
    await settle();
    t.setOnline(true);
    t.setReply((q) => (q.op.kind === "category.add" ? { ok: false, error: "duplicate", existing: { id: C_OLD, name: "운동" } } : { ok: false, error: "unavailable", network: true }));
    await t.runtime.flush();
    await settle();
    const keys = await kv.keys(kvKeys.opPrefix(USER));
    expect(keys).toHaveLength(1);
    expect((await kv.get<QueuedOp>(keys[0]))?.op).toEqual({ kind: "todo.add", id: T1, text: "달리기", categoryId: C_OLD });
  });
});

describe("응답 유실 뒤 재시도: 서버가 처리한 뒤 응답이 끊겨도 두 번 들어가지 않는다", () => {
  it("같은 id로 다시 보내고, 서버는 같은 id를 한 번만 받는다(쌓기만 하는 표는 id 기본키)", async () => {
    const kv = persistentKv();
    await kv.set(kvKeys.base(USER), syncedMirror());
    const t = tab(kv);
    await t.runtime.boot();
    const rows = new Map<string, number>();
    let lose = true;
    t.setReply((q) => {
      if (q.op.kind === "evening.save") rows.set(q.op.input.id, (rows.get(q.op.input.id) ?? 0) + (rows.has(q.op.input.id) ? 0 : 1));
      if (lose) {
        lose = false;
        return { ok: false, error: "unavailable", network: true }; // 처리는 했는데 응답이 끊김
      }
      return { ok: true };
    });
    t.runtime.enqueue({ kind: "evening.save", input: { id: E1, targetDay: "2026-11-07", totalMinutes: 60, items: [{ categoryId: null, minutes: 60 }], saveMode: "not_split", clientSavedAt: iso(NOON) } });
    await settle();
    expect((await t.runtime.flush()).stopped).toBe("offline");
    await t.runTimers();
    await settle();
    expect(t.runtime.pendingCount()).toBe(0);
    expect(t.sent.map((s) => (s.op.kind === "evening.save" ? s.op.input.id : "?"))).toEqual([E1, E1]);
    expect([...rows.entries()]).toEqual([[E1, 1]]);
  });
});

// ---- IndexedDB 흉내(판 올림·닫힘만 시험하는 아주 작은 것) ----
type FakeDb = { closed: boolean; onversionchange: (() => void) | null; onclose: (() => void) | null; objectStoreNames: { contains(): boolean }; close(): void; transaction(): unknown };
function installFakeIndexedDb() {
  const g = globalThis as unknown as { indexedDB?: unknown; IDBKeyRange?: unknown };
  const before = { indexedDB: g.indexedDB, IDBKeyRange: g.IDBKeyRange };
  const data = new Map<string, unknown>();
  let opens = 0;
  let last: FakeDb | null = null;
  const later = (fn: () => void) => setTimeout(fn, 0);
  function makeDb(): FakeDb {
    const db: FakeDb = {
      closed: false,
      onversionchange: null,
      onclose: null,
      objectStoreNames: { contains: () => true },
      close() {
        db.closed = true;
      },
      transaction() {
        if (db.closed) throw new Error("InvalidStateError: The database connection is closing.");
        const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore(): unknown } = {
          objectStore: () => ({
            get: (key: string) => {
              const req: { result?: unknown; onsuccess?: () => void } = {};
              later(() => {
                req.result = data.get(key);
                req.onsuccess?.();
              });
              return req;
            },
            put: (value: unknown, key: string) => {
              data.set(key, value);
              later(() => tx.oncomplete?.());
            },
            delete: (key: string) => {
              data.delete(key);
              later(() => tx.oncomplete?.());
            },
          }),
        };
        return tx;
      },
    };
    return db;
  }
  g.indexedDB = {
    open: () => {
      opens += 1;
      const req: { result?: FakeDb; onsuccess?: () => void; onupgradeneeded?: () => void } = {};
      later(() => {
        last = makeDb();
        req.result = last;
        req.onsuccess?.();
      });
      return req;
    },
  };
  return {
    opens: () => opens,
    lastDb: () => last,
    uninstall: () => {
      g.indexedDB = before.indexedDB;
      g.IDBKeyRange = before.IDBKeyRange;
    },
  };
}
