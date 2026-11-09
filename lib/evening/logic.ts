/**
 * 오늘 기록(옛 이름 저녁 기록 — 코드 이름은 evening 그대로)의 순수 계산(화면·서버가 같이 쓴다. DB·시계를 건드리지 않는다). PRD 7-3.
 * 기타는 categoryId가 null인 항목이다. 시간은 모두 분 단위 정수.
 */

export type EveningItem = { categoryId: string | null; minutes: number };
export type SaveMode = "prefilled" | "edited" | "not_split";
export const SAVE_MODES: readonly SaveMode[] = ["prefilled", "edited", "not_split"];

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
 * 칩으로 새 분야를 다이얼에 넣을 때 기타에서 떼는 분(PM 10, d-114 가 — 고침 5바퀴).
 * 기타가 이보다 적으면 기타 전부(0분이면 0분 조각). 5분 단위이고 3시간 원의 1/6이라 눈에 보인다. 균등 배분이 아니다(d-96 ⑨)
 */
export const NEW_CHIP_MINUTES = 30;

/** 나눈 분야 값(기타 제외, 숨은 분야 포함)의 합을 뺀 기타 분. 0 밑으로 내려가지 않는다 */
export function otherOf(totalMinutes: number, perCategory: Record<string, number>): number {
  const sum = Object.values(perCategory).reduce((s, m) => s + Math.max(0, m), 0);
  return Math.max(0, totalMinutes - sum);
}

/**
 * 칩을 새로 고른다(PM 10): 기타에서 NEW_CHIP_MINUTES(기타가 적으면 기타 전부)를 떼어 그 분야 값으로 둔다. 합(쓴 시간)은 그대로다.
 * 이미 고른 칩이면 그대로 돌려준다. 돌려주는 taken = 뗀 분(0이면 0분 조각).
 */
export function pickChip(totalMinutes: number, perCategory: Record<string, number>, id: string): { perCategory: Record<string, number>; taken: number } {
  if (Object.prototype.hasOwnProperty.call(perCategory, id)) return { perCategory, taken: 0 };
  const taken = Math.min(NEW_CHIP_MINUTES, otherOf(totalMinutes, perCategory));
  return { perCategory: { ...perCategory, [id]: taken }, taken };
}

/** 칩을 푼다(PM 10): 그 분야 값을 지운다 — 그 시간은 기타로 돌아간다(기타 = 쓴 시간 − 나눈 합). 합은 그대로다 */
export function unpickChip(perCategory: Record<string, number>, id: string): Record<string, number> {
  if (!Object.prototype.hasOwnProperty.call(perCategory, id)) return perCategory;
  const next = { ...perCategory };
  delete next[id];
  return next;
}

/**
 * 나누기 단계에 처음 들어갈 때의 값(d-115 나 · d-116 가 — 고침 5바퀴). AI 없이 되는 길(PRD 7-3·D-102⑥).
 * 1) 타이머로 잰 분야(timer)를 그 시간만큼 먼저 채운다(칩이 골라진다). 분야 없이 켠 타이머(timerOther)는 기타다.
 * 2) 그날 끝낸 할 일의 분야(doneCategoryIds)는 칩이 골라진 채 시작하고, 만든 순서(catalogOrder 순서 — lib/category-color.ts와 같은 순서)대로
 *    새 칩 규칙(pickChip)처럼 기타에서 30분씩 뗀다. 기타가 30분보다 적으면 남은 만큼, 0분이면 0분 조각(칩만 골라짐).
 *    남은 시간을 똑같이 나눠 채우지 않는다(시간은 사용자가 나눈다). 타이머와 체크 둘 다인 분야는 타이머 시간만(30분을 더하지 않는다).
 *    기타(null)의 끝낸 할 일과 catalogOrder에 없는 분야(고를 칩이 없다)는 칩을 만들지 않는다.
 * 3) 나머지는 기타. 타이머도 끝낸 할 일도 없으면 기타 100%.
 * 총시간이 타이머 합보다 작으면 타이머 합을 총시간으로 본다(돌려주는 total). catalogOrder에 없는 분야의 타이머 시간은
 * 화면에 칩이 없어도 값(perCategory)에는 남는다(저장에 실린다 — 지금 앱의 숨은 분야와 같은 길).
 * perCategory의 열쇠 = 골라진 칩(0분 포함). items = 미리 채운 값(저장 방식 G9의 prefilled 기준, 0분은 빠진다).
 */
export function initialSelection(args: {
  totalMinutes: number;
  timer: Record<string, number>;
  /** 타이머를 분야 없이 켠 시간(기타) */
  timerOther?: number;
  doneCategoryIds: (string | null)[];
  /** 고를 수 있는 분야 id, 만든 순서 */
  catalogOrder: string[];
}): { total: number; perCategory: Record<string, number>; items: EveningItem[] } {
  const timerEntries = Object.entries(args.timer).filter(([, m]) => m > 0);
  const timerOther = Math.max(0, args.timerOther ?? 0);
  const timerSum = timerEntries.reduce((s, [, m]) => s + m, 0) + timerOther;
  const total = Math.max(Math.max(0, args.totalMinutes), timerSum);
  let perCategory: Record<string, number> = Object.fromEntries(timerEntries);
  const done = new Set(args.doneCategoryIds.filter((id): id is string => id !== null));
  for (const id of args.catalogOrder) {
    if (!done.has(id)) continue;
    perCategory = pickChip(total, perCategory, id).perCategory;
  }
  const items = buildItems(total, perCategory).items;
  return { total, perCategory, items };
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

/** 오늘 기록 대상 날을 고를 수 있는 범위: 오늘부터 이 일수만큼 앞(임시 7일) */
export const EVENING_BACK_DAYS = 7;
