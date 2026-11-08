import { createOutbox, clearAllOutboxes, safeLocalStorage } from "../outbox";
import { createRuntime, type LocalChannel, type ResetReason, type Runtime } from "./runtime";
import { createSender, createSnapshotFetcher } from "./sender";

/**
 * 브라우저에서 기기 먼저 저장을 켜는 길(고침 3바퀴). 운영 장치를 만들고, 연결·화면 보임·닫힘 같은 브라우저 사건에 보내기·받기를 묶는다.
 * 서버 렌더에서는 부르지 않는다(IndexedDB가 없다).
 * 고침 4바퀴: 보내기·받기에 이 장치의 사용자 번호를 싣고(서버가 세션 사용자와 다르면 거절), 같은 출처의 다른 탭과 BroadcastChannel로 잇는다.
 */

/** 같은 출처의 탭끼리 알림 통로 이름 */
export const LOCAL_CHANNEL_NAME = "duno-local";

/** BroadcastChannel을 운영 장치가 쓰는 모양으로 감싼다. 없으면(오래된 브라우저) null */
export function createBroadcastChannel(name: string = LOCAL_CHANNEL_NAME): (LocalChannel & { close(): void }) | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    const bc = new BroadcastChannel(name);
    return {
      post: (message) => {
        try {
          bc.postMessage(message);
        } catch {
          // 닫힌 통로: 조용히 둔다
        }
      },
      subscribe: (listener) => {
        const onMessage = (event: MessageEvent) => listener(event.data);
        bc.addEventListener("message", onMessage);
        return () => {
          bc.removeEventListener("message", onMessage);
          bc.close();
        };
      },
      close: () => bc.close(),
    };
  } catch {
    return null;
  }
}

export function createBrowserRuntime(userKey: string, onReset?: (reason: ResetReason) => void): Runtime {
  return createRuntime({
    userKey,
    send: createSender(userKey),
    fetchSnapshot: createSnapshotFetcher(userKey),
    channel: createBroadcastChannel(),
    onReset,
  });
}

/**
 * 연결이 돌아오면 보내고 받는다. 화면이 다시 보이면 받고(보낼 것이 있으면 보낸다), 가려지거나 닫히면 기기 저장소에 거울을 적어 둔다.
 * 처음 부르면 보낼 줄을 보내고 서버 것을 받는다(받기는 기다리지 않는다). 돌려주는 함수가 듣기를 거둔다.
 */
export function startBrowserSync(runtime: Runtime): () => void {
  const sync = () => {
    runtime.resume();
    void runtime.flush();
    void runtime.pull();
  };
  const onOnline = () => sync();
  const onVisibility = () => {
    if (document.visibilityState === "visible") sync();
    else void runtime.persistNow();
  };
  const onPageHide = () => void runtime.persistNow();
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);
  sync();
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/**
 * 고침 3바퀴 이전 판의 오프라인 보관함(localStorage, 할 일 적기만)에 남은 글을 새 보낼 줄로 옮기고 옛 보관함을 지운다.
 * 적은 때(writtenAt)를 그대로 가져가 하루가 바뀌지 않게 한다. 저장소를 못 쓰면 아무것도 안 한다.
 */
export function migrateLegacyOutbox(runtime: Runtime, userKey: string): number {
  const storage = safeLocalStorage();
  if (!storage) return 0;
  const items = createOutbox(storage, userKey).load();
  for (const item of items) {
    if (runtime.getMirror().todos.some((t) => t.id === item.id) || runtime.hasPendingAdd(item.id)) continue;
    runtime.enqueue({ kind: "todo.add", id: item.id, text: item.text, categoryId: item.categoryId }, item.writtenAt);
  }
  clearAllOutboxes(storage);
  return items.length;
}
