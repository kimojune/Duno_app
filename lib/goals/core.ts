import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listCategoriesForUser } from "../categories/core";
import { listEveningLogs } from "../evening/core";
import { sumRange, type CategoryMinutes } from "../growth/logic";
import { mapRecordDbError, recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";
import type { TodoKey } from "../todos/crypto";
import { todoDayFor } from "../todos/day";
import { weekDates, weekStartFor } from "../week";
import type { GoalSummary } from "./types";
import { checkGoalItems } from "./validation";

/**
 * 이번 주 목표(PRD 7-7, ⑥). 서버 전용.
 * 같은 규칙: 함수마다 자기 안에서 세션 확인(getClaims), user_id는 세션에서만, 주는 서버 시계(두노 하루 기준 월요일), 예상된 실패는 짧은 코드.
 * 목표가 없어도 앱을 쓰는 데 막히지 않는다: 행이 없으면 목표가 없는 주(null)다.
 */
export type GoalDeps = { supabase: SupabaseClient; now?: () => Date };

const serverNow = () => new Date();

const rowItemsSchema = z.array(z.object({ categoryId: z.uuid(), minutes: z.number().int().min(0) }));

function parseItems(value: unknown): CategoryMinutes[] | null {
  const parsed = rowItemsSchema.safeParse(value);
  if (!parsed.success) return null;
  const items = parsed.data.filter((i) => i.minutes > 0).map((i) => ({ categoryId: i.categoryId as string | null, minutes: i.minutes }));
  return items.length > 0 ? items : null;
}

/**
 * 그 주(월요일 weekStart)의 목표 분야·분. 목표가 없으면 null. 다른 core 함수(상태보기·먼저 할 일·먼저 한 기록)가 쓴다.
 * 세션은 여기서도 다시 확인하고(getClaims), 자기 행만 읽는다.
 */
export async function readWeeklyGoalItems(args: { supabase: SupabaseClient; weekStart: string }): Promise<RecordResult<CategoryMinutes[] | null>> {
  try {
    const user = await requireUserId(args.supabase);
    if (!user.ok) return user;
    const { data, error } = await args.supabase.from("weekly_goals").select("items").eq("user_id", user.data).eq("week_start", args.weekStart);
    if (error) return recordFail(mapRecordDbError(error));
    const row = ((data ?? []) as { items: unknown }[])[0];
    return { ok: true, data: row ? parseItems(row.items) : null };
  } catch {
    return recordFail("unavailable");
  }
}

/**
 * 이번 주 목표를 통째로 정한다(분야마다 1시간 단위, 합 168시간 이하). 이미 있으면 바꾼다.
 * 같은 요청을 여러 번 보내도 같다. 남의 분야·없는 분야면 not_found.
 */
export async function saveWeeklyGoalForUser(
  deps: GoalDeps,
  input: unknown,
): Promise<RecordResult<{ weekStart: string; items: CategoryMinutes[] }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const checked = checkGoalItems(input);
    if (!checked.ok) return recordFail("invalid_input");
    const weekStart = weekStartFor(todoDayFor((deps.now ?? serverNow)()));

    // 분야는 내 것이어야 한다(jsonb라 DB 외래 키가 없어 여기서 본다)
    const ids = checked.items.map((i) => i.categoryId);
    const mine = await deps.supabase.from("categories").select("id").eq("user_id", user.data).in("id", ids);
    if (mine.error) return recordFail(mapRecordDbError(mine.error));
    if (((mine.data ?? []) as { id: string }[]).length !== ids.length) return recordFail("not_found");

    const { data, error } = await deps.supabase
      .from("weekly_goals")
      .upsert({ user_id: user.data, week_start: weekStart, items: checked.items }, { onConflict: "user_id,week_start" })
      .select("items");
    if (error) return recordFail(mapRecordDbError(error));
    const items = parseItems(((data ?? []) as { items: unknown }[])[0]?.items) ?? [];
    return { ok: true, data: { weekStart, items } };
  } catch {
    return recordFail("unavailable");
  }
}

/** 이번 주 목표를 없앤다(목표가 없어도 앱은 그대로 쓴다). 없는 것을 없애도 성공 */
export async function clearWeeklyGoalForUser(deps: GoalDeps): Promise<RecordResult<{ weekStart: string }>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const weekStart = weekStartFor(todoDayFor((deps.now ?? serverNow)()));
    const { error } = await deps.supabase.from("weekly_goals").delete().eq("user_id", user.data).eq("week_start", weekStart).select("week_start");
    if (error) return recordFail(mapRecordDbError(error));
    return { ok: true, data: { weekStart } };
  } catch {
    return recordFail("unavailable");
  }
}

/**
 * 할 일 탭의 이번 주 목표 한 줄과 목표 정하기 창이 읽는 것(A14). 상태보기 읽기 전체(지난주·지난달·누적·설정)를 만들지 않고
 * 이번 주 목표·이번 주 저녁 기록(월요일부터)·분야 목록만 읽는다.
 */
export async function readGoalSummaryForUser(deps: { supabase: SupabaseClient; key: TodoKey | null; now?: () => Date }): Promise<RecordResult<GoalSummary>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (!deps.key) return recordFail("config");
    const weekStart = weekStartFor(todoDayFor((deps.now ?? serverNow)()));
    const [logs, categories, goal] = await Promise.all([
      listEveningLogs({ supabase: deps.supabase }, weekStart),
      listCategoriesForUser({ supabase: deps.supabase, key: deps.key }),
      readWeeklyGoalItems({ supabase: deps.supabase, weekStart }),
    ]);
    if (!logs.ok) return logs;
    if (!goal.ok) return goal;
    if (!categories.ok) return recordFail(categories.error === "unauthenticated" ? "unauthenticated" : categories.error === "config" ? "config" : "unavailable");
    return {
      ok: true,
      data: {
        weekStart,
        goal: goal.data,
        thisWeek: sumRange(logs.data, weekStart, weekDates(weekStart)[6]),
        categories: categories.data.categories.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name }] : [])),
      },
    };
  } catch {
    return recordFail("unavailable");
  }
}
