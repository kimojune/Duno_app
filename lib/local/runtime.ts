import { createIdbKv, createMemoryKv, kvKeys, wipeOtherUsers, wipeUser, type KvStore } from "./kv";
import { applyOp, emptyMirror, mergeSnapshot, replay } from "./reduce";
import type { Mirror, MirrorSnapshot, Op, QueuedOp, Rejection, Sender } from "./types";

/**
 * 기기 먼저 저장의 운영 장치(고침 3바퀴). 쓰기 → 기기 거울 → 화면 → 보낼 줄(outbox)을 한 곳에서 이어 준다.
 *
 * - 쓰기(enqueue): 거울에 먼저 입히고 화면에 바로 알린 뒤(동기), 기기 저장소에 적고 보낼 줄에 넣는다. 서버 왕복을 기다리지 않는다.
 * - 보내기(flush): 연결되면 줄의 앞에서부터 하나씩 서버에 보낸다. 같은 id로 다시 보내도 서버가 한 번만 만든다(재시도 안전).
 *   · 성공하면 줄에서 빼고 서버 거울(base)에도 입힌다.
 *   · 서버에 닿지 못했으면(끊김) 멈추고 연결·보이는 때·시간이 지난 뒤 다시 한다(횟수에 세지 않는다).
 *   · 로그인이 풀렸으면 멈추고 알린다(줄은 그대로 둔다).
 *   · 서버가 일시 오류로 답하면 멈추고 다시 한다(횟수를 센다. MAX_ATTEMPTS번을 넘으면 거절로 본다: 줄이 영원히 막히지 않게).
 *   · 서버가 거절하면(권한·검사 실패 등) 줄에서 빼고 거울을 다시 입혀 되돌리고, 화면이 한 줄로 알린다.
 * - 받기(pull): 서버 사본을 받아 서버 거울(base)을 맞추고, 보낼 줄의 쓰기를 다시 입힌다. 맞추기 규칙(임시): 보낼 줄에 남은 것은 기기 것이 이기고, 나머지는 서버 것이 이긴다.
 *   받는 사이에 보낸 쓰기가 서버에 들어갔으면 그 사본에는 그 쓰기가 없을 수 있어, 한 번 더 받는다.
 * - 기기 저장소를 못 쓰면 메모리로 돈다(새로고침하면 사라진다). 던지지 않는다.
 */

export type FlushResult = {
  sent: number;
  rejected: Rejection[];
  remaining: number;
  /** 멈춘 까닭. 없으면 줄을 다 보냈다 */
  stopped?: "offline" | "unauthenticated" | "server_error" | "busy";
};

export type PullResult = { ok: true } | { ok: false; error: string };

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
};

/** 서버가 일시 오류로 이만큼 답하면 거절로 본다(마이그레이션 전 DB의 열 없음 등으로 줄이 영원히 막히지 않게) */
export const MAX_ATTEMPTS = 6;
/** 보내기를 다시 하는 간격(밀리초): 시도마다 두 배, 최대 60초 */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60_000;
/** 서버가 이 오류로 답하면 일시 오류다(다시 해 볼 만한 것). 그 밖의 오류는 서버가 받지 않은 것(거절) */
const TRANSIENT = new Set(["unavailable", "config"]);
/** 이미 없는 것을 지우는 쓰기는 「없음」이어도 성공으로 본다(다른 탭이 먼저 보냈거나 재시도) */
const IDEMPOTENT_NOT_FOUND = new Set<Op["kind"]>(["todo.delete", "note.delete", "offer.dismiss"]);

type Listener = () => void;

export type Runtime = ReturnType<typeof createRuntime>;

