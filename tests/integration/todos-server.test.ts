import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTodoForToday, listTodosForToday, setTodoDoneForUser } from "../../lib/todos/core";
import { decryptTodoText, parseTodoKey, type TodoKey } from "../../lib/todos/crypto";
import { cleanupTodos } from "./cleanup";
import { loadIntegrationEnv } from "./load-env";

/**
 * 서버 할 일 함수(core)를 duno_dev에 대고 돌린다. 클라이언트는 publishable 키, 암호화 키는 시험 안에서 무작위.
 * 진짜 TODO_ENCRYPTION_KEY는 쓰지 않는다. 날짜는 서버 시계를 2000-01-01(서울)로 고정해 실제 기록과 섞이지 않게 한다.
 * 이번 실행에서 만든 행만 afterAll에서 각 계정으로 지운다.
 */

const NOW = new Date("2000-01-01T12:00:00+09:00");
const now = () => NOW;

let a: SupabaseClient;
let b: SupabaseClient;
let aId = "";
let bId = "";
let key: TodoKey;
const createdByA: string[] = [];
const createdByB: string[] = [];

function newClient(url: string, publishableKey: string): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signIn(client: SupabaseClient, email: string, password: string, label: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(`${label} 로그인 실패 (status=${error?.status ?? "?"}, code=${error?.code ?? "?"})`);
  }
  return data.user.id;
}

beforeAll(async () => {
  const env = loadIntegrationEnv();
  a = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  b = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  aId = await signIn(a, env.DUNO_TEST_A_EMAIL, env.DUNO_TEST_A_PASSWORD, "A");
  bId = await signIn(b, env.DUNO_TEST_B_EMAIL, env.DUNO_TEST_B_PASSWORD, "B");
  key = parseTodoKey(randomBytes(32).toString("base64"))!;
});

afterAll(async () => {
  await cleanupTodos([
    { label: "A", client: a, ids: createdByA },
    { label: "B", client: b, ids: createdByB },
  ]);
});

describe("서버 할 일 함수 (duno_dev)", () => {
  it("저장 → 암호문만 → 풀기 → 다른 키 실패 → B 못 읽음 → 체크 → 재시도·겹침", async () => {
    expect(aId).toBeTruthy();
    expect(bId).toBeTruthy();
    expect(aId).not.toBe(bId);

    // 0. 표가 있는지 먼저 본다. core는 DB 오류 원문을 감추므로, 실패 이유(예: PGRST205 표 없음)를 여기서 드러낸다.
    const probe = await a.from("todos").select("id").limit(0);
    expect(probe.error).toBeNull();

    const plain = `duno-it ${randomUUID()} 고유한 글`;
    const id = randomUUID();
    createdByA.push(id); // 실패해도 정리되게 먼저 넣는다

    // 1. A가 core 함수로 저장
    const added = await createTodoForToday({ supabase: a, key, now }, id, plain);
    expect(added).toMatchObject({ ok: true, data: { day: { date: "2000-01-01" }, todo: { id, text: plain } } });

    // 2. A 클라이언트로 행을 그대로 읽기: 평문·base64·base64url·hex가 없다
    const raw = await a.from("todos").select("user_id, day, text_encrypted").eq("id", id);
    expect(raw.error).toBeNull();
    expect(raw.data).toHaveLength(1);
    const stored = raw.data![0];
    expect(stored.user_id).toBe(aId);
    expect(stored.day).toBe("2000-01-01");
    const bytes = Buffer.from(plain, "utf8");
    for (const leak of [plain, bytes.toString("base64"), bytes.toString("base64url"), bytes.toString("hex")]) {
      expect(stored.text_encrypted).not.toContain(leak);
    }
    expect(stored.text_encrypted.toLowerCase()).not.toContain(bytes.toString("hex"));

    // 3. 모듈로 풀면 원래 글, 다른 키·다른 소유자로는 실패
    expect(decryptTodoText(stored.text_encrypted, aId, key)).toEqual({ ok: true, text: plain });
    const otherKey = parseTodoKey(randomBytes(32).toString("base64"))!;
    expect(decryptTodoText(stored.text_encrypted, aId, otherKey)).toEqual({ ok: false });
    expect(decryptTodoText(stored.text_encrypted, bId, key)).toEqual({ ok: false });

    // 4. A 오늘 목록에 보이고, B는 그 행을 못 읽는다
    const listA = await listTodosForToday({ supabase: a, key, now });
    expect(listA.ok && listA.data.todos.some((t) => t.id === id && t.text === plain)).toBe(true);
    const rawB = await b.from("todos").select("id").eq("id", id);
    expect(rawB.error).toBeNull();
    expect(rawB.data).toHaveLength(0);
    const listB = await listTodosForToday({ supabase: b, key, now });
    expect(listB.ok && listB.data.todos.some((t) => t.id === id)).toBe(false);

    // 5. 끝냄 체크: A는 되고, B의 시도는 not_found(0행), A 행 그대로
    expect(await setTodoDoneForUser({ supabase: a }, id, true)).toEqual({ ok: true, data: { id, done: true } });
    expect(await setTodoDoneForUser({ supabase: a }, id, true)).toEqual({ ok: true, data: { id, done: true } });
    expect(await setTodoDoneForUser({ supabase: b }, id, false)).toEqual({ ok: false, error: "not_found" });
    const afterB = await a.from("todos").select("done").eq("id", id);
    expect(afterB.data).toEqual([{ done: true }]);

    // 6. 같은 id로 다시 적기(D4): 행 하나, 성공
    const retried = await createTodoForToday({ supabase: a, key, now }, id, "다시 보낸 글");
    expect(retried).toMatchObject({ ok: true, data: { todo: { id, text: plain } } });
    const count = await a.from("todos").select("id").eq("id", id);
    expect(count.data).toHaveLength(1);

    // 7. B가 A의 id로 적기: conflict, A 행 그대로
    const stolen = await createTodoForToday({ supabase: b, key, now }, id, "B의 글");
    expect(stolen).toEqual({ ok: false, error: "conflict" });
    const stillA = await a.from("todos").select("user_id, text_encrypted, done").eq("id", id);
    expect(stillA.data).toEqual([{ user_id: aId, text_encrypted: stored.text_encrypted, done: true }]);
  });
});
