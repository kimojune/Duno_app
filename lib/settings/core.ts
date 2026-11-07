import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mapRecordDbError, recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";
import { decryptTodoText, encryptTodoText, type TodoKey } from "../todos/crypto";
import type { NotifySettings, RatioItem, SettingsData, SettingsPatch } from "./types";
import { checkGoal, checkRatios, DEFAULT_NOTIFY, notifyPatchSchema } from "./validation";

/**
 * 처음 설정·알림 설정·처음 정한 비율의 서버 함수(PRD 7-1, 7-8). 서버 전용.
 * 같은 규칙: 함수마다 자기 안에서 세션을 확인(getClaims), user_id는 세션에서만, 예상된 실패는 짧은 코드.
 * 목표 글은 할 일 글과 같은 키로 암호화한다(AAD 용도 goal_text).
 */

export type SettingsDeps = { supabase: SupabaseClient; key: TodoKey | null; now?: () => Date };

const serverNow = () => new Date();

type SettingsRow = {
  user_id: string;
  goal_encrypted: string | null;
  onboarding_done_at: string | null;
  notify_evening_enabled: boolean;
  notify_evening_minute: number;
  notify_morning_enabled: boolean;
  notify_morning_minute: number;
};
const SETTINGS_COLUMNS =
  "user_id, goal_encrypted, onboarding_done_at, notify_evening_enabled, notify_evening_minute, notify_morning_enabled, notify_morning_minute";

type RatioRow = { category_id: string; percent: number };

/**
 * 처음 정한 비율의 「기타」 몫(%). 기타는 분야 표(category_ratios)에 둘 수 없어(분야 외래 키) user_settings의 열 하나에 둔다
 * (마이그레이션 20261107110000_ratio_other.sql). 그 마이그레이션을 적용하기 전에도 앱이 돌게, 열을 못 읽으면(열 없음 포함) 기타 몫 없음으로 본다.
 */
async function readOtherPercent(supabase: SupabaseClient, userId: string): Promise<number | null> {
  try {
    const res = await supabase.from("user_settings").select("ratio_other_percent").eq("user_id", userId);
    if (res.error) return null;
    const value = ((res.data ?? []) as { ratio_other_percent: number | null }[])[0]?.ratio_other_percent;
    return typeof value === "number" && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function toSettings(row: SettingsRow | undefined, userId: string, key: TodoKey): Omit<SettingsData, "ratios"> {
  if (!row) return { goal: null, goalReadable: true, onboardingDone: false, notify: { ...DEFAULT_NOTIFY } };
  let goal: string | null = null;
  let goalReadable = true;
  if (row.goal_encrypted !== null) {
    const opened = decryptTodoText(row.goal_encrypted, userId, key, "goal_text");
    if (opened.ok) goal = opened.text;
    else goalReadable = false;
  }
  return {
    goal,
    goalReadable,
    onboardingDone: row.onboarding_done_at !== null,
    notify: {
      eveningEnabled: row.notify_evening_enabled,
      eveningMinute: row.notify_evening_minute,
      morningEnabled: row.notify_morning_enabled,
      morningMinute: row.notify_morning_minute,
    },
  };
}

/** 내 설정과 처음 정한 비율. 행이 없으면 처음 설정을 안 마친 기본값 */
export async function readSettingsForUser(deps: SettingsDeps): Promise<RecordResult<SettingsData>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (!deps.key) return recordFail("config");
    const key = deps.key;
    const [settings, ratios, other] = await Promise.all([
      deps.supabase.from("user_settings").select(SETTINGS_COLUMNS).eq("user_id", user.data),
      deps.supabase.from("category_ratios").select("category_id, percent").eq("user_id", user.data),
      readOtherPercent(deps.supabase, user.data),
    ]);
    if (settings.error) return recordFail(mapRecordDbError(settings.error));
    if (ratios.error) return recordFail(mapRecordDbError(ratios.error));
    const base = toSettings(((settings.data ?? []) as SettingsRow[])[0], user.data, key);
    const items: RatioItem[] = ((ratios.data ?? []) as RatioRow[]).map((r) => ({ categoryId: r.category_id, percent: r.percent }));
    if (other !== null) items.push({ categoryId: null, percent: other }); // 기타는 맨 끝
    return { ok: true, data: { ...base, ratios: items } };
  } catch {
    return recordFail("unavailable");
  }
}

/**
 * 처음 정한 비율을 통째로 바꾼다(처음 설정과 「비율 고치기」가 같이 쓴다). 받은 목록에 없는 분야의 비율은 지운다.
 * categoryId가 null인 항목은 기타다: 0보다 크면 user_settings.ratio_other_percent에 두고, 없거나 0이면 비운다(열이 없는 DB에서는 건드리지 않는다).
 * 남의 분야·없는 분야면 not_found(DB 복합 외래 키가 거절). 같은 요청을 여러 번 보내도 결과가 같다.
 */
