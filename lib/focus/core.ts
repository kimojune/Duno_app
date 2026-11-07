import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listEveningLogs } from "../evening/core";
import { sumRange } from "../growth/logic";
import { mapRecordDbError, recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";
import { readSettingsForUser } from "../settings/core";
import type { TodoKey } from "../todos/crypto";
import { todoDayFor } from "../todos/day";
import { weekDates, weekStartFor } from "../week";
import { readWeeklyGoalItems } from "../goals/core";
import { APP_CONFIG } from "../app-config";
import { elapsedSecondsSoFar, isActive } from "./logic";
import { oppositeFlags } from "./opposite";
import { COLUMNS, toSession, type FocusRow as Row } from "./map";
import { FOCUS_SURFACES, type EndedFocus, type FocusState, type StartedFocus } from "./types";

/**
 * 타이머와 먼저 한 기록(PRD 7-6, 8절). 서버 전용.
 * 같은 규칙: 함수마다 자기 안에서 세션 확인(getClaims), user_id는 세션에서만, 시각은 서버 시계, 예상된 실패는 짧은 코드.
 * 시작하는 순간 한 행이 생긴다(= 먼저 한 기록): 5분 하고 끝내도, 건넨 할 일이 아닌 할 일로 켜도 남는다. 지우지 않는다.
 */
export type FocusDeps = { supabase: SupabaseClient; key: TodoKey | null; now?: () => Date };

const serverNow = () => new Date();

const startSchema = z
  .object({
    id: z.uuid(),
    todoId: z.uuid().nullable().optional(),
    categoryId: z.uuid().nullable().optional(),
    offerId: z.uuid().nullable().optional(),
    surface: z.enum(FOCUS_SURFACES),
    clientStartedAt: z.string().max(40).nullable().optional(),
  })
  .strict();

function cleanClientTime(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * 타이머 시작. 받는 것은 화면이 만든 id와 할 일·분야·제시 번호·어디서 켰나뿐이다(user_id·서버 시각·반대편 여부는 받지 않는다: 서버가 정한다).
 * - 같은 id로 다시 오면(재시도) 새 행을 만들지 않고 그 행으로 성공한다.
 * - 이미 진행 중인 다른 타이머(끝내지 않았고 3시간 안)가 있으면 already_running(B3). 화면은 카드를 거두고 타이머 탭을 안내한다.
 * - 남의 분야·없는 분야면 not_found(DB 복합 외래 키가 거절).
 * - 반대편 여부 둘(이번 주 목표 기준·처음 정한 비율 기준)을 시작하는 순간의 이번 주 기록으로 계산해 함께 남긴다(D-110).
 */
export async function startFocusForUser(deps: FocusDeps, input: unknown): Promise<RecordResult<StartedFocus>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsed = startSchema.safeParse(input);
    if (!parsed.success) return recordFail("invalid_input");
    if (!deps.key) return recordFail("config");
    const v = parsed.data;
    const now = (deps.now ?? serverNow)();
    const day = todoDayFor(now);
    const categoryId = v.categoryId ?? null;

    // 시작하는 순간의 이번 주 기록으로 반대편 여부를 정한다
    const weekStart = weekStartFor(day);
    const [logs, settings, goal] = await Promise.all([
      listEveningLogs({ supabase: deps.supabase }, weekStart),
      readSettingsForUser({ supabase: deps.supabase, key: deps.key }),
      readWeeklyGoalItems({ supabase: deps.supabase, weekStart }),
    ]);
    if (!logs.ok) return logs;
    if (!settings.ok) return settings;
    if (!goal.ok) return goal;
    const flags = oppositeFlags({
      categoryId,
      ratios: settings.data.ratios,
      goalItems: goal.data,
      totals: sumRange(logs.data, weekStart, weekDates(weekStart)[6]),
    });

    // 이미 진행 중인 다른 타이머가 있으면 새로 켜지 않는다(B3). 같은 id의 재시도는 아래에서 그 행으로 성공한다.
    const open = await deps.supabase
      .from("focus_sessions")
      .select(COLUMNS)
      .eq("user_id", user.data)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    if (open.error) return recordFail(mapRecordDbError(open.error));
    const running = ((open.data ?? []) as Row[]).map(toSession)[0];
    if (running && running.id !== v.id && isActive(running, now.getTime())) return recordFail("already_running");

    const { error } = await deps.supabase
      .from("focus_sessions")
      .insert({
        id: v.id,
        user_id: user.data,
        client_started_at: cleanClientTime(v.clientStartedAt),
        day,
        planned_minutes: APP_CONFIG.timerMinutes,
        todo_id: v.todoId ?? null,
        category_id: categoryId,
        offer_id: v.offerId ?? null,
        surface: v.surface,
        opposite_by_goal: flags.byGoal,
        opposite_by_ratio: flags.byRatio,
      })
      .select(COLUMNS);
    const retry = error !== null && (error.code === "23505" || error.code === "P0001");
    if (error && !retry) return recordFail(mapRecordDbError(error));

    const existing = await deps.supabase.from("focus_sessions").select(COLUMNS).eq("id", v.id).eq("user_id", user.data);
    if (existing.error) return recordFail(mapRecordDbError(existing.error));
    const row = ((existing.data ?? []) as Row[])[0];
    if (!row) return recordFail(error ? mapRecordDbError(error) : "unavailable");
    return { ok: true, data: { session: toSession(row), serverNow: now.toISOString() } };
  } catch {
    return recordFail("unavailable");
  }
}

