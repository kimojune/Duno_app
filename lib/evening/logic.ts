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

/** 똑같이 나눌 때 내림하는 단위(분). 앱의 minuteStep(5분)과 같다 */
export const SPLIT_STEP = 5;

/** 나눈 분야 값(기타 제외, 숨은 분야 포함)의 합을 뺀 기타 분. 0 밑으로 내려가지 않는다 */
export function otherOf(totalMinutes: number, perCategory: Record<string, number>): number {
  const sum = Object.values(perCategory).reduce((s, m) => s + Math.max(0, m), 0);
  return Math.max(0, totalMinutes - sum);
}

/**
 * 칩을 고르거나 풀 때의 똑같이 나누기(PM d-180, 고침10 — 옛 「새 칩은 기타에서 30분」 · d-116 「체크한 할 일 분야 = 30분 조각」을 바꾼다).
 * 규칙 1: 남은 시간 = 쓴 시간(totalMinutes) − 타이머로 잰 분야(timer)의 잰 시간(고른 것만).
 * 규칙 2: 타이머 분야는 잰 시간 그대로 두고, 고른 나머지 분야끼리 남은 시간을 똑같이 나눈다. step(5분) 단위로 내리고 나머지는 기타로 남는다(기타 = 쓴 시간 − 나눈 합).
 * 규칙 3: 고른 분야(타이머 분야 빼고)가 0개면 남은 시간 전부 기타(고른 분야 값이 없다).
 * d-181~183: 타이머 잰 시간이 쓴 시간보다 크면 남은 시간은 0(고른 분야 0분 · 기타 0분, 타이머 분야는 잰 시간 그대로).
 * chosenIds = 고른 칩(순서가 결과 열쇠 순서). hidden = 칩이 없는 분야(이미 남긴 기록·타이머에만 있음)의 값 — 그대로 두고, 남은 시간 계산에서도 뺀다.
 * 균등 배분 단추는 없다: 칩을 고르거나 풀 때마다 자동으로 다시 나눈다(손잡이·−/+로 맞춘 값은 덮인다, 규칙 5).
 */
export function splitEvenly(args: {
  totalMinutes: number;
  chosenIds: string[];
  timer: Record<string, number>;
  hidden?: Record<string, number>;
  step?: number;
}): Record<string, number> {
  const step = args.step ?? SPLIT_STEP;
  const hidden = args.hidden ?? {};
  const isTimer = (id: string) => Math.max(0, args.timer[id] ?? 0) > 0;
  const chosen = [...new Set(args.chosenIds)];
  const timerSum = chosen.filter(isTimer).reduce((s, id) => s + args.timer[id], 0);
  const hiddenSum = Object.values(hidden).reduce((s, m) => s + Math.max(0, m), 0);
  const remaining = Math.max(0, args.totalMinutes - timerSum - hiddenSum);
  const shared = chosen.filter((id) => !isTimer(id));
  const each = shared.length === 0 ? 0 : Math.floor(remaining / shared.length / step) * step;
  const out: Record<string, number> = {};
  for (const id of chosen) out[id] = isTimer(id) ? args.timer[id] : each;
  for (const [id, m] of Object.entries(hidden)) if (!(id in out)) out[id] = m;
  return out;
}

/**
 * 나누기 단계에 처음 들어갈 때의 값(규칙 4, d-180). AI 없이 되는 길(PRD 7-3·D-102⑥).
 * 칩이 골라진 분야 = 타이머로 잰 분야 + 그날 끝낸 할 일의 분야(catalogOrder에 있는 것만, 만든 순서). 규칙 1~3으로 똑같이 나뉜다
 * (타이머 분야이기도 하면 타이머 시간 그대로). 기타(null)의 끝낸 할 일과 catalogOrder에 없는 분야(고를 칩이 없다)는 칩을 만들지 않는다.
 * 분야 없이 켠 타이머(timerOther)는 기타다(총시간에만 든다). 타이머도 끝낸 할 일도 없으면 기타 100%.
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
  const done = new Set(args.doneCategoryIds.filter((id): id is string => id !== null));
  const inCatalog = new Set(args.catalogOrder);
  const chosenIds = [...args.catalogOrder.filter((id) => done.has(id) || (args.timer[id] ?? 0) > 0)];
  const hidden = Object.fromEntries(timerEntries.filter(([id]) => !inCatalog.has(id)));
  const perCategory = splitEvenly({ totalMinutes: total, chosenIds, timer: args.timer, hidden });
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
