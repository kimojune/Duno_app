import { addDays, weekStartFor } from "../week";

/**
 * 연속 기록(명세 ⑦-9, 원샷 v2 고침9): 오늘 기록이 하루라도 있는 주를 센다. 한 주 = 월~일(lib/week.ts), 하루는 두노 하루(새벽 4시 경계 —
 * lib/todos/day.ts todoDayFor가 정한 하루 문자열을 받는다). 순수 함수: DB·시계를 건드리지 않는다.
 *
 * 재료는 상태보기가 이미 읽은 자기 오늘 기록의 대상 날(EveningLog.targetDay)뿐이다(서버 core·기기 먼저 저장이 computeGrowth에 넘기는 것 그대로).
 * 새 읽기·새 서버 입구·새 저장 칸이 없다.
 *
 * 세는 법:
 * - 이번 주에 기록이 있으면 이번 주부터, 없으면 지난주부터 거꾸로 이어진 주를 센다. 이번 주는 아직 끝나지 않아서,
 *   월요일 아침에 기록이 아직 없다고 지난주까지의 연속이 바로 사라지지 않는다(끊김은 한 주를 통째로 비웠을 때).
 * - 오늘보다 뒤의 날·모양이 틀린 날은 세지 않는다.
 * - 계산은 기록 수에 대해 선형이다(주 시작을 한 번씩 모으고, 모은 주 수보다 많이 거슬러 가지 않는다).
 */

/** 연속 기록 줄을 보이는 가장 작은 주 수(명세 ⑦-9 「2주 이상일 때만」) */
export const STREAK_MIN_WEEKS = 2;

/**
 * @param today 서버(또는 기기)가 보는 오늘(두노 하루 'YYYY-MM-DD')
 * @param loggedDays 오늘 기록이 있는 대상 날들(중복 있어도 됨)
 * @returns 이어진 주 수(0 = 이어진 주 없음)
 */
export function streakWeeks(today: string, loggedDays: Iterable<string>): number {
  const weeks = new Set<string>();
  for (const day of loggedDays) {
    if (typeof day !== "string" || day > today) continue;
    try {
      weeks.add(weekStartFor(day));
    } catch {
      // 모양이 틀린 날은 세지 않는다
    }
  }
  if (weeks.size === 0) return 0;
  const thisWeek = weekStartFor(today);
  let week = weeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let count = 0;
  while (count < weeks.size && weeks.has(week)) {
    count += 1;
    week = addDays(week, -7);
  }
  return count;
}

/** 화면에 보일 연속 주 수. 2주 미만이면 null(줄을 그리지 않는다 — 끊기면 조용히 사라짐, 알림·경고 없음) */
export function visibleStreak(weeks: number): number | null {
  return Number.isInteger(weeks) && weeks >= STREAK_MIN_WEEKS ? weeks : null;
}
