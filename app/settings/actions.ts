"use server";

import { getDeps } from "../../lib/deps";
import type { RecordResult } from "../../lib/records/common";
import { saveRatiosForUser, saveSettingsForUser } from "../../lib/settings/core";
import type { RatioItem, SettingsData } from "../../lib/settings/types";

/**
 * 처음 설정·알림 설정 쓰기 Server Action(PRD ①). 공개 HTTP 엔드포인트라 인자는 unknown으로 받아 서버에서 다시 검증한다.
 * user_id는 받지 않는다(세션에서 정한다). 예상 못 한 예외는 unavailable로 바꾸고 원문을 내지 않는다.
 */

export async function saveRatios(ratios: unknown): Promise<RecordResult<{ ratios: RatioItem[] }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await saveRatiosForUser(deps, ratios);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function saveSettings(patch: unknown): Promise<RecordResult<Omit<SettingsData, "ratios">>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await saveSettingsForUser(deps, patch);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
