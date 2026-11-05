/**
 * 할 일 서버 함수·Server Action이 화면 쪽에 돌려주는 모양.
 * 화면 코드도 import해도 되는 타입만 둔다(서버 비밀·암호화 코드 없음).
 */

/** 예상된 실패의 짧은 오류 코드(고정 목록). 내부 메시지·DB 오류 원문은 담지 않는다. */
export type TodoErrorCode =
  | "unauthenticated" // 세션이 없거나 만료·검증 실패. 모든 Action이 같은 코드를 쓴다(화면: 「로그인이 풀렸어요」)
  | "invalid_input" // 글이 문자열이 아님, id·분야 번호가 uuid가 아님, done이 참/거짓이 아님
  | "invalid_category" // 분야 번호가 없는 분야이거나 내 분야가 아님(DB 외래 키가 거절)
  | "empty" // 글이 앞뒤 공백을 지우면 0자
  | "too_long" // 글이 200자(코드 포인트)를 넘음
  | "not_found" // 끝냄 체크 대상이 없거나 내 할 일이 아님(바뀐 행 0)
  | "conflict" // 적기 id가 이미 쓰였는데 내 할 일로 보이지 않음
  | "daily_limit" // 한 사용자 하루 행 수 상한(DB, 임시 200)
  | "total_limit" // 한 사용자 전체 행 수 상한(DB, 임시 10000)
  | "config" // 서버 설정 오류(암호화 키 없음·길이 틀림, Supabase 주소·키 없음)
  | "unavailable"; // 일시 오류(네트워크·DB 등). 다시 해 볼 만한 것

export type TodoResult<T> = { ok: true; data: T } | { ok: false; error: TodoErrorCode };

/**
 * 화면에 넘기는 할 일 하나. 풀 수 없는 행은 readable=false, text=null. createdAt은 ISO 문자열.
 * categoryId는 분야 번호(categories.id). null이면 「기타」(D-135).
 */
export type TodoItem =
  | { id: string; readable: true; text: string; done: boolean; createdAt: string; categoryId: string | null }
  | { id: string; readable: false; text: null; done: boolean; createdAt: string; categoryId: string | null };

/** 두노 하루(서울 새벽 4시 경계)와 화면 날짜 글을 만들 재료. 예: 11월 5일 수요일 */
export type TodoDay = {
  date: string; // 'YYYY-MM-DD'
  year: number;
  month: number; // 1~12
  dayOfMonth: number; // 1~31
  weekday: number; // 0=일요일 … 6=토요일
};

export type TodayTodos = { day: TodoDay; todos: TodoItem[] };
export type AddedTodo = { day: TodoDay; todo: TodoItem };
export type TodoDoneState = { id: string; done: boolean };
