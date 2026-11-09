/** 작업 기록·분야 페이지가 화면에 돌려주는 모양(서버 비밀 없음, 화면도 import해도 된다) */

/** 작업 기록 하나. 풀 수 없는 글은 readable=false, text=null */
export type NoteItem =
  | { id: string; todoId: string; day: string; createdAt: string; readable: true; text: string }
  | { id: string; todoId: string; day: string; createdAt: string; readable: false; text: null };

/** 분야 페이지의 날짜 한 칸: 그날 그 분야의 할 일과 각 할 일의 작업 기록 */
export type CategoryPageTodo = {
  id: string;
  text: string | null; // null은 풀 수 없는 글
  done: boolean;
  notes: NoteItem[];
};
/**
 * minutes = 그날 가장 늦은 오늘 기록에서 이 분야 분(없으면 0, 고침8). 날짜 목록은 할 일이 있는 날 ∪ 이 분야 시간이 있는 날이라
 * 시간만 있는 날은 todos가 빈 목록이다
 */
export type CategoryPageDay = { day: string; minutes: number; todos: CategoryPageTodo[] };

/** categoryId가 null이면 「기타」 페이지 */
export type CategoryPageData = { categoryId: string | null; days: CategoryPageDay[] };
