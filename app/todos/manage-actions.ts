"use server";

import { getDeps } from "../../lib/deps";
import { addNoteForUser, deleteNoteForUser } from "../../lib/notes/core";
import type { NoteItem } from "../../lib/notes/types";
import type { RecordResult } from "../../lib/records/common";
import { carryOverTodosForUser, deleteTodoForUser, editTodoForUser, reorderTodosForUser } from "../../lib/todos/manage-core";
import type { TodoItem, TodoResult } from "../../lib/todos/types";

/**
 * 할 일 고치기·지우기·순서·가져오기와 작업 기록 쓰기 Server Action(PRD 0·0-1번). 공개 HTTP 엔드포인트라 인자는 모두 unknown으로 받아
 * 서버에서 다시 검증한다. user_id·날짜는 받지 않는다. 예상 못 한 예외는 unavailable로 바꾸고 원문을 내지 않는다.
 * 읽기(어제 못 끝낸 것, 작업 기록 목록, 분야 페이지)는 Route Handler다(app/todos/yesterday, app/notes, app/category).
 */

export async function editTodo(id: unknown, patch: unknown): Promise<TodoResult<{ todo: TodoItem }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await editTodoForUser(deps, id, patch);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function deleteTodo(id: unknown): Promise<TodoResult<{ id: string }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await deleteTodoForUser(deps, id);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function reorderTodos(ids: unknown): Promise<TodoResult<{ ids: string[] }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await reorderTodosForUser(deps, ids);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function carryOverTodos(items: unknown): ReturnType<typeof carryOverTodosForUser> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await carryOverTodosForUser(deps, items);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function addNote(id: unknown, todoId: unknown, text: unknown): Promise<RecordResult<{ note: NoteItem }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await addNoteForUser(deps, id, todoId, text);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function deleteNote(id: unknown): Promise<RecordResult<{ id: string }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await deleteNoteForUser(deps, id);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
