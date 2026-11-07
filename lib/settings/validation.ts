import { z } from "zod";
import { APP_CONFIG } from "../app-config";
import type { NotifySettings, RatioItem } from "./types";

/**
 * 처음 설정 입력 검증(공용, 순수 함수). 화면도 같은 함수를 쓴다. 서버는 화면이 검사했더라도 다시 검사한다.
 * 임시, 결정 필요: 목표 글 100자(코드 포인트), 비율은 0~100 정수·분야 하나 이상·합이 0보다 커야 함(합이 100이 아니어도 됨).
 */
export const GOAL_MAX_LENGTH = 100;
export const RATIO_STEP = 5;
export const RATIO_ITEMS_MAX = 50; // 분야 상한(CATEGORY_LIMIT)과 같다

export type GoalCheck = { ok: true; goal: string | null } | { ok: false; error: "invalid_input" | "too_long" };

/** 목표 글 검사: 문자열이나 null. 앞뒤 공백을 지우고 비면 null(목표 없음). 100자 넘으면 too_long */
export function checkGoal(input: unknown): GoalCheck {
  if (input === null) return { ok: true, goal: null };
  if (typeof input !== "string") return { ok: false, error: "invalid_input" };
  const text = input.trim().replace(/\s+/gu, " ");
  if (text.length === 0) return { ok: true, goal: null };
  if (text.length > GOAL_MAX_LENGTH * 2 || [...text].length > GOAL_MAX_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true, goal: text };
}

export function countGoalChars(text: string): number {
  return [...text.trim().replace(/\s+/gu, " ")].length;
}

const ratioSchema = z
  .array(z.object({ categoryId: z.uuid(), percent: z.number().int().min(0).max(100) }).strict())
  .min(1)
  .max(RATIO_ITEMS_MAX);

export type RatioCheck = { ok: true; ratios: RatioItem[] } | { ok: false; error: "invalid_input" };

/** 비율 검사: 분야 번호 uuid·중복 없음·0~100 정수·합이 0보다 큼 */
export function checkRatios(input: unknown): RatioCheck {
  const parsed = ratioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const ids = new Set(parsed.data.map((r) => r.categoryId));
  if (ids.size !== parsed.data.length) return { ok: false, error: "invalid_input" };
  if (parsed.data.reduce((sum, r) => sum + r.percent, 0) <= 0) return { ok: false, error: "invalid_input" };
  return { ok: true, ratios: parsed.data };
}

/** 분야 n개를 5% 단위로 고르게 나눈다. 나머지는 앞 분야부터 5%씩 더한다. 예: 3개 → 35·35·30 */
export function evenRatios(categoryIds: string[]): RatioItem[] {
  const n = categoryIds.length;
  if (n === 0) return [];
  const units = 100 / RATIO_STEP; // 20칸
  const base = Math.floor(units / n);
  let extra = units - base * n;
  return categoryIds.map((categoryId) => {
    const add = extra > 0 ? 1 : 0;
    extra -= add;
    return { categoryId, percent: (base + add) * RATIO_STEP };
  });
}

/** 합으로 나눈 몫(합이 100이 아니어도 비율로 읽는다). 합이 0이면 빈 목록 */
export function normalizedShares(ratios: RatioItem[]): { categoryId: string; share: number }[] {
  const sum = ratios.reduce((s, r) => s + r.percent, 0);
  if (sum <= 0) return [];
  return ratios.map((r) => ({ categoryId: r.categoryId, share: r.percent / sum }));
}

const minuteSchema = z.number().int().min(0).max(1439);
export const notifyPatchSchema = z
  .object({
    eveningEnabled: z.boolean().optional(),
    eveningMinute: minuteSchema.optional(),
    morningEnabled: z.boolean().optional(),
    morningMinute: minuteSchema.optional(),
  })
  .strict();

export const DEFAULT_NOTIFY: NotifySettings = {
  eveningEnabled: false,
  eveningMinute: APP_CONFIG.notifyEveningMinute,
  morningEnabled: false,
  morningMinute: APP_CONFIG.notifyMorningMinute,
};
