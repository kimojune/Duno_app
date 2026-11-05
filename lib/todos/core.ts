import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CIPHERTEXT_MAX_LENGTH, decryptTodoText, encryptTodoText, type TodoKey } from "./crypto";
import { describeTodoDay, todoDayFor } from "./day";
import type { AddedTodo, TodayTodos, TodoDoneState, TodoErrorCode, TodoItem, TodoResult } from "./types";
import { checkTodoText, todoDoneSchema, todoIdSchema } from "./validation";

/**
 * 할 일 데이터 접근의 핵심(서버 전용). Supabase 클라이언트·키·시계를 인자로 받아 시험할 수 있게 뗐다.
 * - 함수마다 자기 안에서 세션을 확인한다(getClaims, 서명 검증). getSession 값은 믿지 않는다.
 * - 사용자 id는 세션에서, 날짜는 서버가 요청을 받은 시각과 todoDayFor로 정한다. 호출자가 user_id·날짜를 넘길 길이 없다.
 * - 예상된 실패는 던지지 않고 짧은 오류 코드로 돌려준다. DB 오류 원문·평문·키를 로그나 반환값에 담지 않는다.
 */

export type TodoDeps = {
  supabase: SupabaseClient;
  key: TodoKey | null;
  /** 서버 시계. 시험에서만 바꾼다. */
  now?: () => Date;
};

const fail = (error: TodoErrorCode) => ({ ok: false, error }) as const;
const userIdSchema = z.guid();
const serverNow = () => new Date();

/** 세션에서 사용자 id를 얻는다. 없거나 만료·검증 실패면 unauthenticated. */
async function requireUserId(supabase: SupabaseClient): Promise<TodoResult<string>> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return fail("unauthenticated");
    const sub = userIdSchema.safeParse(data.claims.sub);
    return sub.success ? { ok: true, data: sub.data } : fail("unauthenticated");
  } catch {
    return fail("unavailable");
  }
}

type DbError = { code?: string | null; hint?: string | null } | null | undefined;

/** DB 오류를 짧은 코드로. 원문은 버린다. */
function mapDbError(error: DbError): TodoErrorCode {
  if (!error) return "unavailable";
  if (error.code === "P0001" && error.hint === "todos_daily_limit") return "daily_limit";
  if (error.code === "P0001" && error.hint === "todos_total_limit") return "total_limit";
  if (error.code === "23514") return "invalid_input"; // check 제약(형식·길이)
  if (error.code === "23505") return "conflict"; // 같은 id
  if (error.code === "PGRST301" || error.code === "PGRST303") return "unauthenticated"; // JWT 만료·검증 실패
  return "unavailable";
}

type TodoRow = { id: string; day: string; text_encrypted: string; done: boolean; created_at: string };
const ROW_COLUMNS = "id, day, text_encrypted, done, created_at";

function toItem(row: TodoRow, userId: string, key: TodoKey): TodoItem {
  const opened = decryptTodoText(row.text_encrypted, userId, key);
  return opened.ok
    ? { id: row.id, readable: true, text: opened.text, done: row.done, createdAt: row.created_at }
    : { id: row.id, readable: false, text: null, done: row.done, createdAt: row.created_at };
}

/** 오늘(서울 새벽 4시 기준) 내 할 일 목록. created_at 오름차순, 같으면 id. 풀 수 없는 행은 그 행만 readable=false. */
export async function listTodosForToday(deps: TodoDeps): Promise<TodoResult<TodayTodos>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (!deps.key) return fail("config");
    const key = deps.key;
    const day = todoDayFor((deps.now ?? serverNow)());

    const { data, error } = await deps.supabase
      .from("todos")
      .select(ROW_COLUMNS)
      .eq("user_id", user.data)
      .eq("day", day)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) return fail(mapDbError(error));

    const todos = ((data ?? []) as TodoRow[]).map((row) => toItem(row, user.data, key));
    return { ok: true, data: { day: describeTodoDay(day), todos } };
  } catch {
    return fail("unavailable");
  }
}

/**
 * 오늘 날짜로 할 일을 적는다. 받는 것은 화면이 만든 uuid와 글뿐이다(user_id·날짜는 받지 않는다).
 * 같은 id로 다시 오면(재시도) 새 행을 만들지 않고, 그 id의 행이 내 것으로 보이면 그 행으로 성공한다.
 * 보이지 않으면(남의 행과 id가 겹침) conflict.
 */
export async function createTodoForToday(deps: TodoDeps, id: unknown, text: unknown): Promise<TodoResult<AddedTodo>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedId = todoIdSchema.safeParse(id);
    if (!parsedId.success) return fail("invalid_input");
    const checked = checkTodoText(text);
    if (!checked.ok) return fail(checked.error);
    if (!deps.key) return fail("config");
    const key = deps.key;

    const day = todoDayFor((deps.now ?? serverNow)());
    const textEncrypted = encryptTodoText(checked.text, user.data, key);
    if (textEncrypted.length > CIPHERTEXT_MAX_LENGTH) return fail("too_long");

    const { data, error } = await deps.supabase
      .from("todos")
      .insert({ id: parsedId.data, user_id: user.data, day, text_encrypted: textEncrypted })
      .select(ROW_COLUMNS);

    if (error) {
      // 같은 id(23505)거나, 이미 들어간 뒤 상한에 걸린 재시도(P0001)라면 내 행이 있는지 본다.
      if (error.code === "23505" || error.code === "P0001") {
        const existing = await deps.supabase
          .from("todos")
          .select(ROW_COLUMNS)
          .eq("id", parsedId.data)
          .eq("user_id", user.data);
        if (existing.error) return fail("unavailable");
        const row = ((existing.data ?? []) as TodoRow[])[0];
        if (row) return { ok: true, data: { day: describeTodoDay(row.day), todo: toItem(row, user.data, key) } };
      }
      return fail(mapDbError(error));
    }

    const row = ((data ?? []) as TodoRow[])[0];
    if (!row) return fail("unavailable");
    return {
      ok: true,
      data: {
        day: describeTodoDay(row.day),
        todo: { id: row.id, readable: true, text: checked.text, done: row.done, createdAt: row.created_at },
      },
    };
  } catch {
    return fail("unavailable");
  }
}

/** 끝냄 값을 원하는 값으로 둔다(뒤집기 아님, 여러 번 보내도 같다). 남의 id·없는 id는 바뀐 행 0이라 not_found. */
export async function setTodoDoneForUser(
  deps: Pick<TodoDeps, "supabase">,
  id: unknown,
  done: unknown,
): Promise<TodoResult<TodoDoneState>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedId = todoIdSchema.safeParse(id);
    const parsedDone = todoDoneSchema.safeParse(done);
    if (!parsedId.success || !parsedDone.success) return fail("invalid_input");

    const { data, error } = await deps.supabase
      .from("todos")
      .update({ done: parsedDone.data })
      .eq("id", parsedId.data)
      .eq("user_id", user.data)
      .select("id, done");
    if (error) return fail(mapDbError(error));
    const row = ((data ?? []) as TodoDoneState[])[0];
    if (!row) return fail("not_found");

    return { ok: true, data: { id: row.id, done: row.done } };
  } catch {
    return fail("unavailable");
  }
}
