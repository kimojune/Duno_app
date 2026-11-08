import { describe, expect, it } from "vitest";
import { barPercents, lessDoneByRatio, shortfallByRatio } from "../../lib/growth/logic";
import {
  apportionPercents,
  arcPath,
  bandSegments,
  buildStatusChart,
  drawablePieces,
  pieSlices,
  polarPoint,
} from "../../lib/growth/status-chart";

const A = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const B = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
const C = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
const GONE = "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0"; // 보관했거나 이름을 못 푸는 분야

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("apportionPercents(최대 나머지 방식)", () => {
  it("합이 늘 100이다", () => {
    expect(apportionPercents([1, 1, 1])).toEqual([34, 33, 33]); // 같은 나머지는 앞 자리가 먼저
    expect(sum(apportionPercents([7, 11, 13, 17, 19]))).toBe(100);
    expect(apportionPercents([60, 30, 10])).toEqual([60, 30, 10]);
  });
  it("모두 0이면 모두 0(빈 줄)", () => {
    expect(apportionPercents([0, 0, 0])).toEqual([0, 0, 0]);
    expect(apportionPercents([])).toEqual([]);
  });
  it("한 값만 있으면 100", () => {
    expect(apportionPercents([0, 45, 0])).toEqual([0, 100, 0]);
  });
});

describe("buildStatusChart: 두 줄(처음 정한 비율 / 쓴 시간)", () => {
  const chart = buildStatusChart({
    categoryIds: [A, B, C],
    ratios: [
      { categoryId: A, percent: 50 },
      { categoryId: B, percent: 30 },
      { categoryId: C, percent: 20 },
    ],
    totals: [
      { categoryId: B, minutes: 120 },
      { categoryId: A, minutes: 60 },
      { categoryId: null, minutes: 20 },
    ],
  });

  it("두 줄의 조각 순서가 같고 기타가 맨 끝이다", () => {
    const order = [A, B, C, null];
    expect(chart.ratio.map((p) => p.categoryId)).toEqual(order);
    expect(chart.spent.map((p) => p.categoryId)).toEqual(order);
    expect(chart.rows.map((r) => r.categoryId)).toEqual(order);
  });
  it("각 줄의 %는 정수이고 합이 100이다", () => {
    expect(chart.ratio.map((p) => p.percent)).toEqual([50, 30, 20, 0]);
    expect(chart.spent.map((p) => p.percent)).toEqual([30, 60, 0, 10]); // 60/200, 120/200, 0, 20/200
    expect(sum(chart.ratio.map((p) => p.percent))).toBe(100);
    expect(sum(chart.spent.map((p) => p.percent))).toBe(100);
    for (const p of [...chart.ratio, ...chart.spent]) expect(Number.isInteger(p.percent)).toBe(true);
  });
  it("쓴 시간 줄 조각에 분이 있다. 0인 분야도 목록에 있다", () => {
    expect(chart.spent.map((p) => p.minutes)).toEqual([60, 120, 0, 20]);
    expect(chart.spent).toHaveLength(4);
  });
  it("0% 조각은 목록에는 있고 그릴 조각(띠·원)에서는 빠진다", () => {
    expect(drawablePieces(chart.spent).map((p) => p.categoryId)).toEqual([A, B, null]);
    expect(drawablePieces(chart.ratio).map((p) => p.categoryId)).toEqual([A, B, C]);
    expect(pieSlices(chart.spent).filter((s) => s.d === null).map((s) => s.categoryId)).toEqual([C]);
  });
  it("쓴 시간 합계는 모든 분의 합이다", () => {
    expect(chart.spentTotalMinutes).toBe(200);
    expect(chart.hiddenMinutes).toBe(0);
    expect(chart.ratioEmpty).toBe(false);
    expect(chart.spentEmpty).toBe(false);
  });

  it("분야 줄: 쓴 시간 비율·눈금·차이·막대 길이", () => {
    const [a, b, c, other] = chart.rows;
    expect(a).toMatchObject({ spentPercent: 30, ratioPercent: 50, spentMinutes: 60, diffPercent: -20, diffMinutes: -40 }); // 50%×200=100분 중 60분
    expect(b).toMatchObject({ spentPercent: 60, ratioPercent: 30, diffPercent: 30, diffMinutes: 60 }); // 30%×200=60분 중 120분
    expect(c).toMatchObject({ spentPercent: 0, spentMinutes: 0, diffPercent: -20, diffMinutes: -40 });
    expect(other).toMatchObject({ spentPercent: 10, ratioPercent: 0, diffPercent: 10, diffMinutes: 20 });
    // 막대 길이는 barPercents(가장 많이 쓴 분야가 100)와 같다
    expect(chart.rows.map((r) => r.barPercent)).toEqual(barPercents([60, 120, 0, 20]));
    expect(chart.rows.map((r) => r.barPercent)).toEqual([50, 100, 0, 17]);
    // 눈금은 같은 눈금자 위: 처음 정한 비율만큼의 시간 ÷ 가장 많이 쓴 시간(120분)
    expect(chart.rows.map((r) => r.tickPercent)).toEqual([83, 50, 33, 0]);
    expect(chart.rows.every((r) => !r.tickClipped)).toBe(true);
  });
  it("눈금이 막대 눈금자 100을 넘으면 100에 붙이고 표시한다", () => {
    const c = buildStatusChart({
      categoryIds: [A, B],
      ratios: [
        { categoryId: A, percent: 90 },
        { categoryId: B, percent: 10 },
      ],
      totals: [
        { categoryId: A, minutes: 10 },
        { categoryId: B, minutes: 90 },
      ],
    });
    // A: 처음 정한 비율만큼 90분 ÷ 최대 90분 = 100 → 안 넘음. B: 10분 → 11
    expect(c.rows.map((r) => r.tickPercent)).toEqual([100, 11, 0]);
    const d = buildStatusChart({
      categoryIds: [A, B],
      ratios: [
        { categoryId: A, percent: 100 },
        { categoryId: B, percent: 0 },
      ],
      totals: [
        { categoryId: A, minutes: 30 },
        { categoryId: B, minutes: 60 },
      ],
    });
    // A: 90분 ÷ 최대 60분 = 150 → 100에 붙임
    expect(d.rows[0]).toMatchObject({ tickPercent: 100, tickClipped: true });
  });
});

