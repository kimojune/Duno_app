import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mapRecordDbError, recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";

/**
 * 푸시 구독 저장·삭제(PRD 7-8, ⑦). 서버 전용. 사용자 세션으로 자기 구독만 다룬다(RLS).
 * 같은 규칙: 함수마다 자기 안에서 세션 확인(getClaims), user_id는 세션에서만, 예상된 실패는 짧은 코드.
 */
export type PushDeps = { supabase: SupabaseClient };

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
const subscriptionSchema = z
  .object({
    endpoint: z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(1000),
    p256dh: base64url.min(1).max(200),
    auth: base64url.min(1).max(100),
  })
  .strict();

/** 구독을 저장한다. 같은 주소를 다시 보내도 새로 만들지 않고 성공(이미 있음) */
export async function saveSubscriptionForUser(deps: PushDeps, input: unknown): Promise<RecordResult<{ saved: true }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) return recordFail("invalid_input");
    const { error } = await deps.supabase
      .from("push_subscriptions")
      .upsert({ user_id: user.data, ...parsed.data }, { onConflict: "user_id,endpoint", ignoreDuplicates: true })
      .select("id");
    if (error) return recordFail(mapRecordDbError(error));
    return { ok: true, data: { saved: true } };
  } catch {
    return recordFail("unavailable");
  }
}

/** 구독을 지운다(알림을 끌 때). 없는 것을 지워도 성공 */
export async function deleteSubscriptionForUser(deps: PushDeps, endpoint: unknown): Promise<RecordResult<{ deleted: true }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsed = z.string().min(1).max(1000).safeParse(endpoint);
    if (!parsed.success) return recordFail("invalid_input");
    const { error } = await deps.supabase.from("push_subscriptions").delete().eq("user_id", user.data).eq("endpoint", parsed.data).select("id");
    if (error) return recordFail(mapRecordDbError(error));
    return { ok: true, data: { deleted: true } };
  } catch {
    return recordFail("unavailable");
  }
}
