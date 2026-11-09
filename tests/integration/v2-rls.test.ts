import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTodos } from "./cleanup";
import { loadIntegrationEnv } from "./load-env";

/**
 * 원샷 v2 새 표의 RLS·grant·check 제약·외래 키를 duno_dev에 대고 행동으로 확인한다
 * (마이그레이션 20261107100000 ~ 20261107100800). **이 시험은 DB가 없어 아직 한 번도 돌리지 못했다**: 마이그레이션을 적용한 뒤 npm run test:rls로 돈다.
 *
 * - 클라이언트는 모두 publishable 키다(secret 키는 쓰지 않는다). 암호문 값은 형식만 맞춘 무작위 바이트다.
 * - 새 표 대부분은 쌓기만 하는 표라 앱 키로는 지울 수 없다(지우는 권한 없음). 그래서 시험 행이 남는다. 옛 날짜(2000-01-xx)에 두어 실제 기록과 섞이지 않게 하고,
 *   쌓인 시험 행은 사람이 SQL 편집기에서 지운다(앱·시험 키로는 못 지운다):
 *     delete from public.evening_logs where target_day < '2001-01-01';
 *     delete from public.view_events where day < '2001-01-01';
 *     delete from public.focus_sessions where day < '2001-01-01';
 *     delete from public.todo_offers where day < '2001-01-01';
 *     delete from public.weekly_goals where week_start < '2001-01-01';
 *     delete from public.category_ratio_history where user_id in ('<시험 계정 A id>', '<시험 계정 B id>');
 *   (user_settings·category_ratios·push_subscriptions는 계정마다 시험 값이 하나씩 남는다. 시험 계정 둘의 행만 지운다.
 *    category_ratio_history는 고침 9바퀴 표로, 시험은 ratio-history-rls.test.ts에 있다. 날짜로 가를 수 없어(서버 시각) 시험 계정 둘의 행을 지운다.)
 * - 양성 대조(A는 자기 행이 보인다)를 먼저 단언하고 그 뒤에 「B에게 안 보임·거절」을 통과로 삼는다.
 */

const TEST_DAY = "2000-01-03"; // 월요일(weekly_goals 시험), 실제 기록과 섞이지 않게 옛 날짜
const b64url = (bytes: Buffer) => bytes.toString("base64url");

/** v1:<iv 16자>:<암호문>:<태그 22자> 꼴의 무작위 값(형식 check만 통과한다) */
function fakeCiphertext(): string {
  return `v1:${b64url(randomBytes(12))}:${b64url(randomBytes(24))}:${b64url(randomBytes(16))}`;
}

function newClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

let a: SupabaseClient;
let b: SupabaseClient;
let aId = "";
let bId = "";
let aCat = "";
let bCat = "";
const todosByA: string[] = [];

async function signIn(client: SupabaseClient, email: string, password: string, label: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`${label} 로그인 실패 (status=${error?.status ?? "?"}, code=${error?.code ?? "?"})`);
  return data.user.id;
}

/** 계정의 시험 기준 분야(지울 수 없어 처음 한 번만 만들고 다시 쓴다) */
async function baseCategory(client: SupabaseClient, label: string): Promise<string> {
  const found = await client.from("categories").select("id").order("created_at", { ascending: true }).limit(1);
  if (found.error) throw new Error(`${label} 분야 읽기 실패 (code=${found.error.code ?? "?"})`);
  const first = (found.data ?? [])[0] as { id: string } | undefined;
  if (first) return first.id;
  const made = await client.from("categories").insert({ name_encrypted: fakeCiphertext() }).select("id");
  if (made.error || !made.data?.[0]) throw new Error(`${label} 기준 분야 만들기 실패 (code=${made.error?.code ?? "?"})`);
  return (made.data[0] as { id: string }).id;
}

async function newTodo(client: SupabaseClient): Promise<string> {
  const res = await client.from("todos").insert({ day: TEST_DAY, text_encrypted: fakeCiphertext() }).select("id");
  if (res.error || !res.data?.[0]) throw new Error(`시험 할 일 만들기 실패 (code=${res.error?.code ?? "?"})`);
  const id = (res.data[0] as { id: string }).id;
  todosByA.push(id);
  return id;
}

