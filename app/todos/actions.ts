"use server";

import { createMyCategory } from "../../lib/categories/dal";
import type { AddCategoryResult } from "../../lib/categories/types";
import { createTodayTodo, updateTodoDone } from "../../lib/todos/dal";
import type { AddedTodo, TodoDoneState, TodoResult } from "../../lib/todos/types";

/**
 * 할 일·분야 Server Action(쓰기만). 공개 HTTP 엔드포인트라 인자는 클라이언트가 마음대로 보낼 수 있다.
 * - 인자는 unknown으로 받아 서버에서 검증한다. user_id·날짜는 받지 않는다(세션·서버 시계로 정한다).
 * - 예상된 실패는 짧은 오류 코드로 돌려준다. 예상 못 한 예외도 unavailable로 바꾸고 원문을 내지 않는다.
 * - 로그인이 풀리면 모두 { ok: false, error: "unauthenticated" }. redirect하지 않는다.
 *
 * 읽기(오늘 목록·분야 목록)는 여기 두지 않는다(MO-17): Server Action은 줄 서서 하나씩 돌아, 적기·체크가 걸려 있으면
 * 다시 불러오기가 그 뒤에 선다. 처음 목록은 app/page.tsx가 DAL에서 읽고, 다시 읽기는 GET /todos/today(할 일+분야 함께).
 */

/**
 * 할 일 적기. id는 화면이 crypto.randomUUID()로 만들고, 재시도 때 같은 id를 다시 보낸다.
 * categoryId는 분야 번호(없거나 null이면 「기타」). 남의 분야·없는 분야면 invalid_category.
 */
export async function addTodo(
  id: unknown,
  text: unknown,
  categoryId?: unknown,
  writtenAt?: unknown,
): Promise<TodoResult<AddedTodo>> {
  try {
    // writtenAt(오프라인으로 적은 때, ISO 시각)은 최근 72시간 안이면 그 시각의 하루로 들어가고 아니면 서버 시계(PRD 10절).
    // 없으면 옛 호출 꼴 그대로 부른다(인자 수가 늘지 않게).
    return writtenAt === undefined
      ? await createTodayTodo(id, text, categoryId)
      : await createTodayTodo(id, text, categoryId, writtenAt);
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

/**
 * 분야 더하기(적는 창 칩 줄 끝 「+ 분야」, D-125). id는 화면이 crypto.randomUUID()로 만들고, 재시도 때 같은 id를 보낸다.
 * 같은 id로 다시 오면(15초 한도 뒤 재시도 포함) 새 행을 만들지 않고 그 행으로 성공한다.
 * 같은 이름은 { ok: false, error: "duplicate", existing: { id, name } }, 「기타」는 reserved(임시, 결정 필요).
 */
export async function addCategory(id: unknown, name: unknown): Promise<AddCategoryResult> {
  try {
    return await createMyCategory(id, name);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
