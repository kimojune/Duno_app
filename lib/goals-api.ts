import { clearWeeklyGoal, saveWeeklyGoal } from "../app/goals/actions";
import type { GoalSummary } from "./goals/types";
import type { CategoryMinutes } from "./growth/logic";
import { getJson } from "./manage-api";
import type { RecordResult } from "./records/common";

/** 이번 주 목표 화면이 서버를 부르는 길(브라우저 쪽). 시험은 가짜를 넣는다. 실패는 던지지 않고 unavailable로 바꾼다 */
export type GoalsApi = {
  /** 한 줄과 정하기 창이 읽는 것 */
  fetchSummary(): Promise<RecordResult<GoalSummary>>;
  save(items: { categoryId: string; minutes: number }[]): Promise<RecordResult<{ weekStart: string; items: CategoryMinutes[] }>>;
  clear(): Promise<RecordResult<{ weekStart: string }>>;
};

export const defaultGoalsApi: GoalsApi = {
  fetchSummary: () => getJson("/goals"),
  save: async (items) => {
    try {
      return await saveWeeklyGoal(items);
    } catch {
      return { ok: false, error: "unavailable" };
    }
  },
  clear: async () => {
    try {
      return await clearWeeklyGoal();
    } catch {
      return { ok: false, error: "unavailable" };
    }
  },
};
