import type { NextRequest } from "next/server";
import { getDeps } from "../../lib/deps";
import { readEveningState } from "../../lib/evening/core";
import { JSON_UNAVAILABLE, jsonResult } from "../../lib/json-response";

/** GET /evening?day=YYYY-MM-DD — 저녁 기록 화면이 열릴 때 읽는 것(그 날 기록·끝낸 할 일의 분야·타이머 시간·분야). day를 안 주면 오늘 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    return jsonResult(await readEveningState(deps, request.nextUrl.searchParams.get("day") ?? undefined));
  } catch {
    return JSON_UNAVAILABLE();
  }
}
