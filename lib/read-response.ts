import type { TodayRead } from "./today-types";

/**
 * 읽기 길(Route Handler, GET /todos/today)의 응답을 만든다.
 * - 사용자별 데이터라 어떤 캐시에도 남지 않게 Cache-Control: private, no-store를 단다(서비스 워커도 이 주소를 가로채지 않는다).
 * - 몸은 { todos, categories }이고, 각 칸은 core 함수가 돌려준 { ok, data } 또는 { ok: false, error: 짧은 코드 }다.
 *   받은 객체를 그대로 펼치지 않고 정해진 열만 다시 만든다(실수로 다른 값이 섞여도 나가지 않게). 오류 원문·스택은 담지 않는다.
 * - 상태 코드는 할 일 쪽 결과를 따른다(화면은 몸의 ok·error만 본다). 분야만 실패해도 200이다.
 */

export const READ_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
});

type AnyResult = { ok: true; data: unknown } | { ok: false; error: string };

function statusFor(result: AnyResult): number {
  if (result.ok) return 200;
  if (result.error === "unauthenticated") return 401;
  if (result.error === "config") return 500;
  if (result.error === "unavailable") return 503;
  return 400;
}

function pick(result: AnyResult): AnyResult {
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
}

export function readTodayResponse(read: TodayRead): Response {
  const body = { todos: pick(read.todos), categories: pick(read.categories) };
  return Response.json(body, { status: statusFor(read.todos), headers: READ_HEADERS });
}

/** 예상 못 한 예외 때: 두 칸 모두 unavailable */
export const TODAY_UNAVAILABLE: TodayRead = Object.freeze({
  todos: { ok: false, error: "unavailable" },
  categories: { ok: false, error: "unavailable" },
}) as TodayRead;