export async function saveRatiosForUser(deps: SettingsDeps, input: unknown): Promise<RecordResult<{ ratios: RatioItem[] }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const checked = checkRatios(input);
    if (!checked.ok) return recordFail("invalid_input");

    const categoryItems = checked.ratios.filter((r): r is { categoryId: string; percent: number } => r.categoryId !== null);
    const otherItem = checked.ratios.find((r) => r.categoryId === null);
    if (categoryItems.length > 0) {
      const rows = categoryItems.map((r) => ({ user_id: user.data, category_id: r.categoryId, percent: r.percent }));
      const upsert = await deps.supabase.from("category_ratios").upsert(rows, { onConflict: "user_id,category_id" }).select("category_id, percent");
      if (upsert.error) return recordFail(mapRecordDbError(upsert.error));
    }

    const keep = new Set(categoryItems.map((r) => r.categoryId));
    const existing = await deps.supabase.from("category_ratios").select("category_id").eq("user_id", user.data);
    if (existing.error) return recordFail(mapRecordDbError(existing.error));
    const removed = ((existing.data ?? []) as { category_id: string }[]).map((r) => r.category_id).filter((id) => !keep.has(id));
    if (removed.length > 0) {
      const del = await deps.supabase.from("category_ratios").delete().eq("user_id", user.data).in("category_id", removed).select("category_id");
      if (del.error) return recordFail(mapRecordDbError(del.error));
    }

    // 기타 몫: 지금 값과 다를 때만 쓴다(기타를 안 쓰는 사용자는 이 열을 건드리지 않아, 마이그레이션 전에도 저장이 된다)
    const wantedOther = otherItem && otherItem.percent > 0 ? otherItem.percent : null;
    const currentOther = await readOtherPercent(deps.supabase, user.data);
    if (wantedOther !== currentOther) {
      const write = await deps.supabase.from("user_settings").upsert({ user_id: user.data, ratio_other_percent: wantedOther }, { onConflict: "user_id" }).select("user_id");
      if (write.error) return recordFail(mapRecordDbError(write.error));
    }
    return { ok: true, data: { ratios: checked.ratios } };
  } catch {
    return recordFail("unavailable");
  }
}

const patchSchema = z
  .object({
    goal: z.unknown().optional(),
    notify: z.unknown().optional(),
    completeOnboarding: z.boolean().optional(),
  })
  .strict();

/**
 * 목표 글·알림 설정을 바꾸고, 원하면 처음 설정을 마친 것으로 표시한다(안 보낸 것은 그대로).
 * 행이 없으면 만든다. 처음 설정을 마친 시각은 서버 시계로 한 번만 정하고 다시 마쳐도 바뀌지 않는다.
 */
export async function saveSettingsForUser(
  deps: SettingsDeps,
  input: unknown,
): Promise<RecordResult<Omit<SettingsData, "ratios">>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsed = patchSchema.safeParse(input);
    if (!parsed.success) return recordFail("invalid_input");
    if (!deps.key) return recordFail("config");
    const key = deps.key;
    const patch = parsed.data as SettingsPatch & { goal?: unknown; notify?: unknown };

    const values: Record<string, unknown> = { user_id: user.data };
    if (patch.goal !== undefined) {
      const goal = checkGoal(patch.goal);
      if (!goal.ok) return recordFail(goal.error);
      values.goal_encrypted = goal.goal === null ? null : encryptTodoText(goal.goal, user.data, key, "goal_text");
    }
    if (patch.notify !== undefined) {
      const notify = notifyPatchSchema.safeParse(patch.notify);
      if (!notify.success) return recordFail("invalid_input");
      const n: Partial<NotifySettings> = notify.data;
      if (n.eveningEnabled !== undefined) values.notify_evening_enabled = n.eveningEnabled;
      if (n.eveningMinute !== undefined) values.notify_evening_minute = n.eveningMinute;
      if (n.morningEnabled !== undefined) values.notify_morning_enabled = n.morningEnabled;
      if (n.morningMinute !== undefined) values.notify_morning_minute = n.morningMinute;
    }
    if (patch.completeOnboarding) {
      const existing = await deps.supabase.from("user_settings").select("user_id, onboarding_done_at").eq("user_id", user.data);
      if (existing.error) return recordFail(mapRecordDbError(existing.error));
      const row = ((existing.data ?? []) as { onboarding_done_at: string | null }[])[0];
      if (!row || row.onboarding_done_at === null) values.onboarding_done_at = (deps.now ?? serverNow)().toISOString();
    }
    if (Object.keys(values).length === 1) return recordFail("invalid_input"); // 바꿀 것이 없다

    const { data, error } = await deps.supabase
      .from("user_settings")
      .upsert(values, { onConflict: "user_id" })
      .select(SETTINGS_COLUMNS);
    if (error) return recordFail(mapRecordDbError(error));
    return { ok: true, data: toSettings(((data ?? []) as SettingsRow[])[0], user.data, key) };
  } catch {
    return recordFail("unavailable");
  }
}
