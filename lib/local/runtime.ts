import { archivedText, remapCategory } from "./archive";
import { createIdbKv, createMemoryKv, kvKeys, wipeOtherUsers, wipeUser, type KvStore } from "./kv";
import { applyOp, emptyMirror, mergeSnapshot, replay } from "./reduce";
import type { ArchivedWrite, Mirror, MirrorSnapshot, Op, QueuedOp, Rejection, Sender } from "./types";

/**
 * 기기 먼저 저장의 운영 장치(고침 3바퀴, 고침 4바퀴에서 고침). 쓰기 → 기기 거울 → 화면 → 보낼 줄(outbox)을 한 곳에서 이어 준다.
 *
 * - 쓰기(enqueue): 거울에 먼저 입히고 화면에 바로 알린 뒤(동기), 기기 저장소에 적고 보낼 줄에 넣는다. 서버 왕복을 기다리지 않는다.
 * - 보내기(flush): 연결되면 줄의 앞에서부터 하나씩 서버에 보낸다. 같은 id로 다시 보내도 서버가 한 번만 만든다(재시도 안전).
 *   · 성공하면 「보냈다는 표시」를 남기고 줄에서 빼고 서버 거울(base)에도 입힌다.
 *   · 서버에 닿지 못했으면(끊김) 멈추고 연결·보이는 때·시간이 지난 뒤 다시 한다(횟수에 세지 않는다).
 *   · 로그인이 풀렸으면 멈추고 알린다(줄은 그대로 둔다).
 *   · 서버가 일시 오류로 답하면 멈추고 다시 한다. 일시 오류로는 버리지 않는다(간격은 최대 60초). STALLED_AFTER_ATTEMPTS번 넘게 못 보내면 화면이 「보내지 못함」을 보인다.
 *   · 서버가 거절하면(권한·검사 실패 등) 줄에서 빼고 거울을 다시 입혀 되돌리고, 화면이 한 줄로 알린다. 글이 있는 쓰기는 그 내용을 보관한다(화면에서 보고 복사).
 *   · 분야 만들기가 duplicate(같은 이름이 서버에 이미 있음)면, 뒤의 쓰기가 가리키는 분야 번호를 서버가 알려 준 분야 번호로 바꿔 보낸다.
 *   · 서버의 세션 사용자가 이 장치의 사용자와 다르면(account_mismatch) 멈추고 이 사용자의 기기 저장소를 지운 뒤 화면에 알린다.
 * - 받기(pull): 서버 사본을 받아 서버 거울(base)을 맞추고, 보낼 줄의 쓰기를 다시 입힌다. 맞추기 규칙(임시): 보낼 줄에 남은 것은 기기 것이 이기고, 나머지는 서버 것이 이긴다.
 *   받는 사이에 보낸 쓰기가 서버에 들어갔으면 그 사본에는 그 쓰기가 없을 수 있어, 한 번 더 받는다. 사본의 주인이 이 장치의 사용자와 다르면 받지 않고 위처럼 지운다.
 * - 같은 기기의 다른 탭과는 알림 통로(BroadcastChannel)로 이어진다: 한 탭이 로그아웃하면 다른 탭도 자기 사용자 것을 지우고 멈추며,
 *   다른 사용자가 열리면(그 탭이 「이 사용자가 열렸다」를 알림) 이 탭은 자기 것을 지운다.
 * - 기기 저장소를 못 쓰면 메모리로 돈다(새로고침하면 사라진다). 던지지 않는다.
 */

export type FlushResult = {
  sent: number;
  rejected: Rejection[];
  remaining: number;
  /** 멈춘 까닭. 없으면 줄을 다 보냈다 */
  stopped?: "offline" | "unauthenticated" | "server_error" | "busy" | "account_mismatch";
};

export type PullResult = { ok: true } | { ok: false; error: string };

/** 이 장치가 자기 사용자 것을 지우고 멈춘 까닭: 서버의 세션 사용자가 다름 / 다른 탭에서 로그아웃함 */
export type ResetReason = "account_mismatch" | "signed_out_elsewhere";

/** 같은 기기의 탭끼리 주고받는 알림(사용자 번호만, 글 없음) */
export type ChannelMessage = { type: "signed-out"; user: string } | { type: "active"; user: string };

