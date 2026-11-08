/**
 * 기기 저장소(고침 3바퀴, 기기 먼저 저장). 새 패키지 없이 브라우저 IndexedDB 하나에 열쇠-값으로 둔다.
 * 사용자마다 열쇠 머리를 나눈다(`base/<사용자 번호>`, `op/<사용자 번호>/<줄 순서>`, `pref/`·`sent/`·`rej/` 같은 꼴). 다른 사용자의 것은 읽지도 쓰지도 않는다.
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
        // 다른 탭이 판을 올리면 닫아 주고, 열어 둔 것을 비워 다음 읽기·쓰기가 다시 열게 한다(닫힌 DB를 계속 쓰면 그 뒤 모두 실패한다)
        db.onversionchange = () => {
          db.close();
          opened = null;
        };
        // 브라우저가 DB를 닫았을 때(저장소 지움 등)도 다시 연다
        db.onclose = () => {
          opened = null;
        };
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
  /** 화면이 기억하는 고른 값(상태보기 기간·보기 방식 등). 사용자마다 나뉘고 로그아웃·다른 사용자 로그인 때 함께 지워진다 */
  pref: (userKey: string, name: string) => `pref/${userKey}/${name}`,
  prefPrefix: (userKey: string) => `pref/${userKey}/`,
  /**
   * 「보냈다」는 표시(비석, 고침 4바퀴). 보낸 탭이 줄 칸을 지우기 전에 남긴다. 다른 탭은 줄 칸이 저장소에 없고 이 표시가 있을 때만
   * 「다른 탭이 보냈다」로 보고 건너뛴다. 표시가 없으면 보낸다(서버가 같은 id는 한 번만 받는다). 값은 남긴 때(ms). 하루가 지나면 지운다
   */
  sent: (userKey: string, opKey: string) => `sent/${userKey}/${opKey}`,
  sentPrefix: (userKey: string) => `sent/${userKey}/`,
  /** 서버가 받지 않은 쓰기의 내용(고침 4바퀴). 화면에서 보고 복사할 수 있게 남긴다. 사용자가 지우거나 로그아웃·다른 사용자 로그인 때 지운다 */
  rejected: (userKey: string, opKey: string) => `rej/${userKey}/${opKey}`,
  rejectedPrefix: (userKey: string) => `rej/${userKey}/`,
  /** 이 기기에 마지막으로 로그인한 사용자(다른 사용자가 로그인하면 이전 사용자의 것을 지운다) */
  lastUser: "meta/lastUser",
} as const;

/** 사용자마다 나뉜 열쇠 머리들(지울 때 모두 본다) */
export const USER_PREFIXES = ["base/", "op/", "pref/", "sent/", "rej/"] as const;

/** 이 사용자 것이 아닌 기기 저장소 항목을 모두 지운다(로그인 직후, 다른 계정의 글이 남지 않게). 실패는 조용히 넘긴다 */
export async function wipeOtherUsers(kv: KvStore, userKey: string): Promise<void> {
  try {
    for (const prefix of USER_PREFIXES) {
      for (const key of await kv.keys(prefix)) {
        const owner = key.slice(prefix.length).split("/")[0];
        if (owner !== userKey) await kv.delete(key);
      }
    }
  } catch {
    // 지우지 못해도 앱은 그대로 돈다(내 열쇠만 읽는다)
  }
}

/** 이 사용자 것을 모두 지운다(로그아웃 때: 거울·보낼 줄·고른 값·보냈다는 표시·받지 않은 쓰기 보관) */
export async function wipeUser(kv: KvStore, userKey: string): Promise<void> {
  try {
    await kv.delete(kvKeys.base(userKey));
    for (const prefix of USER_PREFIXES) {
      if (prefix === "base/") continue;
      for (const key of await kv.keys(`${prefix}${userKey}/`)) await kv.delete(key);
    }
  } catch {
    // 조용히 둔다
  }
}
