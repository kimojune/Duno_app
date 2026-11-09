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
  /** 이번 주(달력 주 월~일, 두노 하루 기준)에 분야별로 쓴 시간(기타는 categoryId null). 상태보기 「이번 주」·놓친 분야·채울 시간이 쓴다 */
  thisWeek: CategoryMinutes[];
  lastWeek: CategoryMinutes[];
  lastMonth: CategoryMinutes[];
  /** 쓰기 시작한 때부터 쌓인 것 */
  cumulative: CategoryMinutes[];
  /** 저녁 기록이 있는 날 수 */
  loggedDaysThisWeek: number;
  loggedDaysTotal: number;
  /** 이번 주 목표(없으면 null). 시간은 분 */
  goal: { weekStart: string; items: CategoryMinutes[] } | null;
  /**
   * 처음 설정에서 받은 목표 한 문장(내 정보 첫 카드 「목표」와 같은 값, 상태보기 맨 위 한 줄 — 원샷 v2 고침5, PM 8).
   * 서버는 지금 세션 사용자의 설정을 읽어 복호화한 값(readSettingsForUser), 기기 먼저 저장은 기기에 둔 설정의 값. 없거나 풀 수 없으면 null.
   * 사용자 글이라 화면은 React 텍스트로만 그린다
   */
  goalText: string | null;
};
