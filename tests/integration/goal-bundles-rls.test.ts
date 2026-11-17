import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadIntegrationEnv } from "./load-env";

/**
 * 지난 목표 기록(goal_bundles)과 save_goal_bundle RPC(마이그레이션 20261117100000_goal_bundles.sql)를 행동으로 본다.
 * **미실행**: 이 시험은 원격 DB에 붙는다. 이번 작업에서는 돌리지 않았다(개발 DB가 지금 운영과 같다).
 * 그 마이그레이션을 개발 전용 DB에 적용한 뒤에만 `npm run test:rls`로 돈다.
 *
 * - 클라이언트는 모두 publishable 키(secret 키 없음). anon은 로그인하지 않은 같은 키 클라이언트.
 * - goal_bundles에는 delete 권한이 없어 시험 행이 남고, 이 시험이 만든 분야는 보관되지만 지워지지 않는다. 사람이 SQL 편집기에서 정리한다
 *   (시험 계정 A·B의 auth.users id를 넣는다. 지난 묶음은 시험 계정 둘의 것만 지운다):
 *     delete from public.goal_bundles where user_id in ('<A id>', '<B id>');
 *     delete from public.category_ratios where category_id in (select id from public.categories where user_id in ('<A id>', '<B id>') and archived_at is not null);
 *     -- 시험 분야는 todos 등이 가리키지 않으면 지워도 된다(보관 표시가 있는 시험 분야만):
 *     delete from public.categories where user_id in ('<A id>', '<B id>') and archived_at is not null;
 *     update public.user_settings set bundle_started_at = null, restart_requested_at = null where user_id in ('<A id>', '<B id>');
 * - 준비 SQL(양성 대조용, 사람이 SQL 편집기에서 한 번만. 시험 계정 A의 id):
 *     insert into public.goal_bundles (user_id, started_at, ended_at, reason, categories, ratios)
 *     values ('<A id>', now() - interval '10 days', now() - interval '9 days', 'edit', '[]', '[{"category_id":null,"percent":100}]');
 * - 양성 대조(A는 자기 기록이 1줄 이상 읽힌다)를 먼저 단언하고, 그 뒤에 「B에게 안 보임·거절」을 통과로 삼는다.
 * - 날짜가 다른 경우(다른 날이면 한 줄)는 서버 시계를 못 바꿔 여기서 못 본다: pgTAP(supabase/tests/goal_bundles.test.sql)이 본다.
 *
 * 시험 이름 목록:
 *  흉내가 실제로 A·B로 돈다 / A는 자기 지난 묶음 읽기가 된다(양성 대조) / B는 A의 지난 묶음을 못 본다 /
 *  anon은 save_goal_bundle을 못 부른다 / goal_bundles 직접 insert·update·delete는 거절 / categories 직접 update는 거절 /
 *  B가 A의 분야 id를 넣어도 A 행이 안 바뀐다 / 충돌이면 아무것도 안 바뀐다 / 같은 op 두 번이면 한 번만 /
 *  같은 날 두 번이면 지난 묶음이 늘지 않는다 / 보관한 분야 비율이 기타로 간다 / 50칸 넘는 목록·형식 틀린 암호문은 거절
 */

const fakeCiphertext = () =>
  `v1:${randomBytes(12).toString("base64url")}:${randomBytes(24).toString("base64url")}:${randomBytes(16).toString("base64url")}`;

function newClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function signIn(client: SupabaseClient, email: string, password: string, label: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`${label} 로그인 실패 (status=${error?.status ?? "?"}, code=${error?.code ?? "?"})`);
  return data.user.id;
}

let a: SupabaseClient;
let b: SupabaseClient;
let anon: SupabaseClient;
let aId = "";
let bId = "";

type SaveArgs = {
  p_op_id: string | null;
  p_expected_revision: number | null;
  p_reason: "edit" | "restart";
  p_set_goal: boolean;
  p_goal_encrypted: string | null;
  p_other: number | null;
  p_items: unknown;
  p_complete_onboarding?: boolean;
  p_legacy?: boolean;
};
const call = (c: SupabaseClient, args: SaveArgs) => c.rpc("save_goal_bundle", args);

async function revisionOf(c: SupabaseClient, userId: string): Promise<number> {
  const res = await c.from("user_settings").select("bundle_revision").eq("user_id", userId);
  if (res.error) throw new Error(`고침 번호 읽기 실패 (code=${res.error.code ?? "?"})`);
  return ((res.data ?? []) as { bundle_revision: number }[])[0]?.bundle_revision ?? 0;
}
async function bundleCount(c: SupabaseClient, userId: string): Promise<number> {
  const res = await c.from("goal_bundles").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (res.error || res.count === null) throw new Error(`판 세기 실패 (code=${res.error?.code ?? "?"})`);
  return res.count;
}
async function ratiosOf(c: SupabaseClient) {
  const res = await c.from("category_ratios").select("category_id, percent");
  if (res.error) throw new Error("비율 읽기 실패");
  return (res.data ?? []) as { category_id: string; percent: number }[];
}

