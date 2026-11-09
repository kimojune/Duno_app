import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveRatiosForUser } from "../../lib/settings/core";
import { cleanupTodos } from "./cleanup";
import { loadIntegrationEnv } from "./load-env";

/**
 * 목표 비율이 바뀐 기록(category_ratio_history, 마이그레이션 20261109150000_category_ratio_history.sql)의 RLS·grant를 duno_dev에 대고 행동으로 본다.
 * **이 시험은 그 마이그레이션을 개발용 DB에 적용한 뒤에만 돈다**(적용 전에는 표가 없어 실패한다. 건너뛰지 않는다): 적용 뒤 npm run test:rls.
 *
 * - 클라이언트는 모두 publishable 키다(secret 키는 쓰지 않는다). anon은 로그인하지 않은 같은 키 클라이언트다.
 * - A의 저장은 서버 저장 길(saveRatiosForUser)을 A 세션 클라이언트로 그대로 돌린다(앱과 같은 길, RLS를 거친다).
 *   그래서 A 계정의 category_ratios·user_settings.ratio_other_percent 값이 시험 값으로 바뀐다(시험 계정만).
 * - 쌓기만 하는 표라 앱 키로는 지울 수 없다. 시험 행은 사람이 SQL 편집기에서 지운다(시험 계정 둘의 행만, 번호는 시험 계정 A·B의 auth.users id):
 *     delete from public.category_ratio_history where user_id in ('<시험 계정 A id>', '<시험 계정 B id>');
 * - 양성 대조(A는 자기 기록이 보인다)를 먼저 단언하고, 그 뒤에 「B에게 안 보임·거절」을 통과로 삼는다.
 * - 행 수 상한(트리거 private.category_ratio_history_enforce_limit, 임시 1000): B 계정을 상한까지 채운 뒤 한 줄 더 넣어 P0001을 본다.
 *   채우기는 한 요청에 여러 줄(묶음 insert)이라 가볍다. 지울 수 없어 B는 상한에 머문다: 다시 돌리면 채울 것이 없고 같은 단언이 다시 성립한다.
 *   B는 이 표에서 상한 시험 전용이다(다른 단언은 B의 쓰기 성공에 기대지 않는다). B의 앱 기록이 필요하면 위 지우기 SQL로 비운다.
 *   흉내가 실제로 그 사용자로 도는지: 각 클라이언트의 getUser() id가 A·B 번호와 같고 서로 다름을 먼저 본다.
 */

const HISTORY = "category_ratio_history";

function newClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

let a: SupabaseClient;
let b: SupabaseClient;
let anon: SupabaseClient;
let aId = "";
let bId = "";
let aCat = "";

async function signIn(client: SupabaseClient, email: string, password: string, label: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`${label} 로그인 실패 (status=${error?.status ?? "?"}, code=${error?.code ?? "?"})`);
  return data.user.id;
}

/** 계정의 시험 기준 분야(지울 수 없어 처음 한 번만 만들고 다시 쓴다 — v2-rls.test.ts와 같은 분야) */
async function baseCategory(client: SupabaseClient, label: string): Promise<string> {
  const found = await client.from("categories").select("id").order("created_at", { ascending: true }).limit(1);
  if (found.error) throw new Error(`${label} 분야 읽기 실패 (code=${found.error.code ?? "?"})`);
  const first = (found.data ?? [])[0] as { id: string } | undefined;
  if (!first) throw new Error(`${label} 기준 분야가 없다: v2-rls.test.ts를 먼저 한 번 돌린다`);
  return first.id;
}

/** 자기 기록 수(행을 받지 않고 개수만: API 최대 행 수에 잘리지 않게) */
async function countMine(client: SupabaseClient, userId: string): Promise<number> {
  const res = await client.from(HISTORY).select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (res.error || res.count === null) throw new Error(`기록 세기 실패 (code=${res.error?.code ?? "?"})`);
  return res.count;
}

async function latestOf(client: SupabaseClient, userId: string) {
  const res = await client.from(HISTORY).select("id, user_id, recorded_at, ratios").eq("user_id", userId).order("recorded_at", { ascending: false }).limit(1);
  if (res.error) throw new Error(`최신 기록 읽기 실패 (code=${res.error.code ?? "?"})`);
  return ((res.data ?? []) as { id: string; user_id: string; recorded_at: string; ratios: unknown }[])[0];
}

