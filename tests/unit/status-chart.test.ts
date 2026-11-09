import { describe, expect, it } from "vitest";
import { barPercents, lessDoneByRatio, shortfallByRatio } from "../../lib/growth/logic";
import {
  apportionPercents,
  arcPath,
  bandSegments,
  buildGoalChart,
  buildStatusChart,
  drawablePieces,
  fillTimeFor,
  PIE_LABEL_INSIDE_MIN,
  pieLabels,
  pieSlices,
  polarPoint,
} from "../../lib/growth/status-chart";
import { goalProgress } from "../../lib/goals/validation";

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
  it("나머지가 큰 자리가 1을 더 받는다: 큰 나머지가 뒤에 있어도 앞 자리가 먼저 받지 않는다(정렬 키를 지우면 깨진다)", () => {
    // 10:10:11 → 32.26 / 32.26 / 35.48 → 몫 32·32·35(합 99), 남은 1은 나머지가 가장 큰 마지막 자리(.48)가 받는다
    expect(apportionPercents([10, 10, 11])).toEqual([32, 32, 36]);
    // 3:5:4 → 25 / 41.67 / 33.33 → 몫 25·41·33(합 99), 나머지 .67이 가장 큰 가운데가 받는다
    expect(apportionPercents([3, 5, 4])).toEqual([25, 42, 33]);
    // 나머지가 같으면 앞 자리가 먼저
    expect(apportionPercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sum(apportionPercents([7, 11, 13, 17, 19, 33]))).toBe(100);
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
    // A: 처음 정한 비율만큼 90분 ÷ 최대 90분 = 정확히 100 → 안 넘는다(clipped 아님). B: 10분 → 11
    expect(c.rows.map((r) => r.tickPercent)).toEqual([100, 11, 0]);
    expect(c.rows[0].tickClipped).toBe(false);
    expect(c.rows.map((r) => r.tickClipped)).toEqual([false, false, false]);
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

  it("분야 번호가 겹쳐 들어와도 조각이 겹치지 않는다(기타는 늘 맨 끝에 하나)", () => {
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
  it("숨은 분야가 있어도 missed와 rows의 차이는 같은 분모(보이는 분야의 분)라 같은 값을 낸다: missed 분 = −diffMinutes", () => {
    const totals = [
      { categoryId: A, minutes: 60 },
      { categoryId: B, minutes: 120 },
      { categoryId: GONE, minutes: 600 }, // 숨은 분야: 합계에는 들지만 분모에서는 뺀다
    ];
    const c = buildStatusChart({ categoryIds: [A, B, C], ratios, totals });
    expect(c.hiddenMinutes).toBe(600);
    // 보이는 분야 합 180분 기준: A 90분 중 60 → 30, C 36분 중 0 → 36 (숨은 분 600을 분모에 넣었다면 값이 크게 달라진다)
    expect(c.missed).toEqual([
      { categoryId: C, minutes: 36 },
      { categoryId: A, minutes: 30 },
    ]);
    for (const m of c.missed) expect(c.rows.find((r) => r.categoryId === m.categoryId)?.diffMinutes).toBe(-m.minutes);
    // 모자란 분(5분 이상)이 있는 분야는 모두 missed에 있고, missed는 그것뿐이다
    const fromRows = c.rows.filter((r) => r.diffMinutes !== null && r.diffMinutes <= -5).map((r) => r.categoryId).sort();
    expect(c.missed.map((m) => m.categoryId).sort()).toEqual(fromRows);
  });
  it("입력은 값 정리를 거쳐 넘긴다: 음수·NaN·무한 비율은 0, 소수 분은 반올림, 예외 없음", () => {
    const run = () =>
      buildStatusChart({
        categoryIds: [A, B, C],
        ratios: [
          { categoryId: A, percent: 50 },
          { categoryId: B, percent: -30 }, // 0으로 읽는다
          { categoryId: C, percent: Number.NaN }, // 0으로 읽는다
        ],
        totals: [
          { categoryId: A, minutes: Number.NaN }, // 0
          { categoryId: B, minutes: 99.6 }, // 100
          { categoryId: C, minutes: Number.POSITIVE_INFINITY }, // 0
        ],
      });
    expect(run).not.toThrow();
    const c = run();
    // 정리하면 비율은 A 100%뿐, 쓴 시간은 B 100분뿐 → A는 100분이 모자라다(정리 안 했다면 음수·NaN이 몫을 깨뜨린다)
    expect(c.missed).toEqual([{ categoryId: A, minutes: 100 }]);
    expect(c.rows.find((r) => r.categoryId === A)?.diffMinutes).toBe(-100);
    expect(c.ratio.map((p) => p.percent)).toEqual([100, 0, 0, 0]);
  });
});

describe("fillTimeFor(채울 시간의 기간 짝: 둘 다 같은 이번 주 시간과 견준다, PM 확정 11-09)", () => {
  const ids = [A, B, C];
  const ratios = [
    { categoryId: A, percent: 60 },
    { categoryId: B, percent: 40 },
  ];
  const thisWeek = [
    { categoryId: A, minutes: 60 },
    { categoryId: B, minutes: 120 },
  ];
  it("목표가 없으면 처음 정한 비율 기준: 이번 주에 쓴 시간과 견준다", () => {
    const r = fillTimeFor({ categoryIds: ids, ratios, goalItems: null, thisWeek });
    expect(r.basis).toBe("ratio");
    // 이번 주 180분: A 108분 중 60 → 48
    expect(r.items).toEqual([{ categoryId: A, minutes: 48 }]);
  });
  it("처음 정한 비율 기준의 채울 시간은 같은 이번 주 시간으로 그린 그래프의 놓친 분야(missed)와 같다", () => {
    const r = fillTimeFor({ categoryIds: ids, ratios, goalItems: null, thisWeek });
    expect(r.items).toEqual(buildStatusChart({ categoryIds: ids, ratios, totals: thisWeek }).missed);
  });
  it("목표가 있으면 목표 기준: 같은 이번 주 시간과 견준다", () => {
    const goalItems = [
      { categoryId: A, minutes: 100 },
      { categoryId: B, minutes: 20 },
    ];
    const r = fillTimeFor({ categoryIds: ids, ratios, goalItems, thisWeek });
    expect(r.basis).toBe("goal");
    // 이번 주 A 60분 → 40 남음, B 120분 ≥ 20 → 없음
    expect(r.items).toEqual([{ categoryId: A, minutes: 40 }]);
  });
  it("목표 목록이 비어 있으면 목표가 없는 것과 같다", () => {
    expect(fillTimeFor({ categoryIds: ids, ratios, goalItems: [], thisWeek }).basis).toBe("ratio");
  });
  it("쓴 시간이 없으면 빈 목록", () => {
    expect(fillTimeFor({ categoryIds: ids, ratios, goalItems: null, thisWeek: [] }).items).toEqual([]);
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

// ── 원샷 v2 고침5: 이번 주 목표 뷰 계산 · 원 조각 % 자리 ─────────────────────────

describe("buildGoalChart(이번 주 목표 뷰, 명세 ③-S ①)", () => {
  const goalItems = [
    { categoryId: A, minutes: 300 },
    { categoryId: B, minutes: 360 },
    { categoryId: C, minutes: 180 },
  ];
  const totals = [
    { categoryId: B, minutes: 720 },
    { categoryId: A, minutes: 120 },
    { categoryId: null, minutes: 60 },
  ];

  it("「목표 n 중 n」은 goalProgress(lib/goals)와 같은 값: 분야마다 min(쓴 시간, 목표)의 합", () => {
    const chart = buildGoalChart({ categoryIds: [A, B, C], goalItems, totals });
    expect(chart.targetMinutes).toBe(840);
    expect(chart.doneMinutes).toBe(120 + 360 + 0);
    expect({ targetMinutes: chart.targetMinutes, doneMinutes: chart.doneMinutes }).toEqual(goalProgress(goalItems, totals));
  });

  it("줄 순서 = 받은 분야 순서(만든 순서), 기타 맨 끝. 받은 순서를 바꾸면 줄 순서도 따라 바뀐다(남은 시간 순이 아니다)", () => {
    expect(buildGoalChart({ categoryIds: [A, B, C], goalItems, totals }).rows.map((r) => r.categoryId)).toEqual([A, B, C, null]);
    expect(buildGoalChart({ categoryIds: [C, B, A], goalItems, totals }).rows.map((r) => r.categoryId)).toEqual([C, B, A, null]);
  });

  it("줄 값: 남은 시간 = max(0, 목표 − 쓴 시간), 목표 없는 분야·기타는 goalMinutes null·눈금 없음", () => {
    const rows = buildGoalChart({ categoryIds: [A, B, C], goalItems, totals }).rows;
    expect(rows.map((r) => [r.spentMinutes, r.goalMinutes, r.remainingMinutes])).toEqual([
      [120, 300, 180],
      [720, 360, 0],
      [0, 180, 180],
      [60, null, 0],
    ]);
    expect(rows[3].tickPercent).toBeNull();
  });

  it("축 = 이 화면 분야 가운데 가장 큰 값(목표·쓴 시간 중): 채움·눈금 %가 그 축 위", () => {
    const chart = buildGoalChart({ categoryIds: [A, B, C], goalItems, totals });
    expect(chart.axisMinutes).toBe(720);
    expect(chart.rows.map((r) => r.fillPercent)).toEqual([16.667, 100, 0, 8.333]);
    expect(chart.rows.map((r) => r.tickPercent)).toEqual([41.667, 50, 25, null]);
    // 목표가 쓴 시간보다 크면 목표가 축이 된다
    const big = buildGoalChart({ categoryIds: [A], goalItems: [{ categoryId: A, minutes: 600 }], totals: [{ categoryId: A, minutes: 60 }] });
    expect(big.axisMinutes).toBe(600);
    expect(big.rows[0].fillPercent).toBe(10);
    expect(big.rows[0].tickPercent).toBe(100);
  });

  it("목표도 쓴 시간도 없는 분야는 줄이 없고, 0분이라도 목표가 있으면 줄이 있다. 기타는 쓴 시간이 있을 때만", () => {
    const chart = buildGoalChart({ categoryIds: [A, B, C], goalItems: [{ categoryId: C, minutes: 60 }], totals: [{ categoryId: A, minutes: 30 }] });
    expect(chart.rows.map((r) => r.categoryId)).toEqual([A, C]);
    expect(chart.rows[1]).toMatchObject({ spentMinutes: 0, goalMinutes: 60, fillPercent: 0 });
  });

  it("보이지 않는 분야(보관·이름 못 품)의 목표는 줄에는 없지만 「목표 n 중 n」에는 든다(할 일 탭 목표 한 줄과 같은 값)", () => {
    const chart = buildGoalChart({ categoryIds: [A], goalItems: [{ categoryId: A, minutes: 60 }, { categoryId: GONE, minutes: 120 }], totals: [{ categoryId: GONE, minutes: 120 }] });
    expect(chart.rows.map((r) => r.categoryId)).toEqual([A]);
    expect(chart.targetMinutes).toBe(180);
    expect(chart.doneMinutes).toBe(120);
  });

  it("빈 입력: 줄 없음, 축 0, 「목표 0 중 0」. 이상한 값(음수·NaN·무한)에도 예외 없이 0 이상", () => {
    const empty = buildGoalChart({ categoryIds: [], goalItems: [], totals: [] });
    expect(empty).toEqual({ targetMinutes: 0, doneMinutes: 0, axisMinutes: 0, rows: [] });
    const odd = buildGoalChart({
      categoryIds: [A, B],
      goalItems: [{ categoryId: A, minutes: Number.NaN }, { categoryId: B, minutes: 120 }],
      totals: [{ categoryId: A, minutes: -50 }, { categoryId: B, minutes: Number.POSITIVE_INFINITY }],
    });
    expect(odd.rows.map((r) => r.categoryId)).toEqual([B]);
    expect(odd.rows[0]).toMatchObject({ spentMinutes: 0, goalMinutes: 120, remainingMinutes: 120 });
    expect(odd.rows.every((r) => r.fillPercent >= 0 && r.fillPercent <= 100)).toBe(true);
  });
});

describe("pieLabels(원 조각마다 %, 명세 ③-S ② 5)", () => {
  it("0% 조각은 글이 없고, 8% 이상은 조각 안(가운데 맞춤·이끌 선 없음), 8% 미만은 원 밖 + 이끌 선", () => {
    const slices = pieSlices([
      { categoryId: A, percent: 60 },
      { categoryId: B, percent: 0 },
      { categoryId: C, percent: 8 },
      { categoryId: null, percent: 7 },
      { categoryId: GONE, percent: 25 },
    ]);
    const labels = pieLabels(slices, 100);
    expect(labels.map((l) => l.categoryId)).toEqual([A, C, null, GONE]);
    expect(labels.map((l) => l.inside)).toEqual([true, true, false, true]);
    expect(PIE_LABEL_INSIDE_MIN).toBe(8);
    const inside = labels[0];
    expect(inside.anchor).toBe("middle");
    expect(inside.leader).toBeNull();
    expect(Math.hypot(inside.x, inside.y)).toBeCloseTo(62, 0);
    const outside = labels[2];
    expect(outside.leader).not.toBeNull();
    expect(Math.hypot(outside.x, outside.y)).toBeCloseTo(120, 0);
    expect(Math.hypot(outside.leader!.x1, outside.leader!.y1)).toBeCloseTo(100, 0); // 둘레에서 시작
    expect(Math.hypot(outside.leader!.x2, outside.leader!.y2)).toBeCloseTo(112, 0);
  });

  it("원 밖 글은 원의 오른쪽 반이면 start, 왼쪽 반이면 end로 맞춘다(원과 겹치지 않게)", () => {
    const right = pieLabels(pieSlices([{ categoryId: A, percent: 5 }, { categoryId: B, percent: 95 }]))[0];
    expect(right.inside).toBe(false);
    expect(right.x).toBeGreaterThan(0);
    expect(right.anchor).toBe("start");
    const left = pieLabels(pieSlices([{ categoryId: B, percent: 95 }, { categoryId: A, percent: 5 }]))[1];
    expect(left.inside).toBe(false);
    expect(left.x).toBeLessThan(0);
    expect(left.anchor).toBe("end");
  });

  it("글 자리는 조각 가운데 각도: 12시에서 시작한 25% 조각의 글은 1시 반 방향", () => {
    const [l] = pieLabels(pieSlices([{ categoryId: A, percent: 25 }, { categoryId: B, percent: 75 }]), 100);
    expect(l.x).toBeGreaterThan(0);
    expect(l.y).toBeLessThan(0);
    expect(l.x).toBeCloseTo(-l.y, 1);
  });
});
