import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 시연 체험(익명 로그인, PM d-162 가)의 RLS를 duno_dev에 대고 행동으로 본다: 익명 사용자 둘이 서로의 할 일·기록·비율을 못 본다.
 * - 익명 사용자도 role authenticated(JWT is_anonymous=true)라 기존 「자기 행만」 정책을 그대로 탄다. is_anonymous로 막는 정책은 없다.
 * - **익명 로그인이 꺼져 있으면 건너뛰지 않고 「익명 로그인 꺼짐」으로 실패한다.** CAPTCHA가 켜져 있으면 토큰이 없어 같은 자리에서 실패한다(code를 함께 적는다).
 * - publishable 키만 쓴다(secret 키 없음). 돌릴 때마다 익명 사용자 둘과 그 행이 남는다(앱 키로는 분야·기록을 지울 수 없다).
 *   정리 SQL: docs/oneshot-v2/시연-체험코드.md. Supabase 익명 로그인 한도(IP당 시간당 30, 기본)에 두 번 센다.
 * - 양성 대조(자기 행은 보인다)를 먼저 단언하고, 그 뒤 「남에게 안 보임·거절」을 통과로 삼는다.
 */

function env(): { url: string; key: string } {
  const file = path.resolve(__dirname, "../../.env.local");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const url = (fromFile.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = (fromFile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();
  if (!url || !key) throw new Error("통합 시험 환경 변수가 없음: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return { url, key };
}

/** DB 형식 check(v1:<16>:<body>:<22>)만 맞춘 가짜 암호문 — RLS 시험이라 풀 일은 없다 */
function fakeCipher(): string {
  return `v1:${randomBytes(12).toString("base64url")}:${randomBytes(18).toString("base64url")}:${randomBytes(16).toString("base64url")}`;
}

type Anon = { client: SupabaseClient; id: string; categoryId: string; todoId: string; logId: string };

async function anonUser(label: string): Promise<Anon> {
  const { url, key } = env();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(`익명 로그인 꺼짐 또는 막힘(${label}): status=${error?.status ?? "?"}, code=${error?.code ?? "?"} — Supabase Auth에서 익명 로그인을 켜고 CAPTCHA·한도를 확인한다`);
  }
  const claims = await client.auth.getClaims();
  if (claims.data?.claims?.is_anonymous !== true) throw new Error(`${label}: JWT is_anonymous가 true가 아니다`);
  const id = data.user.id;

  const categoryId = randomUUID();
  const cat = await client.from("categories").insert({ id: categoryId, user_id: id, name_encrypted: fakeCipher() });
  if (cat.error) throw new Error(`${label} 분야 넣기 실패 (code=${cat.error.code})`);
  const todoId = randomUUID();
  const todo = await client.from("todos").insert({ id: todoId, user_id: id, day: "2026-10-20", text_encrypted: fakeCipher(), done: false, category_id: categoryId });
  if (todo.error) throw new Error(`${label} 할 일 넣기 실패 (code=${todo.error.code})`);
  const logId = randomUUID();
  const log = await client.from("evening_logs").insert({
    id: logId,
    user_id: id,
    target_day: "2026-10-20",
    total_minutes: 60,
    items: [{ categoryId, minutes: 60 }],
    save_mode: "edited",
  });
  if (log.error) throw new Error(`${label} 기록 넣기 실패 (code=${log.error.code})`);
  const ratio = await client.from("category_ratios").upsert({ user_id: id, category_id: categoryId, percent: 100 }, { onConflict: "user_id,category_id" });
  if (ratio.error) throw new Error(`${label} 비율 넣기 실패 (code=${ratio.error.code})`);
  return { client, id, categoryId, todoId, logId };
}

let a: Anon;
let b: Anon;

beforeAll(async () => {
  a = await anonUser("익명 A");
  b = await anonUser("익명 B");
});

describe("익명(체험) 사용자 둘의 RLS", () => {
  it("서로 다른 사용자다", () => {
    expect(a.id).not.toBe(b.id);
  });

  it("양성 대조: 각자 자기 할 일·기록·비율·분야는 보인다(지난 날짜도 넣어졌다)", async () => {
    for (const u of [a, b]) {
      const todos = await u.client.from("todos").select("id, user_id").eq("id", u.todoId);
      expect(todos.error).toBeNull();
      expect(todos.data).toEqual([{ id: u.todoId, user_id: u.id }]);
      const logs = await u.client.from("evening_logs").select("id").eq("id", u.logId);
      expect(logs.data?.length).toBe(1);
      const ratios = await u.client.from("category_ratios").select("category_id").eq("user_id", u.id);
      expect(ratios.data?.length).toBe(1);
      const cats = await u.client.from("categories").select("id").eq("id", u.categoryId);
      expect(cats.data?.length).toBe(1);
    }
  });

  it("B는 A의 할 일·기록·비율·분야를 id로 찾아도 못 본다", async () => {
    expect((await b.client.from("todos").select("id").eq("id", a.todoId)).data).toEqual([]);
    expect((await b.client.from("evening_logs").select("id").eq("id", a.logId)).data).toEqual([]);
    expect((await b.client.from("category_ratios").select("category_id").eq("user_id", a.id)).data).toEqual([]);
    expect((await b.client.from("categories").select("id").eq("id", a.categoryId)).data).toEqual([]);
    // 전체 읽기에도 A 행이 섞이지 않는다
    const all = await b.client.from("todos").select("user_id");
    expect(all.error).toBeNull();
    expect((all.data ?? []).length).toBeGreaterThan(0);
    expect((all.data ?? []).every((r) => (r as { user_id: string }).user_id === b.id)).toBe(true);
  });

  it("B는 A의 할 일을 고치거나 지우지 못하고(0행), A 이름으로 넣지 못한다", async () => {
    const upd = await b.client.from("todos").update({ done: true }).eq("id", a.todoId).select("id");
    expect(upd.data ?? []).toEqual([]);
    const del = await b.client.from("todos").delete().eq("id", a.todoId).select("id");
    expect(del.data ?? []).toEqual([]);
    const still = await a.client.from("todos").select("done").eq("id", a.todoId);
    expect(still.data).toEqual([{ done: false }]);
    const forged = await b.client.from("todos").insert({ user_id: a.id, day: "2026-10-20", text_encrypted: fakeCipher() });
    expect(forged.error?.code).toBe("42501");
  });

  it("anon(로그인 안 함)에는 표가 열리지 않는다 — 빈 결과가 아니라 권한 거절(42501)", async () => {
    // 양성 대조: 같은 행이 A에게는 보인다(행이 없어서 빈 것이 아님)
    expect((await a.client.from("todos").select("id").eq("id", a.todoId)).data).toEqual([{ id: a.todoId }]);
    const { url, key } = env();
    const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    // anon 역할에는 마이그레이션이 grant를 주지 않았다(revoke all) → RLS 전에 표 권한에서 막힌다
    for (const table of ["todos", "evening_logs", "category_ratios", "categories"] as const) {
      const res = await anon.from(table).select("user_id").eq("user_id", a.id);
      expect(res.error?.code, table).toBe("42501");
      expect(res.data, table).toBeNull();
    }
    const insert = await anon.from("todos").insert({ user_id: a.id, day: "2026-10-20", text_encrypted: fakeCipher() }).select("id");
    expect(insert.error?.code).toBe("42501");
    expect(insert.data).toBeNull();
  });
});
