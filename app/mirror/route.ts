import { getDeps } from "../../lib/deps";
import { JSON_UNAVAILABLE, jsonResult } from "../../lib/json-response";
import { readMirrorForUser } from "../../lib/mirror/core";

/**
 * GET /mirror — 기기 먼저 저장(고침 3바퀴)이 서버 것을 받아 기기 거울을 맞추는 길. 내 할 일(최근 8일)·분야·설정·저녁 기록·이번 주 목표·타이머 기록을 한 번에.
 * 받는 인자 없음, 세션은 core 안에서 확인한다. 응답은 Cache-Control: private, no-store(사용자별 데이터라 서비스 워커·브라우저가 저장하지 않는다), 오류는 짧은 코드만.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    return jsonResult(await readMirrorForUser(deps));
  } catch {
    return JSON_UNAVAILABLE();
  }
}
