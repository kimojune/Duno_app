import type { EveningLog } from "../evening/types";

/**
 * 같은 날의 기록들에서 가장 늦게 저장한 것만 남긴다(같은 시각이면 id가 큰 것). 날짜 오름차순.
 * 서버 core(lib/evening/core.ts의 latestPerDay)와 같은 규칙이다: 그쪽은 서버 전용 모듈이라 기기에서 쓸 수 없어 순수 함수로 다시 둔다.
 */
export function latestLogPerDay(logs: EveningLog[]): EveningLog[] {
  const best = new Map<string, EveningLog>();
  for (const log of logs) {
    const current = best.get(log.targetDay);
    if (!current || log.savedAt > current.savedAt || (log.savedAt === current.savedAt && log.id > current.id)) best.set(log.targetDay, log);
  }
  return [...best.values()].sort((a, b) => (a.targetDay < b.targetDay ? -1 : 1));
}
