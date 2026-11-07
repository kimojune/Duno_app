import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTodos } from "./cleanup";
import { loadIntegrationEnv } from "./load-env";

/**
 * todos 표의 RLS·grant·check 제약을 duno_dev에 대고 행동으로 확인한다.
 * - 클라이언트는 모두 publishable 키다(secret 키는 쓰지 않는다).
 * - 이번 실행에서 만든 행 id만 모아 두고, afterAll에서 각 계정으로 지운다.
 * - 암호문 값은 진짜 할 일 글이 아니라 형식만 맞춘 무작위 바이트다.
 * - 행 수 상한(하루 200, 전체 10000)은 행을 대량으로 넣지 않으려고 여기서 시험하지 않는다(정적 확인).
 */

const TEST_DAY = "2000-01-01"; // 실제 기록과 섞이지 않게 옛 날짜에 둔다
const MAX_LEN = 4096; // 마이그레이션의 임시 상한과 같다

const b64url = (bytes: Buffer) => bytes.toString("base64url");

/** v1:<iv 16자>:<암호문>:<태그 22자>. ctChars를 주면 암호문 조각을 그 길이로 맞춘다. */
function fakeCiphertext(ctChars?: number): string {
  const iv = b64url(randomBytes(12));
  const tag = b64url(randomBytes(16));
  const ct =
    ctChars === undefined ? b64url(randomBytes(24)) : b64url(randomBytes(ctChars)).slice(0, ctChars);
  return `v1:${iv}:${ct}:${tag}`;
}

/** 전체 길이가 정확히 len인 정상 형식 값 */
function fakeCiphertextOfLength(len: number): string {
  const overhead = "v1:".length + 16 + 1 + 1 + 22;
  const value = fakeCiphertext(len - overhead);
  expect(value.length).toBe(len);
  return value;
}

function newClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type Row = { id: string; user_id: string; day: string; text_encrypted: string; done: boolean };

let a: SupabaseClient;
let b: SupabaseClient;
let anon: SupabaseClient;
let aId = "";
let bId = "";
let aRow: Row;
let bRow: Row;
const createdByA: string[] = [];
const createdByB: string[] = [];

async function signIn(client: SupabaseClient, email: string, password: string, label: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    // 이메일·비밀번호는 찍지 않는다
    throw new Error(`${label} 로그인 실패 (status=${error?.status ?? "?"}, code=${error?.code ?? "?"})`);
  }
  return data.user.id;
}

/** 이번 실행에서 생긴 행을 주인 목록에 넣는다(거절돼야 할 insert가 통과해도 지울 수 있게). */
function track(rows: { id: string; user_id: string }[] | null | undefined) {
  for (const r of rows ?? []) {
    if (r.user_id === aId) createdByA.push(r.id);
    else if (r.user_id === bId) createdByB.push(r.id);
  }
}

async function insertAs(client: SupabaseClient, values: Record<string, unknown>) {
  const res = await client.from("todos").insert(values).select("id, user_id, day, text_encrypted, done");
  track(res.data as Row[] | null);
  return res;
}

async function readById(client: SupabaseClient, id: string) {
  const { data, error } = await client.from("todos").select("id, user_id, day, text_encrypted, done").eq("id", id);
  expect(error).toBeNull();
  return (data ?? []) as Row[];
}

beforeAll(async () => {
  const env = loadIntegrationEnv();
  a = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  b = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  anon = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  aId = await signIn(a, env.DUNO_TEST_A_EMAIL, env.DUNO_TEST_A_PASSWORD, "A");
  bId = await signIn(b, env.DUNO_TEST_B_EMAIL, env.DUNO_TEST_B_PASSWORD, "B");

  const insA = await insertAs(a, { user_id: aId, day: TEST_DAY, text_encrypted: fakeCiphertext() });
  expect(insA.error).toBeNull();
  expect(insA.data).toHaveLength(1);
  aRow = (insA.data as Row[])[0];

  const insB = await insertAs(b, { user_id: bId, day: TEST_DAY, text_encrypted: fakeCiphertext() });
  expect(insB.error).toBeNull();
  expect(insB.data).toHaveLength(1);
  bRow = (insB.data as Row[])[0];
});

