import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findSameNamedCategory } from "../categories/core";
import { checkCategoryName } from "../categories/validation";
import { requireUserId } from "../session";
import { decryptCategoryName, encryptCategoryName, encryptTodoText, type TodoKey } from "../todos/crypto";
import type { BundleApplyResult, BundleErrorCode } from "./types";
import { checkBundleApply } from "./validation";

/**
 * 목표 묶음 저장의 서버 함수(MO-46). 서버 전용.
 * 같은 규칙: 함수마다 자기 안에서 세션을 확인(getClaims). 사용자 id는 세션에서만 얻고 DB 함수에는 넘기지 않는다(DB가 auth.uid()로 정한다).
 * 예상된 실패는 짧은 코드. 이름·목표 글은 여기서 암호화해 save_goal_bundle(RPC)을 **한 번** 부른다.
 */

export type BundleDeps = { supabase: SupabaseClient; key: TodoKey | null };

type DbError = { code?: string | null; hint?: string | null } | null | undefined;

/** DB 오류를 짧은 코드로. 원문은 버린다 */
export function mapBundleDbError(error: DbError): BundleErrorCode {
  if (!error) return "unavailable";
  if (error.hint === "bundle_conflict") return "bundle_conflict";
  if (error.hint === "bundle_not_found" || error.code === "P0002") return "not_found";
  if (error.hint === "bundle_invalid" || error.code === "22023") return "invalid_input";
  if (error.hint === "unauthenticated" || error.code === "28000") return "unauthenticated";
  if (error.code === "P0001" && error.hint === "categories_limit") return "category_limit";
  if (error.code === "23505") return "conflict";
  if (error.code === "23514") return "invalid_input";
  if (error.code === "PGRST301" || error.code === "PGRST303") return "unauthenticated";
  return "unavailable";
}

function toResult(data: unknown): BundleApplyResult {
  const v = (data ?? null) as { revision?: unknown; past?: unknown } | null;
  if (!v || typeof v.revision !== "number") return { ok: false, error: "unavailable" };
  return { ok: true, data: { revision: v.revision, pastSkipped: v.past === "limit" || v.past === "invalid" } };
}

type CategoryRow = { id: string; name_encrypted: string; archived_at: string | null };

/**
 * 새 묶음 전체를 저장한다(bundle.apply). 순서: 세션 → 입력 검사 → 이름 검사(새 분야·이름 바꾸기) → 암호화 → save_goal_bundle 한 번.
 * - 같은 이름: 쓰는 분야와 겹치면 duplicate(그 분야 existing), 보관한 분야와 겹치면 archived_exists(그 id와 함께, 되살리기를 권하는 것은 화면 몫).
 *   검사는 새 분야와 이름을 바꾸는 칸만 한다(옛 데이터의 겹침이 저장을 영영 막지 않게).
 * - 충돌(다른 기기가 먼저 고침)은 bundle_conflict. DB가 아무것도 바꾸지 않는다.
 */
