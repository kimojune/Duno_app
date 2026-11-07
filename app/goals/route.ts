import { getDeps } from "../../lib/deps";
import { readGoalSummaryForUser } from "../../lib/goals/core";
import { JSON_UNAVAILABLE, jsonResult } from "../../lib/json-response";

/**
 * GET /goals — 할 일 탭의 이번 주 목표 한 줄과 목표 정하기 창이 읽는 것(이번 주 목표·이번 주 쓴 시간·분야).
 * 필요한 칸만 읽는 함수(readGoalSummaryForUser)로 읽는다: 상태보기 읽기 전체를 만들지 않는다. 받는 인자 없음, 세션은 core 안에서 확인
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    return jsonResult(await readGoalSummaryForUser(deps));
  } catch {
    return JSON_UNAVAILABLE();
  }
}
