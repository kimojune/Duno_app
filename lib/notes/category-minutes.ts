import type { EveningLog } from "../evening/types";
import type { CategoryPageDay } from "./types";

/**
 * 분야 페이지 날짜별 시간(원샷 v2 고침8, 23 명세 3). 서버(lib/notes/core.ts)와 기기 먼저 저장(lib/local/apis.ts)이 같이 쓰는 순수 함수.
 * - 그날 이 분야 분 = 그날 가장 늦은 오늘 기록(evening log)의 items에서 이 분야(기타는 categoryId null) 분. 없으면 0.
 *   「가장 늦은 것」은 부르는 쪽이 고른다(서버 latestPerDay · 기기 latestLogPerDay — 알려진 한계 F6과 같은 기준).
 * - 날짜 목록 = 할 일이 있는 날 ∪ 이 분야 시간이 있는 날. 최근 날 먼저(지금 분야 페이지 순서).
 * - fromDay가 있으면 그 날보다 앞선 기록은 붙이지 않는다(할 일을 상한까지 읽었을 때 그 범위 밖 날을 더하지 않으려고).
 * 새 저장 칸은 없다: 이미 저장된 오늘 기록을 읽기만 한다.
 */

/** 분야 페이지가 읽는 할 일 수 상한(임시, 최근 것부터). 서버 core가 다시 내보낸다 */
export const CATEGORY_PAGE_TODO_LIMIT = 500;
/** 분야 페이지가 날짜별 시간을 붙이려고 읽는 오늘 기록 행 수 상한(최근 것부터). 상태보기(listEveningLogs)의 상한과 같다 */
export const CATEGORY_PAGE_LOG_LIMIT = 2000;

/** 이 기록에서 이 분야의 분(0 이상 정수). 기타는 categoryId null */
export function minutesInLog(log: EveningLog, categoryId: string | null): number {
  let sum = 0;
  for (const item of log.items) {
    if (item.categoryId !== categoryId) continue;
    const m = Number.isFinite(item.minutes) ? Math.max(0, Math.round(item.minutes)) : 0;
    sum += m;
  }
  return sum;
}

/**
 * 할 일 날짜 묶음(최근 날 먼저)과 날마다 가장 늦은 기록 목록을 합친다.
 * @param todoDays 할 일이 있는 날들(minutes는 무시하고 다시 셈)
 * @param latestLogs 날마다 하나(그날 가장 늦은 것). 순서는 상관없다
 */
export function mergeCategoryMinutes(
  todoDays: Pick<CategoryPageDay, "day" | "todos">[],
  latestLogs: EveningLog[],
  categoryId: string | null,
  fromDay?: string | null,
): CategoryPageDay[] {
  const minutesByDay = new Map<string, number>();
  for (const log of latestLogs) {
    if (fromDay && log.targetDay < fromDay) continue;
    const m = minutesInLog(log, categoryId);
    if (m > 0) minutesByDay.set(log.targetDay, m);
  }
  const byDay = new Map<string, CategoryPageDay>();
  for (const d of todoDays) byDay.set(d.day, { day: d.day, minutes: minutesByDay.get(d.day) ?? 0, todos: d.todos });
  for (const [day, minutes] of minutesByDay) if (!byDay.has(day)) byDay.set(day, { day, minutes, todos: [] });
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/** 할 일을 상한까지 읽었으면 가장 오래된 할 일 날(그보다 앞선 날은 읽은 범위 밖), 아니면 null */
export function categoryPageFromDay(todoCount: number, todoDays: { day: string }[]): string | null {
  if (todoCount < CATEGORY_PAGE_TODO_LIMIT || todoDays.length === 0) return null;
  return todoDays.reduce((min, d) => (d.day < min ? d.day : min), todoDays[0].day);
}

/** 이 페이지에서 가장 긴 날의 분(막대 폭 전체 기준). 모두 0이면 0 */
export function longestDayMinutes(days: { minutes: number }[]): number {
  return days.reduce((max, d) => (d.minutes > max ? d.minutes : max), 0);
}

/** 막대 길이(0~100, 소수 그대로). 가장 긴 날 = 100. 그날 0이거나 가장 긴 날이 0이면 0 */
export function dayBarPercent(minutes: number, longest: number): number {
  if (!(minutes > 0) || !(longest > 0)) return 0;
  return Math.min(100, (minutes / longest) * 100);
}
