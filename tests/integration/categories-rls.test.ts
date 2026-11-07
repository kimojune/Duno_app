import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTodos } from "./cleanup";
import { loadIntegrationEnv } from "./load-env";

/**
 * categories 표와 todos.category_id의 RLS·grant·check 제약·복합 외래 키를 duno_dev에 대고 행동으로 확인한다
 * (마이그레이션 20261106003000_categories.sql). 악용 시나리오 1·2·3·4·7·8.
 * 아직 밤에는 돌리지 않는다(새 표가 개발 DB에 없다). 마이그레이션을 적용한 뒤 npm run test:rls로 돈다.
 *
 * - 클라이언트는 모두 publishable 키다(secret 키는 쓰지 않는다). 암호문 값은 형식만 맞춘 무작위 바이트다.
 * - 분야는 지우는 권한이 없어(grant 없음) 시험이 지울 수 없다. 그래서 계정마다 「시험 기준 분야」 하나를 처음 한 번만 만들고
 *   다음 실행부터는 그것을 다시 쓴다. 실행마다 새로 남는 분야는 A의 「512자 통과」 행 하나뿐이다(인계에 적음).
 *   쌓인 시험 분야는 사람이 SQL 편집기에서 지운다(앱·시험 키로는 못 지운다). 분야를 가리키는 시험 할 일이 남아 있으면
 *   외래 키(restrict)가 막으므로 그 할 일부터 지운다(보통은 afterAll의 cleanupTodos가 이미 지웠다):
 *     delete from public.todos where user_id in (<A id>, <B id>) and day = '2000-01-01' and category_id is not null;
 *     delete from public.categories where user_id in (<A id>, <B id>);
 * - 할 일 행은 이번 실행에서 만든 id만 모아 afterAll에서 각 계정으로 지운다.
 * - 양성 대조(A는 자기 분야가 보인다)를 먼저 단언하고, 그 뒤에 「0행」을 통과로 삼는다.
 */

const TEST_DAY = "2000-01-01"; // 실제 기록과 섞이지 않게 옛 날짜
const MAX_LEN = 512; // 마이그레이션의 임시 상한과 같다
const COLS = "id, user_id, name_encrypted, archived_at, created_at";

const b64url = (bytes: Buffer) => bytes.toString("base64url");

/** v1:<iv 16자>:<암호문>:<태그 22자>. ctChars를 주면 암호문 조각을 그 길이로 맞춘다. */
function fakeCiphertext(ctChars?: number): string {
  const iv = b64url(randomBytes(12));
  const tag = b64url(randomBytes(16));
  const ct = ctChars === undefined ? b64url(randomBytes(24)) : b64url(randomBytes(ctChars)).slice(0, ctChars);
  return `v1:${iv}:${ct}:${tag}`;
}

function fakeCiphertextOfLength(len: number): string {
  const overhead = "v1:".length + 16 + 1 + 1 + 22;
  const value = fakeCiphertext(len - overhead);
  expect(value.length).toBe(len);
  return value;
}

function newClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

type CategoryRow = { id: string; user_id: string; name_encrypted: string; archived_at: string | null; created_at: string };

let a: SupabaseClient;
let b: SupabaseClient;
let anon: SupabaseClient;
let aId = "";
let bId = "";
let aCat: CategoryRow;
let bCat: CategoryRow;
const todosByA: string[] = [];
const todosByB: string[] = [];

async function signIn(client: SupabaseClient, email: string, password: string, label: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`${label} 로그인 실패 (status=${error?.status ?? "?"}, code=${error?.code ?? "?"})`);
  return data.user.id;
}