describe("buildStatusChart: 경계", () => {
  it("분야 0개: 기타 한 조각만 있다", () => {
    const c = buildStatusChart({ categoryIds: [], ratios: [], totals: [] });
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].categoryId).toBeNull();
    expect(c.ratioEmpty).toBe(true);
    expect(c.spentEmpty).toBe(true);
    expect(c.missed).toEqual([]);
    expect(c.spentTotalMinutes).toBe(0);
  });

  it("처음 정한 비율이 없음: 비율 줄은 빈 줄(%가 모두 0, ratioEmpty), 쓴 시간 줄은 그대로, 눈금·차이는 null, 놓친 분야는 빈 목록", () => {
    const c = buildStatusChart({ categoryIds: [A, B], ratios: [], totals: [{ categoryId: A, minutes: 90 }] });
    expect(c.ratioEmpty).toBe(true);
    expect(c.ratio.map((p) => p.percent)).toEqual([0, 0, 0]);
    expect(c.spent.map((p) => p.percent)).toEqual([100, 0, 0]);
    expect(c.rows.every((r) => r.tickPercent === null && r.diffMinutes === null && r.diffPercent === null)).toBe(true);
    expect(c.missed).toEqual([]);
  });

  it("쓴 시간 0: 쓴 시간 줄은 빈 줄(spentEmpty), 막대 모두 0, 눈금·차이 null, 놓친 분야는 빈 목록", () => {
    const c = buildStatusChart({
      categoryIds: [A, B],
      ratios: [
        { categoryId: A, percent: 60 },
        { categoryId: B, percent: 40 },
      ],
      totals: [],
    });
    expect(c.spentEmpty).toBe(true);
    expect(c.spent.map((p) => p.percent)).toEqual([0, 0, 0]);
    expect(c.ratio.map((p) => p.percent)).toEqual([60, 40, 0]);
    expect(c.rows.map((r) => r.barPercent)).toEqual([0, 0, 0]);
    expect(c.rows.every((r) => r.tickPercent === null && r.diffMinutes === null)).toBe(true);
    expect(c.missed).toEqual([]); // lessDoneByRatio는 이때 비율이 있는 분야를 모두 돌려주지만 여기서는 쓰지 않는다
    expect(lessDoneByRatio([{ categoryId: A, percent: 60 }], [])).toHaveLength(1);
  });

  it("기타만 있음: 쓴 시간이 기타뿐이면 기타가 100%", () => {
    const c = buildStatusChart({ categoryIds: [A], ratios: [{ categoryId: A, percent: 100 }], totals: [{ categoryId: null, minutes: 45 }] });
    expect(c.spent.map((p) => p.percent)).toEqual([0, 100]);
    expect(c.rows[1]).toMatchObject({ categoryId: null, spentPercent: 100, barPercent: 100 });
    expect(c.missed).toEqual([{ categoryId: A, minutes: 45 }]);
  });

  it("처음 정한 비율에 기타가 들면 기타도 비율 줄과 놓친 분야에 든다", () => {
    const c = buildStatusChart({
      categoryIds: [A],
      ratios: [
        { categoryId: A, percent: 50 },
        { categoryId: null, percent: 50 },
      ],
      totals: [{ categoryId: A, minutes: 100 }],
    });
    expect(c.ratio.map((p) => p.percent)).toEqual([50, 50]);
    expect(c.missed).toEqual([{ categoryId: null, minutes: 50 }]); // 쓴 시간 100분의 50%인데 기타는 0분
  });

  it("합이 100이 아닌 처음 정한 비율은 합으로 나눠 읽는다(합 100)", () => {
    const under = buildStatusChart({
      categoryIds: [A, B, C],
      ratios: [
        { categoryId: A, percent: 20 },
        { categoryId: B, percent: 20 },
        { categoryId: C, percent: 10 },
      ],
      totals: [],
    });
    expect(under.ratio.map((p) => p.percent)).toEqual([40, 40, 20, 0]);
    const over = buildStatusChart({
      categoryIds: [A, B],
      ratios: [
        { categoryId: A, percent: 100 },
        { categoryId: B, percent: 100 },
      ],
      totals: [],
    });
    expect(over.ratio.map((p) => p.percent)).toEqual([50, 50, 0]);
    const odd = buildStatusChart({
      categoryIds: [A, B, C],
      ratios: [
        { categoryId: A, percent: 10 },
        { categoryId: B, percent: 10 },
        { categoryId: C, percent: 10 },
      ],
      totals: [],
    });
    expect(odd.ratio.map((p) => p.percent)).toEqual([34, 33, 33, 0]);
  });

  it("분야 9개 이상(색이 모자라는 때)도 조각 계산이 깨지지 않는다", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const c = buildStatusChart({
      categoryIds: ids,
      ratios: ids.map((id) => ({ categoryId: id, percent: 5 })),
      totals: ids.map((id, i) => ({ categoryId: id, minutes: (i + 1) * 5 })),
    });
    expect(c.rows).toHaveLength(13); // 분야 12 + 기타
    expect(sum(c.ratio.map((p) => p.percent))).toBe(100);
    expect(sum(c.spent.map((p) => p.percent))).toBe(100);
    expect(c.ratio.map((p) => p.categoryId)).toEqual([...ids, null]);
    const slices = pieSlices(c.spent);
    expect(slices).toHaveLength(13);
    expect(slices[12].to).toBe(1);
    expect(bandSegments(c.spent).at(-1)).toMatchObject({ categoryId: ids[11] });
  });

  it("보관했거나 이름을 못 푸는 분야의 시간: 합계에는 들고 조각·줄에는 없으며 기타로 합치지 않는다(지금 앱과 같다)", () => {
    const totals = [
      { categoryId: A, minutes: 60 },
      { categoryId: GONE, minutes: 40 },
      { categoryId: null, minutes: 20 },
    ];
    const c = buildStatusChart({ categoryIds: [A, B], ratios: [{ categoryId: A, percent: 100 }], totals });
    expect(c.spentTotalMinutes).toBe(120); // 지금 앱의 합계(totalOf)와 같다
    expect(c.hiddenMinutes).toBe(40);
    expect(c.rows.some((r) => r.categoryId === GONE)).toBe(false);
    expect(c.spent.find((p) => p.categoryId === null)?.minutes).toBe(20); // 기타에 합치지 않음
    expect(c.spent.map((p) => p.percent)).toEqual([75, 0, 25]); // 보이는 분야의 분(80분)끼리 나눈 몫, 합 100
    expect(sum(c.spent.map((p) => p.percent))).toBe(100);
  });

  it("보이는 분야가 아닌 분야의 몫은 처음 정한 비율 줄에서 빼고 남은 것끼리 합 100으로 읽는다", () => {
    const c = buildStatusChart({
      categoryIds: [A, B],
      ratios: [
        { categoryId: A, percent: 30 },
        { categoryId: GONE, percent: 40 },
        { categoryId: B, percent: 30 },
      ],
      totals: [],
    });
    expect(c.ratio.map((p) => p.percent)).toEqual([50, 50, 0]);
  });

  it("분야 번호가 겹치거나 null로 들어와도 조각이 겹치지 않는다", () => {
    const c = buildStatusChart({ categoryIds: [A, A, B], ratios: [], totals: [] });
    expect(c.rows.map((r) => r.categoryId)).toEqual([A, B, null]);
  });

  it("이상한 값(음수·NaN·무한·아주 큰 분)에도 예외 없이 합 100을 지킨다", () => {
    const run = () =>
      buildStatusChart({
        categoryIds: [A, B, C],
        ratios: [
          { categoryId: A, percent: Number.NaN },
          { categoryId: B, percent: -30 },
          { categoryId: C, percent: Number.POSITIVE_INFINITY },
        ],
        totals: [
          { categoryId: A, minutes: -50 },
          { categoryId: B, minutes: Number.NaN },
          { categoryId: C, minutes: 1e300 },
          { categoryId: null, minutes: 1e300 },
          { categoryId: GONE, minutes: Number.MAX_VALUE },
        ],
      });
    expect(run).not.toThrow();
    const c = run();
    expect(c.ratioEmpty).toBe(true); // 음수·NaN·무한은 0으로 읽는다
    expect(c.ratio.map((p) => p.percent)).toEqual([0, 0, 0, 0]);
    expect(sum(c.spent.map((p) => p.percent))).toBe(100);
    expect(c.spent.map((p) => p.percent)).toEqual([0, 0, 50, 50]);
    expect(Number.isFinite(c.spentTotalMinutes)).toBe(true);
    expect(c.rows.every((r) => Number.isFinite(r.barPercent) && r.barPercent >= 0 && r.barPercent <= 100)).toBe(true);
    // 소수 분은 반올림
    const frac = buildStatusChart({ categoryIds: [A], ratios: [], totals: [{ categoryId: A, minutes: 12.6 }] });
    expect(frac.rows[0].spentMinutes).toBe(13);
  });
});

