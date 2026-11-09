import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mapRecordDbError, recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";
import { decryptTodoText, encryptTodoText, type TodoKey } from "../todos/crypto";
import { resolveWriteDay } from "../todos/day";
import { todoIdSchema } from "../todos/validation";
import { checkNoteText, NOTE_MAX_LENGTH_PUBLIC } from "./public";
import { readLatestLogsForUser } from "../evening/core";
import { CATEGORY_PAGE_LOG_LIMIT, CATEGORY_PAGE_TODO_LIMIT, categoryPageFromDay, mergeCategoryMinutes } from "./category-minutes";
import type { CategoryPageData, CategoryPageTodo, NoteItem } from "./types";

/**
 * 할 일마다 작업 기록(PRD 7-2)과 분야 페이지(7-4, G13-a)의 서버 함수. 서버 전용.
 * 같은 규칙: 함수마다 자기 안에서 세션 확인(getClaims), user_id는 세션에서만, 날짜는 서버 시계, 예상된 실패는 짧은 코드.
 * 글은 할 일 글과 같은 키로 암호화한다(AAD 용도 todo_note).
 */

export type NotesDeps = { supabase: SupabaseClient; key: TodoKey | null; now?: () => Date };

/** 임시, 결정 필요: 작업 기록 한 개 글자 수 상한 2000(코드 포인트). 화면과 같은 값(lib/notes/public.ts) */
export const NOTE_MAX_LENGTH = NOTE_MAX_LENGTH_PUBLIC;
/** 분야 페이지가 읽는 할 일 수 상한(임시, 최근 것부터). 값은 lib/notes/category-minutes.ts(기기 먼저 저장도 같은 값) */
export { CATEGORY_PAGE_TODO_LIMIT };

const serverNow = () => new Date();
export { checkNoteText };
export type { NoteTextCheck } from "./public";

type NoteRow = { id: string; todo_id: string; day: string; note_encrypted: string; created_at: string };
const NOTE_COLUMNS = "id, todo_id, day, note_encrypted, created_at";

function toNote(row: NoteRow, userId: string, key: TodoKey): NoteItem {
  const opened = decryptTodoText(row.note_encrypted, userId, key, "todo_note");
  const base = { id: row.id, todoId: row.todo_id, day: row.day, createdAt: row.created_at };
  return opened.ok ? { ...base, readable: true, text: opened.text } : { ...base, readable: false, text: null };
}

const noteIdSchema = z.uuid();

/**
 * 작업 기록 더하기. id는 화면이 만든 uuid(같은 id를 다시 보내도 새로 만들지 않는다). 없는 할 일·남의 할 일이면 not_found.
 * writtenAt(기기가 적은 때, ISO)이 최근 72시간 안·미래 5분 이내면 그 때의 두노 하루로 넣는다(기기 먼저 저장, 고침 3바퀴). 아니면 서버 시계.
 */
export async function addNoteForUser(
  deps: NotesDeps,
  id: unknown,
  todoId: unknown,
  text: unknown,
  writtenAt?: unknown,
): Promise<RecordResult<{ note: NoteItem }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedId = noteIdSchema.safeParse(id);
    const parsedTodo = todoIdSchema.safeParse(todoId);
    if (!parsedId.success || !parsedTodo.success) return recordFail("invalid_input");
    const checked = checkNoteText(text);
    if (!checked.ok) return recordFail(checked.error);
    if (!deps.key) return recordFail("config");
    const key = deps.key;

    const day = resolveWriteDay((deps.now ?? serverNow)(), writtenAt);
    const encrypted = encryptTodoText(checked.text, user.data, key, "todo_note");
    const { data, error } = await deps.supabase
      .from("todo_notes")
      .insert({ id: parsedId.data, user_id: user.data, todo_id: parsedTodo.data, day, note_encrypted: encrypted })
      .select(NOTE_COLUMNS);
    if (error) {
      if (error.code === "23505" || error.code === "P0001") {
        const existing = await deps.supabase
          .from("todo_notes")
          .select(NOTE_COLUMNS)
          .eq("id", parsedId.data)
          .eq("user_id", user.data);
        const row = ((existing.data ?? []) as NoteRow[])[0];
        if (!existing.error && row) return { ok: true, data: { note: toNote(row, user.data, key) } };
      }
      return recordFail(mapRecordDbError(error));
    }
    const row = ((data ?? []) as NoteRow[])[0];
    if (!row) return recordFail("unavailable");
    return {
      ok: true,
      data: { note: { id: row.id, todoId: row.todo_id, day: row.day, createdAt: row.created_at, readable: true, text: checked.text } },
    };
  } catch {
    return recordFail("unavailable");
  }
}

