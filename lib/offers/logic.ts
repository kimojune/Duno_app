import { lessDoneByGoal, lessDoneByRatio, type CategoryMinutes } from "../growth/logic";
import type { RatioItem } from "../settings/types";

/**
 * 오늘 먼저 할 일로 건넬 분야와 할 일 고르기(순수 계산, PRD 7-5). AI 없이 정해진 규칙이다.
 * 건네는 분야는 처음 정한 비율(이번 주 목표가 있으면 목표)보다 덜 한 분야다(G6 나, D-108).
 */

/**
 * 건넬 분야:
 * - 이번 주 목표가 있으면 목표 안에서 목표보다 덜 한 분야(남은 시간이 가장 많은 것). 목표에 들지 않은 분야는 그 주에 건네지 않는다.
 *   목표를 다 채웠으면(임시) 목표에 든 분야 안에서 처음 정한 비율이 가장 큰 분야(비율이 없으면 목표의 첫 분야).
 * - 목표가 없으면 처음 정한 비율보다 덜 한 분야(모자란 시간이 가장 큰 것, 주 초에는 비율이 가장 큰 것).
 * - 건넬 분야가 없으면 null(비율도 목표도 없다).
 * 돌려주는 값은 분야 번호(uuid), 기타를 건네면 OFFER_OTHER, 건넬 것이 없으면 null이다.
 * 처음 정한 비율에 기타를 넣었으면 기타도 건넬 수 있다(고침 3바퀴, PM 답 d-69). 목표에는 기타가 없어 목표 안에서는 건네지 않는다.
 */
export const OFFER_OTHER = "other";

export function pickOfferCategory(args: { ratios: RatioItem[]; goalItems: CategoryMinutes[] | null; totals: CategoryMinutes[] }): string | null {
  const { ratios, goalItems, totals } = args;
  if (goalItems !== null && goalItems.length > 0) {
    const goalCategories = goalItems.flatMap((g) => (g.categoryId === null ? [] : [g.categoryId]));
    const less = lessDoneByGoal(goalItems, totals).find((c) => c.categoryId !== null);
    if (less) return less.categoryId;
    const byRatio = [...ratios].filter((r) => r.categoryId !== null && goalCategories.includes(r.categoryId)).sort((a, b) => b.percent - a.percent)[0];
    return byRatio?.categoryId ?? goalCategories[0] ?? null;
  }
  const less = lessDoneByRatio(ratios, totals)[0];
  if (!less) return null;
  return less.categoryId === null ? OFFER_OTHER : less.categoryId;
}

export type OfferTodoCandidate = { id: string; day: string; createdAt: string };

/** 건넬 할 일: 그 분야의 오늘 끝내지 않은 첫 할 일, 없으면 최근(7일 안) 끝내지 않은 가장 늦은 날의 첫 할 일, 없으면 null(분야만 건넨다, 임시) */
export function pickOfferTodo(candidates: OfferTodoCandidate[], today: string): string | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => (a.day === b.day ? (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1) : a.day < b.day ? 1 : -1));
  const todayFirst = sorted.find((c) => c.day === today);
  return (todayFirst ?? sorted[0]).id;
}

/** 같은 제시 판별 열쇠: 자리·분야·할 일(DB offer_key와 같은 값) */
export function offerKey(surface: string, categoryId: string | null, todoId: string | null): string {
  return `${surface}|${categoryId ?? "-"}|${todoId ?? "-"}`;
}

/**
 * 카드의 「적은 날」 줄(고침 11, 23 명세 4절): 어제 것이면 「어제 적은 할 일」, 그 전이면 「{M}월 {D}일에 적은 할 일」.
 * 오늘 것·날짜를 모르는 것(옛 기기 사본)·날짜 꼴이 틀린 것은 null(줄 없음, 「30분 시작」 꼴).
 */
export function writtenDayLine(todoDay: string | null | undefined, today: string): string | null {
  if (!todoDay || todoDay >= today) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todoDay);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - 1));
  const yesterday = d.toISOString().slice(0, 10);
  if (todoDay === yesterday) return "어제 적은 할 일";
  return `${Number(m[2])}월 ${Number(m[3])}일에 적은 할 일`;
}

/** 카드가 「오늘 할 일에 추가」를 보일 때인가: 건넨 할 일이 있고 지난 날 것이다 */
export function needsAddToToday(offer: { todoId: string | null; todoDay?: string | null }, today: string): boolean {
  return offer.todoId !== null && typeof offer.todoDay === "string" && offer.todoDay < today;
}
