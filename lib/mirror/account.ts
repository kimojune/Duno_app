import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUserId } from "../session";

/**
 * 기기 먼저 저장의 계정 확인(고침 4바퀴, 서버 전용). 기기의 보낼 줄·서버 사본 받기는 「이 줄의 주인」(기대 사용자 번호)을 함께 싣는다.
 * 서버는 세션에서 꺼낸 사용자 번호와 견줘 다르면 account_mismatch로 거절한다(A가 쌓은 줄이 B 세션으로 들어가지 않게).
 * 기대 번호는 거절에만 쓴다: 같아도 권한을 넓히지 않고, 쓰기는 늘 세션 사용자로만 한다(각 core가 세션에서 사용자를 다시 꺼낸다).
 */
export type AccountCheck = { ok: true; userId: string } | { ok: false; error: "account_mismatch" | "unauthenticated" | "unavailable" };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function checkExpectedUser(supabase: SupabaseClient, expected: unknown): Promise<AccountCheck> {
  const user = await requireUserId(supabase);
  if (!user.ok) return user;
  // 기대 번호가 없거나 모양이 틀려도 거절한다(누구의 줄인지 모르면 보내지 않는다)
  if (typeof expected !== "string" || !GUID.test(expected) || expected.toLowerCase() !== user.data.toLowerCase()) return { ok: false, error: "account_mismatch" };
  return { ok: true, userId: user.data };
}
