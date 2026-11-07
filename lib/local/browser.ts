import { createOutbox, clearAllOutboxes, safeLocalStorage } from "../outbox";
import { createRuntime, type Runtime } from "./runtime";
import { fetchMirrorSnapshot, sendToServer } from "./sender";

/**
 * 브라우저에서 기기 먼저 저장을 켜는 길(고침 3바퀴). 운영 장치를 만들고, 연결·화면 보임·닫힘 같은 브라우저 사건에 보내기·받기를 묶는다.
 * 서버 렌더에서는 부르지 않는다(IndexedDB가 없다).
 */

export function createBrowserRuntime(userKey: string): Runtime {
  return createRuntime({ userKey, send: sendToServer, fetchSnapshot: fetchMirrorSnapshot });
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