afterAll(async () => {
  // 시험이 중간에 실패해도 돈다. 각 계정은 자기 행만 지울 수 있다.
  // 한 계정 정리가 실패해도 다른 계정 정리·로그아웃은 끝까지 돌고, 실패는 모아 마지막에 던진다.
  await cleanupTodos([
    { label: "A", client: a, ids: createdByA },
    { label: "B", client: b, ids: createdByB },
  ]);
});

describe("가드와 양성 대조", () => {
  it("A와 B는 서로 다른 사용자다", () => {
    expect(aId).toBeTruthy();
    expect(bId).toBeTruthy();
    expect(aId).not.toBe(bId);
  });

  it("A는 자기가 넣은 행을 읽는다", async () => {
    const rows = await readById(a, aRow.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(aId);
  });

  it("B는 자기가 넣은 행을 읽는다", async () => {
    const rows = await readById(b, bRow.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(bId);
  });

  it("A는 자기 행의 done을 바꿀 수 있다(정상 update 통과)", async () => {
    const { data, error } = await a.from("todos").update({ done: true }).eq("id", aRow.id).select("id, done");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: aRow.id, done: true }]);
  });
});

describe("A가 B의 행에 닿지 못한다", () => {
  it("select: B 행 id로 읽으면 0행", async () => {
    expect(await readById(a, bRow.id)).toHaveLength(0);
    const { data, error } = await a.from("todos").select("id").eq("day", TEST_DAY);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).not.toContain(bRow.id);
  });

  it("update: 바뀐 행 0, B로 다시 읽으면 그대로", async () => {
    const { data, error } = await a.from("todos").update({ done: true }).eq("id", bRow.id).select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
    const rows = await readById(b, bRow.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].done).toBe(false);
  });

  it("delete: 지워진 행 0, B로 다시 읽으면 남아 있음", async () => {
    const { data, error } = await a.from("todos").delete().eq("id", bRow.id).select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
    expect(await readById(b, bRow.id)).toHaveLength(1);
  });

  it("insert: user_id = B로 넣으면 거절(WITH CHECK), B 쪽에도 행이 생기지 않음", async () => {
    // RETURNING 없이(return=minimal) 보낸다. RETURNING을 붙이면 select 정책 때문에도 에러가 날 수 있어
    // WITH CHECK가 거절했는지 따로 증명하지 못한다.
    const value = fakeCiphertext();
    const { error } = await a.from("todos").insert({ user_id: bId, day: TEST_DAY, text_encrypted: value });
    expect(error).not.toBeNull();

    const { data, error: readError } = await b
      .from("todos")
      .select("id, user_id")
      .eq("day", TEST_DAY)
      .eq("text_encrypted", value);
    expect(readError).toBeNull();
    track(data as { id: string; user_id: string }[] | null); // 잘못 들어갔으면 정리 대상에 넣는다
    expect(data).toHaveLength(0);
  });

  it("update: 자기 행의 user_id를 B로 바꾸면 거절이거나 0행, 자기 행 그대로", async () => {
    const { data, error } = await a.from("todos").update({ user_id: bId }).eq("id", aRow.id).select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    const rows = await readById(a, aRow.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(aId);
    expect(await readById(b, aRow.id)).toHaveLength(0);
  });

  // 원샷 v2 0번(마이그레이션 20261107100000_todo_manage.sql)이 update 권한 열을 done에서
  // done·text_encrypted·category_id·position으로 넓혔다. day·user_id·id·created_at은 여전히 못 바꾼다.
  // (옛 시험 「done 말고 다른 열(day·text_encrypted)은 바꾸지 못한다」는 새 계약에 맞춰 둘로 나눴다. 이 시험은 DB가 필요해 아직 돌리지 못했다.)
  it("update: day·user_id·id는 바꾸지 못한다(권한 거절)", async () => {
    const day = await a.from("todos").update({ day: "2000-01-02" }).eq("id", aRow.id).select("id");
    expect(day.error).not.toBeNull();
    const owner = await a.from("todos").update({ user_id: bId }).eq("id", aRow.id).select("id");
    expect(owner.error !== null || (owner.data ?? []).length === 0).toBe(true);
    const id = await a.from("todos").update({ id: "00000000-0000-4000-8000-000000000000" }).eq("id", aRow.id).select("id");
    expect(id.error).not.toBeNull();
    const rows = await readById(a, aRow.id);
    expect(rows[0].day).toBe(aRow.day);
    expect(rows[0].user_id).toBe(aId);
  });

  it("update: 자기 행의 text_encrypted는 바꿀 수 있고(고치기), 형식이 틀린 값은 거절된다", async () => {
    const next = fakeCiphertext();
    const ok = await a.from("todos").update({ text_encrypted: next }).eq("id", aRow.id).select("id, text_encrypted");
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual([{ id: aRow.id, text_encrypted: next }]);
    const bad = await a.from("todos").update({ text_encrypted: "평문 글" }).eq("id", aRow.id).select("id");
    expect(bad.error).not.toBeNull(); // todos_text_encrypted_format check
    const back = await a.from("todos").update({ text_encrypted: aRow.text_encrypted }).eq("id", aRow.id).select("id");
    expect(back.error).toBeNull();
    expect((await readById(a, aRow.id))[0].text_encrypted).toBe(aRow.text_encrypted);
  });

  it("update: B의 행의 text_encrypted·position은 바꾸지 못한다(바뀐 행 0), B로 다시 읽으면 그대로", async () => {
    const text = await a.from("todos").update({ text_encrypted: fakeCiphertext() }).eq("id", bRow.id).select("id");
    expect(text.error !== null || (text.data ?? []).length === 0).toBe(true);
    const position = await a.from("todos").update({ position: 7 }).eq("id", bRow.id).select("id");
    expect(position.error !== null || (position.data ?? []).length === 0).toBe(true);
    const rows = await readById(b, bRow.id);
    expect(rows[0].text_encrypted).toBe(bRow.text_encrypted);
  });

  it("update: 자기 행의 position(순서)은 바꿀 수 있고, 범위를 벗어난 값은 거절된다", async () => {
    const ok = await a.from("todos").update({ position: 3 }).eq("id", aRow.id).select("id, position");
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual([{ id: aRow.id, position: 3 }]);
    const bad = await a.from("todos").update({ position: -1 }).eq("id", aRow.id).select("id");
    expect(bad.error).not.toBeNull(); // todos_position_range check
    const reset = await a.from("todos").update({ position: null }).eq("id", aRow.id).select("id");
    expect(reset.error).toBeNull();
  });
});

