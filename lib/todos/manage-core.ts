import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireUserId } from "../session";
import { addDays } from "../week";
import { CIPHERTEXT_MAX_LENGTH, decryptTodoText, encryptTodoText, type TodoKey } from "./crypto";
import { describeTodoDay, todoDayFor } from "./day";
import type { TodoErrorCode, TodoItem, TodoResult } from "./types";
import { checkTodoText, todoCategoryIdSchema, todoIdSchema } from "./validation";

/**
 * 할 일 고치기·지우기·순서·어제 것 가져오기(PRD 6절 0번, G12-a). 서버 전용.
 * lib/todos/core.ts와 같은 규칙: 함수마다 자기 안에서 세션을 확인하고(getClaims), user_id는 세션에서만 얻고,
 * 예상된 실패는 던지지 않고 짧은 코드로 돌려준다. 남의 행·없는 행은 바뀐 행 0이라 not_found.
 *
 * 순서는 todos.position(null 허용)으로 둔다. 목록은 created_at 순으로 읽은 뒤(기존 쿼리 그대로)
 * 서버가 position 오름차순(null은 뒤)으로 안정 정렬한다: sortByPosition.
 */

export type ManageDeps = { supabase: SupabaseClient; key: TodoKey | null; now?: () => Date };

const fail = (error: TodoErrorCode) => ({ ok: false, error }) as const;
const serverNow = () => new Date();

type DbError = { code?: string | null; hint?: string | null } | null | undefined;

function mapDbError(error: DbError): TodoErrorCode {
  if (!error) return "unavailable";
  if (error.code === "P0001" && error.hint === "todos_daily_limit") return "daily_limit";
  if (error.code === "P0001" && error.hint === "todos_total_limit") return "total_limit";
  if (error.code === "23514") return "invalid_input";
  if (error.code === "23505") return "conflict";
  if (error.code === "PGRST301" || error.code === "PGRST303") return "unauthenticated";
  return "unavailable";
}

type TodoRow = {
  id: string;
  day: string;
  text_encrypted: string;
  done: boolean;
  created_at: string;
  category_id: string | null;
  position?: number | null;
};
const ROW_COLUMNS = "id, day, text_encrypted, done, created_at, category_id, position";

/** position 오름차순(null은 뒤), 같으면 들어온 순서 그대로(안정 정렬) */
export function sortByPosition<T extends { position?: number | null }>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const pa = a.row.position ?? Number.POSITIVE_INFINITY;
      const pb = b.row.position ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa < pb ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

function toItem(row: TodoRow, userId: string, key: TodoKey): TodoItem {
  const opened = decryptTodoText(row.text_encrypted, userId, key);
  const categoryId = row.category_id ?? null;
  return opened.ok
    ? { id: row.id, readable: true, text: opened.text, done: row.done, createdAt: row.created_at, categoryId }
    : { id: row.id, readable: false, text: null, done: row.done, createdAt: row.created_at, categoryId };
}

const editSchema = z.object({ text: z.unknown().optional(), categoryId: todoCategoryIdSchema }).strict();

/**
 * 할 일 고치기: 글과 분야를 바꾼다(둘 중 하나만도 된다). 안 보낸 것은 그대로.
 * categoryId가 null이면 기타로 바꾼다. 날짜·id·끝냄은 여기서 바꾸지 않는다.
 */
export async function editTodoForUser(
  deps: ManageDeps,
  id: unknown,
  patch: unknown,
): Promise<TodoResult<{ todo: TodoItem }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedId = todoIdSchema.safeParse(id);
    const parsedPatch = editSchema.safeParse(patch);
    if (!parsedId.success || !parsedPatch.success) return fail("invalid_input");
    if (!deps.key) return fail("config");
    const key = deps.key;

    const hasText = parsedPatch.data.text !== undefined;
    const hasCategory = parsedPatch.data.categoryId !== undefined;
    if (!hasText && !hasCategory) return fail("invalid_input");
    const values: Record<string, unknown> = {};
    let plain: string | null = null;
    if (hasText) {
      const checked = checkTodoText(parsedPatch.data.text);
      if (!checked.ok) return fail(checked.error);
      const encrypted = encryptTodoText(checked.text, user.data, key);
      if (encrypted.length > CIPHERTEXT_MAX_LENGTH) return fail("too_long");
      values.text_encrypted = encrypted;
      plain = checked.text;
    }
    if (hasCategory) values.category_id = parsedPatch.data.categoryId ?? null;

    const { data, error } = await deps.supabase
      .from("todos")
      .update(values)
      .eq("id", parsedId.data)
      .eq("user_id", user.data)
      .select(ROW_COLUMNS);
    if (error) {
      if (error.code === "23503" && hasCategory) return fail("invalid_category");
      return fail(mapDbError(error));
    }
    const row = ((data ?? []) as TodoRow[])[0];
    if (!row) return fail("not_found");
    const item = toItem(row, user.data, key);
    return { ok: true, data: { todo: item.readable && plain !== null ? { ...item, text: plain } : item } };
  } catch {
    return fail("unavailable");
  }
}

/** 할 일 지우기(그 할 일의 작업 기록도 함께 지워진다: DB 외래 키 on delete cascade) */
export async function deleteTodoForUser(
  deps: Pick<ManageDeps, "supabase">,
  id: unknown,
): Promise<TodoResult<{ id: string }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedId = todoIdSchema.safeParse(id);
    if (!parsedId.success) return fail("invalid_input");
    const { data, error } = await deps.supabase
      .from("todos")
      .delete()
      .eq("id", parsedId.data)
      .eq("user_id", user.data)
      .select("id");
    if (error) return fail(mapDbError(error));
    if (((data ?? []) as { id: string }[]).length === 0) return fail("not_found");
    return { ok: true, data: { id: parsedId.data } };
  } catch {
    return fail("unavailable");
  }
}

