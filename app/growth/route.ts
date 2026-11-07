import { getDeps } from "../../lib/deps";
import { readGrowthForUser } from "../../lib/growth/core";
import { JSON_UNAVAILABLE, jsonResult } from "../../lib/json-response";

/** GET /growth — 상태보기(이번 주·지난주·지난달·누적 분야별 시간, 처음 정한 비율, 분야). 받는 인자 없음, 세션은 core 안에서 확인 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    return jsonResult(await readGrowthForUser(deps));
  } catch {
    return JSON_UNAVAILABLE();
  }
}
