import type { CategoryMinutes } from "./logic";
import { countLoggedDays, sumRange } from "./logic";
import type { EveningLog } from "../evening/types";
import type { RatioItem } from "../settings/types";
import { addDays, previousMonthRange, weekDates, weekStartFor } from "../week";
import { streakWeeks } from "./streak";
import type { GrowthData } from "./types";
import type { GoalSummary } from "../goals/types";

/**
 * 상태보기·이번 주 목표 한 줄의 순수 계산(서버 core와 기기 먼저 저장의 기기 쪽이 같이 쓴다. DB·시계를 건드리지 않는다).
 * 서버 읽기(lib/growth/core.ts, lib/goals/core.ts)는 DB에서 재료를 읽어 여기에 넘기고, 기기는 기기에 둔 재료를 넘긴다.
 */

export type NamedCategory = { id: string; name: string };

export function computeGrowth(args: {
  today: string;
  logs: EveningLog[];
  categories: NamedCategory[];
  ratios: RatioItem[];
  goalItems: CategoryMinutes[] | null;
  /** 목표 한 문장(상태보기 맨 위 한 줄). 없으면 null */
  goalText?: string | null;
}): GrowthData {
  const weekStart = weekStartFor(args.today);
  const lastWeekStart = addDays(weekStart, -7);
  const lastMonthRange = previousMonthRange(args.today);
  const weekEnd = weekDates(weekStart)[6];
  const lastWeekEnd = weekDates(lastWeekStart)[6];
  return {
    today: args.today,
    weekStart,
    lastWeekStart,
    lastMonthRange,
    categories: args.categories,
    ratios: args.ratios,
    thisWeek: sumRange(args.logs, weekStart, weekEnd),
    lastWeek: sumRange(args.logs, lastWeekStart, lastWeekEnd),
    lastMonth: sumRange(args.logs, lastMonthRange.from, lastMonthRange.to),
    cumulative: sumRange(args.logs),
    loggedDaysThisWeek: countLoggedDays(args.logs, weekStart, weekEnd),
    loggedDaysTotal: countLoggedDays(args.logs),
    streakWeeks: streakWeeks(args.today, args.logs.map((l) => l.targetDay)),
    goal: args.goalItems ? { weekStart, items: args.goalItems } : null,
    goalText: args.goalText ?? null,
  };
}

export function computeGoalSummary(args: {
  today: string;
  logs: EveningLog[];
  categories: NamedCategory[];
  goalItems: CategoryMinutes[] | null;
}): GoalSummary {
  const weekStart = weekStartFor(args.today);
  return {
    weekStart,
    goal: args.goalItems,
    thisWeek: sumRange(args.logs, weekStart, weekDates(weekStart)[6]),
    categories: args.categories,
  };
}