/** 계정의 시험 기준 분야: 가장 먼저 만든 자기 분야를 다시 쓰고, 없으면 하나 만든다. */
async function baseCategory(client: SupabaseClient, label: string): Promise<CategoryRow> {
  const found = await client.from("categories").select(COLS).order("created_at", { ascending: true }).limit(1);
  if (found.error) throw new Error(`${label} 분야 읽기 실패 (code=${found.error.code ?? "?"})`); // 표가 없으면 여기서 멈춘다
  const first = (found.data ?? [])[0] as CategoryRow | undefined;
  if (first) return first;
  const made = await client.from("categories").insert({ name_encrypted: fakeCiphertext() }).select(COLS);
  if (made.error || !made.data?.[0]) throw new Error(`${label} 기준 분야 만들기 실패 (code=${made.error?.code ?? "?"})`);
  return made.data[0] as CategoryRow;
}

async function readCategory(client: SupabaseClient, id: string): Promise<CategoryRow[]> {
  const { data, error } = await client.from("categories").select(COLS).eq("id", id);
  expect(error).toBeNull();
  return (data ?? []) as CategoryRow[];
}

/** 할 일 insert. 생긴 행은 주인별 정리 목록에 넣는다(거절돼야 할 insert가 통과해도 지울 수 있게). */
async function insertTodo(client: SupabaseClient, values: Record<string, unknown>) {
  const res = await client.from("todos").insert(values).select("id, user_id, category_id");
  for (const r of (res.data ?? []) as { id: string; user_id: string }[]) {
    if (r.user_id === aId) todosByA.push(r.id);
    else if (r.user_id === bId) todosByB.push(r.id);
  }
  return res;
}

beforeAll(async () => {
  const env = loadIntegrationEnv();
  a = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  b = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  anon = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  aId = await signIn(a, env.DUNO_TEST_A_EMAIL, env.DUNO_TEST_A_PASSWORD, "A");
  bId = await signIn(b, env.DUNO_TEST_B_EMAIL, env.DUNO_TEST_B_PASSWORD, "B");
  aCat = await baseCategory(a, "A");
  bCat = await baseCategory(b, "B");
});

afterAll(async () => {
  await cleanupTodos([
    { label: "A", client: a, ids: todosByA },
    { label: "B", client: b, ids: todosByB },
  ]);
});

