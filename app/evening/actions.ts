"use server";

import { getDeps } from "../../lib/deps";
import { saveEveningLogForUser } from "../../lib/evening/core";
import type { SavedEvening } from "../../lib/evening/types";
import type { RecordResult } from "../../lib/records/common";

/**
 * 저녁 기록 저장 Server Action(PRD ②). 공개 HTTP 엔드포인트라 인자는 unknown으로 받아 서버에서 다시 검증한다.
 * user_id·서버 저장 시각은 받지 않는다. 예상 못 한 예외는 unavailable로 바꾸고 원문을 내지 않는다.
 */
export async function saveEveningLog(input: unknown): Promise<RecordResult<SavedEvening>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await saveEveningLogForUser(deps, input);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
