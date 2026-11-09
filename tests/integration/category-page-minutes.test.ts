import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { readCategoryPage } from "../../lib/notes/core";
import { parseTodoKey, type TodoKey } from "../../lib/todos/crypto";
import { loadIntegrationEnv } from "./load-env";

/**
 * 원샷 v2 고침8: 분야 페이지 날짜별 시간(days[].minutes)이 새로 읽는 길(오늘 기록 evening_logs)을 duno_dev에 대고 확인한다.
 * - 클라이언트는 publishable 키(secret 키 없음), 암호화 키는 시험 안에서 무작위. 날짜는 실제 기록과 섞이지 않는 옛 날(2000-01-05·06).
 * - evening_logs는 쌓기만 하는 표라 시험 행이 남는다(v2-rls.test.ts 머리의 SQL로 사람이 지운다: target_day < '2001-01-01').
 * - 양성 대조(A는 자기 분야 페이지에서 자기 기록 분이 보인다)를 먼저 단언하고, 그 뒤에 「B는 A의 분야 번호로 A의 분을 못 본다 · A 페이지에 B의 행이 안 섞인다」.
 * 이 시험은 env가 있는 곳에서 npm run test:rls로 돈다(작성한 작업 폴더에는 env가 없어 돌리지 못했다).
 */

const A_DAY = "2000-01-05";
const B_DAY = "2000-01-06";

let a: SupabaseClient;
let b: SupabaseClient;
let aCat = "";
let key: TodoKey;

function newClient(url: string, publishableKey: string): SupabaseClient {
  return createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
async function signIn(client: SupabaseClient, email: string, password: string, label: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`${label} 로그인 실패 (status=${error?.status ?? "?"}, code=${error?.code ?? "?"})`);
  return data.user.id;
}
function fakeCiphertext(): string {
  const u = (n: number) => randomBytes(n).toString("base64url");
  return `v1:${u(12)}:${u(24)}:${u(16)}`;
}
/** A의 시험 기준 분야(지울 수 없어 처음 한 번만 만들고 다시 쓴다 — v2-rls.test.ts와 같은 방식) */
async function baseCategory(client: SupabaseClient): Promise<string> {
  const found = await client.from("categories").select("id").order("created_at", { ascending: true }).limit(1);
  if (found.error) throw new Error(`분야 읽기 실패 (code=${found.error.code ?? "?"})`);
  const first = (found.data ?? [])[0] as { id: string } | undefined;
  if (first) return first.id;
  const made = await client.from("categories").insert({ name_encrypted: fakeCiphertext() }).select("id");
  if (made.error || !made.data?.[0]) throw new Error(`기준 분야 만들기 실패 (code=${made.error?.code ?? "?"})`);
  return (made.data[0] as { id: string }).id;
}

beforeAll(async () => {
  const env = loadIntegrationEnv();
  a = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  b = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  await signIn(a, env.DUNO_TEST_A_EMAIL, env.DUNO_TEST_A_PASSWORD, "A");
  await signIn(b, env.DUNO_TEST_B_EMAIL, env.DUNO_TEST_B_PASSWORD, "B");
  aCat = await baseCategory(a);
  key = parseTodoKey(randomBytes(32).toString("base64"))!;
});

describe("분야 페이지 날짜별 시간(evening_logs 읽기, 고침8)", () => {
  it("A는 자기 분야 페이지에 자기 기록 분이 보이고, B는 A의 분야 번호로 A의 분을 못 보며, A 페이지에 B의 행이 섞이지 않는다", async () => {
    // A: 그날 가장 늦은 기록이 되도록 지금 쌓는다(같은 날 옛 시험 행보다 saved_at이 늦다)
    const aMinutes = 60 + Math.floor(Math.random() * 600);
    const aIns = await a.from("evening_logs").insert({ id: randomUUID(), target_day: A_DAY, total_minutes: aMinutes, items: [{ categoryId: aCat, minutes: aMinutes }], save_mode: "edited" }).select("id");
    expect(aIns.error).toBeNull();
    // B: 자기 기록 items에 A의 분야 번호를 적는다(json이라 막히지 않는다) — A 페이지에 섞이면 안 된다
    const bIns = await b.from("evening_logs").insert({ id: randomUUID(), target_day: B_DAY, total_minutes: 999, items: [{ categoryId: aCat, minutes: 999 }], save_mode: "edited" }).select("id");
    expect(bIns.error).toBeNull();

    // 양성 대조: A
    const mine = await readCategoryPage({ supabase: a, key }, aCat);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.data.days.find((d) => d.day === A_DAY)?.minutes).toBe(aMinutes);
    // A 페이지에 B의 행(B_DAY 999분)이 없다
    expect(mine.data.days.some((d) => d.minutes === 999 || d.day === B_DAY)).toBe(false);

    // B가 A의 분야 번호로: 지금처럼 빈 결과(남의 할 일 없음), A의 분 없음
    const theirs = await readCategoryPage({ supabase: b, key }, aCat);
    expect(theirs.ok).toBe(true);
    if (!theirs.ok) return;
    expect(theirs.data.days.some((d) => d.day === A_DAY && d.minutes === aMinutes)).toBe(false);
    expect(theirs.data.days.every((d) => d.todos.length === 0)).toBe(true);
  });
});
