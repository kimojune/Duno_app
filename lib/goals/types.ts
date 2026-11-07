import type { CategoryMinutes } from "../growth/logic";

/** 할 일 탭의 이번 주 목표 한 줄과 목표 정하기 창이 읽는 것(서버 비밀 없음, 화면도 import해도 된다) */
export type GoalSummary = {
  /** 이번 주 월요일 */
  weekStart: string;
  /** 이번 주 목표(없으면 null). 시간은 분 */
  goal: CategoryMinutes[] | null;
  /** 이번 주 분야별로 쓴 시간(기타는 categoryId null) */
  thisWeek: CategoryMinutes[];
  /** 고를 수 있는 분야(보관 안 한 것, 이름을 풀 수 있는 것) */
  categories: { id: string; name: string }[];
};
