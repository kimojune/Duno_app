"use server";

import { getDeps } from "../../lib/deps";
import type { RecordResult } from "../../lib/records/common";
import { recordViewForUser } from "../../lib/views/core";

/**
 * 화면 본 것 기록 Server Action(PRD 8절). 인자는 unknown으로 받아 서버에서 다시 검증한다. 실패해도 화면은 그대로다(조용히 버림).
 * 예상 못 한 예외는 unavailable로 바꾸고 원문을 내지 않는다.
 */
export async function recordView(input: unknown): Promise<RecordResult<{ id: string }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await recordViewForUser(deps, input);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
