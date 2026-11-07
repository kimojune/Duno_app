import type { NextRequest } from "next/server";
import { getDeps } from "../../lib/deps";
import { JSON_UNAVAILABLE, jsonResult } from "../../lib/json-response";
import { listNotesForTodo } from "../../lib/notes/core";

/** GET /notes?todoId=<uuid> — 그 할 일의 작업 기록. todoId 검증과 세션 확인은 core 안에서 한다 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    return jsonResult(await listNotesForTodo(deps, request.nextUrl.searchParams.get("todoId")));
  } catch {
    return JSON_UNAVAILABLE();
  }
}