describe("가드와 양성 대조", () => {
  it("A와 B는 서로 다른 사용자이고, 기준 분야는 각자 것이다", () => {
    expect(aId).toBeTruthy();
    expect(bId).toBeTruthy();
    expect(aId).not.toBe(bId);
    expect(aCat.user_id).toBe(aId);
    expect(bCat.user_id).toBe(bId);
    expect(aCat.archived_at).toBeNull();
  });

  it("A는 자기 분야를 읽는다", async () => {
    const rows = await readCategory(a, aCat.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(aId);
  });

  it("B는 자기 분야를 읽는다", async () => {
    expect(await readCategory(b, bCat.id)).toHaveLength(1);
  });

  it("A는 자기 분야 번호로 할 일을 적을 수 있다(정상 insert 통과, category_id grant)", async () => {
    const { data, error } = await insertTodo(a, { day: TEST_DAY, text_encrypted: fakeCiphertext(), category_id: aCat.id });
    expect(error).toBeNull();
    expect(data).toEqual([expect.objectContaining({ user_id: aId, category_id: aCat.id })]);
  });

  it("분야 번호 없이 적으면 category_id는 null(기타)", async () => {
    const { data, error } = await insertTodo(a, { day: TEST_DAY, text_encrypted: fakeCiphertext() });
    expect(error).toBeNull();
    expect(data).toEqual([expect.objectContaining({ category_id: null })]);
  });
});

describe("악용 2: A가 B의 분야 이름을 보지 못한다", () => {
  it("A 토큰으로 B의 분야 id를 eq로 읽으면 0행, 전체 목록에도 없다", async () => {
    expect(await readCategory(a, aCat.id)).toHaveLength(1); // 양성 대조를 같은 시험 안에서 다시
    expect(await readCategory(a, bCat.id)).toHaveLength(0);
    const { data, error } = await a.from("categories").select("id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).not.toContain(bCat.id);
  });
});

describe("악용 3: 남의 분야로 할 일 적기", () => {
  it("REST로 직접 category_id = B의 분야로 넣으면 외래 키가 거절(23503), 행이 생기지 않는다", async () => {
    const value = fakeCiphertext();
    const { error } = await a.from("todos").insert({ day: TEST_DAY, text_encrypted: value, category_id: bCat.id });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
    const left = await a.from("todos").select("id, user_id").eq("text_encrypted", value);
    for (const r of (left.data ?? []) as { id: string; user_id: string }[]) todosByA.push(r.id);
    expect(left.data).toHaveLength(0);
  });

  it("없는 분야 번호도 거절(23503)", async () => {
    const { error } = await a
      .from("todos")
      .insert({ day: TEST_DAY, text_encrypted: fakeCiphertext(), category_id: "00000000-0000-4000-8000-000000000000" });
    expect(error?.code).toBe("23503");
  });

  it("user_id = B, category_id = B의 분야로 넣어도 WITH CHECK가 거절", async () => {
    const { error } = await a
      .from("todos")
      .insert({ user_id: bId, day: TEST_DAY, text_encrypted: fakeCiphertext(), category_id: bCat.id });
    expect(error).not.toBeNull();
  });
});

describe("악용 4: B 이름으로 분야 만들기", () => {
  it("user_id = B로 넣으면 거절(WITH CHECK), B 쪽에도 행이 없다", async () => {
    const value = fakeCiphertext();
    // RETURNING 없이 보낸다(select 정책 때문이 아니라 WITH CHECK가 거절했는지 보려고)
    const { error } = await a.from("categories").insert({ user_id: bId, name_encrypted: value });
    expect(error).not.toBeNull();
    const { data, error: readError } = await b.from("categories").select("id").eq("name_encrypted", value);
    expect(readError).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("archived_at·created_at은 넣지 못한다(grant 밖 열)", async () => {
    const archived = await a
      .from("categories")
      .insert({ name_encrypted: fakeCiphertext(), archived_at: "2000-01-01T00:00:00Z" });
    expect(archived.error).not.toBeNull();
    const created = await a.from("categories").insert({ name_encrypted: fakeCiphertext(), created_at: "2000-01-01T00:00:00Z" });
    expect(created.error).not.toBeNull();
  });
});

describe("악용 1: 로그인 안 한 publishable 클라이언트(anon)", () => {
  it("select는 거절이거나 빈 결과(A·B 분야가 있는데도)", async () => {
    expect(await readCategory(a, aCat.id)).toHaveLength(1); // 양성 대조
    const { data, error } = await anon.from("categories").select("id").in("id", [aCat.id, bCat.id]);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("insert는 거절", async () => {
    const { data, error } = await anon.from("categories").insert({ user_id: aId, name_encrypted: fakeCiphertext() }).select("id");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

describe("악용 7: 평문 이름 직접 넣기 (형식·길이 check, 임시 512자)", () => {
  it("평문은 거절(23514)", async () => {
    const { error } = await a.from("categories").insert({ name_encrypted: "취업 준비" });
    expect(error?.code).toBe("23514");
  });

  it("판 번호 접두만 빠진 값은 거절", async () => {
    const { error } = await a.from("categories").insert({ name_encrypted: fakeCiphertext().slice("v1".length) });
    expect(error).not.toBeNull();
  });

  it("상한을 넘는 정상 모양 값(513자)은 거절", async () => {
    const { error } = await a.from("categories").insert({ name_encrypted: fakeCiphertextOfLength(MAX_LEN + 1) });
    expect(error).not.toBeNull();
  });

  it("상한 딱 맞는 정상 값(512자)은 통과, user_id를 빼도 자기 것·보관 안 함으로 들어간다 (실행마다 한 행 남음)", async () => {
    const { data, error } = await a.from("categories").insert({ name_encrypted: fakeCiphertextOfLength(MAX_LEN) }).select(COLS);
    expect(error, "상한(50)에 닿았으면 시험 분야를 정리한 뒤 다시 돈다").toBeNull();
    expect(data).toHaveLength(1);
    expect((data as CategoryRow[])[0]).toMatchObject({ user_id: aId, archived_at: null });
  });
});

describe("악용 8: 분야 지우기·이름 바꾸기, 할 일 분야 바꾸기 (grant 없음)", () => {
  it("자기 분야 update(이름·보관)는 거절, 다시 읽으면 그대로", async () => {
    const rename = await a.from("categories").update({ name_encrypted: fakeCiphertext() }).eq("id", aCat.id).select("id");
    expect(rename.error).not.toBeNull();
    expect(rename.error?.code).toBe("42501");
    const archive = await a.from("categories").update({ archived_at: new Date().toISOString() }).eq("id", aCat.id).select("id");
    expect(archive.error).not.toBeNull();
    const rows = await readCategory(a, aCat.id);
    expect(rows).toEqual([aCat]);
  });

  it("자기 분야 delete는 거절, 남아 있다", async () => {
    const { error } = await a.from("categories").delete().eq("id", aCat.id).select("id");
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(await readCategory(a, aCat.id)).toHaveLength(1);
  });

  it("B의 분야 update·delete 시도: 거절이거나 0행, B 쪽에서 다시 읽으면 그대로", async () => {
    const up = await a.from("categories").update({ name_encrypted: fakeCiphertext() }).eq("id", bCat.id).select("id");
    expect(up.error !== null || (up.data ?? []).length === 0).toBe(true);
    const del = await a.from("categories").delete().eq("id", bCat.id).select("id");
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
    expect(await readCategory(b, bCat.id)).toEqual([bCat]);
  });

  // 원샷 v2 0번(20261107100000_todo_manage.sql)이 todos.category_id update 권한을 열었다. 옛 시험
  // 「할 일의 category_id update는 거절(update는 done만)」은 새 계약에 맞춰 바꿨다: 내 분야로는 되고, 남의 분야로는
  // 복합 외래 키(todos_category_owner_fkey)가 막는다. 이 시험은 DB가 필요해 아직 돌리지 못했다.
  it("할 일의 category_id update: 내 분야로는 바뀌고 기타(null)로 돌릴 수 있으며, 남의 분야로는 거절", async () => {
    const made = await insertTodo(a, { day: TEST_DAY, text_encrypted: fakeCiphertext() });
    expect(made.error).toBeNull();
    const todoId = (made.data as { id: string }[])[0].id;
    const own = await a.from("todos").update({ category_id: aCat.id }).eq("id", todoId).select("id, category_id");
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ id: todoId, category_id: aCat.id }]);
    const foreign = await a.from("todos").update({ category_id: bCat.id }).eq("id", todoId).select("id");
    expect(foreign.error).not.toBeNull();
    expect(foreign.error?.code).toBe("23503"); // 외래 키: (category_id, user_id)가 남의 분야를 가리킬 수 없다
    const again = await a.from("todos").select("category_id").eq("id", todoId);
    expect(again.data).toEqual([{ category_id: aCat.id }]);
    const unset = await a.from("todos").update({ category_id: null }).eq("id", todoId).select("id, category_id");
    expect(unset.error).toBeNull();
    expect(unset.data).toEqual([{ id: todoId, category_id: null }]);
    // 정상 대조: done은 여전히 바꿀 수 있고, day는 여전히 못 바꾼다
    const done = await a.from("todos").update({ done: true }).eq("id", todoId).select("id, done");
    expect(done.error).toBeNull();
    expect(done.data).toEqual([{ id: todoId, done: true }]);
    const day = await a.from("todos").update({ day: "2000-01-02" }).eq("id", todoId).select("id");
    expect(day.error?.code).toBe("42501");
  });
});
