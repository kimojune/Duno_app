import type { RatioItem } from "../settings/types";
import { goalProgress } from "../goals/validation";
import { barPercents, shortfallByGoal, shortfallByRatio, type CategoryMinutes, type ShortfallBasis } from "./logic";

/**
 * 상태보기 그래프(분야 색 띠 두 줄 · 원그래프 둘 · 분야 줄의 막대와 눈금)의 순수 계산. React·DOM 없음.
 * 화면은 2단계에서 이 값을 그리기만 한다. 서버(core)와 기기 먼저 저장(lib/local/derive)은 둘 다 computeGrowth(compute.ts)를 거쳐
 * 같은 GrowthData를 만들고, 이 파일은 그 GrowthData의 값(categories·ratios·thisWeek 또는 cumulative)을 받아 돈다.
 *
 * 이름(PM 기능 이름 목록 기준): ratio* = 처음 정한 비율, spent* = 쓴 시간, 조각 = piece/slice, 띠그래프 = band*, 원그래프 = pie*,
 * missed = 놓친 분야. 화면 글은 여기서 짓지 않는다.
 *
 * 정한 것(시험에 적혀 있다):
 * - 두 줄(처음 정한 비율 / 쓴 시간)은 같은 순서의 같은 조각 목록이다: 보이는 분야(받은 순서) 뒤에 기타가 늘 맨 끝.
 * - 각 줄의 %는 정수이고 합이 100이다(최대 나머지 방식, 같은 나머지는 앞 분야가 먼저). 그 줄 값이 모두 0이면 %가 전부 0이고 empty=true.
 * - 0인 분야도 조각 목록(ratio·spent)과 줄(rows)에서 빠지지 않는다. 띠·원에 실제로 그릴 조각은 drawablePieces()가 0%를 뺀 것이다(0% 조각은 그리지 않는다).
 * - 보관했거나 이름을 못 푸는 분야의 시간: 지금 앱(growth-screen·shortfallByRatio)처럼 「쓴 시간 합계」에는 들고 분야 줄·조각에는 없다.
 *   기타로 합치지 않는다. 합계(spentTotalMinutes)에 든 몫은 hiddenMinutes로 따로 알린다. 띠·원의 %는 보이는 분야의 분끼리 나눈 몫이다(합 100을 지키려고).
 * - 이상한 값(음수·NaN·무한·소수)은 0 이상의 정수 분으로 고쳐 읽는다(NaN·무한·음수는 0, 소수는 반올림, 한 값 최대 1e12).
 */

export type ChartCategoryId = string | null;

const MAX_VALUE = 1e12;

/** 분·비율 한 값을 0 이상의 정수로. NaN·무한·음수는 0 */
function clean(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), MAX_VALUE);
}

/**
 * 값들을 정수 %로 나눈다. 합이 정확히 100(최대 나머지 방식). 같은 나머지는 앞 자리가 먼저 받는다. 합이 0이면 모두 0.
 * 값은 0 이상의 정수여야 한다.
 */
export function apportionPercents(values: number[]): number[] {
  const sum = values.reduce((s, v) => s + v, 0);
  if (sum <= 0) return values.map(() => 0);
  const parts = values.map((v, index) => {
    const scaled = v * 100;
    const rest = scaled % sum;
    return { index, whole: (scaled - rest) / sum, rest };
  });
  let left = 100 - parts.reduce((s, p) => s + p.whole, 0);
  const out = parts.map((p) => p.whole);
  for (const p of [...parts].sort((a, b) => b.rest - a.rest || a.index - b.index)) {
    if (left <= 0) break;
    out[p.index] += 1;
    left -= 1;
  }
  return out;
}

export type RatioPiece = { categoryId: ChartCategoryId; percent: number };
export type SpentPiece = { categoryId: ChartCategoryId; percent: number; minutes: number };

