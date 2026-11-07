import { APP_CONFIG } from "../app-config";

/**
 * 저녁 기록의 순수 계산(화면·서버가 같이 쓴다. DB·시계를 건드리지 않는다). PRD 7-3.
 * 기타는 categoryId가 null인 항목이다. 시간은 모두 분 단위 정수.
 */

export type EveningItem = { categoryId: string | null; minutes: number };
export type SaveMode = "prefilled" | "edited" | "not_split";
export const SAVE_MODES: readonly SaveMode[] = ["prefilled", "edited", "not_split"];

const STEP = APP_CONFIG.minuteStep;

export const sumMinutes = (items: EveningItem[]) => items.reduce((s, i) => s + i.minutes, 0);

/** 같은 분야를 한 항목으로 합치고, 0분이 아닌 것만 남긴다(기타는 맨 끝). 저장·비교 전에 쓴다 */
export function compactItems(items: EveningItem[]): EveningItem[] {
  const byKey = new Map<string | null, number>();
  for (const item of items) byKey.set(item.categoryId, (byKey.get(item.categoryId) ?? 0) + item.minutes);
  const out: EveningItem[] = [];
  let other = 0;
  for (const [categoryId, minutes] of byKey) {
    if (minutes <= 0) continue;
    if (categoryId === null) other = minutes;
    else out.push({ categoryId, minutes });
  }
  if (other > 0) out.push({ categoryId: null, minutes: other });
  return out;
}

/**
 * 미리 채우기(AI 없이 되는 길, PRD 7-3·D-102⑥). 임시 규칙:
 * 1) 타이머로 진행한 분야 시간(timer)을 그 분야에 먼저 넣는다.
 * 2) 총시간에서 타이머 합을 뺀 나머지를, 그날 끝낸 할 일의 분야(doneCategoryIds, 기타 제외)에 5분 단위로 똑같이 나눠 넣는다.
 * 3) 나눠지지 않은 조각과 끝낸 할 일의 분야가 없을 때의 나머지는 기타로 둔다.
 * 총시간이 타이머 합보다 작으면 타이머 합을 총시간으로 본다. 돌려주는 값의 합은 max(총시간, 타이머 합)이다.
 */
export function prefillItems(args: {
  totalMinutes: number;
  timer: Record<string, number>;
  /** 타이머를 분야 없이 켠 시간(기타) */
  timerOther?: number;
  doneCategoryIds: (string | null)[];
}): EveningItem[] {
  const timerEntries = Object.entries(args.timer).filter(([, m]) => m > 0);
  const timerOther = Math.max(0, args.timerOther ?? 0);
  const timerSum = timerEntries.reduce((s, [, m]) => s + m, 0) + timerOther;
  const total = Math.max(args.totalMinutes, timerSum);
  const remaining = total - timerSum;
  const doneIds = [...new Set(args.doneCategoryIds.filter((id): id is string => id !== null))];

  const minutes = new Map<string, number>(timerEntries);
  let other = timerOther;
  if (remaining > 0 && doneIds.length > 0) {
    const per = Math.floor(Math.floor(remaining / STEP) / doneIds.length) * STEP;
    for (const id of doneIds) minutes.set(id, (minutes.get(id) ?? 0) + per);
    other += remaining - per * doneIds.length;
  } else {
    other += remaining;
  }
  const items: EveningItem[] = [...minutes].map(([categoryId, m]) => ({ categoryId, minutes: m }));
  items.push({ categoryId: null, minutes: other });
  return compactItems(items);
}

/**
 * 사용자가 분야마다 넣은 시간(기타 제외)과 총시간으로 저장할 항목을 만든다. 기타는 총시간에서 나머지다.
 * 분야 시간의 합이 총시간보다 크면 총시간을 그 합으로 늘린다(임시): 돌려주는 total이 저장할 총시간이다.
 */
export function buildItems(totalMinutes: number, perCategory: Record<string, number>): { total: number; items: EveningItem[] } {
  const entries = Object.entries(perCategory).filter(([, m]) => m > 0);
  const sum = entries.reduce((s, [, m]) => s + m, 0);
  const total = Math.max(totalMinutes, sum);
  const items = compactItems([...entries.map(([categoryId, minutes]) => ({ categoryId, minutes })), { categoryId: null, minutes: total - sum }]);
  return { total, items };
}

/** 나누지 않고 저장: 그날 시간은 전부 기타(총시간이 0이면 항목 없음) */
export function notSplitItems(totalMinutes: number): EveningItem[] {
  return totalMinutes > 0 ? [{ categoryId: null, minutes: totalMinutes }] : [];
}

/** 같은 내용인가(순서·0분 항목은 무시) */
export function sameItems(a: EveningItem[], b: EveningItem[]): boolean {
  const x = compactItems(a);
  const y = compactItems(b);
  if (x.length !== y.length) return false;
  const map = new Map(y.map((i) => [i.categoryId, i.minutes]));
  return x.every((i) => map.get(i.categoryId) === i.minutes);
}

/** 저장 방식 분류(G9): 나누기를 건너뛰면 not_split, 미리 채운 그대로면 prefilled, 아니면 edited */
export function classifySaveMode(args: { skippedSplit: boolean; prefilled: EveningItem[]; final: EveningItem[] }): SaveMode {
  if (args.skippedSplit) return "not_split";
  return sameItems(args.prefilled, args.final) ? "prefilled" : "edited";
}

export type ItemDelta = { categoryId: string | null; minutes: number };

/** 이전 기록 대비 분야별 바뀐 시간(0이 아닌 것만, 바뀐 크기가 큰 순서). 이전이 없으면 0에서 시작 */
export function diffItems(previous: EveningItem[], next: EveningItem[]): ItemDelta[] {
  const before = new Map(compactItems(previous).map((i) => [i.categoryId, i.minutes]));
  const after = new Map(compactItems(next).map((i) => [i.categoryId, i.minutes]));
  const keys = new Set([...before.keys(), ...after.keys()]);
  const out: ItemDelta[] = [];
  for (const key of keys) {
    const d = (after.get(key) ?? 0) - (before.get(key) ?? 0);
    if (d !== 0) out.push({ categoryId: key, minutes: d });
  }
  return out.sort((p, q) => Math.abs(q.minutes) - Math.abs(p.minutes) || (p.categoryId ?? "~").localeCompare(q.categoryId ?? "~"));
}

/** 저녁 기록 대상 날을 고를 수 있는 범위: 오늘부터 이 일수만큼 앞(임시 7일) */
export const EVENING_BACK_DAYS = 7;
