import type { CategoryList, CategoryResult } from "./categories/types";
import type { TodayTodos, TodoResult } from "./todos/types";

/**
 * 오늘 화면 한 번 읽기의 결과(디자인 명세 C-D5): 할 일 목록과 분야 목록을 함께 싣되 결과를 나눈다.
 * 한쪽만 실패할 수 있다(예: 분야만 못 읽음 → 화면은 할 일은 보이고 칩 줄만 「분야를 불러오지 못했어요」).
 * 처음 목록(app/page.tsx → DAL)과 다시 불러오기(GET /todos/today)가 같은 모양이다. 화면 코드도 import해도 되는 타입만.
 */
export type TodayRead = {
  todos: TodoResult<TodayTodos>;
  categories: CategoryResult<CategoryList>;
};