/**
 * 타이머 끝내기. 끝난 시각은 서버 시계, 진행한 시간은 시작부터 지금까지(정한 길이를 넘기지 않는다)로 서버가 정한다.
 * 이미 끝난 세션이면 그대로 성공(여러 번 보내도 같다). 남의 것·없는 것은 not_found.
 */
export async function endFocusForUser(deps: Pick<FocusDeps, "supabase" | "now">, id: unknown): Promise<RecordResult<EndedFocus>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedId = z.uuid().safeParse(id);
    if (!parsedId.success) return recordFail("invalid_input");
    const found = await deps.supabase.from("focus_sessions").select(COLUMNS).eq("id", parsedId.data).eq("user_id", user.data);
    if (found.error) return recordFail(mapRecordDbError(found.error));
    const row = ((found.data ?? []) as Row[])[0];
    if (!row) return recordFail("not_found");
    if (row.ended_at !== null) return { ok: true, data: { session: toSession(row) } };

    const now = (deps.now ?? serverNow)();
    const startedMs = Date.parse(row.started_at);
    const elapsed = Number.isFinite(startedMs) ? elapsedSecondsSoFar(startedMs, now.getTime(), row.planned_minutes) : 0;
    const { data, error } = await deps.supabase
      .from("focus_sessions")
      .update({ ended_at: now.toISOString(), elapsed_seconds: elapsed })
      .eq("id", parsedId.data)
      .eq("user_id", user.data)
      .select(COLUMNS);
    if (error) return recordFail(mapRecordDbError(error));
    const updated = ((data ?? []) as Row[])[0];
    if (!updated) return recordFail("not_found");
    return { ok: true, data: { session: toSession(updated) } };
  } catch {
    return recordFail("unavailable");
  }
}

/** 타이머 화면이 열릴 때: 진행 중인 세션과 오늘 시작한 세션들(오래된 것이 위) */
export async function readFocusState(deps: Pick<FocusDeps, "supabase" | "now">): Promise<RecordResult<FocusState>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const now = (deps.now ?? serverNow)();
    const day = todoDayFor(now);
    const { data, error } = await deps.supabase
      .from("focus_sessions")
      .select(COLUMNS)
      .eq("user_id", user.data)
      .eq("day", day)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) return recordFail(mapRecordDbError(error));
    const today = ((data ?? []) as Row[]).map(toSession);
    // 어제 시작해 새벽 4시를 넘긴 채 도는 세션도 진행 중으로 본다: 오늘 목록에 없으면 끝내지 않은 가장 최근 것을 따로 찾는다
    let active = [...today].reverse().find((s) => isActive(s, now.getTime())) ?? null;
    if (!active) {
      const open = await deps.supabase
        .from("focus_sessions")
        .select(COLUMNS)
        .eq("user_id", user.data)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1);
      if (open.error) return recordFail(mapRecordDbError(open.error));
      const candidate = ((open.data ?? []) as Row[]).map(toSession)[0];
      if (candidate && isActive(candidate, now.getTime())) active = candidate;
    }
    return { ok: true, data: { serverNow: now.toISOString(), active, today } };
  } catch {
    return recordFail("unavailable");
  }
}
