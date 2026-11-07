import type { NextRequest } from "next/server";
import { getDeps } from "../../../lib/deps";
import { JSON_UNAVAILABLE, jsonResult } from "../../../lib/json-response";
import { listTodosForPastDay } from "../../../lib/todos/core";

/**
 * GET /todos/day?date=YYYY-MM-DD — 지난 날의 내 할 일 목록(보기만, 고침 3바퀴 PM 답 d-69 ⑦). 오늘·앞날은 invalid_input.
 * 세션은 core 안에서 확인한다. 응답은 Cache-Control: private, no-store, 오류는 짧은 코드만.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    return jsonResult(await listTodosForPastDay(deps, request.nextUrl.searchParams.get("date") ?? undefined));
  } catch {
    return JSON_UNAVAILABLE();
  }
}