const idListSchema = z.array(todoIdSchema).min(1).max(200);

/**
 * 순서 정하기: 화면에 보이는 순서대로 id 목록을 받아 position 0,1,2…를 매긴다.
 * 같은 값을 여러 번 보내도 결과가 같다. 하나라도 내 할 일이 아니면 not_found(이미 바뀐 것은 그대로 남는다, 임시).
 */
export async function reorderTodosForUser(
  deps: Pick<ManageDeps, "supabase">,
  ids: unknown,
): Promise<TodoResult<{ ids: string[] }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsed = idListSchema.safeParse(ids);
    if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) return fail("invalid_input");
    const results = await Promise.all(
      parsed.data.map((id, index) =>
        deps.supabase.from("todos").update({ position: index }).eq("id", id).eq("user_id", user.data).select("id"),
      ),
    );
    for (const res of results) {
      if (res.error) return fail(mapDbError(res.error));
      if (((res.data ?? []) as { id: string }[]).length === 0) return fail("not_found");
    }
    return { ok: true, data: { ids: parsed.data } };
  } catch {
    return fail("unavailable");
  }
}

/** 어제(서울 새벽 4시 기준) 못 끝낸 내 할 일. 가져올 것을 사용자가 고르게 목록을 준다. */
export async function listCarryOverCandidates(deps: ManageDeps): Promise<TodoResult<{ todos: TodoItem[] }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (!deps.key) return fail("config");
    const key = deps.key;
    const today = todoDayFor((deps.now ?? serverNow)());
    const yesterday = addDays(today, -1);
    const { data, error } = await deps.supabase
      .from("todos")
      .select(ROW_COLUMNS)
      .eq("user_id", user.data)
      .eq("day", yesterday)
      .eq("done", false)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) return fail(mapDbError(error));
    // 이미 가져온 것은 후보에서 뺀다. 가져오기는 암호문을 그대로 복사하므로(IV까지 같다), 오늘 할 일(끝낸 것 포함)과
    // text_encrypted가 같은 어제 것은 이미 가져온 것이다. 마이그레이션 없이 알아본다(A2).
    // 가져온 뒤 오늘 쪽 글을 고치면 암호문이 달라져 다시 후보에 나올 수 있다(알려진 한계, 보고에 적음).
    const todayRows = await deps.supabase.from("todos").select("text_encrypted").eq("user_id", user.data).eq("day", today);
    if (todayRows.error) return fail(mapDbError(todayRows.error));
    const taken = new Set(((todayRows.data ?? []) as { text_encrypted: string }[]).map((r) => r.text_encrypted));
    const rows = ((data ?? []) as TodoRow[]).filter((row) => !taken.has(row.text_encrypted));
    const todos = sortByPosition(rows).map((row) => toItem(row, user.data, key));
    return { ok: true, data: { todos } };
  } catch {
    return fail("unavailable");
  }
}

const carrySchema = z.array(z.object({ from: todoIdSchema, id: todoIdSchema }).strict()).min(1).max(50);

/**
 * 어제 못 끝낸 할 일을 오늘로 가져온다. 글(암호문)과 분야를 그대로 복사해 새 할 일을 만들고, 어제 것은 그대로 둔다(앱이 알아서 넘기지 않는다).
 * from은 어제의 내 할 일이어야 한다. id는 화면이 만든 uuid라 같은 요청을 다시 보내도 새로 만들지 않는다.
 */
export async function carryOverTodosForUser(
  deps: ManageDeps,
  items: unknown,
): Promise<TodoResult<{ todos: TodoItem[]; day: ReturnType<typeof describeTodoDay> }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsed = carrySchema.safeParse(items);
    if (!parsed.success) return fail("invalid_input");
    if (!deps.key) return fail("config");
    const key = deps.key;
    const today = todoDayFor((deps.now ?? serverNow)());
    const yesterday = addDays(today, -1);

    const sources = await deps.supabase.from("todos").select(ROW_COLUMNS).eq("user_id", user.data).eq("day", yesterday);
    if (sources.error) return fail(mapDbError(sources.error));
    const byId = new Map(((sources.data ?? []) as TodoRow[]).map((row) => [row.id, row]));

    const created: TodoItem[] = [];
    for (const { from, id } of parsed.data) {
      const source = byId.get(from);
      if (!source) return fail("not_found");
      const values: Record<string, string> = {
        id,
        user_id: user.data,
        day: today,
        text_encrypted: source.text_encrypted,
      };
      if (source.category_id) values.category_id = source.category_id;
      const { data, error } = await deps.supabase.from("todos").insert(values).select(ROW_COLUMNS);
      if (error) {
        if (error.code === "23505" || error.code === "P0001") {
          const existing = await deps.supabase.from("todos").select(ROW_COLUMNS).eq("id", id).eq("user_id", user.data);
          const row = ((existing.data ?? []) as TodoRow[])[0];
          if (!existing.error && row) {
            created.push(toItem(row, user.data, key));
            continue;
          }
        }
        return fail(mapDbError(error));
      }
      const row = ((data ?? []) as TodoRow[])[0];
      if (!row) return fail("unavailable");
      created.push(toItem(row, user.data, key));
    }
    return { ok: true, data: { todos: created, day: describeTodoDay(today) } };
  } catch {
    return fail("unavailable");
  }
}
