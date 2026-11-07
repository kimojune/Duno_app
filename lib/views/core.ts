import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mapRecordDbError, recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";
import { todoDayFor } from "../todos/day";
import { VIEW_ENTRIES, VIEW_SCREENS } from "./core-types";

/**
 * 화면 본 것 기록(PRD 8절, G8). 서버 전용. 입구별로 센다: after_save(저녁 기록 저장 직후의 한 줄) / self(스스로 연 것).
 * 「봤다」는 화면이 실제로 그려진 때(화면이 그린 뒤 부른다). 날짜·시각은 서버 시계, user_id는 세션에서만. 쌓기만 한다.
 */
export type ViewDeps = { supabase: SupabaseClient; now?: () => Date };


const serverNow = () => new Date();

const viewSchema = z.object({ id: z.uuid(), screen: z.enum(VIEW_SCREENS), entry: z.enum(VIEW_ENTRIES) }).strict();

/** 같은 id를 다시 보내도(재시도) 한 번만 남는다(이미 있으면 성공) */
export async function recordViewForUser(deps: ViewDeps, input: unknown): Promise<RecordResult<{ id: string }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsed = viewSchema.safeParse(input);
    if (!parsed.success) return recordFail("invalid_input");
    const day = todoDayFor((deps.now ?? serverNow)());
    const { error } = await deps.supabase
      .from("view_events")
      .insert({ id: parsed.data.id, user_id: user.data, screen: parsed.data.screen, entry: parsed.data.entry, day })
      .select("id");
    if (error) {
      if (error.code === "23505") {
        const existing = await deps.supabase.from("view_events").select("id").eq("id", parsed.data.id).eq("user_id", user.data);
        if (!existing.error && ((existing.data ?? []) as { id: string }[]).length > 0) return { ok: true, data: { id: parsed.data.id } };
      }
      return recordFail(mapRecordDbError(error));
    }
    return { ok: true, data: { id: parsed.data.id } };
  } catch {
    return recordFail("unavailable");
  }
}
