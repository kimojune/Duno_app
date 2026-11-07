import type { FocusSession } from "./types";

/**
 * 타이머의 순수 계산(화면·서버가 같이 쓴다. DB를 건드리지 않는다). PRD 7-6.
 * 시간은 초·분 정수. 시계는 인자로 받는다.
 */

/** 활성 세션으로 볼 최대 시간(끝내지 않고 이 시간이 지나면 더는 진행 중으로 보지 않는다, 임시 3시간) */
export const ACTIVE_MAX_MS = 3 * 60 * 60 * 1000;

/** 시작부터 지금까지 지난 초(정한 길이를 넘기지 않는다) */
export function elapsedSecondsSoFar(startedAtMs: number, nowMs: number, plannedMinutes: number): number {
  const raw = Math.floor((nowMs - startedAtMs) / 1000);
  return Math.min(Math.max(0, raw), plannedMinutes * 60);
}

/** 남은 초 */
export function remainingSeconds(startedAtMs: number, nowMs: number, plannedMinutes: number): number {
  return plannedMinutes * 60 - elapsedSecondsSoFar(startedAtMs, nowMs, plannedMinutes);
}

/**
 * 한 세션이 저녁 기록에 미리 채워 줄 분(임시 규칙):
 * - 끝낸 세션은 진행한 초를 분으로 반올림(30초 미만은 0분. 5분 하고 끝내면 5분).
 * - 끝내지 않은 세션은 시작부터 지금까지(정한 길이까지)를 분으로 반올림한다. 끝내기를 잊어도 정한 길이가 지나면 정한 길이만큼 센다.
 */
export function sessionMinutes(session: Pick<FocusSession, "startedAt" | "plannedMinutes" | "endedAt" | "elapsedSeconds">, nowMs: number): number {
  if (session.endedAt !== null && session.elapsedSeconds !== null) return Math.round(session.elapsedSeconds / 60);
  const started = Date.parse(session.startedAt);
  if (!Number.isFinite(started)) return 0;
  return Math.round(elapsedSecondsSoFar(started, nowMs, session.plannedMinutes) / 60);
}

/** 지금 진행 중인 세션인가: 끝내지 않았고 시작한 지 ACTIVE_MAX_MS 안 */
export function isActive(session: Pick<FocusSession, "startedAt" | "endedAt">, nowMs: number): boolean {
  if (session.endedAt !== null) return false;
  const started = Date.parse(session.startedAt);
  return Number.isFinite(started) && nowMs - started < ACTIVE_MAX_MS;
}

/** 분야별 분 합(기타는 null). 0분인 것은 뺀다 */
export function minutesByCategory(sessions: FocusSession[], nowMs: number): { categoryId: string | null; minutes: number }[] {
  const map = new Map<string | null, number>();
  for (const s of sessions) map.set(s.categoryId, (map.get(s.categoryId) ?? 0) + sessionMinutes(s, nowMs));
  return [...map].filter(([, m]) => m > 0).map(([categoryId, minutes]) => ({ categoryId, minutes }));
}
