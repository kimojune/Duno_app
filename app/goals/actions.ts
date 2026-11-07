"use server";

import { getDeps } from "../../lib/deps";
import { clearWeeklyGoalForUser, saveWeeklyGoalForUser } from "../../lib/goals/core";
import type { CategoryMinutes } from "../../lib/growth/logic";
import type { RecordResult } from "../../lib/records/common";

/**
 * 이번 주 목표 쓰기 Server Action(PRD ⑥). 공개 HTTP 엔드포인트라 인자는 unknown으로 받아 서버에서 다시 검증한다.
 * user_id·주(월요일)는 받지 않는다(세션·서버 시계로 정한다). 예상 못 한 예외는 unavailable로 바꾸고 원문을 내지 않는다.
 */
export async function saveWeeklyGoal(items: unknown, clientAt?: unknown): Promise<RecordResult<{ weekStart: string; items: CategoryMinutes[] }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    // clientAt(기기가 정한 때)은 기기 먼저 저장이 보낸다. 없으면 옛 호출 꼴 그대로 부른다
    return clientAt === undefined ? await saveWeeklyGoalForUser(deps, items) : await saveWeeklyGoalForUser(deps, items, clientAt);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function clearWeeklyGoal(clientAt?: unknown): Promise<RecordResult<{ weekStart: string }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return clientAt === undefined ? await clearWeeklyGoalForUser(deps) : await clearWeeklyGoalForUser(deps, clientAt);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