const denied = (res: { error: { code?: string } | null; data: unknown }) =>
  res.error !== null || (Array.isArray(res.data) && res.data.length === 0);

beforeAll(async () => {
  const env = loadIntegrationEnv();
  a = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  b = newClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  aId = await signIn(a, env.DUNO_TEST_A_EMAIL, env.DUNO_TEST_A_PASSWORD, "A");
  bId = await signIn(b, env.DUNO_TEST_B_EMAIL, env.DUNO_TEST_B_PASSWORD, "B");
  aCat = await baseCategory(a, "A");
  bCat = await baseCategory(b, "B");
});

afterAll(async () => {
  await cleanupTodos([
    { label: "A", client: a, ids: todosByA },
    { label: "B", client: b, ids: [] },
  ]);
});

describe("todo_notes (작업 기록)", () => {
  it("A는 자기 할 일에 기록을 남기고 읽는다. B는 못 읽고, A의 할 일에 쓰려 하면 외래 키가 거절한다", async () => {
    const todoId = await newTodo(a);
    const noteId = randomUUID();
    const ok = await a.from("todo_notes").insert({ id: noteId, todo_id: todoId, day: TEST_DAY, note_encrypted: fakeCiphertext() }).select("id, user_id");
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual([{ id: noteId, user_id: aId }]);
    expect(((await a.from("todo_notes").select("id").eq("id", noteId)).data ?? []).length).toBe(1);
    expect((await b.from("todo_notes").select("id").eq("id", noteId)).data ?? []).toHaveLength(0);
    const foreign = await b.from("todo_notes").insert({ todo_id: todoId, day: TEST_DAY, note_encrypted: fakeCiphertext() }).select("id");
    expect(foreign.error?.code).toBe("23503"); // (todo_id, user_id)가 A의 할 일을 가리킬 수 없다
    const plain = await a.from("todo_notes").insert({ todo_id: todoId, day: TEST_DAY, note_encrypted: "평문 기록" }).select("id");
    expect(plain.error).not.toBeNull(); // 형식 check
  });
  it("A는 자기 기록을 지울 수 있고 B는 못 지운다. 기록은 고치지 못한다(update 권한 없음). 할 일을 지우면 기록도 지워진다", async () => {
    const todoId = await newTodo(a);
    const noteId = randomUUID();
    await a.from("todo_notes").insert({ id: noteId, todo_id: todoId, day: TEST_DAY, note_encrypted: fakeCiphertext() });
    expect(denied(await b.from("todo_notes").delete().eq("id", noteId).select("id"))).toBe(true);
    const edit = await a.from("todo_notes").update({ note_encrypted: fakeCiphertext() }).eq("id", noteId).select("id");
    expect(edit.error?.code).toBe("42501");
    const delTodo = await a.from("todos").delete().eq("id", todoId).select("id");
    expect(delTodo.error).toBeNull();
    expect(((await a.from("todo_notes").select("id").eq("id", noteId)).data ?? []).length).toBe(0); // on delete cascade
  });
});

