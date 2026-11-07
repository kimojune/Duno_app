import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUserId } from "../session";
import { CIPHERTEXT_MAX_LENGTH, decryptTodoText, encryptTodoText, type TodoKey } from "./crypto";
import { describeTodoDay, resolveWriteDay, todoDayFor } from "./day";
import { sortByPosition } from "./manage-core";
import type { AddedTodo, TodayTodos, TodoDoneState, TodoErrorCode, TodoItem, TodoResult } from "./types";
import { checkTodoText, todoCategoryIdSchema, todoDoneSchema, todoIdSchema } from "./validation";

/**
 * 할 일 데이터 접근의 핵심(서버 전용). Supabase 클라이언트·키·시계를 인자로 받아 시험할 수 있게 뗐다.
 * - 함수마다 자기 안에서 세션을 확인한다(lib/session의 getClaims, 서명 검증). getSession 값은 믿지 않는다.
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
const serverNow = () => new Date();

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

type TodoRow = {
  id: string;
  day: string;
  text_encrypted: string;
  done: boolean;
  created_at: string;
  category_id: string | null;
  /** 순서(0부터, null은 뒤). 고치는 길은 lib/todos/manage-core.ts. 화면에는 내보내지 않고 정렬에만 쓴다 */
  position?: number | null;
};
const ROW_COLUMNS = "id, day, text_encrypted, done, created_at, category_id, position";

function toItem(row: TodoRow, userId: string, key: TodoKey): TodoItem {
  const opened = decryptTodoText(row.text_encrypted, userId, key);
  const categoryId = row.category_id ?? null;
  return opened.ok
    ? { id: row.id, readable: true, text: opened.text, done: row.done, createdAt: row.created_at, categoryId }
    : { id: row.id, readable: false, text: null, done: row.done, createdAt: row.created_at, categoryId };
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

    // 읽는 쿼리는 created_at·id 순 그대로 두고, 순서를 정한 행(position)만 앞으로 안정 정렬한다
    const todos = sortByPosition((data ?? []) as TodoRow[]).map((row) => toItem(row, user.data, key));
    return { ok: true, data: { day: describeTodoDay(day), todos } };
  } catch {
    return fail("unavailable");
  }
}

/**
 * 오늘 날짜로 할 일을 적는다. 받는 것은 화면이 만든 uuid와 글, 분야 번호뿐이다(user_id·날짜는 받지 않는다).
 * 분야 번호가 없거나 null이면 「기타」. uuid가 아니면 invalid_input, 없는 분야·남의 분야면 DB 외래 키가 거절해 invalid_category.
 * 같은 id로 다시 오면(재시도) 새 행을 만들지 않고, 그 id의 행이 내 것으로 보이면 그 행으로 성공한다.
 * 보이지 않으면(남의 행과 id가 겹침) conflict.
 */
export async function createTodoForToday(
  deps: TodoDeps,
  id: unknown,
  text: unknown,
  categoryId?: unknown,
  writtenAt?: unknown,
): Promise<TodoResult<AddedTodo>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedId = todoIdSchema.safeParse(id);
    if (!parsedId.success) return fail("invalid_input");
    const parsedCategory = todoCategoryIdSchema.safeParse(categoryId);
    if (!parsedCategory.success) return fail("invalid_input");
    const category = parsedCategory.data ?? null;
    const checked = checkTodoText(text);
    if (!checked.ok) return fail(checked.error);
    if (!deps.key) return fail("config");
    const key = deps.key;

    // 오프라인으로 적은 글은 적은 때(writtenAt)의 하루로 들어간다. 믿는 범위(최근 72시간, 미래 5분)만 따르고 아니면 서버 시계(PRD 10절)
    const day = resolveWriteDay((deps.now ?? serverNow)(), writtenAt);
    const textEncrypted = encryptTodoText(checked.text, user.data, key);
    if (textEncrypted.length > CIPHERTEXT_MAX_LENGTH) return fail("too_long");

    // 기타(null)는 열을 보내지 않는다(기본값 null). 분야가 있을 때만 category_id를 싣는다.
    const values: Record<string, string> = { id: parsedId.data, user_id: user.data, day, text_encrypted: textEncrypted };
    if (category !== null) values.category_id = category;
    const { data, error } = await deps.supabase.from("todos").insert(values).select(ROW_COLUMNS);

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
      // 분야 외래 키(todos_category_owner_fkey) 위반: 없는 분야이거나 남의 분야
      if (error.code === "23503" && category !== null) return fail("invalid_category");
      return fail(mapDbError(error));
    }

    const row = ((data ?? []) as TodoRow[])[0];
    if (!row) return fail("unavailable");
    return {
      ok: true,
      data: {
        day: describeTodoDay(row.day),
        todo: {
          id: row.id,
          readable: true,
          text: checked.text,
          done: row.done,
          createdAt: row.created_at,
          categoryId: row.category_id ?? null,
        },
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