export type StatusRow = {
  categoryId: ChartCategoryId;
  /** 처음 정한 비율(정수 %, 줄 합 100). 처음 정한 비율이 없으면 0 */
  ratioPercent: number;
  /** 쓴 시간 비율(정수 %, 줄 합 100). 쓴 시간이 없으면 0 */
  spentPercent: number;
  spentMinutes: number;
  /**
   * 쓴 시간 − 처음 정한 비율만큼의 시간(보이는 분야의 쓴 시간 합 기준, 분). 둘 중 한 줄이 비면 null
   */
  diffMinutes: number | null;
  /** 쓴 시간 % − 처음 정한 %. 둘 중 한 줄이 비면 null */
  diffPercent: number | null;
  /** 막대 길이(0~100). 지금 barPercents와 같다: 보이는 분야 가운데 가장 많이 쓴 분야가 100, 모두 0이면 0 */
  barPercent: number;
  /**
   * 처음 정한 비율 눈금 자리(0~100). barPercent와 같은 눈금자 위: 처음 정한 비율만큼의 시간 ÷ 가장 많이 쓴 시간 × 100.
   * 100을 넘으면 100에 붙이고 tickClipped=true. 처음 정한 비율이 없거나 쓴 시간이 없으면 null
   */
  tickPercent: number | null;
  tickClipped: boolean;
};

export type StatusChart = {
  /** 처음 정한 비율 줄. 보이는 분야 + 기타(맨 끝), 모든 분야가 들어 있다(0%도) */
  ratio: RatioPiece[];
  /** 쓴 시간 줄. ratio와 같은 순서·같은 길이 */
  spent: SpentPiece[];
  ratioEmpty: boolean;
  spentEmpty: boolean;
  /** 분야마다 한 줄(막대·눈금). ratio·spent와 같은 순서 */
  rows: StatusRow[];
  /** 쓴 시간 합계(큰 숫자). 보관했거나 이름을 못 푸는 분야의 시간도 든다 — 지금 앱의 합계와 같다 */
  spentTotalMinutes: number;
  /** spentTotalMinutes 가운데 분야 줄·조각이 없는 분야(보관·이름 못 품)의 분 */
  hiddenMinutes: number;
  /** 놓친 분야: 처음 정한 비율보다 덜 쓴 분야, 차이(분) 큰 순. 쓴 시간이 0이거나 처음 정한 비율이 없으면 빈 목록 */
  missed: CategoryMinutes[];
};

/**
 * @param categoryIds 보이는 분야 번호(받은 순서가 조각 순서). 기타는 넣지 않는다(맨 끝에 늘 붙는다). 중복·null은 건너뛴다
 * @param ratios 처음 정한 비율(합이 100이 아니어도 된다). 보이는 분야·기타가 아닌 분야의 몫은 줄에서 뺀다
 * @param totals 분야별로 쓴 시간(GrowthData.thisWeek 또는 cumulative). 기타는 categoryId null
 */