export async function applyBundleForUser(deps: BundleDeps, input: unknown): Promise<BundleApplyResult> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const checked = checkBundleApply(input);
    if (!checked.ok) return { ok: false, error: checked.error };
    if (!deps.key) return { ok: false, error: "config" };
    const key = deps.key;
    const v = checked.input;

    const mine = await deps.supabase.from("categories").select("id, name_encrypted, archived_at").eq("user_id", user.data);
    if (mine.error) return { ok: false, error: mapBundleDbError(mine.error) };
    const rows = (mine.data ?? []) as CategoryRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));

    // 이 묶음이 끝나면 쓰지 않게 되는 분야(보관하는 칸, 다시 시작에서 빠진 분야)는 같은 이름 검사에서 뺀다
    const listed = new Map(v.items.map((i) => [i.id, i]));
    const leaving = new Set<string>();
    for (const item of v.items) if (item.archived === true) leaving.add(item.id);
    if (v.reason === "restart") for (const r of rows) if (r.archived_at === null && !listed.has(r.id)) leaving.add(r.id);

    const rpcItems: Record<string, unknown>[] = [];
    const seenNames: { id: string; name: string }[] = [];
    for (const item of v.items) {
      const entry: Record<string, unknown> = { id: item.id, percent: item.percent };
      const row = byId.get(item.id);
      const isNew = item.isNew === true && !row;
      if (!row && !isNew) return { ok: false, error: "not_found" };
      if (isNew) entry.new = true;
      if (item.archived !== undefined) entry.archived = item.archived;

      if (isNew || item.name !== undefined) {
        const name = checkCategoryName(item.name);
        if (!name.ok) return { ok: false, error: name.error };
        const current = row ? decryptCategoryName(row.name_encrypted, user.data, key) : null;
        const renamed = isNew || !current?.ok || current.text !== name.name;
        if (renamed && item.archived !== true) {
          const same = findSameNamedCategory(rows, user.data, key, name.name, new Set([...leaving, item.id]));
          if (same.active) return { ok: false, error: "duplicate", existing: same.active };
          const lower = name.name.toLowerCase();
          const inList = seenNames.find((s) => s.name.toLowerCase() === lower);
          if (inList) return { ok: false, error: "duplicate", existing: inList };
          // 보관한 같은 이름: 이 묶음이 그 분야를 되살리는 칸이면 겹침이 아니다
          if (same.archived && listed.get(same.archived.id)?.archived !== false) {
            return { ok: false, error: "archived_exists", existing: same.archived };
          }
          entry.name_encrypted = encryptCategoryName(name.name, user.data, key);
        }
        if (item.archived !== true) seenNames.push({ id: item.id, name: name.name });
      }
      rpcItems.push(entry);
    }

    const goalEncrypted = v.goal === null ? null : encryptTodoText(v.goal, user.data, key, "goal_text");
    const res = await deps.supabase.rpc("save_goal_bundle", {
      p_op_id: v.id,
      p_expected_revision: v.expectedRevision,
      p_reason: v.reason,
      p_set_goal: true,
      p_goal_encrypted: goalEncrypted,
      p_other: v.other,
      p_items: rpcItems,
      p_complete_onboarding: v.completeOnboarding === true,
      p_legacy: false,
    });
    if (res.error) return { ok: false, error: mapBundleDbError(res.error) };
    return toResult(res.data);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** 다시 시작 표시·취소(1단계). 표시는 지금 표를 바꾸지 않는다(set_restart_requested 한 번) */
export async function setRestartRequestedForUser(
  deps: BundleDeps,
  requested: unknown,
): Promise<{ ok: true } | { ok: false; error: BundleErrorCode }> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (typeof requested !== "boolean") return { ok: false, error: "invalid_input" };
    const res = await deps.supabase.rpc("set_restart_requested", { p_requested: requested });
    if (res.error) return { ok: false, error: mapBundleDbError(res.error) };
    return { ok: true };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * 옛 op(ratios.save·settings.save의 goal)가 배포 전 기기 줄에 남아 있을 때의 길. 같은 save_goal_bundle을 부르되 충돌 검사는 건너뛴다(p_legacy).
 * 옛 op는 거절하지 않는다: 분야 목록은 받은 비율의 분야 id만(이름·보관은 건드리지 않는다). 비율 합이 100이 아니어도 저장하고,
 * 그때는 지난 묶음·비율 바뀐 기록만 건너뛴다(DB).
 */
export async function saveLegacyBundleForUser(
  deps: BundleDeps,
  change: {
    ratios?: { categoryId: string | null; percent: number }[];
    goal?: { value: string | null };
    completeOnboarding?: boolean;
  },
): Promise<BundleApplyResult> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (!deps.key) return { ok: false, error: "config" };
    const items = change.ratios?.filter((r) => r.categoryId !== null).map((r) => ({ id: r.categoryId, percent: r.percent }));
    const other = change.ratios?.find((r) => r.categoryId === null)?.percent ?? 0;
    const goalEncrypted =
      change.goal && change.goal.value !== null ? encryptTodoText(change.goal.value, user.data, deps.key, "goal_text") : null;
    const res = await deps.supabase.rpc("save_goal_bundle", {
      p_op_id: null,
      p_expected_revision: null,
      p_reason: "edit",
      p_set_goal: change.goal !== undefined,
      p_goal_encrypted: goalEncrypted,
      p_other: change.ratios ? other : null,
      p_items: change.ratios ? items : null,
      p_complete_onboarding: change.completeOnboarding === true,
      p_legacy: true,
    });
    if (res.error) return { ok: false, error: mapBundleDbError(res.error) };
    return toResult(res.data);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