describe("user_settings · category_ratios (처음 설정)", () => {
  it("A는 자기 설정을 만들고 고친다. B는 못 읽고 못 고친다. 알림 시각 범위는 check가 막는다", async () => {
    const up = await a.from("user_settings").upsert({ user_id: aId, goal_encrypted: fakeCiphertext() }, { onConflict: "user_id" }).select("user_id");
    expect(up.error).toBeNull();
    expect(((await a.from("user_settings").select("user_id").eq("user_id", aId)).data ?? []).length).toBe(1);
    expect((await b.from("user_settings").select("user_id").eq("user_id", aId)).data ?? []).toHaveLength(0);
    expect(denied(await b.from("user_settings").update({ notify_evening_enabled: true }).eq("user_id", aId).select("user_id"))).toBe(true);
    const range = await a.from("user_settings").update({ notify_evening_minute: 1440 }).eq("user_id", aId).select("user_id");
    expect(range.error).not.toBeNull();
    const plain = await a.from("user_settings").update({ goal_encrypted: "평문 목표" }).eq("user_id", aId).select("user_id");
    expect(plain.error).not.toBeNull();
    const other = await b.from("user_settings").insert({ user_id: aId }).select("user_id");
    expect(other.error).not.toBeNull(); // WITH CHECK
  });
  it("비율은 내 분야만 가리킬 수 있고(복합 외래 키) 0~100만 받는다", async () => {
    const ok = await a.from("category_ratios").upsert({ user_id: aId, category_id: aCat, percent: 60 }, { onConflict: "user_id,category_id" }).select("percent");
    expect(ok.error).toBeNull();
    const foreign = await a.from("category_ratios").insert({ user_id: aId, category_id: bCat, percent: 40 }).select("percent");
    expect(foreign.error?.code).toBe("23503");
    const big = await a.from("category_ratios").update({ percent: 101 }).eq("category_id", aCat).select("percent");
    expect(big.error).not.toBeNull();
    expect((await b.from("category_ratios").select("percent").eq("category_id", aCat)).data ?? []).toHaveLength(0);
  });
});

describe("evening_logs (저녁 기록, 쌓기만)", () => {
  it("A는 저장하고 읽는다. 서버 시각(saved_at)은 못 넣고, 고치거나 지우지 못하며, B는 못 읽는다", async () => {
    const id = randomUUID();
    const row = { id, target_day: TEST_DAY, total_minutes: 120, items: [{ categoryId: aCat, minutes: 60 }, { categoryId: null, minutes: 60 }], save_mode: "edited" };
    const ok = await a.from("evening_logs").insert(row).select("id, saved_at");
    expect(ok.error).toBeNull();
    expect((ok.data as { saved_at: string }[])[0].saved_at).toBeTruthy();
    expect((await b.from("evening_logs").select("id").eq("id", id)).data ?? []).toHaveLength(0);
    const forged = await a.from("evening_logs").insert({ ...row, id: randomUUID(), saved_at: "2000-01-01T00:00:00Z" }).select("id");
    expect(forged.error?.code).toBe("42501");
    expect((await a.from("evening_logs").update({ total_minutes: 5 }).eq("id", id).select("id")).error?.code).toBe("42501");
    expect((await a.from("evening_logs").delete().eq("id", id).select("id")).error?.code).toBe("42501");
  });
  it("저장 방식·총시간·항목 모양 check", async () => {
    const base = { target_day: TEST_DAY, total_minutes: 10, items: [], save_mode: "not_split" };
    expect((await a.from("evening_logs").insert({ ...base, id: randomUUID(), save_mode: "auto" }).select("id")).error).not.toBeNull();
    expect((await a.from("evening_logs").insert({ ...base, id: randomUUID(), total_minutes: 1441 }).select("id")).error).not.toBeNull();
    expect((await a.from("evening_logs").insert({ ...base, id: randomUUID(), items: { not: "array" } }).select("id")).error).not.toBeNull();
    expect((await a.from("evening_logs").insert({ ...base, user_id: bId, id: randomUUID() }).select("id")).error).not.toBeNull(); // WITH CHECK
  });
});

describe("view_events (화면 본 것)", () => {
  it("A는 남기고 읽는다. 화면·입구 값은 check, 시각은 못 넣고, 고치거나 지우지 못하며, B는 못 읽는다", async () => {
    const id = randomUUID();
    const ok = await a.from("view_events").insert({ id, screen: "growth", entry: "after_save", day: TEST_DAY }).select("id");
    expect(ok.error).toBeNull();
    expect((await b.from("view_events").select("id").eq("id", id)).data ?? []).toHaveLength(0);
    expect((await a.from("view_events").insert({ screen: "timer", entry: "self", day: TEST_DAY }).select("id")).error).not.toBeNull();
    expect((await a.from("view_events").insert({ screen: "growth", entry: "push", day: TEST_DAY }).select("id")).error).not.toBeNull();
    expect((await a.from("view_events").insert({ screen: "growth", entry: "self", day: TEST_DAY, viewed_at: "2000-01-01T00:00:00Z" }).select("id")).error?.code).toBe("42501");
    expect((await a.from("view_events").update({ entry: "self" }).eq("id", id).select("id")).error?.code).toBe("42501");
    expect((await a.from("view_events").delete().eq("id", id).select("id")).error?.code).toBe("42501");
  });
});

