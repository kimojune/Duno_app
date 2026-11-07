import { READ_HEADERS } from "./read-response";

/**
 * 읽기용 Route Handler가 { ok, data } | { ok: false, error } 결과를 JSON으로 내보내는 한 곳.
 * 사용자별 데이터라 Cache-Control: private, no-store, 오류는 짧은 코드만(원문·스택 없음).
 */
type AnyResult = { ok: true; data: unknown } | { ok: false; error: string };

export function statusForError(error: string): number {
  if (error === "unauthenticated") return 401;
  if (error === "config") return 500;
  if (error === "unavailable") return 503;
  if (error === "not_found") return 404;
  return 400;
}

export function jsonResult(result: AnyResult): Response {
  if (result.ok) return Response.json({ ok: true, data: result.data }, { status: 200, headers: READ_HEADERS });
  return Response.json({ ok: false, error: result.error }, { status: statusForError(result.error), headers: READ_HEADERS });
}

export const JSON_UNAVAILABLE = (): Response => jsonResult({ ok: false, error: "unavailable" });
