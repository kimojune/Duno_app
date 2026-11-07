import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isEvening } from "../app-config";
import { listCategoriesForUser } from "../categories/core";
import { listEveningLogs } from "../evening/core";
import { readWeeklyGoalItems } from "../goals/core";
import { sumRange } from "../growth/logic";
import { mapRecordDbError, recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";
import { readSettingsForUser } from "../settings/core";
import { decryptTodoText, type TodoKey } from "../todos/crypto";
import { todoDayFor } from "../todos/day";
import { addDays, weekDates, weekStartFor } from "../week";
import { offerKey, pickOfferCategory, pickOfferTodo } from "./logic";
import { OFFER_SURFACES, type DismissedOffer, type OfferRequestResult } from "./types";

/**
 * 오늘 먼저 할 일 건네기(PRD 7-5, ⑤, 검증 장치). 서버 전용.
 * 같은 규칙: 함수마다 자기 안에서 세션 확인(getClaims), user_id는 세션에서만, 날짜·시각은 서버 시계, 예상된 실패는 짧은 코드.
 * 건넨 것(제시)을 기록한다(먼저 하기 비율의 분모, 22 4-1): 같은 날·자리·분야·할 일은 한 번만 센다(Q4 임시).
 * 건네는 분야는 처음 정한 비율(이번 주 목표가 있으면 목표)보다 덜 한 분야다. 건넬 할 일은 그 분야의 끝내지 않은 할 일에서 가져오고(AI 없음), 없으면 분야만 건넨다.
 * 「저녁에는 건네지 않는다」: 카드는 서울 오후 6시~새벽 4시 전에는 건네지 않는다. 타이머 탭의 추천은 저녁에도 한다(임시, 22 2-9 어긋남은 자리를 따로 기록해 가른다).
 */
export type OfferDeps = { supabase: SupabaseClient; key: TodoKey | null; now?: () => Date };

const serverNow = () => new Date();
const requestSchema = z.object({ surface: z.enum(OFFER_SURFACES) }).strict();

type OfferRow = { id: string; day: string; surface: string; category_id: string | null; todo_id: string | null; offer_key: string; dismissed_at: string | null };
const OFFER_COLUMNS = "id, day, surface, category_id, todo_id, offer_key, dismissed_at";

/** 지금 건넬 것을 정해 돌려주고, 제시로 기록한다(같은 제시는 한 번만). 건넬 것이 없으면 offer가 null이고 이유가 붙는다. */
export async function requestOfferForUser(deps: OfferDeps, input: unknown): Promise<RecordResult<OfferRequestResult>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return recordFail("invalid_input");
    if (!deps.key) return recordFail("config");
    const key = deps.key;
    const surface = parsed.data.surface;
    const now = (deps.now ?? serverNow)();
    if (surface === "card" && isEvening(now)) return { ok: true, data: { offer: null, reason: "evening" } };

    const day = todoDayFor(now);
    const weekStart = weekStartFor(day);
    const [settings, logs, goal, categories] = await Promise.all([
      readSettingsForUser({ supabase: deps.supabase, key }),
      listEveningLogs({ supabase: deps.supabase }, weekStart),
      readWeeklyGoalItems({ supabase: deps.supabase, weekStart }),
      listCategoriesForUser({ supabase: deps.supabase, key }),
    ]);
    if (!settings.ok) return settings;
    if (!logs.ok) return logs;
    if (!goal.ok) return goal;
    if (!categories.ok) return recordFail(categories.error === "unauthenticated" ? "unauthenticated" : categories.error === "config" ? "config" : "unavailable");

    const categoryId = pickOfferCategory({
      ratios: settings.data.ratios,
      goalItems: goal.data,
      totals: sumRange(logs.data, weekStart, weekDates(weekStart)[6]),
    });
    const category = categoryId ? categories.data.categories.find((c) => c.id === categoryId) : undefined;
    if (!categoryId || !category || !category.readable) return { ok: true, data: { offer: null, reason: "no_target" } };

    // 건넬 할 일: 그 분야의 최근 7일 안 끝내지 않은 할 일
    const todosRes = await deps.supabase
      .from("todos")
      .select("id, day, text_encrypted, created_at")
      .eq("user_id", user.data)
      .eq("category_id", categoryId)
      .eq("done", false)
      .gte("day", addDays(day, -7))
      .lte("day", day)
      .limit(100);
    if (todosRes.error) return recordFail(mapRecordDbError(todosRes.error));
    const todoRows = (todosRes.data ?? []) as { id: string; day: string; text_encrypted: string; created_at: string }[];
    const todoId = pickOfferTodo(todoRows.map((r) => ({ id: r.id, day: r.day, createdAt: r.created_at })), day);
    let todoText: string | null = null;
    if (todoId) {
      const row = todoRows.find((r) => r.id === todoId);
      const opened = row ? decryptTodoText(row.text_encrypted, user.data, key) : null;
      todoText = opened && opened.ok ? opened.text : null;
    }

    // 제시로 기록한다: 같은 날·자리·분야·할 일은 한 번만(이미 있으면 그대로 둔다)
    const k = offerKey(surface, categoryId, todoId);
    const write = await deps.supabase
      .from("todo_offers")
      .upsert(
        { user_id: user.data, day, surface, category_id: categoryId, todo_id: todoId, offer_key: k },
        { onConflict: "user_id,day,offer_key", ignoreDuplicates: true },
      )
      .select("id");
    if (write.error) return recordFail(mapRecordDbError(write.error));
    const read = await deps.supabase.from("todo_offers").select(OFFER_COLUMNS).eq("user_id", user.data).eq("day", day).eq("offer_key", k);
    if (read.error) return recordFail(mapRecordDbError(read.error));
    const row = ((read.data ?? []) as OfferRow[])[0];
    if (!row) return recordFail("unavailable");

    let state: "new" | "dismissed" | "started" = "new";
    if (row.dismissed_at !== null) state = "dismissed";
    else {
      const started = await deps.supabase.from("focus_sessions").select("id").eq("user_id", user.data).eq("offer_id", row.id).limit(1);
      if (started.error) return recordFail(mapRecordDbError(started.error));
      if (((started.data ?? []) as { id: string }[]).length > 0) state = "started";
    }
    return {
      ok: true,
      data: {
        offer: { id: row.id, surface, day: row.day, categoryId, categoryName: category.name, todoId, todoText, state },
      },
    };
  } catch {
    return recordFail("unavailable");
  }
}

