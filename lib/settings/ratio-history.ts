import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { RatioItem } from "./types";
import { RATIO_ITEMS_MAX } from "./validation";

/**
 * 목표 비율이 바뀐 기록(고침 9바퀴, PM 「152 나」 — 이번에는 저장만, 보이기는 다음 판). 서버 전용.
 * 표: public.category_ratio_history(마이그레이션 20261109150000_category_ratio_history.sql). 한 행 = 저장 한 번의 묶음.
 *
 * 규칙
 * - 비율 저장(saveRatiosForUser)이 끝까지 성공한 뒤에만 부른다. 세션 클라이언트로 넣는다(RLS를 거친다, service role 없음).
 * - 직전 기록(자기 행 최신 하나)과 같은 묶음이면 넣지 않는다: 같은 값을 다시 저장해도, 보낼 줄(기기 먼저 저장)이 같은 저장을 다시 보내도 행이 늘지 않는다.
 * - 무엇이 실패해도 던지지 않는다. 비율 저장은 이미 끝났으니 사용자에게 실패로 돌려주지 않고, 로그에 짧은 코드만 남긴다(값·사용자 글 없음).
 *   표가 아직 없는 DB(마이그레이션 적용 전)에서도 같은 길이다: 기록만 빠지고 비율 저장은 성공한다.
 * - 저장한 시각은 DB 기본값(now(), 서버 시계)이다. 앱은 recorded_at을 보내지 않는다(insert 권한에도 없다).
 */

export const RATIO_HISTORY_TABLE = "category_ratio_history";

/** 기록 한 칸. category_id가 null이면 기타 */
export type RatioHistoryItem = { category_id: string | null; percent: number };

/** 기록 묶음의 모양: 배열 · 분야 번호 uuid 또는 null(기타) · 0~100 정수 · 분야 중복 없음 · 합 100(PM 확정 11-08 「합은 늘 100」) */
export const ratioHistorySchema = z
  .array(z.object({ category_id: z.uuid().nullable(), percent: z.number().int().min(0).max(100) }).strict())
  .min(1)
  .max(RATIO_ITEMS_MAX)
  .refine((items) => new Set(items.map((i) => i.category_id)).size === items.length, { message: "duplicate" })
  .refine((items) => items.reduce((sum, i) => sum + i.percent, 0) === 100, { message: "sum" });

/**
 * 저장한 최종 묶음 → 기록 묶음. 지금 저장 규칙을 그대로 따른다(readSettingsForUser가 저장 뒤 돌려줄 값과 같다):
 * 분야 몫은 받은 그대로(category_ratios에 들어간 행), 기타는 0보다 클 때만(0이면 ratio_other_percent를 비운다).
 * 순서는 분야 번호 순, 기타는 맨 끝(같은 묶음을 순서와 상관없이 같게 비교하려고).
 */
export function toHistoryRatios(saved: RatioItem[]): RatioHistoryItem[] {
  const categories = saved
    .filter((r): r is { categoryId: string; percent: number } => r.categoryId !== null)
    .map((r) => ({ category_id: r.categoryId, percent: r.percent }))
    .sort((a, b) => (a.category_id < b.category_id ? -1 : a.category_id > b.category_id ? 1 : 0));
  const other = saved.find((r) => r.categoryId === null);
  return other && other.percent > 0 ? [...categories, { category_id: null, percent: other.percent }] : categories;
}

function canonical(items: RatioHistoryItem[]): string {
  const sorted = [...items].sort((a, b) => {
    if (a.category_id === b.category_id) return 0;
    if (a.category_id === null) return 1;
    if (b.category_id === null) return -1;
    return a.category_id < b.category_id ? -1 : 1;
  });
  return JSON.stringify(sorted.map((i) => [i.category_id, i.percent]));
}

/** 같은 묶음인가(순서는 보지 않는다) */
export function sameRatios(a: RatioHistoryItem[], b: RatioHistoryItem[]): boolean {
  return canonical(a) === canonical(b);
}

export type RatioHistoryOutcome = "written" | "unchanged" | "skipped_invalid" | "read_failed" | "write_failed";

/** 로그: 정해진 짧은 코드와 DB 오류 코드만(값·사용자 번호·오류 원문은 남기지 않는다) */
function logFailure(outcome: RatioHistoryOutcome, code?: unknown) {
  console.warn(`[ratio_history] ${outcome}${typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? ` code=${code}` : ""}`);
}

/**
 * 비율 저장이 성공한 뒤 기록 한 줄을 남긴다(바뀐 것이 없으면 남기지 않는다). 던지지 않는다.
 * userId는 세션에서 정한 값만 넘긴다(saveRatiosForUser의 requireUserId).
 */
export async function recordRatioHistory(supabase: SupabaseClient, userId: string, saved: RatioItem[]): Promise<RatioHistoryOutcome> {
  try {
    const ratios = toHistoryRatios(saved);
    const checked = ratioHistorySchema.safeParse(ratios);
    if (!checked.success) {
      // 지금 화면은 늘 합 100으로 보낸다. 그 밖의 길(옛 보낼 줄 등)로 합이 100이 아닌 묶음이 저장되면 기록만 건너뛴다
      logFailure("skipped_invalid");
      return "skipped_invalid";
    }

    const latest = await supabase
      .from(RATIO_HISTORY_TABLE)
      .select("ratios")
      .eq("user_id", userId)
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (latest.error) {
      logFailure("read_failed", latest.error.code);
      return "read_failed";
    }
    const previous = ((latest.data ?? []) as { ratios: unknown }[])[0];
    if (previous) {
      const parsed = ratioHistorySchema.safeParse(previous.ratios);
      if (parsed.success && sameRatios(parsed.data, checked.data)) return "unchanged";
    }

    const insert = await supabase.from(RATIO_HISTORY_TABLE).insert({ user_id: userId, ratios: checked.data });
    if (insert.error) {
      logFailure("write_failed", insert.error.code);
      return "write_failed";
    }
    return "written";
  } catch {
    logFailure("write_failed");
    return "write_failed";
  }
}