export function createRuntime(deps: RuntimeDeps) {
  const userKey = deps.userKey;
  const now = deps.now ?? (() => Date.now());
  const isOnline = deps.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const kv: KvStore = deps.kv ?? createIdbKv() ?? createMemoryKv();

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
  /** wipe로 이 사용자의 기기 저장소를 지웠다: 그 뒤로는 아무것도 다시 적지 않는다(닫히며 거울을 적는 것이 지운 것을 되살리지 않게) */
  let wiped = false;
  let authLost = false;
  /** 마지막으로 서버가 거절해 되돌린 것들(화면이 알림을 보이고 닫을 때까지 쌓인다) */
  let rejections: Rejection[] = [];
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
  /** 기기 저장소에서 서버 거울(base)과 보낼 줄을 읽어 화면이 볼 값을 만든다. 네트워크를 쓰지 않는다 */
  async function boot(): Promise<void> {
    if (booted) return;
    // 거울과 보낼 줄 열쇠를 함께 읽는다(첫 화면이 기기 저장소를 몇 번 거치느냐가 곧 첫 화면이 그려지는 때다)
    const [saved, savedKeys] = await Promise.all([safe(() => kv.get<Mirror>(kvKeys.base(userKey))), safe(() => kv.keys(kvKeys.opPrefix(userKey)))]);
    if (saved && typeof saved === "object" && Array.isArray((saved as Mirror).todos)) base = { ...emptyMirror(), ...saved };
    const keys = savedKeys ?? [];
    const loaded: QueuedOp[] = [];
    for (const q of await Promise.all(keys.map((k) => safe(() => kv.get<QueuedOp>(k))))) {
      if (q && typeof q === "object" && typeof q.key === "string" && q.op) loaded.push(q);
    }
    loaded.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    queue = loaded;
    for (const q of loaded) opWrites.set(q.key, Promise.resolve(true));
    if (loaded.length > 0) lastKeyMs = Math.max(lastKeyMs, ...loaded.map((q) => Number(q.key.slice(0, 13)) || 0));
    rebuildView();
    booted = true;
    emit();
    emitState();
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

  /** 여러 탭이 같은 줄을 동시에 보내지 않게, 한 탭만 보내기를 한다(Web Locks가 있을 때). 다른 탭이 하는 중이면 busy */
  async function withFlushLock<T>(work: () => Promise<T>, busy: T): Promise<T> {
    const locks = typeof navigator === "undefined" ? undefined : (navigator as { locks?: LockManager }).locks;
    if (!locks) return work();
    return locks.request(`duno-flush-${userKey}`, { ifAvailable: true }, async (lock) => (lock ? work() : busy));
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
          const q = queue[0];
          // 다른 탭이 이미 보내 저장소에서 지웠으면 건너뛴다(같은 쓰기를 두 번 보내지 않으려고). 저장소에 적지 못한 줄은 확인할 수 없으니 그대로 보낸다
          const written = opWrites.get(q.key);
          if (kv.persistent && (written === undefined || (await written))) {
            const stillThere = await safe(() => kv.get<QueuedOp>(kvKeys.op(userKey, q.key)));
            if (stillThere === undefined) {
              queue = queue.filter((x) => x.key !== q.key);
              base = applyOp(base, q); // 다른 탭이 보낸 것이니 서버에 들어간 것으로 본다
              continue;
            }
          }
          let res;
          try {
            res = await deps.send(q);
          } catch {
            res = { ok: false as const, error: "unavailable", network: true };
          }
          if (res.ok || (!res.ok && res.error === "not_found" && IDEMPOTENT_NOT_FOUND.has(q.op.kind))) {
            await removeOp(q);
            base = applyOp(base, q);
            ackSeq += 1;
            result.sent += 1;
            retryCount = 0;
            persistBaseSoon();
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
            q.attempts += 1;
            await safe(() => kv.set(kvKeys.op(userKey, q.key), q));
            if (q.attempts < MAX_ATTEMPTS) {
              result.stopped = "server_error";
              break;
            }
            // 여러 번 일시 오류로 답했다: 줄이 영원히 막히지 않게 거절로 본다
          }
          // 거절: 줄에서 빼고 되돌린다
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
        retryCount += 1;
        scheduleFlush(Math.min(RETRY_BASE_MS * 2 ** (retryCount - 1), RETRY_MAX_MS));
      } else if (result.stopped === undefined && result.sent > 0 && !pulling) {
        // 줄을 다 보냈다: 서버 것으로 한 번 맞춰 서버가 정한 값(만든 시각 등)과 다른 기기의 변화를 받는다
        void pull();
      }
      return result;
      },
      { sent: 0, rejected: [], remaining: queue.length, stopped: "busy" as const },
    ).then((result) => {
      flushing = null;
      if (result.stopped === "busy") scheduleFlush(3000); // 다른 탭이 보내는 중: 조금 뒤에 다시 본다
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
          if (!res.ok) {
            if (res.error === "unauthenticated") {
              authLost = true;
              emitState();
            }
            return res;
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
   * 이미 서버 사본을 받은 기기에서는 부르지 않는다(기기에 있는 것이 더 새것일 수 있다).
   */
  function applySnapshot(snapshot: MirrorSnapshot): void {
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
  /** 보낼 줄·로그인 상태가 바뀔 때 알림(동기화 상태 표시용) */
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
    base = change(base);
    rebuildView();
    persistBaseSoon();
    emit();
  }

  async function wipe(): Promise<void> {
    stopped = true;
    wiped = true;
    if (retryHandle !== null) clearTimer(retryHandle);
    if (persistHandle !== null) clearTimer(persistHandle);
    queue = [];
    base = emptyMirror();
    view = base;
    await wipeUser(kv, userKey);
    emit();
    emitState();
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
    wipeOthers: () => wipeOtherUsers(kv, userKey),
    /** 지금 화면이 볼 거울(서버 거울에 보낼 줄을 입힌 것) */
    getMirror: (): Mirror => view,
    /** 아직 서버에 못 보낸 쓰기 수 */
    pendingCount: () => queue.length,
    pendingKinds: () => queue.map((q) => q.op.kind),
    /** 아직 서버에 없는 할 일(보낼 줄에 「적기」가 남은 것)인가 */
    hasPendingAdd: (todoId: string) => queue.some((q) => q.op.kind === "todo.add" && q.op.id === todoId),
    pendingOps: (): QueuedOp[] => [...queue],
    isAuthLost: () => authLost,
    isPersistent: () => kv.persistent,
    isOnline,
    now,
    stop: () => {
      stopped = true;
      if (retryHandle !== null) clearTimer(retryHandle);
    },
    /** 멈췄던 보내기·받기를 다시 한다(연결이 돌아왔거나 화면이 다시 보일 때) */
    resume: () => {
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