/** 「넘기기」: 그 제시를 넘긴 것으로 남긴다(서버 시각). 이미 넘겼으면 그대로 성공. 남의 것·없는 것은 not_found */
export async function dismissOfferForUser(deps: Pick<OfferDeps, "supabase" | "now">, id: unknown): Promise<RecordResult<DismissedOffer>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedId = z.uuid().safeParse(id);
    if (!parsedId.success) return recordFail("invalid_input");
    const found = await deps.supabase.from("todo_offers").select(OFFER_COLUMNS).eq("id", parsedId.data).eq("user_id", user.data);
    if (found.error) return recordFail(mapRecordDbError(found.error));
    const row = ((found.data ?? []) as OfferRow[])[0];
    if (!row) return recordFail("not_found");
    if (row.dismissed_at !== null) return { ok: true, data: { id: row.id } };
    const { data, error } = await deps.supabase
      .from("todo_offers")
      .update({ dismissed_at: (deps.now ?? serverNow)().toISOString() })
      .eq("id", parsedId.data)
      .eq("user_id", user.data)
      .select("id");
    if (error) return recordFail(mapRecordDbError(error));
    if (((data ?? []) as { id: string }[]).length === 0) return recordFail("not_found");
    return { ok: true, data: { id: row.id } };
  } catch {
    return recordFail("unavailable");
  }
}
