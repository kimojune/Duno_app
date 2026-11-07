"use server";

import { getDeps } from "../../lib/deps";
import { deleteSubscriptionForUser, saveSubscriptionForUser } from "../../lib/push/core";
import type { RecordResult } from "../../lib/records/common";

/**
 * 푸시 구독 저장·삭제 Server Action(PRD ⑦). 공개 HTTP 엔드포인트라 인자는 unknown으로 받아 서버에서 다시 검증한다.
 * user_id는 받지 않는다(세션에서 정한다). 예상 못 한 예외는 unavailable로 바꾸고 원문을 내지 않는다.
 */
export async function savePushSubscription(input: unknown): Promise<RecordResult<{ saved: true }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await saveSubscriptionForUser({ supabase: deps.supabase }, input);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function deletePushSubscription(endpoint: unknown): Promise<RecordResult<{ deleted: true }>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await deleteSubscriptionForUser({ supabase: deps.supabase }, endpoint);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
