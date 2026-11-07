/**
 * 기기 저장소(고침 3바퀴, 기기 먼저 저장). 새 패키지 없이 브라우저 IndexedDB 하나에 열쇠-값으로 둔다.
 * 사용자마다 열쇠 머리를 나눈다(`base/<사용자 번호>`, `op/<사용자 번호>/<줄 순서>`). 다른 사용자의 것은 읽지도 쓰지도 않는다.
 * 저장소를 못 쓰면(시크릿 창·막힘·가득 참) createIdbKv가 null을 돌려주고, 앱은 기기에 남기지 않는 메모리 저장소로 돈다(새로고침하면 사라진다).
 * 값은 구조 복제(structured clone)로 들어가므로 평범한 객체·배열·문자열·숫자만 둔다.
 */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** 머리가 같은 열쇠들(사전순) */
  keys(prefix: string): Promise<string[]>;
  /** 이 저장소가 기기에 남는가(메모리 저장소는 false) */
  readonly persistent: boolean;
}

export function createMemoryKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    persistent: false,
    async get<T>(key: string) {
      return map.has(key) ? (structuredClone(map.get(key)) as T) : undefined;
    },
    async set(key, value) {
      map.set(key, structuredClone(value));
    },
    async delete(key) {
      map.delete(key);
    },
    async keys(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

const DB_NAME = "duno-local";
const STORE = "kv";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb transaction aborted"));
  });
}

/** IndexedDB 저장소. indexedDB가 없으면(서버 렌더·오래된 브라우저) null */
export function createIdbKv(name: string = DB_NAME): KvStore | null {
  if (typeof indexedDB === "undefined") return null;
  let opened: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close(); // 다른 탭이 판을 올리면 닫아 준다
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("indexeddb open failed"));
      req.onblocked = () => reject(new Error("indexeddb blocked"));
    }).catch((error) => {
      opened = null; // 다음에 다시 열어 본다
      throw error;
    });
    return opened;
  };
  return {
    persistent: true,
    async get<T>(key: string) {
      const db = await open();
      const tx = db.transaction(STORE, "readonly");
      const value = await request<T | undefined>(tx.objectStore(STORE).get(key) as IDBRequest<T | undefined>);
      return value;
    },
    async set(key, value) {
      const db = await open();
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      await done(tx);
    },
    async delete(key) {
      const db = await open();
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      await done(tx);
    },
    async keys(prefix) {
      const db = await open();
      const tx = db.transaction(STORE, "readonly");
      const range = IDBKeyRange.bound(prefix, prefix + "￿");
      const keys = await request<IDBValidKey[]>(tx.objectStore(STORE).getAllKeys(range));
      return keys.filter((k): k is string => typeof k === "string").sort();
    },
  };
}

/** 열쇠 모양: 사용자마다 머리를 나눈다 */
export const kvKeys = {
  base: (userKey: string) => `base/${userKey}`,
  opPrefix: (userKey: string) => `op/${userKey}/`,
  op: (userKey: string, opKey: string) => `op/${userKey}/${opKey}`,
  /** 이 기기에 마지막으로 로그인한 사용자(다른 사용자가 로그인하면 이전 사용자의 것을 지운다) */
  lastUser: "meta/lastUser",
} as const;

/** 이 사용자 것이 아닌 기기 저장소 항목을 모두 지운다(로그인 직후, 다른 계정의 글이 남지 않게). 실패는 조용히 넘긴다 */
export async function wipeOtherUsers(kv: KvStore, userKey: string): Promise<void> {
  try {
    for (const prefix of ["base/", "op/"]) {
      for (const key of await kv.keys(prefix)) {
        const owner = key.slice(prefix.length).split("/")[0];
        if (owner !== userKey) await kv.delete(key);
      }
    }
  } catch {
    // 지우지 못해도 앱은 그대로 돈다(내 열쇠만 읽는다)
  }
}

/** 이 사용자 것을 모두 지운다(로그아웃 때) */
export async function wipeUser(kv: KvStore, userKey: string): Promise<void> {
  try {
    await kv.delete(kvKeys.base(userKey));
    for (const key of await kv.keys(kvKeys.opPrefix(userKey))) await kv.delete(key);
  } catch {
    // 조용히 둔다
  }
}