/** 그 할 일의 작업 기록(오래된 것이 위) */
export async function listNotesForTodo(deps: NotesDeps, todoId: unknown): Promise<RecordResult<{ notes: NoteItem[] }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedTodo = todoIdSchema.safeParse(todoId);
    if (!parsedTodo.success) return recordFail("invalid_input");
    if (!deps.key) return recordFail("config");
    const key = deps.key;
    const { data, error } = await deps.supabase
      .from("todo_notes")
      .select(NOTE_COLUMNS)
      .eq("user_id", user.data)
      .eq("todo_id", parsedTodo.data)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) return recordFail(mapRecordDbError(error));
    return { ok: true, data: { notes: ((data ?? []) as NoteRow[]).map((row) => toNote(row, user.data, key)) } };
  } catch {
    return recordFail("unavailable");
  }
}

/** 작업 기록 지우기. 남의 것·없는 것은 not_found */
export async function deleteNoteForUser(deps: Pick<NotesDeps, "supabase">, id: unknown): Promise<RecordResult<{ id: string }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedId = noteIdSchema.safeParse(id);
    if (!parsedId.success) return recordFail("invalid_input");
    const { data, error } = await deps.supabase
      .from("todo_notes")
      .delete()
      .eq("id", parsedId.data)
      .eq("user_id", user.data)
      .select("id");
    if (error) return recordFail(mapRecordDbError(error));
    if (((data ?? []) as { id: string }[]).length === 0) return recordFail("not_found");
    return { ok: true, data: { id: parsedId.data } };
  } catch {
    return recordFail("unavailable");
  }
}

type TodoPageRow = { id: string; day: string; text_encrypted: string; done: boolean; created_at: string };

const CHUNK = 100;

/**
 * 분야 페이지: 그 분야(categoryId, null이면 기타)의 할 일을 날짜별로 모으고 각 할 일의 작업 기록을 붙인다.
 * 날짜는 최근 것이 위, 한 날 안은 적은 순서. 할 일은 최근 500개까지 읽는다(임시).
 * 날마다 minutes(그날 가장 늦은 오늘 기록에서 이 분야 분)를 붙이고, 시간만 있고 할 일이 없는 날도 날짜 목록에 든다(고침8).
 */
export async function readCategoryPage(deps: NotesDeps, categoryId: unknown): Promise<RecordResult<CategoryPageData>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedCategory = z.uuid().nullable().safeParse(categoryId);
    if (!parsedCategory.success) return recordFail("invalid_input");
    if (!deps.key) return recordFail("config");
    const key = deps.key;
    const category = parsedCategory.data;

    let query = deps.supabase.from("todos").select("id, day, text_encrypted, done, created_at").eq("user_id", user.data);
    query = category === null ? query.is("category_id", null) : query.eq("category_id", category);
    const todosRes = await query
      .order("day", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(CATEGORY_PAGE_TODO_LIMIT);
    if (todosRes.error) return recordFail(mapRecordDbError(todosRes.error));
    const todoRows = (todosRes.data ?? []) as TodoPageRow[];

    const notesByTodo = new Map<string, NoteItem[]>();
    for (let i = 0; i < todoRows.length; i += CHUNK) {
      const ids = todoRows.slice(i, i + CHUNK).map((r) => r.id);
      const notesRes = await deps.supabase
        .from("todo_notes")
        .select(NOTE_COLUMNS)
        .eq("user_id", user.data)
        .in("todo_id", ids)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (notesRes.error) return recordFail(mapRecordDbError(notesRes.error));
      for (const row of (notesRes.data ?? []) as NoteRow[]) {
        const list = notesByTodo.get(row.todo_id) ?? [];
        list.push(toNote(row, user.data, key));
        notesByTodo.set(row.todo_id, list);
      }
    }

    const days: { day: string; todos: CategoryPageTodo[] }[] = [];
    for (const row of todoRows) {
      let bucket = days[days.length - 1];
      if (!bucket || bucket.day !== row.day) {
        bucket = { day: row.day, todos: [] };
        days.push(bucket);
      }
      const opened = decryptTodoText(row.text_encrypted, user.data, key);
      bucket.todos.push({
        id: row.id,
        text: opened.ok ? opened.text : null,
        done: row.done,
        notes: notesByTodo.get(row.id) ?? [],
      });
    }
    // 날짜별 시간(고침8): 이미 저장된 오늘 기록을 읽기만 한다. 세션의 user id로만 읽고(앱 필터 + RLS), 분야 번호는 위 할 일 읽기와
    // 같은 검사(uuid · 내 할 일만)를 거친 값이다. 남의 분야 번호면 할 일이 비고, 내 기록의 items에 그 번호가 없어 분도 0이다.
    // 범위: 할 일을 상한까지 읽었으면 그 가장 오래된 날부터, 오늘 기록은 최근 것부터 CATEGORY_PAGE_LOG_LIMIT행까지(상태보기와 같은 상한).
    const fromDay = categoryPageFromDay(todoRows.length, days);
    const logs = await readLatestLogsForUser(deps.supabase, user.data, { fromDay, limit: CATEGORY_PAGE_LOG_LIMIT });
    if (!logs.ok) return logs;
    return { ok: true, data: { categoryId: category, days: mergeCategoryMinutes(days, logs.data, category, fromDay) } };
  } catch {
    return recordFail("unavailable");
  }
}