export function buildStatusChart(args: { categoryIds: string[]; ratios: RatioItem[]; totals: CategoryMinutes[] }): StatusChart {
  const ids: ChartCategoryId[] = [];
  for (const id of args.categoryIds) if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  ids.push(null);

  const ratioRaw = new Map<ChartCategoryId, number>();
  for (const r of args.ratios) ratioRaw.set(r.categoryId, (ratioRaw.get(r.categoryId) ?? 0) + clean(r.percent));
  const spentRaw = new Map<ChartCategoryId, number>();
  for (const t of args.totals) spentRaw.set(t.categoryId, (spentRaw.get(t.categoryId) ?? 0) + clean(t.minutes));

  const ratioValues = ids.map((id) => ratioRaw.get(id) ?? 0);
  const spentMinutes = ids.map((id) => spentRaw.get(id) ?? 0);
  const ratioPercents = apportionPercents(ratioValues);
  const spentPercents = apportionPercents(spentMinutes);
  const ratioEmpty = ratioValues.every((v) => v === 0);
  const visibleMinutes = spentMinutes.reduce((s, v) => s + v, 0);
  const spentEmpty = visibleMinutes === 0;
  const spentTotalMinutes = [...spentRaw.values()].reduce((s, v) => s + v, 0);
  const ratioSum = ratioValues.reduce((s, v) => s + v, 0);
  const bars = barPercents(spentMinutes);
  const maxMinutes = Math.max(0, ...spentMinutes);

  const rows = ids.map((categoryId, i): StatusRow => {
    const comparable = !ratioEmpty && !spentEmpty;
    const expected = comparable ? (ratioValues[i] / ratioSum) * visibleMinutes : 0;
    const tick = comparable ? Math.round((expected / maxMinutes) * 100) : null;
    return {
      categoryId,
      ratioPercent: ratioPercents[i],
      spentPercent: spentPercents[i],
      spentMinutes: spentMinutes[i],
      diffMinutes: comparable ? spentMinutes[i] - Math.round(expected) : null,
      diffPercent: comparable ? spentPercents[i] - ratioPercents[i] : null,
      barPercent: bars[i],
      tickPercent: tick === null ? null : Math.min(tick, 100),
      tickClipped: tick !== null && tick > 100,
    };
  });

  // 놓친 분야: 지금 shortfallByRatio(상태보기 「채울 시간」과 같은 계산)를 그대로 쓴다. 다만 rows(차이·눈금)와 같은 분모를 쓰도록
  // 값 정리를 거친 「보이는 분야만」의 비율·분을 넘긴다(숨은 분야의 분은 분모에서 뺀다). 그래서 missed의 분 = −rows의 diffMinutes다.
  // 같은 차이는 조각 순서(받은 분야 순서, 기타 맨 끝)가 먼저.
  const missed = shortfallByRatio(
    ids.map((categoryId, i) => ({ categoryId, percent: ratioValues[i] })),
    ids.map((categoryId, i) => ({ categoryId, minutes: spentMinutes[i] })),
  );

  return {
    ratio: ids.map((categoryId, i) => ({ categoryId, percent: ratioPercents[i] })),
    spent: ids.map((categoryId, i) => ({ categoryId, percent: spentPercents[i], minutes: spentMinutes[i] })),
    ratioEmpty,
    spentEmpty,
    rows,
    spentTotalMinutes,
    hiddenMinutes: spentTotalMinutes - visibleMinutes,
    missed,
  };
}

/**
 * 채울 시간(상태보기 「채울 시간」·저장 직후 한 줄). 임시값(PM 답 전, d-69 ⑤ · docs/oneshot-v2/임시값.md):
 * - 이번 주 목표를 세운 주 → 목표 기준. 목표는 달력 주(월~일)에 묶여 있어 이번 주(thisWeek)에 쓴 시간과 견준다
 * - 아니면 처음 정한 비율 기준 → 같은 이번 주(thisWeek)에 쓴 시간과 견준다(PM 확정 11-09). 계산은 buildStatusChart().missed와 같다(같은 분모)
 */
export function fillTimeFor(args: {
  categoryIds: string[];
  ratios: RatioItem[];
  goalItems: CategoryMinutes[] | null;
  thisWeek: CategoryMinutes[];
}): { basis: ShortfallBasis; items: CategoryMinutes[] } {
  if (args.goalItems && args.goalItems.length > 0) return { basis: "goal", items: shortfallByGoal(args.goalItems, args.thisWeek) };
  return { basis: "ratio", items: buildStatusChart({ categoryIds: args.categoryIds, ratios: args.ratios, totals: args.thisWeek }).missed };
}

/** 띠·원에 실제로 그릴 조각: 0% 조각을 뺀다(순서는 그대로). 줄이 비었으면 빈 목록 */
export function drawablePieces<T extends { percent: number }>(line: T[]): T[] {
  return line.filter((p) => p.percent > 0);
}

/** 띠 한 줄의 조각 자리: 맨 왼쪽(0)에서 시작한 %와 길이 %. 0% 조각은 뺀다 */
export function bandSegments<T extends { categoryId: ChartCategoryId; percent: number }>(line: T[]): (T & { startPercent: number })[] {
  let start = 0;
  return drawablePieces(line).map((p) => {
    const seg = { ...p, startPercent: start };
    start += p.percent;
    return seg;
  });
}

// ── 원그래프 ──────────────────────────────────────────────────────────────