describe("놓친 분야(missed): 지금 shortfallByRatio를 그대로 쓴다", () => {
  const ratios = [
    { categoryId: A, percent: 50 },
    { categoryId: B, percent: 30 },
    { categoryId: C, percent: 20 },
  ];
  it("처음 정한 비율보다 덜 쓴 분야를 차이 큰 순으로 낸다", () => {
    const totals = [
      { categoryId: A, minutes: 60 },
      { categoryId: B, minutes: 120 },
    ];
    const c = buildStatusChart({ categoryIds: [A, B, C], ratios, totals });
    // 쓴 시간 합 180분: A는 90분 중 60분 → 30, C는 36분 중 0분 → 36, B는 54분 중 120분이라 안 든다
    expect(c.missed).toEqual([
      { categoryId: C, minutes: 36 },
      { categoryId: A, minutes: 30 },
    ]);
    expect(c.missed).toEqual(shortfallByRatio(ratios, totals));
  });
  it("처음 정한 비율과 같거나 5분 미만으로만 모자라면 안 든다(shortfallByRatio의 5분 문턱)", () => {
    const c = buildStatusChart({
      categoryIds: [A, B, C],
      ratios,
      totals: [
        { categoryId: A, minutes: 50 },
        { categoryId: B, minutes: 30 },
        { categoryId: C, minutes: 20 },
      ],
    });
    expect(c.missed).toEqual([]);
  });
  it("보이는 분야가 아닌 분야는 빼고 낸다(shortfallByRatio는 낸다)", () => {
    const withGone = [...ratios, { categoryId: GONE, percent: 50 }];
    const totals = [{ categoryId: A, minutes: 100 }];
    expect(shortfallByRatio(withGone, totals).some((m) => m.categoryId === GONE)).toBe(true);
    const c = buildStatusChart({ categoryIds: [A, B, C], ratios: withGone, totals });
    expect(c.missed.some((m) => m.categoryId === GONE)).toBe(false);
  });
});

