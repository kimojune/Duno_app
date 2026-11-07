import { z } from "zod";
import { APP_CONFIG } from "../app-config";

/**
 * 이번 주 목표 입력 검증(공용, 순수 함수). 화면도 같은 함수를 쓴다. 서버는 화면이 검사했더라도 다시 검사한다.
 * 임시, 결정 필요: 시간은 1시간 단위(10-27 답), 분야마다 1~168시간, 한 주 합이 168시간 이하(10-29 답). 기타는 목표에 넣지 않는다.
 */
export const GOAL_MAX_HOURS = APP_CONFIG.maxWeekGoalHours;
export const GOAL_ITEMS_MAX = 50;

const itemSchema = z.object({ categoryId: z.uuid(), minutes: z.number().int().min(60).max(GOAL_MAX_HOURS * 60) }).strict();
const itemsSchema = z.array(itemSchema).min(1).max(GOAL_ITEMS_MAX);

export type GoalInput = { categoryId: string; minutes: number };
export type GoalCheck = { ok: true; items: GoalInput[] } | { ok: false; error: "invalid_input" };

/** 검사: 분야 번호 uuid·중복 없음·분 단위는 60의 배수(1시간 단위)·합이 168시간 이하 */
export function checkGoalItems(input: unknown): GoalCheck {
  const parsed = itemsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const items = parsed.data;
  if (new Set(items.map((i) => i.categoryId)).size !== items.length) return { ok: false, error: "invalid_input" };
  if (items.some((i) => i.minutes % 60 !== 0)) return { ok: false, error: "invalid_input" };
  if (items.reduce((s, i) => s + i.minutes, 0) > GOAL_MAX_HOURS * 60) return { ok: false, error: "invalid_input" };
  return { ok: true, items };
}

/** 한 줄 「이번 주 목표 15시간 중 9시간」의 재료: 목표 합과, 분야마다 목표를 넘기지 않게 센 쓴 시간(분) */
export function goalProgress(
  goal: { categoryId: string | null; minutes: number }[],
  totals: { categoryId: string | null; minutes: number }[],
): { targetMinutes: number; doneMinutes: number } {
  let targetMinutes = 0;
  let doneMinutes = 0;
  for (const g of goal) {
    targetMinutes += g.minutes;
    const actual = totals.find((t) => t.categoryId === g.categoryId)?.minutes ?? 0;
    doneMinutes += Math.min(actual, g.minutes);
  }
  return { targetMinutes, doneMinutes };
}
