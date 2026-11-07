import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordResult } from "../records/common";

/**
 * 그 날 타이머로 진행한 시간(분야별). 저녁 기록이 미리 채우는 데 쓴다(PRD 7-6 「진행한 시간은 저녁 기록에 미리 채워진다」).
 * 타이머(④)가 생기기 전에는 비어 있다. ④에서 focus_sessions를 읽도록 바뀐다.
 */
export type TimerMinutes = { categoryId: string | null; minutes: number }[];

export async function listTimerMinutes(args: {
  supabase: SupabaseClient;
  userId: string;
  day: string;
}): Promise<RecordResult<TimerMinutes>> {
  void args;
  return { ok: true, data: [] };
}
