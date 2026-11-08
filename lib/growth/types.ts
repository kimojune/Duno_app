import type { CategoryMinutes } from "./logic";
import type { RatioItem } from "../settings/types";

/** 상태보기가 화면에 돌려주는 모양(서버 비밀 없음, 화면도 import해도 된다) */
export type GrowthData = {
  /** 서버가 보는 오늘(두노 하루) */
  today: string;
  /** 이번 주 월요일, 지난주 월요일 */
  weekStart: string;
  lastWeekStart: string;
  /** 지난 달력 달 전체 */
  lastMonthRange: { from: string; to: string };
  /** 고를 수 있는 분야(보관 안 한 것, 이름을 풀 수 있는 것) */
  categories: { id: string; name: string }[];
  /** 처음 정한 비율(부족 기준) */
  ratios: RatioItem[];
  /** 분야별로 쓴 시간(기타는 categoryId null) */
  thisWeek: CategoryMinutes[];
  /** 최근 1주: 오늘 포함 지난 7일(두노 하루 기준, today-6 ~ today)에 분야별로 쓴 시간. 달력 주(월~일)인 thisWeek와 다르다 */
  recentWeek: CategoryMinutes[];
  lastWeek: CategoryMinutes[];
  lastMonth: CategoryMinutes[];
  /** 쓰기 시작한 때부터 쌓인 것 */
  cumulative: CategoryMinutes[];
  /** 저녁 기록이 있는 날 수 */
  loggedDaysThisWeek: number;
  loggedDaysRecentWeek: number;
  loggedDaysTotal: number;
  /** 이번 주 목표(없으면 null). 시간은 분 */
  goal: { weekStart: string; items: CategoryMinutes[] } | null;
};