/** A의 현재 묶음을 시험이 아는 꼴로 맞춘다: 시험 분야 둘(60/40), 기타 0. 이 호출은 판을 남길 수 있다 */
async function resetA(): Promise<{ c1: string; c2: string }> {
  const c1 = randomUUID();
  const c2 = randomUUID();
  const rev = await revisionOf(a, aId);
  const res = await call(a, {
    p_op_id: randomUUID(),
    p_expected_revision: rev,
    p_reason: "restart",
    p_set_goal: true,
    p_goal_encrypted: fakeCiphertext(),
    p_other: 0,
    p_items: [
      { id: c1, new: true, name_encrypted: fakeCiphertext(), percent: 60 },
      { id: c2, new: true, name_encrypted: fakeCiphertext(), percent: 40 },
    ],
  });
  expect(res.error).toBeNull();
  return { c1, c2 };
}

beforeAll(async () => {
  const env = loadIntegrationEnv();
  a = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  b = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  anon = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  aId = await signIn(a, env.DUNO_TEST_A_EMAIL, env.DUNO_TEST_A_PASSWORD, "A");
  bId = await signIn(b, env.DUNO_TEST_B_EMAIL, env.DUNO_TEST_B_PASSWORD, "B");
});

afterAll(async () => {
  for (const c of [a, b]) {
    try {
      await c?.auth.signOut({ scope: "local" });
    } catch {
      /* 로그아웃 실패는 시험 결과가 아니다 */
    }
  }
});

