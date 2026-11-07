import "server-only";
import { createClient } from "../supabase/server";
import { createTodoForToday, setTodoDoneForUser } from "./core";
import { getTodoKeyFromEnv } from "./crypto";
import type { AddedTodo, TodoDoneState, TodoResult } from "./types";

/**
 * 할 일 데이터 접근 계층(서버 전용). 요청마다 서버 클라이언트를 새로 만들고, 키는 서버 환경 변수에서 읽는다.
 * 인증·인가는 core 함수 안에서 한다(getClaims). 사용자 데이터라 use cache를 쓰지 않는다.
 * 읽기: 분야 목록과 함께 lib/today-dal.ts의 readToday가 한다(서버 컴포넌트 app/page.tsx가 바로 부르고,
 *   화면이 다시 읽을 때는 GET /todos/today).
 * 읽기를 Server Action으로 하지 않는다: Action은 줄 서서 하나씩 돌아, 적기·체크가 걸려 있으면 다시 불러오기가 그 뒤에 선다(MO-17).
 * 쓰기: app/todos/actions.ts의 Server Action.
 */

export async function createTodayTodo(
  id: unknown,
  text: unknown,
  categoryId?: unknown,
  writtenAt?: unknown,
): Promise<TodoResult<AddedTodo>> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "config" };
  return createTodoForToday({ supabase, key: getTodoKeyFromEnv() }, id, text, categoryId, writtenAt);
}

export async function updateTodoDone(id: unknown, done: unknown): Promise<TodoResult<TodoDoneState>> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "config" };
  return setTodoDoneForUser({ supabase }, id, done);
}