describe("로그인 안 한 publishable 클라이언트", () => {
  it("select는 에러이거나 빈 결과", async () => {
    const { data, error } = await anon.from("todos").select("id").in("id", [aRow.id, bRow.id]);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("insert는 거절", async () => {
    const { data, error } = await insertAs(anon, { user_id: aId, day: TEST_DAY, text_encrypted: fakeCiphertext() });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("update는 거절, A 행 그대로", async () => {
    const before = (await readById(a, aRow.id))[0];
    const { error } = await anon.from("todos").update({ done: !before.done }).eq("id", aRow.id).select("id");
    expect(error).not.toBeNull();
    expect((await readById(a, aRow.id))[0].done).toBe(before.done);
  });

  it("delete는 거절, A 행 남아 있음", async () => {
    const { error } = await anon.from("todos").delete().eq("id", aRow.id).select("id");
    expect(error).not.toBeNull();
    expect(await readById(a, aRow.id)).toHaveLength(1);
  });
});

describe("암호문 열 형식·상한(임시 4096자)", () => {
  it("평문(형식 표시 없음)은 거절", async () => {
    const { error } = await insertAs(a, { day: TEST_DAY, text_encrypted: "plain text todo" });
    expect(error).not.toBeNull();
  });

  it("판 번호 접두만 빠진 값은 거절", async () => {
    const { error } = await insertAs(a, { day: TEST_DAY, text_encrypted: fakeCiphertext().slice("v1".length) });
    expect(error).not.toBeNull();
  });

  it("상한을 넘는 정상 모양 값(4097자)은 거절", async () => {
    const { error } = await insertAs(a, { day: TEST_DAY, text_encrypted: fakeCiphertextOfLength(MAX_LEN + 1) });
    expect(error).not.toBeNull();
  });

  it("상한 딱 맞는 정상 값(4096자)은 통과, user_id를 빼도 자기 것으로 들어간다", async () => {
    const { data, error } = await insertAs(a, { day: TEST_DAY, text_encrypted: fakeCiphertextOfLength(MAX_LEN) });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Row[])[0].user_id).toBe(aId);
  });
});