describe("띠그래프 조각 자리", () => {
  it("0%를 빼고 왼쪽부터 쌓는다", () => {
    const segs = bandSegments([
      { categoryId: A, percent: 30 },
      { categoryId: B, percent: 0 },
      { categoryId: C, percent: 60 },
      { categoryId: null, percent: 10 },
    ]);
    expect(segs.map((s) => [s.categoryId, s.startPercent, s.percent])).toEqual([
      [A, 0, 30],
      [C, 30, 60],
      [null, 90, 10],
    ]);
  });
  it("빈 줄은 그릴 조각이 없다", () => {
    expect(bandSegments(buildStatusChart({ categoryIds: [A], ratios: [], totals: [] }).ratio)).toEqual([]);
  });
});

describe("원그래프 조각 경로", () => {
  it("12시에서 시작해 시계 방향이다", () => {
    const [x0, y0] = polarPoint(0, 100);
    expect(x0).toBeCloseTo(0, 6);
    expect(y0).toBeCloseTo(-100, 6); // 12시 = 위(SVG y가 작음)
    const [x1, y1] = polarPoint(0.25, 100);
    expect(x1).toBeCloseTo(100, 6); // 3시
    expect(y1).toBeCloseTo(0, 6);
    const [x2, y2] = polarPoint(0.5, 100);
    expect(x2).toBeCloseTo(0, 6); // 6시
    expect(y2).toBeCloseTo(100, 6);
  });
  it("25%는 12시→3시 부채꼴이다", () => {
    expect(arcPath(0, 0.25)).toBe("M0 0 L0 -100 A100 100 0 0 1 100 0 Z");
  });
  it("50% 넘으면 큰 호 표시(large-arc)가 1이다", () => {
    expect(arcPath(0, 0.75)).toContain("A100 100 0 1 1 ");
    expect(arcPath(0, 0.5)).toContain("A100 100 0 0 1 ");
  });
  it("100%면 온 원, 0%면 경로 없음", () => {
    const full = arcPath(0, 1);
    expect(full).toBe("M0 -100 A100 100 0 1 1 0 100 A100 100 0 1 1 0 -100 Z");
    expect(arcPath(0.3, 0.3)).toBeNull();
    expect(arcPath(0.5, 0.2)).toBeNull();
    expect(arcPath(Number.NaN, 0.5)).toBeNull();
  });
  it("반지름을 바꿀 수 있다", () => {
    expect(arcPath(0, 0.25, 50)).toBe("M0 0 L0 -50 A50 50 0 0 1 50 0 Z");
  });
  it("pieSlices: 정수 %로 쌓아 한 바퀴(1)에 딱 맞고, 0%는 d가 null이다", () => {
    const slices = pieSlices([
      { categoryId: A, percent: 34 },
      { categoryId: B, percent: 0 },
      { categoryId: C, percent: 33 },
      { categoryId: null, percent: 33 },
    ]);
    expect(slices.map((s) => [s.from, s.to])).toEqual([
      [0, 0.34],
      [0.34, 0.34],
      [0.34, 0.67],
      [0.67, 1],
    ]);
    expect(slices.map((s) => s.d === null)).toEqual([false, true, false, false]);
    const whole = pieSlices([{ categoryId: A, percent: 100 }]);
    expect(whole[0].d).toBe(arcPath(0, 1));
    expect(pieSlices([{ categoryId: A, percent: 0 }])[0].d).toBeNull();
  });
});