describe("focus_sessions (타이머·먼저 한 기록)", () => {
  it("A는 시작하고(서버 시각은 DB 기본값) 끝낼 때 ended_at·elapsed_seconds만 고친다. 다른 열은 못 고친다", async () => {
    const id = randomUUID();
    const ok = await a
      .from("focus_sessions")
      .insert({ id, day: TEST_DAY, category_id: aCat, surface: "manual", opposite_by_goal: null, opposite_by_ratio: true })
      .select("id, started_at, planned_minutes");
    expect(ok.error).toBeNull();
    expect((ok.data as { planned_minutes: number }[])[0].planned_minutes).toBe(30);
    const end = await a.from("focus_sessions").update({ ended_at: new Date().toISOString(), elapsed_seconds: 300 }).eq("id", id).select("id");
    expect(end.error).toBeNull();
    expect((await a.from("focus_sessions").update({ opposite_by_ratio: false }).eq("id", id).select("id")).error?.code).toBe("42501");
    expect((await a.from("focus_sessions").update({ category_id: null }).eq("id", id).select("id")).error?.code).toBe("42501");
    expect((await a.from("focus_sessions").delete().eq("id", id).select("id")).error?.code).toBe("42501");
  });
  it("B는 A의 세션을 읽거나 끝내지 못하고, 남의 분야·시작 시각 넣기·이상한 surface·진행 시간 범위는 거절된다", async () => {
    const id = randomUUID();
    await a.from("focus_sessions").insert({ id, day: TEST_DAY, surface: "card" });
    expect((await b.from("focus_sessions").select("id").eq("id", id)).data ?? []).toHaveLength(0);
    expect(denied(await b.from("focus_sessions").update({ elapsed_seconds: 1 }).eq("id", id).select("id"))).toBe(true);
    expect((await a.from("focus_sessions").insert({ day: TEST_DAY, category_id: bCat, surface: "manual" }).select("id")).error?.code).toBe("23503");
    expect((await a.from("focus_sessions").insert({ day: TEST_DAY, surface: "manual", started_at: "2000-01-01T00:00:00Z" }).select("id")).error?.code).toBe("42501");
    expect((await a.from("focus_sessions").insert({ day: TEST_DAY, surface: "push" }).select("id")).error).not.toBeNull();
    expect((await a.from("focus_sessions").update({ elapsed_seconds: 99999 }).eq("id", id).select("id")).error).not.toBeNull();
  });
});

describe("todo_offers (할 일 제시)", () => {
  it("A는 제시를 남기고, 같은 날·같은 열쇠는 한 번만(고유 제약), 넘긴 시각만 고친다. B는 못 읽는다", async () => {
    const key = `card|${aCat}|-`;
    const row = { day: TEST_DAY, surface: "card", category_id: aCat, offer_key: key };
    const ok = await a.from("todo_offers").upsert(row, { onConflict: "user_id,day,offer_key", ignoreDuplicates: true }).select("id");
    expect(ok.error).toBeNull();
    const dup = await a.from("todo_offers").insert(row).select("id");
    expect(dup.error?.code).toBe("23505");
    const mine = await a.from("todo_offers").select("id").eq("day", TEST_DAY).eq("offer_key", key);
    const id = ((mine.data ?? [])[0] as { id: string }).id;
    expect((await b.from("todo_offers").select("id").eq("id", id)).data ?? []).toHaveLength(0);
    expect((await a.from("todo_offers").update({ dismissed_at: new Date().toISOString() }).eq("id", id).select("id")).error).toBeNull();
    expect((await a.from("todo_offers").update({ category_id: null }).eq("id", id).select("id")).error?.code).toBe("42501");
    expect(denied(await b.from("todo_offers").update({ dismissed_at: new Date().toISOString() }).eq("id", id).select("id"))).toBe(true);
    expect((await a.from("todo_offers").delete().eq("id", id).select("id")).error?.code).toBe("42501");
    expect((await a.from("todo_offers").insert({ ...row, offer_key: "x2", surface: "push" }).select("id")).error).not.toBeNull();
    expect((await a.from("todo_offers").insert({ ...row, offer_key: "x3", category_id: bCat }).select("id")).error?.code).toBe("23503");
  });
});