/** 탭끼리 알림 통로(브라우저에서는 BroadcastChannel). 자기가 보낸 것은 자기에게 오지 않는다 */
export type LocalChannel = {
  post(message: ChannelMessage): void;
  subscribe(listener: (message: unknown) => void): () => void;
};

export type RuntimeDeps = {
  userKey: string;
  /** 기기 저장소. 없으면 IndexedDB를 열고, 못 열면 메모리 */
  kv?: KvStore;
  send: Sender;
  /** 서버 사본 받기 */
  fetchSnapshot: () => Promise<{ ok: true; data: MirrorSnapshot } | { ok: false; error: string }>;
  now?: () => number;
  /** 지금 연결돼 있는가(없으면 보내지 않고 기다린다). 기본: navigator.onLine */
  online?: () => boolean;
  /** 보내기·받기를 다시 하는 때를 거는 도구(시험이 가짜로 바꾼다) */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** 같은 기기의 다른 탭과 잇는 알림 통로(없으면 탭끼리 알리지 않는다) */
  channel?: LocalChannel | null;
  /** 이 장치가 자기 사용자 것을 지우고 멈춘 뒤 부른다(화면이 안내하고 다시 연다) */
  onReset?: (reason: ResetReason) => void;
};

/**
 * 서버가 일시 오류로 이만큼 넘게 답하면 화면이 「보내지 못함」을 보인다(버리지 않고 계속 다시 보낸다).
 * 6번 ≈ 2+4+8+16+32초 ≈ 1분: 그보다 오래 못 보내면 사용자가 알 만하다(임시).
 */
export const STALLED_AFTER_ATTEMPTS = 6;
/** 보내기를 다시 하는 간격(밀리초): 시도마다 두 배, 최대 60초 */
export const RETRY_BASE_MS = 2000;
export const RETRY_MAX_MS = 60_000;
/**
 * 지우기(wipe)가 돌던 보내기·고른 값 쓰기를 기다리는 시간 상한(밀리초, 임시).
 * 기기 저장소 쓰기는 몇 ms, 서버 왕복도 보통 1초 안이다. 더 걸리면 연결이 막힌 것이라 더 기다리지 않는다.
 * 늦게 온 응답은 「지웠나」 확인으로 다시 적지 않는다(이 기다림은 지우기 순서를 깔끔하게 할 뿐, 안전은 그 확인이 지킨다).
 */
export const WIPE_WAIT_MS = 1500;
/** 「보냈다는 표시(비석)」를 남겨 두는 시간(밀리초). 지난 표시는 열 때 지운다. 표시가 없어 다시 보내도 서버가 같은 id는 한 번만 받는다 */
export const SENT_MARK_TTL_MS = 24 * 60 * 60 * 1000;
/** 서버가 이 오류로 답하면 일시 오류다(다시 해 볼 만한 것). 그 밖의 오류는 서버가 받지 않은 것(거절) */
const TRANSIENT = new Set(["unavailable", "config"]);
/** 이미 없는 것을 지우는 쓰기는 「없음」이어도 성공으로 본다(다른 탭이 먼저 보냈거나 재시도) */
const IDEMPOTENT_NOT_FOUND = new Set<Op["kind"]>(["todo.delete", "note.delete", "offer.dismiss"]);

type Listener = () => void;

export type Runtime = ReturnType<typeof createRuntime>;