describe("goal_bundles · save_goal_bundle (지난 목표 묶음)", () => {
  it("흉내가 실제로 A·B로 돈다", async () => {
    expect((await a.auth.getUser()).data.user?.id).toBe(aId);
    expect((await b.auth.getUser()).data.user?.id).toBe(bId);
    expect(aId).not.toBe(bId);
  });

  it("A는 자기 지난 묶음 읽기가 된다(양성 대조) · B는 A의 지난 묶음을 못 본다", async () => {
    const { c1 } = await resetA();
    // 양성 대조: A에게 지난 묶음이 1줄 이상 있어야 「B에게 안 보임」이 뜻을 가진다. every()는 0행이어도 참이라 개수를 먼저 단언한다.
    // 지난 묶음은 함수가 다른 날 저장할 때만 생긴다(같은 날이면 0줄). 시험 계정 A에 한 줄도 없으면 파일 머리의 「준비 SQL」로 한 줄 심은 뒤 다시 돈다.
    const mine = await a.from("goal_bundles").select("id, user_id");
    expect(mine.error).toBeNull();
    const mineRows = (mine.data ?? []) as { user_id: string }[];
    expect(mineRows.length, "A의 지난 묶음이 0줄이다: 파일 머리의 준비 SQL로 한 줄 심는다(양성 대조 불가)").toBeGreaterThanOrEqual(1);
    expect(mineRows.every((r) => r.user_id === aId)).toBe(true);
    const theirs = await b.from("goal_bundles").select("id, user_id");
    expect(theirs.error).toBeNull();
    expect((theirs.data ?? []).filter((r) => (r as { user_id: string }).user_id === aId)).toEqual([]);
    expect(c1).toBeTruthy();
  });

  it("anon은 save_goal_bundle을 못 부른다", async () => {
    const res = await call(anon, { p_op_id: null, p_expected_revision: 0, p_reason: "edit", p_set_goal: false, p_goal_encrypted: null, p_other: 0, p_items: null });
    expect(res.error).not.toBeNull();
    expect(["42501", "PGRST301", "PGRST302"]).toContain(res.error?.code);
    const read = await anon.from("goal_bundles").select("id");
    expect(read.error?.code).toBe("42501");
  });

  it("goal_bundles 직접 insert·update·delete는 거절", async () => {
    const ins = await a.from("goal_bundles").insert({ started_at: new Date().toISOString(), ended_at: new Date().toISOString(), reason: "edit", categories: [], ratios: [{ category_id: null, percent: 100 }] });
    expect(ins.error?.code).toBe("42501");
    const upd = await a.from("goal_bundles").update({ reason: "restart" }).eq("user_id", aId);
    expect(upd.error?.code).toBe("42501");
    const del = await a.from("goal_bundles").delete().eq("user_id", aId);
    expect(del.error?.code).toBe("42501");
  });

  it("categories 직접 update는 거절(이름·보관은 함수로만)", async () => {
    const { c1 } = await resetA();
    const upd = await a.from("categories").update({ archived_at: new Date().toISOString() }).eq("id", c1);
    expect(upd.error?.code).toBe("42501");
  });

  it("B가 A의 분야 id를 넣어도 A 행이 안 바뀐다", async () => {
    const { c1 } = await resetA();
    const before = await a.from("categories").select("name_encrypted, archived_at").eq("id", c1);
    const res = await call(b, {
      p_op_id: null,
      p_expected_revision: await revisionOf(b, bId),
      p_reason: "edit",
      p_set_goal: false,
      p_goal_encrypted: null,
      p_other: 0,
      p_items: [{ id: c1, name_encrypted: fakeCiphertext(), percent: 100, archived: true }],
    });
    expect(res.error?.hint).toBe("bundle_not_found");
    const after = await a.from("categories").select("name_encrypted, archived_at").eq("id", c1);
    expect(after.data).toEqual(before.data);
  });

  it("충돌이면 아무것도 안 바뀐다", async () => {
    const { c1, c2 } = await resetA();
    const rev = await revisionOf(a, aId);
    const ratiosBefore = await ratiosOf(a);
    const res = await call(a, {
      p_op_id: randomUUID(),
      p_expected_revision: rev + 5,
      p_reason: "edit",
      p_set_goal: true,
      p_goal_encrypted: fakeCiphertext(),
      p_other: 0,
      p_items: [{ id: c1, percent: 30 }, { id: c2, percent: 70 }],
    });
    expect(res.error?.hint).toBe("bundle_conflict");
    expect(await revisionOf(a, aId)).toBe(rev);
    expect(await ratiosOf(a)).toEqual(ratiosBefore);
  });

  it("같은 op 두 번이면 한 번만(멱등), 같은 날 두 번이면 지난 묶음이 늘지 않는다", async () => {
    const { c1, c2 } = await resetA();
    const rev = await revisionOf(a, aId);
    const op = randomUUID();
    const args: SaveArgs = {
      p_op_id: op,
      p_expected_revision: rev,
      p_reason: "edit",
      p_set_goal: false,
      p_goal_encrypted: null,
      p_other: 0,
      p_items: [{ id: c1, percent: 50 }, { id: c2, percent: 50 }],
    };
    const first = await call(a, args);
    expect(first.error).toBeNull();
    const countAfterFirst = await bundleCount(a, aId);
    const again = await call(a, args);
    expect(again.error).toBeNull();
    expect((again.data as { idempotent: boolean }).idempotent).toBe(true);
    expect(await revisionOf(a, aId)).toBe(rev + 1);
    expect(await bundleCount(a, aId)).toBe(countAfterFirst);

    // 같은 날 다른 op: 판이 늘지 않는다(resetA가 오늘 시작했으므로 같은 날)
    const second = await call(a, { ...args, p_op_id: randomUUID(), p_expected_revision: rev + 1, p_items: [{ id: c1, percent: 40 }, { id: c2, percent: 60 }] });
    expect(second.error).toBeNull();
    expect(await bundleCount(a, aId)).toBe(countAfterFirst);
  });

  it("보관한 분야 비율이 기타로 간다", async () => {
    const { c1, c2 } = await resetA();
    const rev = await revisionOf(a, aId);
    const res = await call(a, {
      p_op_id: randomUUID(),
      p_expected_revision: rev,
      p_reason: "edit",
      p_set_goal: false,
      p_goal_encrypted: null,
      p_other: 0,
      p_items: [{ id: c1, percent: 60 }, { id: c2, percent: 40, archived: true }],
    });
    expect(res.error).toBeNull();
    const settings = await a.from("user_settings").select("ratio_other_percent").eq("user_id", aId);
    expect(((settings.data ?? []) as { ratio_other_percent: number | null }[])[0]?.ratio_other_percent).toBe(40);
    const cat = await a.from("categories").select("archived_at").eq("id", c2);
    expect(((cat.data ?? []) as { archived_at: string | null }[])[0]?.archived_at).not.toBeNull();
    expect((await ratiosOf(a)).some((r) => r.category_id === c2)).toBe(false);
  });

  it("50칸 넘는 목록·형식 틀린 암호문은 거절", async () => {
    const rev = await revisionOf(a, aId);
    const many = Array.from({ length: 51 }, () => ({ id: randomUUID(), new: true, name_encrypted: fakeCiphertext(), percent: 0 }));
    const tooMany = await call(a, { p_op_id: null, p_expected_revision: rev, p_reason: "edit", p_set_goal: false, p_goal_encrypted: null, p_other: 100, p_items: many });
    expect(tooMany.error?.code).toBe("22023");
    const badGoal = await call(a, { p_op_id: null, p_expected_revision: rev, p_reason: "edit", p_set_goal: true, p_goal_encrypted: "평문 목표", p_other: null, p_items: null });
    expect(badGoal.error?.code).toBe("22023");
    expect(await revisionOf(a, aId)).toBe(rev);
  });
});
