import type { AddCategoryResult } from "../categories/types";
import type { TodayRead } from "../today-types";
import { readTodayFromMirror, type LocalApis } from "./apis";
import { clearDeviceHint } from "./device-hint";
import type { Runtime } from "./runtime";

/**
 * 기기 먼저 저장(고침 3바퀴)에서 할 일 화면이 쓰는 것. 있으면 화면은 서버 왕복을 기다리지 않는다:
 * 적기·끝냄·분야 더하기는 기기 거울에 먼저 반영되어 바로 보이고(저장 중·연결 대기 줄이 따로 없다), 서버에는 보낼 줄이 뒤에서 보낸다.
 * 목록은 기기 거울에서 읽고, 서버 것은 뒤에서 받아 맞춘다. 없으면 예전 방식(서버에 직접 쓰고 읽는다) 그대로다.
 */
export type LocalTodos = {
  /** 기기 거울에서 읽은 오늘 화면(할 일 + 분야) */
  read(): TodayRead;
  /** 거울이 바뀔 때마다 부른다(내가 쓴 것·서버에서 받아 맞춘 것·거절돼 되돌린 것 모두) */
  subscribe(listener: () => void): () => void;
  /** 보낼 줄·로그인 상태가 바뀔 때 부른다 */
  subscribeState(listener: () => void): () => void;
  addTodo(input: { id: string; text: string; categoryId: string | null }): void;
  setDone(id: string, done: boolean): void;
  addCategory(id: string, name: string): Promise<AddCategoryResult>;
  /** 보낼 줄을 보내고 서버 것을 받아 맞추기를 시작한다(기다리지 않는다) */
  refresh(): void;
  /** 로그인이 풀려 서버에 보내지 못하고 있는가 */
  isAuthLost(): boolean;
  /** 아직 서버가 받지 않은 「적기」의 할 일 번호들(보낼 줄에 todo.add가 남은 것) — 줄에 「저장 대기」 원을 그린다(고침10, Figma 128:87) */
  pendingAddIds(): ReadonlySet<string>;
  /** 로그아웃 직전: 기기의 보낼 줄(다른 탭 것 포함)을 서버에 보내 보고(최대 limitMs), 기기에 남은 못 보낸 쓰기 수를 돌려준다 */
  flushBeforeSignOut(): Promise<number>;
  /** 로그아웃: 이 사용자의 기기 저장소(거울·보낼 줄·고른 값·받지 않은 쓰기 보관)를 지우고 다른 탭에 알린다 */
  discard(): Promise<void>;
};

/** 로그아웃 직전에 보낼 줄을 서버에 보내 보며 기다리는 시간 상한(밀리초, 임시) */
export const SIGN_OUT_FLUSH_LIMIT_MS = 6000;

export function createLocalTodos(runtime: Runtime, apis: LocalApis): LocalTodos {
  return {
    read: () => readTodayFromMirror(runtime),
    subscribe: runtime.subscribe,
    subscribeState: runtime.subscribeState,
    addTodo: ({ id, text, categoryId }) => {
      runtime.enqueue({ kind: "todo.add", id, text, categoryId });
    },
    setDone: (id, done) => {
      runtime.enqueue({ kind: "todo.done", id, done });
    },
    addCategory: (id, name) => apis.settings.addCategory(id, name),
    refresh: () => {
      void runtime.flush();
      void runtime.pull();
    },
    isAuthLost: runtime.isAuthLost,
    pendingAddIds: () => new Set(runtime.pendingOps().flatMap((q) => (q.op.kind === "todo.add" ? [q.op.id] : []))),
    flushBeforeSignOut: async () => {
      // 다른 탭이 적어 둔 보낼 줄도 함께 보내 보고, 못 보낸 수는 기기 저장소의 이 사용자 줄 칸으로 센다(F1: 로그아웃이 다른 탭의 줄까지 지운다)
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = (async () => {
        await runtime.adoptStoredQueue();
        await runtime.flush();
      })();
      await Promise.race([work, new Promise((resolve) => (timer = setTimeout(resolve, SIGN_OUT_FLUSH_LIMIT_MS)))]);
      clearTimeout(timer);
      return runtime.storedPendingCount();
    },
    discard: () => {
      clearDeviceHint(); // 이 기기에 거울이 없어졌다: 다음에 열 때 서버가 사본을 한 번 실어 보낸다
      // 같은 기기의 다른 탭에도 알려 그 탭들이 자기 것을 지우고 멈추게 한다(S1)
      return runtime.wipe({ broadcast: true });
    },
  };
}