/** 원의 한 점. fraction은 한 바퀴를 1로 본 자리: 0은 12시, 0.25는 3시(시계 방향). 가운데가 (0,0) */
export function polarPoint(fraction: number, radius: number): [number, number] {
  const angle = (fraction - 0.25) * 2 * Math.PI;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

const fix = (n: number) => String(Number(n.toFixed(3))).replace(/^-0$/, "0");

/**
 * 부채꼴 경로(가운데 (0,0) → 12시 기준 from~to → 가운데). from·to는 한 바퀴를 1로 본 자리.
 * 길이가 0 이하이면 null(그리지 않는다), 1 이상이면 온 원(반원 둘).
 */
export function arcPath(from: number, to: number, radius = 100): string | null {
  const a = Math.max(0, Math.min(1, from));
  const b = Math.max(0, Math.min(1, to));
  if (!(b - a > 0)) return null;
  if (b - a >= 1) return `M0 ${-radius} A${radius} ${radius} 0 1 1 0 ${radius} A${radius} ${radius} 0 1 1 0 ${-radius} Z`;
  const p1 = polarPoint(a, radius);
  const p2 = polarPoint(b, radius);
  return `M0 0 L${fix(p1[0])} ${fix(p1[1])} A${radius} ${radius} 0 ${b - a > 0.5 ? 1 : 0} 1 ${fix(p2[0])} ${fix(p2[1])} Z`;
}

export type PieSlice = {
  categoryId: ChartCategoryId;
  percent: number;
  /** 시작·끝 자리(한 바퀴 = 1). 정수 %로 쌓아 나눠서 부동소수 오차가 쌓이지 않는다 */
  from: number;
  to: number;
  /** SVG path의 d. 0%면 null(그리지 않는다) */
  d: string | null;
};

/** 한 줄(ratio 또는 spent)의 원그래프 조각들. 12시에서 시작해 시계 방향. 줄과 같은 순서·같은 길이(0% 조각은 d가 null) */
export function pieSlices(line: { categoryId: ChartCategoryId; percent: number }[], radius = 100): PieSlice[] {
  let acc = 0;
  return line.map((p) => {
    const from = acc / 100;
    acc += p.percent;
    const to = acc / 100;
    return { categoryId: p.categoryId, percent: p.percent, from, to, d: arcPath(from, to, radius) };
  });
}

/** 조각 % 글을 조각 안에 둘 가장 작은 % (이보다 작으면 가는 이끌 선으로 원 밖에, 명세 ③-S ② 5 「약 8% 미만」) */
export const PIE_LABEL_INSIDE_MIN = 8;

export type PieLabel = {
  categoryId: ChartCategoryId;
  percent: number;
  /** 글 자리(가운데 (0,0) 기준) */
  x: number;
  y: number;
  inside: boolean;
  /** 원 밖 글의 이끌 선(원 둘레 → 글 앞). 조각 안 글이면 null */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
  /** 글 맞춤: 조각 안은 가운데, 원 밖은 오른쪽 반이면 start, 왼쪽 반이면 end */
  anchor: "start" | "middle" | "end";
};

/**
 * 원그래프 조각마다 % 글 자리(원샷 v2 고침5, 명세 ③-S ② 5). 0% 조각은 글이 없다.
 * 넓은 조각(PIE_LABEL_INSIDE_MIN 이상)은 조각 가운데 각도의 반지름 0.62 자리에, 작은 조각은 원 밖(반지름 1.2)에 두고 둘레에서 이끌 선을 긋는다.
 */
export function pieLabels(slices: PieSlice[], radius = 100): PieLabel[] {
  return slices
    .filter((s) => s.percent > 0)
    .map((s) => {
      const mid = (s.from + s.to) / 2;
      const inside = s.percent >= PIE_LABEL_INSIDE_MIN;
      const fixed = (n: number) => Number(n.toFixed(2));
      if (inside) {
        const [x, y] = polarPoint(mid, radius * 0.62);
        return { categoryId: s.categoryId, percent: s.percent, x: fixed(x), y: fixed(y), inside, leader: null, anchor: "middle" as const };
      }
      const [x1, y1] = polarPoint(mid, radius);
      const [x2, y2] = polarPoint(mid, radius * 1.12);
      const [x, y] = polarPoint(mid, radius * 1.2);
      return {
        categoryId: s.categoryId,
        percent: s.percent,
        x: fixed(x),
        y: fixed(y),
        inside,
        leader: { x1: fixed(x1), y1: fixed(y1), x2: fixed(x2), y2: fixed(y2) },
        anchor: x >= 0 ? ("start" as const) : ("end" as const),
      };
    });
}

// ── 이번 주 목표 뷰(분야별 막대) ─────────────────────────────────────────────

export type GoalRow = {
  categoryId: ChartCategoryId;
  /** 이번 주 쓴 시간(분) */
  spentMinutes: number;
  /** 그 분야 목표(분). 목표가 없으면(기타 포함) null */
  goalMinutes: number | null;
  /** 목표까지 남은 시간(분). 목표가 없거나 닿았으면 0 */
  remainingMinutes: number;
  /** 채움 길이(0~100, 축 = axisMinutes) */
  fillPercent: number;
  /** 목표 눈금 자리(0~100). 목표가 없으면 null */
  tickPercent: number | null;
};

export type GoalChart = {
  /** 「목표 {target} 중 {done}」 — lib/goals goalProgress와 같은 계산(분야마다 min(쓴 시간, 목표)의 합) */
  targetMinutes: number;
  doneMinutes: number;
  /** 축: 이 화면 분야 줄 가운데 가장 큰 값(목표·쓴 시간 중). 줄이 없거나 모두 0이면 0 */
  axisMinutes: number;
  /** 분야 줄. 순서 = 분야를 만든 순서(categoryIds 순서), 기타 맨 끝(PM 8·d-110) */
  rows: GoalRow[];
};

/**
 * 이번 주 목표 뷰의 계산(원샷 v2 고침5, 명세 ③-S ①). 화면 글은 짓지 않는다.
 * - 줄: 보이는 분야 가운데 목표가 있거나(0분이어도) 이번 주에 쓴 시간이 있는 분야, 만든 순서. 기타는 쓴 시간이 있을 때만 맨 끝(기타는 목표에 넣지 않는다).
 * - 「목표 n 중 n」은 goalProgress(lib/goals/validation.ts) 그대로 — 할 일 탭의 이번 주 목표 한 줄과 같은 값이다.
 * - 이상한 값(음수·NaN·무한·소수)은 0 이상의 정수 분으로 고쳐 읽는다.
 */
export function buildGoalChart(args: { categoryIds: string[]; goalItems: CategoryMinutes[]; totals: CategoryMinutes[] }): GoalChart {
  const ids: string[] = [];
  for (const id of args.categoryIds) if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  const goal = new Map<ChartCategoryId, number>();
  for (const g of args.goalItems) if (g.categoryId !== null) goal.set(g.categoryId, (goal.get(g.categoryId) ?? 0) + clean(g.minutes));
  const spent = new Map<ChartCategoryId, number>();
  for (const t of args.totals) spent.set(t.categoryId, (spent.get(t.categoryId) ?? 0) + clean(t.minutes));

  const picked: { categoryId: ChartCategoryId; spentMinutes: number; goalMinutes: number | null }[] = [];
  for (const id of ids) {
    const g = goal.get(id) ?? 0;
    const s = spent.get(id) ?? 0;
    if (g > 0 || s > 0) picked.push({ categoryId: id, spentMinutes: s, goalMinutes: g > 0 ? g : null });
  }
  const other = spent.get(null) ?? 0;
  if (other > 0) picked.push({ categoryId: null, spentMinutes: other, goalMinutes: null });

  const axisMinutes = Math.max(0, ...picked.map((r) => Math.max(r.spentMinutes, r.goalMinutes ?? 0)));
  const pct = (v: number) => (axisMinutes > 0 ? Number(((v / axisMinutes) * 100).toFixed(3)) : 0);
  // 할 일 탭의 이번 주 목표 한 줄(components/goal.tsx GoalLine)과 같은 함수·같은 입력: 값이 갈리지 않게 그대로 넘긴다
  const progress = goalProgress(args.goalItems, args.totals);
  return {
    targetMinutes: progress.targetMinutes,
    doneMinutes: progress.doneMinutes,
    axisMinutes,
    rows: picked.map((r) => ({
      ...r,
      remainingMinutes: r.goalMinutes === null ? 0 : Math.max(0, r.goalMinutes - r.spentMinutes),
      fillPercent: pct(r.spentMinutes),
      tickPercent: r.goalMinutes === null ? null : pct(r.goalMinutes),
    })),
  };
}