describe("weekly_goals (이번 주 목표)", () => {
  it("A는 월요일 주의 목표를 만들고 고치고 지운다. 월요일이 아닌 날·빈 목록은 거절, B는 못 읽는다", async () => {
    const items = [{ categoryId: aCat, minutes: 300 }];
    const ok = await a.from("weekly_goals").upsert({ user_id: aId, week_start: TEST_DAY, items }, { onConflict: "user_id,week_start" }).select("week_start");
    expect(ok.error).toBeNull();
    expect((await b.from("weekly_goals").select("week_start").eq("user_id", aId)).data ?? []).toHaveLength(0);
    expect((await a.from("weekly_goals").update({ items: [{ categoryId: aCat, minutes: 600 }] }).eq("week_start", TEST_DAY).select("week_start")).error).toBeNull();
    expect((await a.from("weekly_goals").insert({ user_id: aId, week_start: "2000-01-04", items }).select("week_start")).error).not.toBeNull(); // 화요일
    expect((await a.from("weekly_goals").insert({ user_id: aId, week_start: "2000-01-10", items: [] }).select("week_start")).error).not.toBeNull();
    // 키 열 update 권한을 주었으므로(upsert의 DO UPDATE SET) 월요일로 옮기기는 되고, 월요일이 아닌 날로 옮기기와 남의 것으로 바꾸기는 막힌다
    expect((await a.from("weekly_goals").update({ week_start: "2000-01-04" }).eq("week_start", TEST_DAY).select("week_start")).error).not.toBeNull();
    expect(denied(await a.from("weekly_goals").update({ user_id: bId }).eq("week_start", TEST_DAY).select("week_start"))).toBe(true);
    expect(denied(await b.from("weekly_goals").delete().eq("user_id", aId).select("week_start"))).toBe(true);
    const del = await a.from("weekly_goals").delete().eq("week_start", TEST_DAY).select("week_start");
    expect(del.error).toBeNull();
  });
});

describe("push_subscriptions (푸시 구독)", () => {
  it("A는 구독을 저장하고 지운다. https가 아닌 주소는 check가 막고, B는 못 읽고 못 지운다", async () => {
    const endpoint = `https://example.invalid/push/${randomUUID()}`;
    const ok = await a.from("push_subscriptions").insert({ endpoint, p256dh: "key-a", auth: "auth-a" }).select("id");
    expect(ok.error).toBeNull();
    expect((await a.from("push_subscriptions").insert({ endpoint, p256dh: "key-a", auth: "auth-a" }).select("id")).error?.code).toBe("23505");
    expect((await b.from("push_subscriptions").select("id").eq("endpoint", endpoint)).data ?? []).toHaveLength(0);
    expect(denied(await b.from("push_subscriptions").delete().eq("endpoint", endpoint).select("id"))).toBe(true);
    expect((await a.from("push_subscriptions").insert({ endpoint: "http://example.invalid/x", p256dh: "k", auth: "a" }).select("id")).error).not.toBeNull();
    expect((await a.from("push_subscriptions").update({ p256dh: "other" }).eq("endpoint", endpoint).select("id")).error?.code).toBe("42501");
    const del = await a.from("push_subscriptions").delete().eq("endpoint", endpoint).select("id");
    expect(del.error).toBeNull();
    expect(del.data).toHaveLength(1);
  });
});

describe("todos 새 열(position)", () => {
  it("순서 열은 자기 행만 고치고 범위를 벗어나면 거절된다(0번)", async () => {
    const id = await newTodo(a);
    expect((await a.from("todos").update({ position: 2 }).eq("id", id).select("id")).error).toBeNull();
    expect((await a.from("todos").update({ position: 100001 }).eq("id", id).select("id")).error).not.toBeNull();
    expect(denied(await b.from("todos").update({ position: 1 }).eq("id", id).select("id"))).toBe(true);
  });
});
