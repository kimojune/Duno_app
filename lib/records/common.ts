/**
 * 새 기록 표(작업 기록·저녁 기록·설정·타이머 등)의 서버 함수가 같이 쓰는 오류 모양.
 * 할 일·분야 core(lib/todos/core.ts, lib/categories/core.ts)와 같은 규칙이다:
 * 예상된 실패는 던지지 않고 짧은 코드로 돌려준다. DB 오류 원문·평문·키는 담지 않는다.
 */
export type RecordErrorCode =
  | "unauthenticated" // 세션 없음·만료
  | "invalid_input" // 형식 틀림(uuid·날짜·숫자 범위 등)
  | "empty" // 빈 글
  | "too_long" // 글자 수 넘음
  | "not_found" // 대상이 없거나 내 것이 아님
  | "conflict" // 같은 id가 남의 행과 겹침
  | "limit" // 개수 상한(DB 트리거)
  | "already_running" // 타이머: 이미 진행 중인 타이머가 있어 새로 시작하지 않음(B3)
  | "config" // 서버 설정 오류(암호화 키 없음, Supabase 주소·키 없음)
  | "unavailable"; // 일시 오류

export type RecordResult<T> = { ok: true; data: T } | { ok: false; error: RecordErrorCode };

export const recordFail = (error: RecordErrorCode) => ({ ok: false, error }) as const;

type DbError = { code?: string | null; hint?: string | null } | null | undefined;

/** DB 오류를 짧은 코드로. 원문은 버린다. */
export function mapRecordDbError(error: DbError): RecordErrorCode {
  if (!error) return "unavailable";
  if (error.code === "P0001") return "limit";
  if (error.code === "23514") return "invalid_input"; // check 제약
  if (error.code === "23505") return "conflict"; // 같은 id
  if (error.code === "23503") return "not_found"; // 외래 키: 가리킨 행이 없거나 남의 것
  if (error.code === "PGRST301" || error.code === "PGRST303") return "unauthenticated";
  return "unavailable";
}
