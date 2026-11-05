"use server";

import { createTodayTodo, listTodayTodos, updateTodoDone } from "../../lib/todos/dal";
import type { AddedTodo, TodayTodos, TodoDoneState, TodoResult } from "../../lib/todos/types";

/**
 * 할 일 Server Action. 공개 HTTP 엔드포인트라 인자는 클라이언트가 마음대로 보낼 수 있다.
 * - 인자는 unknown으로 받아 서버에서 검증한다. user_id·날짜는 받지 않는다(세션·서버 시계로 정한다).
 * - 예상된 실패는 짧은 오류 코드로 돌려준다. 예상 못 한 예외도 unavailable로 바꾸고 원문을 내지 않는다.
 * - 로그인이 풀리면 모두 { ok: false, error: "unauthenticated" }. redirect하지 않는다.
 */

/** 오늘 목록. 서버 컴포넌트는 lib/todos/dal의 listTodayTodos를 바로 불러도 된다. */
export async function getTodayTodos(): Promise<TodoResult<TodayTodos>> {
  try {
    return await listTodayTodos();
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** 할 일 적기. id는 화면이 crypto.randomUUID()로 만들고, 재시도 때 같은 id를 다시 보낸다. */
export async function addTodo(id: unknown, text: unknown): Promise<TodoResult<AddedTodo>> {
  try {
    return await createTodayTodo(id, text);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** 끝냄 체크. done은 원하는 값(참·거짓). 같은 값을 여러 번 보내도 결과가 같다. */
export async function setTodoDone(id: unknown, done: unknown): Promise<TodoResult<TodoDoneState>> {
  try {
    return await updateTodoDone(id, done);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
