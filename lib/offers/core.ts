import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listCategoriesForUser } from "../categories/core";
import type { CategoryItem } from "../categories/types";
import { listEveningLogs } from "../evening/core";
import { readWeeklyGoalItems } from "../goals/core";
import { sumRange } from "../growth/logic";
import { mapRecordDbError, recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";
import { readSettingsForUser } from "../settings/core";
import { decryptTodoText, type TodoKey } from "../todos/crypto";
import { todoDayFor } from "../todos/day";
import { addDays, weekDates, weekStartFor } from "../week";
import { offerCopyId } from "./copy-id";
import { OFFER_OTHER, offerKey, pickOfferCategory, pickOfferTodo } from "./logic";
import { OFFER_SURFACES, type AddOfferTodoResult, type DismissedOffer, type Offer, type OfferRequestResult } from "./types";

/**
 * 오늘 먼저 할 일 건네기(PRD 7-5, ⑤, 검증 장치). 서버 전용.
 * 같은 규칙: 함수마다 자기 안에서 세션 확인(getClaims), user_id는 세션에서만, 날짜·시각은 서버 시계, 예상된 실패는 짧은 코드.
 * 건넨 것(제시)을 기록한다(먼저 하기 비율의 분모, 22 4-1): 같은 날·자리·분야·할 일은 한 번만 센다(Q4 임시).
 * 건네는 분야는 처음 정한 비율(이번 주 목표가 있으면 목표)보다 덜 한 분야다. 건넬 할 일은 그 분야의 끝내지 않은 할 일에서 가져오고(AI 없음), 없으면 분야만 건넨다.
 * 시간대 규칙은 없다(PM 11-10, d-223): 카드도 타이머 탭 추천도 하루 어느 때든 건넨다. 그날 넘긴 제시는 같은 날(하루는 새벽 4시에 바뀐다) 저녁·새벽에도 다시 나오지 않는다.
 */
export type OfferDeps = { supabase: SupabaseClient; key: TodoKey | null; now?: () => Date };

const serverNow = () => new Date();
const requestSchema = z.object({ surface: z.enum(OFFER_SURFACES) }).strict();

type OfferRow = { id: string; day: string; surface: string; category_id: string | null; todo_id: string | null; offer_key: string; dismissed_at: string | null };
const OFFER_COLUMNS = "id, day, surface, category_id, todo_id, offer_key, dismissed_at";
type DbCode = ReturnType<typeof mapRecordDbError>;

/** 그 제시를 넘겼으면 dismissed, 그 제시로 타이머를 켠 적이 있으면 started, 아니면 new. 읽기 실패는 짧은 코드로 돌려준다 */
async function offerState(deps: Pick<OfferDeps, "supabase">, userId: string, row: OfferRow): Promise<{ ok: true; state: Offer["state"] } | { ok: false; error: DbCode }> {
  if (row.dismissed_at !== null) return { ok: true, state: "dismissed" };
  const started = await deps.supabase.from("focus_sessions").select("id").eq("user_id", userId).eq("offer_id", row.id).limit(1);
  if (started.error) return { ok: false, error: mapRecordDbError(started.error) };
  return { ok: true, state: ((started.data ?? []) as { id: string }[]).length > 0 ? "started" : "new" };
}

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

    // 「오늘 할 일에 추가」로 오늘 사본을 만든 카드 제시가 있으면 새 제시 줄을 만들지 않고 그 원래 제시를 사본과 함께 돌려준다(분모는 한 번, 고침 11)
    if (surface === "card") {
      const reused = await readCopiedCardOffer(deps, user.data, key, day, categories.data.categories);
      if (!reused.ok) return recordFail(reused.error);
      if (reused.offer) return { ok: true, data: { offer: reused.offer } };
    }

    const target = pickOfferCategory({
      ratios: settings.data.ratios,
      goalItems: goal.data,
      totals: sumRange(logs.data, weekStart, weekDates(weekStart)[6]),
    });
    // 기타(분야 없음)도 건넬 수 있다: 분야 번호는 null, 이름은 「기타」
    const categoryId = target === OFFER_OTHER ? null : target;
    const category = target === null ? undefined : categoryId === null ? { readable: true as const, name: "기타" } : categories.data.categories.find((c) => c.id === categoryId);
    if (target === null || !category || !category.readable) return { ok: true, data: { offer: null, reason: "no_target" } };

    // 건넬 할 일: 그 분야(기타는 분야 없는 것)의 최근 7일 안 끝내지 않은 할 일
    let todosQuery = deps.supabase.from("todos").select("id, day, text_encrypted, created_at").eq("user_id", user.data);
    todosQuery = categoryId === null ? todosQuery.is("category_id", null) : todosQuery.eq("category_id", categoryId);
    const todosRes = await todosQuery
      .eq("done", false)
      .gte("day", addDays(day, -7))
      .lte("day", day)
      .limit(100);
    if (todosRes.error) return recordFail(mapRecordDbError(todosRes.error));
    const todoRows = (todosRes.data ?? []) as { id: string; day: string; text_encrypted: string; created_at: string }[];
    const todoId = pickOfferTodo(todoRows.map((r) => ({ id: r.id, day: r.day, createdAt: r.created_at })), day);
    let todoText: string | null = null;
    const todoDay = todoId ? (todoRows.find((r) => r.id === todoId)?.day ?? null) : null;
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

    const state = await offerState(deps, user.data, row);
    if (!state.ok) return recordFail(state.error);
    return {
      ok: true,
      data: {
        offer: { id: row.id, surface, day: row.day, categoryId, categoryName: category.name, todoId, todoText, todoDay, state: state.state },
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

type CategoryList = CategoryItem[];

/**
 * 오늘의 카드 제시(넘기지 않음) 가운데 「오늘 할 일에 추가」로 만든 오늘 사본이 있는 것을 찾는다.
 * 사본 id는 제시 id에서 정해지므로(offerCopyId) 제시 줄은 고치지 않고도 사본을 알아본다. 사본이 오늘 것이고 끝나지 않았을 때만 쓴다.
 */
async function readCopiedCardOffer(
  deps: Pick<OfferDeps, "supabase">,
  userId: string,
  key: TodoKey,
  day: string,
  categories: CategoryList,
): Promise<{ ok: true; offer: Offer | null } | { ok: false; error: DbCode }> {
  const offersRes = await deps.supabase
    .from("todo_offers")
    .select(OFFER_COLUMNS)
    .eq("user_id", userId)
    .eq("day", day)
    .eq("surface", "card")
    .is("dismissed_at", null)
    .limit(50);
  if (offersRes.error) return { ok: false, error: mapRecordDbError(offersRes.error) };
  const rows = ((offersRes.data ?? []) as OfferRow[]).filter((r) => r.todo_id !== null);
  const rowOfCopy = new Map<string, OfferRow>();
  for (const r of rows) {
    const id = offerCopyId(r.id);
    if (id) rowOfCopy.set(id, r);
  }
  if (rowOfCopy.size === 0) return { ok: true, offer: null };
  const todosRes = await deps.supabase
    .from("todos")
    .select("id, day, text_encrypted")
    .eq("user_id", userId)
    .in("id", [...rowOfCopy.keys()])
    .eq("day", day)
    .eq("done", false)
    .limit(50);
  if (todosRes.error) return { ok: false, error: mapRecordDbError(todosRes.error) };
  // 사본이 여럿이면(분야가 다른 제시 둘 등) 제시 번호가 작은 쪽을 먼저 쓴다(늘 같은 답)
  const copies = ((todosRes.data ?? []) as { id: string; day: string; text_encrypted: string }[]).sort((a, b) =>
    rowOfCopy.get(a.id)!.id < rowOfCopy.get(b.id)!.id ? -1 : 1,
  );
  for (const copy of copies) {
    const row = rowOfCopy.get(copy.id)!;
    const category = row.category_id === null ? { readable: true, name: "기타" } : categories.find((c) => c.id === row.category_id);
    if (!category || !category.readable) continue;
    const opened = decryptTodoText(copy.text_encrypted, userId, key);
    const state = await offerState(deps, userId, row);
    if (!state.ok) return state;
    return {
      ok: true,
      offer: {
        id: row.id,
        surface: "card",
        day: row.day,
        categoryId: row.category_id,
        categoryName: category.name,
        todoId: copy.id,
        todoText: opened.ok ? opened.text : null,
        todoDay: copy.day,
        state: state.state,
      },
    };
  }
  return { ok: true, offer: null };
}

const addSchema = z.object({ offerId: z.uuid() }).strict();

/**
 * 「오늘 할 일에 추가」(고침 11, 23 명세 5절): 카드로 건넨 지난 날 할 일을 오늘 할 일로 복사한다(글·분야 복사, 원본은 그대로).
 * 공개 엔드포인트라 인자는 unknown으로 받아 다시 검증하고, 제시는 자기 것·오늘·card·넘기지 않음, 원본은 자기 것·7일 안·끝내지 않음을 매번 서버가 확인한다.
 * 사본 id는 화면이 보내지 않고 서버가 제시 id에서 만든다(offerCopyId) → 제시 하나에 사본 하나. 제시 줄은 고치지 않는다(todo_offers는 dismissed_at만 고친다).
 * 원본이 그새 끝났거나 지워졌거나 이미 오늘 것이면 사본을 만들지 않고 { added: false }로 돌려준다(화면이 카드를 다시 받는다).
 * 먼저 한 기록(focus_sessions)은 만들지 않는다(D-092: 타이머를 시작해야 센다).
 */
export async function addOfferTodoForUser(deps: OfferDeps, input: unknown): Promise<RecordResult<AddOfferTodoResult>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsed = addSchema.safeParse(input);
    if (!parsed.success) return recordFail("invalid_input");
    if (!deps.key) return recordFail("config");
    const key = deps.key;
    const day = todoDayFor((deps.now ?? serverNow)());
    const copyId = offerCopyId(parsed.data.offerId);
    if (!copyId) return recordFail("invalid_input");

    const found = await deps.supabase.from("todo_offers").select(OFFER_COLUMNS).eq("id", parsed.data.offerId).eq("user_id", user.data);
    if (found.error) return recordFail(mapRecordDbError(found.error));
    const offer = ((found.data ?? []) as OfferRow[])[0];
    // 남의 것·없는 것·타이머 탭 제시·지난 날 제시·넘긴 제시는 거절한다(쓰기 없음)
    if (!offer || offer.surface !== "card" || offer.day !== day || offer.dismissed_at !== null || offer.todo_id === null) return recordFail("not_found");

    const source = await deps.supabase
      .from("todos")
      .select("id, day, text_encrypted, category_id")
      .eq("id", offer.todo_id)
      .eq("user_id", user.data)
      .eq("done", false)
      .gte("day", addDays(day, -7))
      .lte("day", addDays(day, -1))
      .limit(1);
    if (source.error) return recordFail(mapRecordDbError(source.error));
    const original = ((source.data ?? []) as { id: string; day: string; text_encrypted: string; category_id: string | null }[])[0];
    if (!original) return { ok: true, data: { added: false } };

    const values: Record<string, string> = { id: copyId, user_id: user.data, day, text_encrypted: original.text_encrypted };
    if (original.category_id) values.category_id = original.category_id;
    const inserted = await deps.supabase.from("todos").insert(values).select("id");
    // 같은 제시로 다시 눌렀거나 연타: 이미 있는 그 사본을 그대로 돌려준다(하나만 생긴다)
    if (inserted.error && inserted.error.code !== "23505" && inserted.error.code !== "P0001") return recordFail(mapRecordDbError(inserted.error));
    const mine = await deps.supabase.from("todos").select("id, day, text_encrypted").eq("id", copyId).eq("user_id", user.data).limit(1);
    if (mine.error) return recordFail(mapRecordDbError(mine.error));
    const copy = ((mine.data ?? []) as { id: string; day: string; text_encrypted: string }[])[0];
    if (!copy) return recordFail(inserted.error ? mapRecordDbError(inserted.error) : "unavailable");
    const opened = decryptTodoText(copy.text_encrypted, user.data, key);
    return { ok: true, data: { added: true, todoId: copy.id, todoText: opened.ok ? opened.text : null, day: copy.day } };
  } catch {
    return recordFail("unavailable");
  }
}
