import { APP_CONFIG } from "../app-config";
import type { EveningLog } from "../evening/types";
import type { RatioItem } from "../settings/types";
import { normalizedShares } from "../settings/validation";

/**
 * 상태보기(성장 화면)의 순수 계산(화면·서버가 같이 쓴다). PRD 7-4.
 * 이번 판의 「늘어난 역량」은 분야에 쓴 시간이다(G5). 기타는 categoryId null.
 */

export type CategoryMinutes = { categoryId: string | null; minutes: number };

/** from~to(둘 다 포함) 날의 분야별 합. 날마다 가장 늦게 저장한 기록만 센다(logs는 날마다 하나). to를 안 주면 끝까지 */
export function sumRange(logs: EveningLog[], from?: string, to?: string): CategoryMinutes[] {
  const totals = new Map<string | null, number>();
  for (const log of logs) {
    if (from !== undefined && log.targetDay < from) continue;
    if (to !== undefined && log.targetDay > to) continue;
    for (const item of log.items) totals.set(item.categoryId, (totals.get(item.categoryId) ?? 0) + item.minutes);
  }
  return [...totals].map(([categoryId, minutes]) => ({ categoryId, minutes }));
}

/** from~to 사이에 기록이 있는 날 수 */
export function countLoggedDays(logs: EveningLog[], from?: string, to?: string): number {
  return logs.filter((l) => (from === undefined || l.targetDay >= from) && (to === undefined || l.targetDay <= to)).length;
}

export const minutesOf = (list: CategoryMinutes[], categoryId: string | null) => list.find((t) => t.categoryId === categoryId)?.minutes ?? 0;
export const totalOf = (list: CategoryMinutes[]) => list.reduce((s, t) => s + t.minutes, 0);

/**
 * 처음 정한 비율보다 덜 한 분야(부족의 기본 기준, G4-1 「일단은 가」). 임시 계산:
 * 이번 주 쓴 시간 전체(기타 포함)에 처음 정한 비율(합으로 나눈 몫)을 곱한 만큼을 「이만큼은 썼어야」로 보고,
 * 실제로 쓴 시간이 그보다 5분 이상 모자란 분야를 모자란 만큼과 함께 큰 순서로 돌려준다.
 * 기타는 비율에 들지 않고 부족한 분야로도 잡지 않는다. 쓴 시간이 없으면 빈 목록.
 */
export function shortfallByRatio(ratios: RatioItem[], totals: CategoryMinutes[]): CategoryMinutes[] {
  const total = totalOf(totals);
  if (total <= 0) return [];
  const out: CategoryMinutes[] = [];
  for (const { categoryId, share } of normalizedShares(ratios)) {
    const deficit = Math.round(share * total - minutesOf(totals, categoryId));
    if (deficit >= APP_CONFIG.minuteStep) out.push({ categoryId, minutes: deficit });
  }
  return out.sort((a, b) => b.minutes - a.minutes);
}

/** 이번 주 목표 기준 부족: 목표 시간보다 덜 한 분야와 남은 시간(큰 순서) */
export function shortfallByGoal(goalItems: CategoryMinutes[], totals: CategoryMinutes[]): CategoryMinutes[] {
  const out: CategoryMinutes[] = [];
  for (const g of goalItems) {
    const remain = g.minutes - minutesOf(totals, g.categoryId);
    if (remain > 0) out.push({ categoryId: g.categoryId, minutes: remain });
  }
  return out.sort((a, b) => b.minutes - a.minutes);
}

export type ShortfallBasis = "goal" | "ratio";

/**
 * 부족 한 줄의 재료. 이번 주 목표를 세운 주에는 목표 기준(F3 ㄴ), 아니면 처음 정한 비율 기준이다.
 * (PRD 7-4에는 「상태보기 기준은 처음 정한 비율」이라는 줄도 있어 어긋난다: 최근 PM 답 F3 ㄴ을 따랐다. 임시값 목록 참고)
 */
export function shortfallFor(args: {
  ratios: RatioItem[];
  goalItems: CategoryMinutes[] | null;
  totals: CategoryMinutes[];
}): { basis: ShortfallBasis; items: CategoryMinutes[] } {
  if (args.goalItems && args.goalItems.length > 0) return { basis: "goal", items: shortfallByGoal(args.goalItems, args.totals) };
  return { basis: "ratio", items: shortfallByRatio(args.ratios, args.totals) };
}

/** 막대 길이(0~100): 가장 큰 값을 100으로. 모두 0이면 0 */
export function barPercents(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max <= 0 ? 0 : Math.round((v / max) * 100)));
}

/**
 * 「덜 한 분야」(반대편) 목록: 먼저 할 일을 고르고 먼저 한 기록에 반대편 여부를 남길 때 쓴다(D-105, D-108, D-110).
 * 처음 정한 비율 기준: 이번 주 쓴 시간이 아직 없으면(주 초) 비율이 0보다 큰 모든 분야가 덜 한 분야이고(큰 비율 순),
 * 쓴 시간이 있으면 shortfallByRatio와 같다. 기타는 들지 않는다. (임시)
 */
export function lessDoneByRatio(ratios: RatioItem[], totals: CategoryMinutes[]): CategoryMinutes[] {
  if (totalOf(totals) > 0) return shortfallByRatio(ratios, totals);
  return ratios
    .filter((r) => r.percent > 0)
    .sort((a, b) => b.percent - a.percent)
    .map((r) => ({ categoryId: r.categoryId, minutes: 0 }));
}

/** 이번 주 목표 기준 덜 한 분야: 목표에 든 분야 가운데 목표보다 덜 한 것(남은 시간 큰 순) */
export function lessDoneByGoal(goalItems: CategoryMinutes[], totals: CategoryMinutes[]): CategoryMinutes[] {
  return shortfallByGoal(goalItems, totals);
}
