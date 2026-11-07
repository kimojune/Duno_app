import { getDeps } from "../../../lib/deps";
import { JSON_UNAVAILABLE, jsonResult } from "../../../lib/json-response";
import { listCarryOverCandidates } from "../../../lib/todos/manage-core";

/** GET /todos/yesterday — 어제 못 끝낸 내 할 일(가져올 것을 고르게). 받는 인자 없음, 세션은 core 안에서 확인 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    return jsonResult(await listCarryOverCandidates(deps));
  } catch {
    return JSON_UNAVAILABLE();
  }
}
