import { z } from "zod";

/**
 * 오프라인 입력 보관함(PRD 10절 「오프라인에서도 입력하고 저장할 수 있어야 한다」, 이번 범위는 할 일 적기만).
 * 방법(새 패키지 없이 브라우저 기능): 서버에 아직 못 올린 할 일(저장 중·실패·연결 대기)을 기기 localStorage에 사용자별로 두었다가,
 * 연결이 돌아오면 같은 id로 다시 보낸다(서버가 같은 id는 한 번만 만든다). 올라가면 지운다. 로그아웃하면 지운다.
 * 기기에는 글이 평문으로 잠깐 남는다(서버에는 암호화해 둔다). 옛 판은 저장 전 글을 기기에 두지 않았다(D6): PRD 10절이 이를 바꿨다(임시값 목록 참고).
 * 저장소를 못 쓰면(막힘·가득 참) 조용히 건너뛴다: 앱은 보관함 없이 옛 방식대로 돈다. 던지지 않는다.
 */

export type OutboxItem = {
  /** 할 일 id(화면이 만든 uuid, 재시도에 새 행을 만들지 않으려고) */
  id: string;
  text: string;
  /** 분야 번호(없으면 기타) */
  categoryId: string | null;
  /** 적은 때(기기 시계, ISO). 서버는 최근 72시간 안이면 이 때의 하루로 넣는다 */
  writtenAt: string;
};

export type Outbox = {
  load(): OutboxItem[];
  save(items: OutboxItem[]): void;
  clear(): void;
};

/** 보관함 하나가 둘 수 있는 최대 개수(임시). 넘으면 오래된 것부터 버리지 않고 새로 받지 않는 쪽이 안전하나, 화면이 이 수로 막는다 */
export const OUTBOX_MAX_ITEMS = 100;
const KEY_PREFIX = "duno.outbox.v1.";

const itemSchema = z.object({
  id: z.uuid(),
  text: z.string().min(1).max(2000),
  categoryId: z.uuid().nullable(),
  writtenAt: z.string().max(40),
});
const listSchema = z.array(z.unknown());

/** 쓸 수 있는 localStorage를 돌려준다(없거나 막혔으면 null). 서버 렌더에서는 항상 null */
export function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = window.localStorage;
    const probe = "duno.outbox.probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** 사용자별 보관함. userKey는 사용자 번호(화면에 내지 않는다). storage가 null이면 아무것도 안 하는 보관함 */
export function createOutbox(storage: Storage | null, userKey: string): Outbox {
  const key = KEY_PREFIX + userKey;
  return {
    load() {
      if (!storage) return [];
      try {
        const raw = storage.getItem(key);
        if (!raw) return [];
        const list = listSchema.safeParse(JSON.parse(raw));
        if (!list.success) return [];
        const items: OutboxItem[] = [];
        for (const entry of list.data) {
          const parsed = itemSchema.safeParse(entry);
          if (parsed.success && !items.some((i) => i.id === parsed.data.id)) items.push(parsed.data);
          if (items.length >= OUTBOX_MAX_ITEMS) break;
        }
        return items;
      } catch {
        return [];
      }
    },
    save(items) {
      if (!storage) return;
      try {
        if (items.length === 0) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(items.slice(0, OUTBOX_MAX_ITEMS)));
      } catch {
        // 저장소가 가득 찼거나 막혔다: 보관함 없이 돈다
      }
    },
    clear() {
      if (!storage) return;
      try {
        storage.removeItem(key);
      } catch {
        // 지우기 실패는 조용히 둔다
      }
    },
  };
}

/** 이 기기의 모든 사용자 보관함을 지운다(로그아웃·계정 바뀜 때 남의 글이 남지 않게) */
export function clearAllOutboxes(storage: Storage | null): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    // 조용히 둔다
  }
}
