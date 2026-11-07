import type { NextRequest } from "next/server";
import { getDeps } from "../../lib/deps";
import { JSON_UNAVAILABLE, jsonResult } from "../../lib/json-response";
import { readCategoryPage } from "../../lib/notes/core";

/**
 * GET /category?id=<uuid> — 분야 페이지(그 분야 할 일과 작업 기록, 날짜별). id가 「other」이면 기타(분야 없는 할 일).
 * 분야 번호 검증과 세션 확인은 core 안에서 한다.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    const id = request.nextUrl.searchParams.get("id");
    return jsonResult(await readCategoryPage(deps, id === "other" ? null : id));
  } catch {
    return JSON_UNAVAILABLE();
  }
}
