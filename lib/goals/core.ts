import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CategoryMinutes } from "../growth/logic";
import type { RecordResult } from "../records/common";

/**
 * 이번 주 목표 읽기(⑥에서 표와 함께 채운다). 지금은 이번 주 목표가 없는 것으로 본다.
 * 먼저 한 기록의 반대편 계산이 이 함수를 부른다(목표 기준 반대편, D-110).
 * 돌려주는 값: 목표에 든 분야와 목표 분(없는 주는 null).
 */
export async function readWeeklyGoalItems(args: { supabase: SupabaseClient; weekStart: string }): Promise<RecordResult<CategoryMinutes[] | null>> {
  void args;
  return { ok: true, data: null };
}