const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function createRuntime(deps: RuntimeDeps) {
  const userKey = deps.userKey;
  const now = deps.now ?? (() => Date.now());
  const isOnline = deps.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const kv: KvStore = deps.kv ?? createIdbKv() ?? createMemoryKv();
  const channel = deps.channel ?? null;

  let base: Mirror = emptyMirror();
  let queue: QueuedOp[] = [];
  let view: Mirror = base;
  let booted = false;
  let lastKeyMs = 0;
  let keyCounter = 0;
  let ackSeq = 0;
  let flushing: Promise<FlushResult> | null = null;
  let pulling: Promise<PullResult> | null = null;
  let retryHandle: unknown = null;
  let retryCount = 0;
  let persistHandle: unknown = null;
  let stopped = false;
  /** wipe로 이 사용자의 기기 저장소를 지웠다: 그 뒤로는 아무것도 다시 적지 않는다(닫히며 거울을 적는 것·늦게 온 응답이 지운 것을 되살리지 않게) */
  let wiped = false;
  /** 계정이 바뀌었거나 다른 탭에서 로그아웃해 지우고 멈췄다(한 번만 한다) */
  let resetting = false;
  /** 아직 끝나지 않은 고른 값 쓰기들. wipe가 이것들이 끝난 뒤에(시간 상한까지) 지워서, 로그아웃 직후에 늦게 반영되는 쓰기가 pref/를 남기지 않게 한다 */
  const prefWrites = new Set<Promise<void>>();
  let authLost = false;
  /** 마지막으로 서버가 거절해 되돌린 것들(화면이 알림을 보이고 닫을 때까지 쌓인다) */
  let rejections: Rejection[] = [];
  /** 서버가 받지 않은 쓰기의 내용(기기 저장소에도 둔다. 사용자가 지우거나 로그아웃 때까지) */
  let archived: ArchivedWrite[] = [];
  const listeners = new Set<Listener>();
  const rejectionListeners = new Set<(r: Rejection[]) => void>();
  const stateListeners = new Set<Listener>();

  // ---- 저장소(실패해도 던지지 않는다) ----
  async function safe<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch {
      return undefined;
    }
  }
  function persistBaseSoon() {
    if (wiped || persistHandle !== null) return;
    persistHandle = setTimer(() => {
      persistHandle = null;
      void persistBaseNow();
    }, 200);
  }
  async function persistBaseNow() {
    if (persistHandle !== null) {
      clearTimer(persistHandle);
      persistHandle = null;
    }
    if (wiped) return;
    await safe(() => kv.set(kvKeys.base(userKey), base));
  }

  function emit() {
    for (const l of [...listeners]) l();
  }
  function emitState() {
    for (const l of [...stateListeners]) l();
  }
  function rebuildView() {
    view = replay(base, queue);
  }

  /** 줄 순서 열쇠: 시각 순으로 커지고(기기 시계가 거꾸로 가도 줄어들지 않게), 같은 ms는 순번으로 가른다 */
  function nextKey(): { key: string; clientAt: string } {
    const ms = Math.max(now(), lastKeyMs);
    keyCounter = ms === lastKeyMs ? keyCounter + 1 : 0;
    lastKeyMs = ms;
    return { key: `${String(ms).padStart(13, "0")}${String(keyCounter).padStart(4, "0")}-${randomSuffix()}`, clientAt: new Date(now()).toISOString() };
  }

  // ---- 시작 ----
  /** 기기 저장소에서 서버 거울(base)과 보낼 줄·받지 않은 쓰기 보관을 읽어 화면이 볼 값을 만든다. 네트워크를 쓰지 않는다 */
  async function boot(): Promise<void> {
    if (booted) return;
    // 거울과 보낼 줄 열쇠를 함께 읽는다(첫 화면이 기기 저장소를 몇 번 거치느냐가 곧 첫 화면이 그려지는 때다)
    const [saved, savedKeys, archivedKeys] = await Promise.all([
      safe(() => kv.get<Mirror>(kvKeys.base(userKey))),
      safe(() => kv.keys(kvKeys.opPrefix(userKey))),
      safe(() => kv.keys(kvKeys.rejectedPrefix(userKey))),
    ]);
    if (saved && typeof saved === "object" && Array.isArray((saved as Mirror).todos)) base = { ...emptyMirror(), ...saved };
    const keys = savedKeys ?? [];
    const loaded: QueuedOp[] = [];
    for (const q of await Promise.all(keys.map((k) => safe(() => kv.get<QueuedOp>(k))))) {
      if (q && typeof q === "object" && typeof q.key === "string" && q.op) loaded.push(q);
    }
    loaded.sort(byKey);
    queue = loaded;
    for (const q of loaded) opWrites.set(q.key, Promise.resolve(true));
    if (loaded.length > 0) lastKeyMs = Math.max(lastKeyMs, ...loaded.map((q) => Number(q.key.slice(0, 13)) || 0));
    const kept: ArchivedWrite[] = [];
    for (const a of await Promise.all((archivedKeys ?? []).map((k) => safe(() => kv.get<ArchivedWrite>(k))))) {
      if (a && typeof a === "object" && typeof a.key === "string" && typeof a.text === "string") kept.push(a);
    }
    archived = kept.sort(byKey);
    rebuildView();
    booted = true;
    emit();
    emitState();
    // 이 사용자가 이 기기에서 열렸다고 다른 탭에 알린다(다른 사용자의 탭은 자기 것을 지운다)
    if (!wiped) channel?.post({ type: "active", user: userKey });
    void pruneSentMarks();
  }

  /** 하루가 지난 「보냈다는 표시」를 지운다(첫 화면을 기다리게 하지 않는다) */
  async function pruneSentMarks() {
    if (!kv.persistent) return;
    const keys = (await safe(() => kv.keys(kvKeys.sentPrefix(userKey)))) ?? [];
    for (const key of keys) {
      if (wiped) return;
      const at = await safe(() => kv.get<number>(key));
      if (typeof at !== "number" || now() - at > SENT_MARK_TTL_MS) await safe(() => kv.delete(key));
    }
  }

  // ---- 쓰기 ----
  /**
   * 쓰기 하나: 거울에 먼저 입히고 화면에 바로 알린 뒤(동기), 저장하고 보낼 줄에 넣는다.
   * at은 누른 때를 따로 줄 때만(옛 판의 보관함 글을 옮길 때): 하루 경계를 그 때로 정한다. 줄 안의 순서는 늘 넣은 순서다.
   */
  function enqueue(op: Op, at?: string): QueuedOp {
    const { key, clientAt: now0 } = nextKey();
    const clientAt = at && Number.isFinite(Date.parse(at)) ? at : now0;
    const queued: QueuedOp = { key, clientAt, attempts: 0, op };
    queue = [...queue, queued];
    view = applyOp(view, queued);
    emit();
    emitState();
    persistOp(queued);
    scheduleFlush(0);
    return queued;
  }

  // ---- 보내기 ----
  /** 줄의 한 칸을 기기 저장소에 적는다. 적기가 끝났고 성공했는지는 보내기 전에 확인한다 */
  const opWrites = new Map<string, Promise<boolean>>();
  function persistOp(q: QueuedOp) {
    if (wiped) return;
    opWrites.set(
      q.key,
      kv.set(kvKeys.op(userKey, q.key), q).then(
        () => true,
        () => false,
      ),
    );
  }

  /**
   * 여러 탭이 같은 줄을 동시에 보내지 않게, 한 탭만 보내기를 한다(Web Locks가 있을 때). 다른 탭이 하는 중이면 busy.
   * 잠금 이름은 사용자와 상관없이 하나다(고침 4바퀴): 계정이 바뀐 낡은 탭과 새 탭이 동시에 보내지 않게.
   */
  async function withFlushLock<T>(work: () => Promise<T>, busy: T): Promise<T> {
    const locks = typeof navigator === "undefined" ? undefined : (navigator as { locks?: LockManager }).locks;
    if (!locks) return work();
    return locks.request("duno-flush", { ifAvailable: true }, async (lock) => (lock ? work() : busy));
  }

  function scheduleFlush(ms: number) {
    if (stopped) return;
    if (retryHandle !== null) clearTimer(retryHandle);
    retryHandle = setTimer(() => {
      retryHandle = null;
      void flush();
    }, ms);
  }

  async function removeOp(q: QueuedOp) {
    queue = queue.filter((x) => x.key !== q.key);
    opWrites.delete(q.key);
    await safe(() => kv.delete(kvKeys.op(userKey, q.key)));
  }

  /**
   * 보내기 전에 기기 저장소의 그 칸을 본다(다른 탭과 같은 줄을 나눠 쓴다).
   * - present: 저장소에 있다(다른 탭이 바꿔 적었으면 그 값으로 보낸다)
   * - sent: 저장소에 없고 「보냈다는 표시」가 있다 → 다른 탭이 보냈다. 건너뛴다
   * - send: 그 밖(메모리 저장소·저장소에 적지 못했음·읽기 실패·표시 없음) → 보낸다. 서버가 같은 id는 한 번만 받는다(F1·F2)
   */
  async function checkStored(q: QueuedOp): Promise<{ state: "present"; value: QueuedOp } | { state: "sent" } | { state: "send" }> {
    if (!kv.persistent) return { state: "send" };
    const written = opWrites.get(q.key);
    if (written !== undefined && !(await written)) return { state: "send" };
    let stored: QueuedOp | undefined;
    try {
      stored = await kv.get<QueuedOp>(kvKeys.op(userKey, q.key));
    } catch {
      return { state: "send" };
    }
    if (stored !== undefined) return stored && typeof stored === "object" && stored.op ? { state: "present", value: stored } : { state: "send" };
    try {
      return (await kv.get<number>(kvKeys.sent(userKey, q.key))) !== undefined ? { state: "sent" } : { state: "send" };
    } catch {
      return { state: "send" };
    }
  }

  /** 보냈다는 표시를 남긴다(줄 칸을 지우기 전에). 못 남겨도 다른 탭이 다시 보낼 뿐이다(서버가 한 번만 받는다) */
  async function markSent(q: QueuedOp) {
    if (wiped || !kv.persistent) return;
    await safe(() => kv.set(kvKeys.sent(userKey, q.key), now()));
  }

  /** 서버가 받지 않은 쓰기의 내용을 보관한다(글이 있는 것만) */
  async function archiveRejected(q: QueuedOp, error: string) {
    const text = archivedText(q.op, view);
    if (text === null || wiped) return;
    const item: ArchivedWrite = { key: q.key, kind: q.op.kind, error, clientAt: q.clientAt, text };
    archived = [...archived.filter((a) => a.key !== q.key), item];
    await safe(() => kv.set(kvKeys.rejected(userKey, q.key), item));
  }

  /**
   * 분야 만들기가 duplicate: 서버에 같은 이름의 분야(existing)가 이미 있다. 그 분야를 서버 거울에 넣고,
   * 뒤의 쓰기(할 일·저녁 기록·목표·비율·타이머)가 가리키는 분야 번호를 그 번호로 바꿔 저장소에도 다시 적는다(F4).
   */
  function adoptExistingCategory(q: QueuedOp, existing: { id: string; name: string }) {
    if (q.op.kind !== "category.add") return;
    const from = q.op.id;
    base = applyOp(base, { ...q, op: { kind: "category.add", id: existing.id, name: existing.name } });
    queue = queue.map((x) => {
      const op = remapCategory(x.op, from, existing.id);
      if (op === x.op) return x;
      const next: QueuedOp = { ...x, op };
      persistOp(next);
      return next;
    });
  }

  function flush(): Promise<FlushResult> {
    if (flushing) return flushing;
    flushing = withFlushLock(
      async (): Promise<FlushResult> => {
        const result: FlushResult = { sent: 0, rejected: [], remaining: queue.length };
        try {
          while (queue.length > 0 && !stopped) {
            if (!isOnline()) {
              result.stopped = "offline";
              break;
            }
            let q = queue[0];
            // 다른 탭이 이미 보냈으면(보냈다는 표시가 있으면) 건너뛴다. 다른 탭이 바꿔 적은 칸이면 그 값으로 보낸다
            const stored = await checkStored(q);
            if (wiped) break;
            if (stored.state === "sent") {
              queue = queue.filter((x) => x.key !== q.key);
              base = applyOp(base, q); // 다른 탭이 보낸 것이니 서버에 들어간 것으로 본다
              continue;
            }
            if (stored.state === "present" && JSON.stringify(stored.value.op) !== JSON.stringify(q.op)) {
              const value: QueuedOp = { ...stored.value, key: q.key };
              queue = queue.map((x) => (x.key === q.key ? value : x));
              q = value;
            }
            let res;
            try {
              res = await deps.send(q);
            } catch {
              res = { ok: false as const, error: "unavailable", network: true };
            }
            // 보내는 사이에 로그아웃·계정 바뀜으로 지웠으면 응답을 기기에 적지 않는다(S2)
            if (wiped) break;
            if (res.ok || (!res.ok && res.error === "not_found" && IDEMPOTENT_NOT_FOUND.has(q.op.kind))) {
              await markSent(q);
              await removeOp(q);
              base = applyOp(base, q);
              ackSeq += 1;
              result.sent += 1;
              retryCount = 0;
              persistBaseSoon();
              continue;
            }
            if (res.error === "account_mismatch") {
              // 서버의 세션 사용자가 다르다: 보내지 않고 멈춘다(지우기는 보내기가 끝난 뒤에 한다)
              stopped = true;
              result.stopped = "account_mismatch";
              break;
            }
            const existing = res.existing;
            if (q.op.kind === "category.add" && res.error === "duplicate" && existing && typeof existing.id === "string" && typeof existing.name === "string") {
              // 같은 이름의 분야가 서버에 이미 있다: 그 분야를 쓰고 뒤의 쓰기를 그 번호로 바꿔 보낸다
              await markSent(q);
              await removeOp(q);
              adoptExistingCategory(q, existing);
              ackSeq += 1;
              result.sent += 1;
              retryCount = 0;
              rebuildView();
              persistBaseSoon();
              emit();
              continue;
            }
            if (res.error === "unauthenticated") {
              authLost = true;
              result.stopped = "unauthenticated";
              emitState();
              break;
            }
            if (res.network) {
              result.stopped = "offline";
              break;
            }
            if (TRANSIENT.has(res.error)) {
              // 일시 오류로는 버리지 않는다(F3). 횟수만 세어 오래 못 보내면 화면이 알린다. 지운 뒤에는 다시 적지 않는다(S2)
              q.attempts += 1;
              if (!wiped) await safe(() => kv.set(kvKeys.op(userKey, q.key), q));
              result.stopped = "server_error";
              break;
            }
            // 거절: 글이 있으면 내용을 보관하고, 줄에서 빼고 되돌린다
            await archiveRejected(q, res.error);
            await removeOp(q);
            const rejection: Rejection = { kind: q.op.kind, error: res.error };
            result.rejected.push(rejection);
            rejections = [...rejections, rejection];
            rebuildView();
            ackSeq += 1;
            emit();
          }
        } finally {
          result.remaining = queue.length;
          emitState();
        }
        if (result.rejected.length > 0) for (const l of [...rejectionListeners]) l(rejections);
        if (result.stopped === "offline" || result.stopped === "server_error") {
          retryCount = Math.min(retryCount + 1, 16);
          scheduleFlush(Math.min(RETRY_BASE_MS * 2 ** (retryCount - 1), RETRY_MAX_MS));
        } else if (result.stopped === undefined && result.sent > 0 && !pulling && !wiped) {
          // 줄을 다 보냈다: 서버 것으로 한 번 맞춰 서버가 정한 값(만든 시각 등)과 다른 기기의 변화를 받는다
          void pull();
        }
        return result;
      },
      { sent: 0, rejected: [], remaining: queue.length, stopped: "busy" as const },
    ).then((result) => {
      flushing = null;
      if (result.stopped === "account_mismatch") void resetFor("account_mismatch");
      else if (result.stopped === "busy") scheduleFlush(3000); // 다른 탭이 보내는 중: 조금 뒤에 다시 본다
      // 보내는 사이에 새로 들어온 쓰기가 있으면(그 쓰기의 보내기 부름은 이미 돌던 보내기에 합쳐졌다) 바로 다시 한다
      else if (result.stopped === undefined && queue.length > 0) scheduleFlush(0);
      return result;
    });
    return flushing;
  }

  // ---- 받기 ----
  function pull(): Promise<PullResult> {
    if (pulling) return pulling;
    pulling = (async (): Promise<PullResult> => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const seq = ackSeq;
          let res;
          try {
            res = await deps.fetchSnapshot();
          } catch {
            res = { ok: false as const, error: "unavailable" };
          }
          if (wiped) return { ok: false, error: "wiped" };
          if (!res.ok) {
            if (res.error === "account_mismatch") void resetFor("account_mismatch");
            if (res.error === "unauthenticated") {
              authLost = true;
              emitState();
            }
            return res;
          }
          // 사본의 주인이 이 장치의 사용자가 아니면 받지 않는다(다른 계정의 글을 이 사용자 열쇠에 적지 않게)
          if (res.data.userId !== undefined && res.data.userId !== userKey) {
            void resetFor("account_mismatch");
            return { ok: false, error: "account_mismatch" };
          }
          authLost = false;
          // 받는 사이에 보낸 쓰기가 서버에 들어갔으면 이 사본에는 없을 수 있다: 한 번 더 받는다(마지막 시도는 그대로 쓴다)
          if (seq !== ackSeq && attempt < 2) continue;
          base = mergeSnapshot(base, res.data);
          rebuildView();
          persistBaseSoon();
          emit();
          emitState();
          return { ok: true };
        }
        return { ok: false, error: "unavailable" };
      } finally {
        pulling = null;
      }
    })();
    return pulling;
  }

  /**
   * 서버가 첫 화면과 함께 실어 보낸 사본을 받는다(이 기기에서 처음 열 때, 고침 3바퀴). 네트워크를 쓰지 않는다. 받아 맞추기(pull)와 같은 규칙이다.
   * 이미 서버 사본을 받은 기기에서는 부르지 않는다(기기에 있는 것이 더 새것일 수 있다). 주인이 다른 사본은 받지 않는다.
   */
  function applySnapshot(snapshot: MirrorSnapshot): void {
    if (wiped || (snapshot.userId !== undefined && snapshot.userId !== userKey)) return;
    base = mergeSnapshot(base, snapshot);
    rebuildView();
    persistBaseSoon();
    emit();
    emitState();
  }

  // ---- 화면이 쓰는 것 ----
  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  /** 보낼 줄·로그인 상태·받지 않은 쓰기 보관이 바뀔 때 알림(동기화 상태 표시용) */
  function subscribeState(listener: Listener): () => void {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }
  function subscribeRejections(listener: (r: Rejection[]) => void): () => void {
    rejectionListeners.add(listener);
    return () => rejectionListeners.delete(listener);
  }
  function takeRejections(): Rejection[] {
    const taken = rejections;
    rejections = [];
    return taken;
  }

  /** 거울을 바꾸는 쓰기가 아닌 값(제시·작업 기록 불러오기 등)을 서버 거울과 지금 거울 둘 다에 넣는다 */
  function patchBase(change: (m: Mirror) => Mirror) {
    if (wiped) return;
    base = change(base);
    rebuildView();
    persistBaseSoon();
    emit();
  }

  /**
   * 이 사용자의 기기 저장소(거울·보낼 줄·고른 값·보냈다는 표시·받지 않은 쓰기 보관)를 지우고 멈춘다. 그 뒤로는 아무것도 다시 적지 않는다.
   * broadcast면 같은 기기의 다른 탭에 「로그아웃」을 알린다(그 탭들도 자기 것을 지우고 멈춘다).
   * 돌던 보내기·고른 값 쓰기는 WIPE_WAIT_MS까지만 기다린다.
   */
  async function wipe(options: { broadcast?: boolean } = {}): Promise<void> {
    const inflight = flushing;
    stopped = true;
    wiped = true;
    if (retryHandle !== null) clearTimer(retryHandle);
    if (persistHandle !== null) clearTimer(persistHandle);
    retryHandle = null;
    persistHandle = null;
    queue = [];
    base = emptyMirror();
    view = base;
    archived = [];
    rejections = [];
    if (options.broadcast) channel?.post({ type: "signed-out", user: userKey });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...prefWrites, ...(inflight ? [inflight] : [])]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, WIPE_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
    await wipeUser(kv, userKey);
    emit();
    emitState();
  }

  /** 계정이 바뀌었거나 다른 탭에서 로그아웃했다: 이 사용자 것을 지우고 멈춘 뒤 화면에 알린다(한 번만) */
  async function resetFor(reason: ResetReason): Promise<void> {
    if (resetting) return;
    resetting = true;
    stopChannel();
    await wipe();
    emitState();
    deps.onReset?.(reason);
  }

  const stopChannel =
    channel?.subscribe((message) => {
      if (message === null || typeof message !== "object") return;
      const m = message as { type?: unknown; user?: unknown };
      if (m.type === "signed-out") void resetFor("signed_out_elsewhere");
      else if (m.type === "active" && typeof m.user === "string" && m.user !== userKey) void resetFor("account_mismatch");
    }) ?? (() => {});

  /** 다른 탭이 적어 둔 보낼 줄도 이 탭 줄에 합친다(로그아웃 전에 기기의 줄을 모두 보내 보려고) */
  async function adoptStoredQueue(): Promise<void> {
    if (!kv.persistent || wiped) return;
    const keys = await safe(() => kv.keys(kvKeys.opPrefix(userKey)));
    if (!keys) return;
    const have = new Set(queue.map((q) => q.key));
    const added: QueuedOp[] = [];
    for (const key of keys) {
      if (have.has(key.slice(kvKeys.opPrefix(userKey).length))) continue;
      const q = await safe(() => kv.get<QueuedOp>(key));
      if (q && typeof q === "object" && typeof q.key === "string" && q.op && !have.has(q.key)) {
        added.push(q);
        opWrites.set(q.key, Promise.resolve(true));
      }
    }
    if (added.length === 0 || wiped) return;
    queue = [...queue, ...added].sort(byKey);
    rebuildView();
    emit();
    emitState();
  }

  /**
   * 기기에 남은 못 보낸 쓰기 수(로그아웃 확인이 센다, F1): 이 탭의 줄과 기기 저장소의 이 사용자 줄 칸(op/<사용자>/)을 합친 수.
   * 저장소를 못 읽으면 이 탭의 줄만 센다(그때는 저장소에도 적지 못했다).
   */
  async function storedPendingCount(): Promise<number> {
    const keys = new Set(queue.map((q) => q.key));
    if (kv.persistent) {
      const stored = await safe(() => kv.keys(kvKeys.opPrefix(userKey)));
      for (const key of stored ?? []) keys.add(key.slice(kvKeys.opPrefix(userKey).length));
    }
    return keys.size;
  }

  return {
    boot,
    applySnapshot,
    enqueue,
    /** 이미 쓰기를 거절당해 쌓인 알림을 비우지 않고 보기만 한다 */
    peekRejections: (): Rejection[] => rejections,
    flush,
    pull,
    subscribe,
    subscribeState,
    subscribeRejections,
    takeRejections,
    patchBase,
    persistNow: persistBaseNow,
    wipe,
    adoptStoredQueue,
    storedPendingCount,
    /** 서버가 받지 않은 쓰기의 내용(오래된 것부터) */
    archivedWrites: (): ArchivedWrite[] => archived,
    /** 보관한 것을 지운다(key가 없으면 모두) */
    dismissArchived: async (key?: string): Promise<void> => {
      const gone = key === undefined ? archived : archived.filter((a) => a.key === key);
      archived = key === undefined ? [] : archived.filter((a) => a.key !== key);
      emitState();
      for (const a of gone) await safe(() => kv.delete(kvKeys.rejected(userKey, a.key)));
    },
    /** 서버가 일시 오류로 오래(STALLED_AFTER_ATTEMPTS번 넘게) 받지 못하고 있는가. 줄은 그대로 두고 계속 다시 보낸다 */
    isStalled: () => (queue[0]?.attempts ?? 0) >= STALLED_AFTER_ATTEMPTS,
    /** 계정이 바뀌었거나 다른 탭에서 로그아웃해 지우고 멈췄는가 */
    isReset: () => resetting,
    /** 화면이 기억하는 고른 값 읽기·쓰기(이 사용자 열쇠 한 칸). 실패는 던지지 않고(읽기는 undefined, 쓰기는 조용히 건너뜀), 지운(wipe) 뒤에는 다시 적지 않는다 */
    getPref: (name: string): Promise<unknown> => safe(() => kv.get<unknown>(kvKeys.pref(userKey, name))),
    setPref: (name: string, value: unknown): Promise<void> => {
      if (wiped) return Promise.resolve();
      const write = safe(() => kv.set(kvKeys.pref(userKey, name), value)).then(() => {});
      prefWrites.add(write);
      void write.finally(() => prefWrites.delete(write));
      return write;
    },
    wipeOthers: () => wipeOtherUsers(kv, userKey),
    /** 지금 화면이 볼 거울(서버 거울에 보낼 줄을 입힌 것) */
    getMirror: (): Mirror => view,
    /** 아직 서버에 못 보낸 쓰기 수(이 탭의 줄) */
    pendingCount: () => queue.length,
    pendingKinds: () => queue.map((q) => q.op.kind),
    /** 아직 서버에 없는 할 일(보낼 줄에 「적기」가 남은 것)인가 */
    hasPendingAdd: (todoId: string) => queue.some((q) => q.op.kind === "todo.add" && q.op.id === todoId),
    pendingOps: (): QueuedOp[] => [...queue],
    isAuthLost: () => authLost,
    isPersistent: () => kv.persistent,
    isOnline,
    now,
    /** 이 화면을 닫는다(보내기를 멈추고 탭끼리 알림 듣기를 거둔다). 기기 저장소는 그대로 둔다 */
    stop: () => {
      stopped = true;
      if (retryHandle !== null) clearTimer(retryHandle);
      retryHandle = null;
      stopChannel();
    },
    /** 멈췄던 보내기·받기를 다시 한다(연결이 돌아왔거나 화면이 다시 보일 때). 지운 뒤에는 다시 하지 않는다 */
    resume: () => {
      if (wiped) return;
      stopped = false;
      retryCount = 0;
      scheduleFlush(0);
    },
  };
}

function randomSuffix(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}
