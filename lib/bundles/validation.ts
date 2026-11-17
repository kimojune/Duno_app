import { z } from "zod";
import { checkGoal, RATIO_STEP } from "../settings/validation";
import { CATEGORY_LIMIT } from "../categories/validation";
import type { BundleApplyInput } from "./types";

/**
 * bundle.apply 입력 검증(공용, 순수 함수). 서버는 화면이 검사했더라도 다시 검사한다.
 * 규칙(23 명세): 분야 칸(보관한 것 포함)의 비율 합 + 기타 = 100, 비율은 0~100 정수·5 단위(지금 checkRatios의 단위), 분야 id 중복 없음.
 * 이름은 여기서 안 본다(서버 core가 checkCategoryName으로 정규화·검사한다).
 */
const itemSchema = z
  .object({
    id: z.uuid(),
    isNew: z.boolean().optional(),
    name: z.string().max(200).optional(),
    percent: z.number().int().min(0).max(100),
    archived: z.boolean().optional(),
  })
  .strict();

const applySchema = z
  .object({
    id: z.uuid(),
    expectedRevision: z.number().int().min(0).max(2_000_000_000),
    reason: z.enum(["edit", "restart"]),
    goal: z.unknown(),
    other: z.number().int().min(0).max(100),
    items: z.array(itemSchema).max(CATEGORY_LIMIT),
    completeOnboarding: z.boolean().optional(),
  })
  .strict();

export type BundleCheck =
  | { ok: true; input: Omit<BundleApplyInput, "goal"> & { goal: string | null } }
  | { ok: false; error: "invalid_input" | "too_long" };

export function checkBundleApply(input: unknown): BundleCheck {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const v = parsed.data;
  const goal = checkGoal(v.goal === undefined ? null : v.goal);
  if (!goal.ok) return { ok: false, error: goal.error };
  if (new Set(v.items.map((i) => i.id)).size !== v.items.length) return { ok: false, error: "invalid_input" };
  const sum = v.items.reduce((s, i) => s + i.percent, v.other);
  if (sum !== 100) return { ok: false, error: "invalid_input" };
  if ([v.other, ...v.items.map((i) => i.percent)].some((p) => p % RATIO_STEP !== 0)) return { ok: false, error: "invalid_input" };
  return { ok: true, input: { ...v, goal: goal.goal } };
}
