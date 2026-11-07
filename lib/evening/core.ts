import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listCategoriesForUser } from "../categories/core";
import { mapRecordDbError, recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";
import type { TodoKey } from "../todos/crypto";
import { todoDayFor } from "../todos/day";
import { addDays, isDayString } from "../week";
import { listTimerMinutes } from "../focus/minutes";
import { compactItems, diffItems, EVENING_BACK_DAYS, notSplitItems, SAVE_MODES, sumMinutes, type EveningItem } from "./logic";
import type { EveningLog, EveningState, SavedEvening } from "./types";

/**
 * 저녁 기록 서버 함수(PRD 7-3, 8절). 서버 전용.
 * 같은 규칙: 함수마다 자기 안에서 세션 확인(getClaims), user_id는 세션에서만, 날짜·저장 시각은 서버 시계, 예상된 실패는 짧은 코드.
 * 저장할 때마다 한 행이 쌓인다(저장 방식·대상 날·저장 시각을 남긴다, G9). 고쳐 쓰지도 지우지도 않는다.
 */

export type EveningDeps = { supabase: SupabaseClient; key: TodoKey | null; now?: () => Date };

const serverNow = () => new Date();

type LogRow = {
  id: string;
  target_day: string;
  total_minutes: number;
  items: unknown;
  save_mode: string;
  saved_at: string;
  client_saved_at?: string | null;
};
const LOG_COLUMNS = "id, target_day, total_minutes, items, save_mode, saved_at, client_saved_at";

const itemsSchema = z.array(z.object({ categoryId: z.uuid().nullable(), minutes: z.number().int().min(0).max(1440) }));

/** DB의 행을 화면 모양으로. items가 이상하면(손으로 넣은 값) 빈 목록으로 읽는다 */
export function toLog(row: LogRow): EveningLog {
  const parsed = itemsSchema.safeParse(row.items);
  const mode = SAVE_MODES.find((m) => m === row.save_mode) ?? "edited";
  return {
    id: row.id,
    targetDay: row.target_day,
    totalMinutes: row.total_minutes,
    items: parsed.success ? compactItems(parsed.data) : [],
    saveMode: mode,
    savedAt: row.saved_at,
  };
}

/** 같은 날의 기록들에서 가장 늦게 저장한 것(같은 시각이면 id가 큰 것) */
export function latestPerDay(logs: EveningLog[]): EveningLog[] {
  const best = new Map<string, EveningLog>();
  for (const log of logs) {
    const current = best.get(log.targetDay);
    if (!current || log.savedAt > current.savedAt || (log.savedAt === current.savedAt && log.id > current.id)) best.set(log.targetDay, log);
  }
  return [...best.values()].sort((a, b) => (a.targetDay < b.targetDay ? -1 : 1));
}

function dayInReach(today: string, day: string): boolean {
  return isDayString(day) && day <= today && day >= addDays(today, -EVENING_BACK_DAYS);
}

/** 저녁 기록 화면이 열릴 때 필요한 것. day를 안 주면 오늘. 오늘에서 7일 앞까지만(그 밖은 invalid_input) */
export async function readEveningState(deps: EveningDeps, dayParam?: unknown): Promise<RecordResult<EveningState>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (!deps.key) return recordFail("config");
    const today = todoDayFor((deps.now ?? serverNow)());
    const day = dayParam === undefined || dayParam === null || dayParam === "" ? today : dayParam;
    if (typeof day !== "string" || !dayInReach(today, day)) return recordFail("invalid_input");

    const [logs, done, categories, timer] = await Promise.all([
      deps.supabase.from("evening_logs").select(LOG_COLUMNS).eq("user_id", user.data).eq("target_day", day).order("saved_at", { ascending: true }).order("id", { ascending: true }),
      deps.supabase.from("todos").select("category_id").eq("user_id", user.data).eq("day", day).eq("done", true),
      listCategoriesForUser({ supabase: deps.supabase, key: deps.key }),
      listTimerMinutes({ supabase: deps.supabase, userId: user.data, day, now: deps.now }),
    ]);
    if (logs.error) return recordFail(mapRecordDbError(logs.error));
    if (done.error) return recordFail(mapRecordDbError(done.error));
    if (!categories.ok) return recordFail(categories.error === "unauthenticated" ? "unauthenticated" : categories.error === "config" ? "config" : "unavailable");
    if (!timer.ok) return timer;

    const doneIds = [...new Set(((done.data ?? []) as { category_id: string | null }[]).map((r) => r.category_id ?? null))];
    const latest = latestPerDay(((logs.data ?? []) as LogRow[]).map(toLog))[0] ?? null;
    return {
      ok: true,
      data: {
        today,
        day,
        existing: latest,
        doneCategoryIds: doneIds,
        timerByCategory: timer.data,
        categories: categories.data.categories.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name }] : [])),
      },
    };
  } catch {
    return recordFail("unavailable");
  }
}

const saveSchema = z
  .object({
    id: z.uuid(),
    targetDay: z.string(),
    totalMinutes: z.number().int().min(0).max(1440),
    items: z.array(z.object({ categoryId: z.uuid().nullable(), minutes: z.number().int().min(1).max(1440) }).strict()).max(51),
    saveMode: z.enum(SAVE_MODES),
    clientSavedAt: z.string().max(40).nullable().optional(),
  })
  .strict();

