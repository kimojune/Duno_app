import "server-only";
import { createClient } from "../supabase/server";
import { createTodoForToday, listTodosForToday, setTodoDoneForUser } from "./core";
import { getTodoKeyFromEnv } from "./crypto";
import type { AddedTodo, TodayTodos, TodoDoneState, TodoResult } from "./types";

/**
 * 할 일 데이터 접근 계층(서버 전용). 요청마다 서버 클라이언트를 새로 만들고, 키는 서버 환경 변수에서 읽는다.
 * 인증·인가는 core 함수 안에서 한다(getClaims). 사용자 데이터라 use cache를 쓰지 않는다.
 * 서버 컴포넌트는 listTodayTodos를 바로 부르고, 쓰기는 app/todos/actions.ts의 Server Action을 거친다.
 */

export async function listTodayTodos(): Promise<TodoResult<TodayTodos>> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "config" };
  return listTodosForToday({ supabase, key: getTodoKeyFromEnv() });
}

export async function createTodayTodo(id: unknown, text: unknown): Promise<TodoResult<AddedTodo>> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "config" };
  return createTodoForToday({ supabase, key: getTodoKeyFromEnv() }, id, text);
}

export async function updateTodoDone(id: unknown, done: unknown): Promise<TodoResult<TodoDoneState>> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "config" };
  return setTodoDoneForUser({ supabase }, id, done);
}
