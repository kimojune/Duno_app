import { getDeps } from "../../lib/deps";
import { readGrowthForUser } from "../../lib/growth/core";
import { JSON_UNAVAILABLE, jsonResult } from "../../lib/json-response";

/**
 * GET /goals — 할 일 탭의 이번 주 목표 한 줄과 목표 정하기 창이 읽는 것(이번 주 목표·이번 주 쓴 시간·분야).
 * 상태보기 읽기(/growth)와 같은 계산에서 필요한 칸만 내보낸다. 받는 인자 없음, 세션은 core 안에서 확인
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    const res = await readGrowthForUser(deps);
    if (!res.ok) return jsonResult(res);
    const g = res.data;
    return jsonResult({ ok: true, data: { weekStart: g.weekStart, goal: g.goal?.items ?? null, thisWeek: g.thisWeek, categories: g.categories } });
  } catch {
    return JSON_UNAVAILABLE();
  }
}
