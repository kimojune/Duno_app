import { lessDoneByGoal, lessDoneByRatio, type CategoryMinutes } from "../growth/logic";
import type { RatioItem } from "../settings/types";

/**
 * 타이머를 시작한 그 분야가 두 기준에서 반대편이었는지(D-110). 먼저 한 기록에 둘 다 남긴다(성공 기준 ①을 어느 기준으로 셀지 나중에 가르려고).
 * - 이번 주 목표 기준: 이번 주 목표가 없으면 null(셀 수 없음). 있으면 목표에 든 분야 가운데 목표보다 덜 한 분야인가.
 * - 처음 정한 비율 기준: 처음 정한 비율보다 덜 한 분야인가(lessDoneByRatio).
 * 기타(분야 없음)는 두 기준 모두 반대편이 아니다(목표가 없으면 goal은 null).
 */
export function oppositeFlags(args: {
  categoryId: string | null;
  ratios: RatioItem[];
  goalItems: CategoryMinutes[] | null;
  totals: CategoryMinutes[];
}): { byGoal: boolean | null; byRatio: boolean } {
  const { categoryId } = args;
  const byRatio = categoryId !== null && lessDoneByRatio(args.ratios, args.totals).some((c) => c.categoryId === categoryId);
  if (args.goalItems === null) return { byGoal: null, byRatio };
  const byGoal = categoryId !== null && lessDoneByGoal(args.goalItems, args.totals).some((c) => c.categoryId === categoryId);
  return { byGoal, byRatio };
}