beforeAll(async () => {
  const env = loadIntegrationEnv();
  a = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  b = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  anon = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  aId = await signIn(a, env.DUNO_TEST_A_EMAIL, env.DUNO_TEST_A_PASSWORD, "A");
  bId = await signIn(b, env.DUNO_TEST_B_EMAIL, env.DUNO_TEST_B_PASSWORD, "B");
  aCat = await baseCategory(a, "A");
});

afterAll(async () => {
  await cleanupTodos([
    { label: "A", client: a, ids: [] },
    { label: "B", client: b, ids: [] },
  ]);
});

describe("category_ratio_history (목표 비율이 바뀐 기록, 쌓기만)", () => {
  it("표가 있다(마이그레이션 20261109150000 적용 확인 — 없으면 아래 시험이 뜻 없이 실패하므로 먼저 이 이름으로 실패한다)", async () => {
    // 앱 키로는 pg_catalog를 못 보므로 표 자체를 한 번 읽는다. 없는 표면 PostgREST가 PGRST205(스키마 캐시에 없음)나 42P01을 준다.
    // RLS·grant·상한 트리거가 있는지는 아래 시험이 행동으로 본다(42501 거절 · P0001 category_ratio_history_limit).
    const probe = await a.from(HISTORY).select("id", { count: "exact", head: true }).eq("user_id", aId);
    expect(probe.error?.code ?? null, "category_ratio_history 표가 없다: 마이그레이션 20261109150000을 이 DB에 적용했는지 본다").toBeNull();
    expect(typeof probe.count).toBe("number");
  });

  it("흉내가 실제로 A·B로 돈다(세션 사용자 번호가 다르다)", async () => {
    const ua = await a.auth.getUser();
    const ub = await b.auth.getUser();
    expect(ua.data.user?.id).toBe(aId);
    expect(ub.data.user?.id).toBe(bId);
    expect(aId).not.toBe(bId);
  });

  it("A가 저장 길로 저장하면 A 기록이 생기고 A가 읽는다(양성 대조). 시각은 서버가 정한다", async () => {
    // 직전 기록과 다른 묶음이 되게 두 값을 번갈아 쓴다(같은 묶음이면 안 쓰는 규칙 때문에)
    const before = await latestOf(a, aId);
    const pickFirst = JSON.stringify(before?.ratios) !== JSON.stringify([{ category_id: aCat, percent: 70 }, { category_id: null, percent: 30 }]);
    const ratios = pickFirst ? [{ categoryId: aCat, percent: 70 }, { categoryId: null, percent: 30 }] : [{ categoryId: aCat, percent: 60 }, { categoryId: null, percent: 40 }];
    const countBefore = await countMine(a, aId);
    const started = Date.now();

    const saved = await saveRatiosForUser({ supabase: a, key: null }, ratios);
    expect(saved).toEqual({ ok: true, data: { ratios } });

    expect(await countMine(a, aId)).toBe(countBefore + 1);
    const latest = await latestOf(a, aId);
    expect(latest.user_id).toBe(aId);
    expect(latest.ratios).toEqual([{ category_id: aCat, percent: ratios[0].percent }, { category_id: null, percent: ratios[1].percent }]);
    expect(Math.abs(Date.parse(latest.recorded_at) - started)).toBeLessThan(5 * 60_000); // 서버 시계(앱 시계와 크게 다르지 않음)

    // 같은 묶음 다시 저장 → 늘지 않음
    expect((await saveRatiosForUser({ supabase: a, key: null }, ratios)).ok).toBe(true);
    expect(await countMine(a, aId)).toBe(countBefore + 1);
  });

  it("B는 A의 기록을 select로 못 본다(A에게는 보이는 행)", async () => {
    const mine = await latestOf(a, aId);
    expect(mine).toBeTruthy(); // 양성 대조
    const byUser = await b.from(HISTORY).select("id").eq("user_id", aId);
    expect(byUser.error).toBeNull();
    expect(byUser.data ?? []).toHaveLength(0);
    const byId = await b.from(HISTORY).select("id").eq("id", mine.id);
    expect(byId.error).toBeNull();
    expect(byId.data ?? []).toHaveLength(0);
  });

  it("B가 user_id = A로 넣으면 거절되고 A의 기록 수는 그대로다. A가 자기 것은 직접 넣을 수 있다(정상 통과)", async () => {
    const countA = await countMine(a, aId);
    const forged = await b.from(HISTORY).insert({ user_id: aId, ratios: [{ category_id: null, percent: 100 }] }).select("id");
    expect(forged.error?.code).toBe("42501"); // WITH CHECK
    expect(await countMine(a, aId)).toBe(countA);

    // 정상 통과는 A로 본다(B는 아래 상한 시험이 상한까지 채워 두므로 자기 insert가 상한에 걸릴 수 있다)
    const own = await a.from(HISTORY).insert({ user_id: aId, ratios: [{ category_id: null, percent: 100 }] }).select("id, user_id");
    expect(own.error).toBeNull();
    expect((own.data as { user_id: string }[])[0].user_id).toBe(aId);
    expect(await countMine(a, aId)).toBe(countA + 1);
  });

  it("시각(recorded_at)·번호(id)는 넣지 못하고(insert 권한 없음), 배열이 아닌 ratios는 check가 막는다", async () => {
    const atForged = await a.from(HISTORY).insert({ user_id: aId, ratios: [{ category_id: null, percent: 100 }], recorded_at: "2000-01-01T00:00:00Z" }).select("id");
    expect(atForged.error?.code).toBe("42501");
    const idForged = await a.from(HISTORY).insert({ id: "00000000-0000-4000-8000-000000000001", user_id: aId, ratios: [{ category_id: null, percent: 100 }] }).select("id");
    expect(idForged.error?.code).toBe("42501");
    const notArray = await a.from(HISTORY).insert({ user_id: aId, ratios: { category_id: null, percent: 100 } }).select("id");
    expect(notArray.error).not.toBeNull();
    expect(notArray.error?.code).toBe("23514");
  });

  it("A도 B도 기록을 고치거나 지우지 못한다(행 수·값 그대로)", async () => {
    const mine = await latestOf(a, aId);
    expect(mine).toBeTruthy();
    const countA = await countMine(a, aId);

    const aEdit = await a.from(HISTORY).update({ ratios: [{ category_id: null, percent: 100 }] }).eq("id", mine.id).select("id");
    expect(aEdit.error?.code).toBe("42501");
    const aDel = await a.from(HISTORY).delete().eq("id", mine.id).select("id");
    expect(aDel.error?.code).toBe("42501");
    const bEdit = await b.from(HISTORY).update({ ratios: [{ category_id: null, percent: 100 }] }).eq("id", mine.id).select("id");
    expect(bEdit.error?.code).toBe("42501");
    const bDel = await b.from(HISTORY).delete().eq("id", mine.id).select("id");
    expect(bDel.error?.code).toBe("42501");

    expect(await countMine(a, aId)).toBe(countA);
    const after = await latestOf(a, aId);
    expect(after.id).toBe(mine.id);
    expect(after.ratios).toEqual(mine.ratios);
  });

  it("행 수 상한(임시 1000): B를 상한까지 채우면 한 줄 더는 P0001(category_ratio_history_limit)로 거절되고 수는 그대로다", async () => {
    const LIMIT = 1000; // 마이그레이션의 임시 값과 같다
    const row = () => ({ user_id: bId, ratios: [{ category_id: null, percent: 100 }] });
    const before = await countMine(b, bId);
    expect(before).toBeLessThanOrEqual(LIMIT);
    for (let left = LIMIT - before; left > 0; ) {
      const n = Math.min(left, 250);
      const fill = await b.from(HISTORY).insert(Array.from({ length: n }, row));
      expect(fill.error).toBeNull(); // 상한 전까지는 들어간다(정상 통과)
      left -= n;
    }
    expect(await countMine(b, bId)).toBe(LIMIT);

    const over = await b.from(HISTORY).insert(row()).select("id");
    expect(over.error?.code).toBe("P0001");
    expect(over.error?.hint).toBe("category_ratio_history_limit");
    expect(await countMine(b, bId)).toBe(LIMIT);

    // 상한은 사용자마다: A는 그대로 넣을 수 있다
    const countA = await countMine(a, aId);
    expect(countA).toBeLessThan(LIMIT);
    const aOk = await a.from(HISTORY).insert({ user_id: aId, ratios: [{ category_id: null, percent: 100 }] }).select("id");
    expect(aOk.error).toBeNull();
    expect(await countMine(a, aId)).toBe(countA + 1);
  });

  it("anon(로그인 없음)은 아무것도 못 보고 못 넣는다", async () => {
    expect(await countMine(a, aId)).toBeGreaterThan(0); // 양성 대조: 행이 있다
    const read = await anon.from(HISTORY).select("id").limit(5);
    expect(read.error !== null ? read.error.code : (read.data ?? []).length).toSatisfy((v: unknown) => v === "42501" || v === 0);
    const write = await anon.from(HISTORY).insert({ user_id: aId, ratios: [{ category_id: null, percent: 100 }] }).select("id");
    expect(write.error?.code).toBe("42501");
    expect(await countMine(a, aId)).toBeGreaterThan(0);
  });
});
