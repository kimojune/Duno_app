import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * 서버 함수가 자기 안에서 세션을 확인하는 한 곳(할 일·분야 core가 같이 쓴다).
 * getClaims는 서명을 검증한다. getSession 값은 믿지 않는다. 사용자 id는 여기서만 얻는다(호출자가 넘길 길이 없다).
 * 없거나 만료·검증 실패면 unauthenticated, 확인 자체가 예외면 unavailable(원문은 버린다).
 */

export type SessionResult = { ok: true; data: string } | { ok: false; error: "unauthenticated" | "unavailable" };

const userIdSchema = z.guid();

export async function requireUserId(supabase: SupabaseClient): Promise<SessionResult> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return { ok: false, error: "unauthenticated" };
    const sub = userIdSchema.safeParse(data.claims.sub);
    return sub.success ? { ok: true, data: sub.data } : { ok: false, error: "unauthenticated" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
