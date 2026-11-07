import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapRecordDbError, recordFail, type RecordResult } from "../records/common";
import { minutesByCategory } from "./logic";
import { COLUMNS, toSession, type FocusRow } from "./map";

/**
 * 그 날 타이머로 진행한 시간(분야별, 기타는 null). 저녁 기록이 미리 채우는 데 쓴다(PRD 7-6 「진행한 시간은 저녁 기록에 미리 채워진다」).
 * 끝낸 세션은 진행한 초를 분으로, 끝내지 않은 세션은 시작부터 지금까지(정한 길이까지)를 분으로 센다(lib/focus/logic.ts sessionMinutes).
 */
export type TimerMinutes = { categoryId: string | null; minutes: number }[];

export async function listTimerMinutes(args: {
  supabase: SupabaseClient;
  userId: string;
  day: string;
  now?: () => Date;
}): Promise<RecordResult<TimerMinutes>> {
  try {
    const { data, error } = await args.supabase
      .from("focus_sessions")
      .select(COLUMNS)
      .eq("user_id", args.userId)
      .eq("day", args.day);
    if (error) return recordFail(mapRecordDbError(error));
    const sessions = ((data ?? []) as FocusRow[]).map(toSession);
    return { ok: true, data: minutesByCategory(sessions, (args.now ?? (() => new Date()))().getTime()) };
  } catch {
    return recordFail("unavailable");
  }
}