/** 기기 시계 값은 믿지 않고 형식만 본다. 이상하면 null */
function cleanClientTime(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * 저녁 기록 저장. 받는 것은 화면이 만든 id·대상 날·총시간·항목·저장 방식·기기 시각뿐이다(user_id·서버 시각은 받지 않는다).
 * - 대상 날은 오늘에서 7일 앞까지, 항목 시간의 합은 총시간과 같아야 하고, 같은 분야는 한 번만, 분야는 내 것이어야 한다(남의 분야면 not_found).
 * - 「나누지 않음」은 항목이 기타 하나(총시간 0이면 없음)여야 한다.
 * - 같은 id로 다시 오면(재시도) 새 행을 만들지 않고 그 행으로 성공한다.
 * - 돌려주는 delta는 그 날 앞선 기록(없으면 0)과 견준 분야별 바뀐 시간이다(저장 직후 한 줄).
 */
export async function saveEveningLogForUser(deps: EveningDeps, input: unknown): Promise<RecordResult<SavedEvening>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return recordFail("invalid_input");
    const v = parsed.data;
    const today = todoDayFor((deps.now ?? serverNow)());
    if (!dayInReach(today, v.targetDay)) return recordFail("invalid_input");
    const ids = v.items.map((i) => i.categoryId);
    if (new Set(ids).size !== ids.length) return recordFail("invalid_input");
    if (sumMinutes(v.items) !== v.totalMinutes) return recordFail("invalid_input");
    if (v.saveMode === "not_split") {
      const expected = notSplitItems(v.totalMinutes);
      if (v.items.length !== expected.length || v.items.some((i, n) => i.categoryId !== expected[n].categoryId || i.minutes !== expected[n].minutes)) {
        return recordFail("invalid_input");
      }
    }

    const categoryIds = ids.filter((id): id is string => id !== null);
    if (categoryIds.length > 0) {
      const mine = await deps.supabase.from("categories").select("id").eq("user_id", user.data).in("id", categoryIds);
      if (mine.error) return recordFail(mapRecordDbError(mine.error));
      if (((mine.data ?? []) as { id: string }[]).length !== categoryIds.length) return recordFail("not_found");
    }

    const { error } = await deps.supabase
      .from("evening_logs")
      .insert({
        id: v.id,
        user_id: user.data,
        target_day: v.targetDay,
        total_minutes: v.totalMinutes,
        items: v.items,
        save_mode: v.saveMode,
        client_saved_at: cleanClientTime(v.clientSavedAt),
      })
      .select(LOG_COLUMNS);
    // 같은 id(재시도)거나 이미 들어간 뒤 상한에 걸린 재시도면 아래에서 내 행을 찾는다. 못 찾으면 그 오류를 돌려준다.
    const retry = error !== null && (error.code === "23505" || error.code === "P0001");
    if (error && !retry) return recordFail(mapRecordDbError(error));

    const all = await deps.supabase
      .from("evening_logs")
      .select(LOG_COLUMNS)
      .eq("user_id", user.data)
      .eq("target_day", v.targetDay)
      .order("saved_at", { ascending: true })
      .order("id", { ascending: true });
    if (all.error) return recordFail(mapRecordDbError(all.error));
    const logs = ((all.data ?? []) as LogRow[]).map(toLog);
    const index = logs.findIndex((l) => l.id === v.id);
    if (index < 0) return recordFail(error ? mapRecordDbError(error) : "unavailable");
    const previous: EveningItem[] = index > 0 ? logs[index - 1].items : [];
    return { ok: true, data: { log: logs[index], delta: diffItems(previous, logs[index].items) } };
  } catch {
    return recordFail("unavailable");
  }
}

/**
 * 최근 날들의 저녁 기록(날마다 가장 늦게 저장한 것). 상태보기가 쓴다. from은 그 날부터(포함).
 * 임시: 최근 것부터 최대 2000행을 읽는다(넘으면 가장 오래된 기록이 빠진다). 쌓이면 SQL 집계로 옮긴다.
 */
export async function listEveningLogs(deps: Pick<EveningDeps, "supabase">, fromDay?: string): Promise<RecordResult<EveningLog[]>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    let query = deps.supabase.from("evening_logs").select(LOG_COLUMNS).eq("user_id", user.data);
    if (fromDay !== undefined) {
      if (!isDayString(fromDay)) return recordFail("invalid_input");
      query = query.gte("target_day", fromDay);
    }
    // 최근 것부터 2000행을 읽는다(A12). 오래된 것부터 읽으면 2000행을 넘긴 뒤의 새 기록이 조용히 빠져 누적이 멈춘다.
    // 날짜 오름차순으로 돌려주는 것은 latestPerDay가 맡는다
    const { data, error } = await query.order("target_day", { ascending: false }).order("saved_at", { ascending: false }).limit(2000);
    if (error) return recordFail(mapRecordDbError(error));
    return { ok: true, data: latestPerDay(((data ?? []) as LogRow[]).map(toLog)) };
  } catch {
    return recordFail("unavailable");
  }
}
