import { getDeps } from "../../lib/deps";
import { readFocusState } from "../../lib/focus/core";
import { JSON_UNAVAILABLE, jsonResult } from "../../lib/json-response";

/** GET /focus — 타이머 화면이 열릴 때: 진행 중인 세션과 오늘 시작한 세션들. 받는 인자 없음, 세션은 core 안에서 확인 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    return jsonResult(await readFocusState(deps));
  } catch {
    return JSON_UNAVAILABLE();
  }
}
