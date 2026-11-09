"use client";

import type { ComponentType, CSSProperties } from "react";
import { categoryColorValue } from "../lib/category-color";
import { bandSegments, pieLabels, pieSlices, type ChartCategoryId, type GoalChart, type StatusChart } from "../lib/growth/status-chart";

/**
 * 상태보기의 그림들(원샷 v2 고침5, 명세 ③-S + ⑩ PM 8 · d-110).
 * - 이번 주 목표 뷰: 분야별 막대 하나(GoalBars). 칩 없음, 기간은 이번 주만.
 * - 목표 비율 뷰: 띠그래프(처음)·원그래프. 보기 하나 = 같은 데이터(buildStatusChart 결과)를 받는 부품 하나(STATUS_VIEWS).
 *   보기를 늘리려면 STATUS_VIEWS 목록에 {id, label, Component} 한 줄을 더한다 — 기억한 값 검사(parseStatusPref)가 이 목록을 따른다.
 * 색: 조각 색을 정하는 곳은 categoryColorValue 한 군데(lib/category-color.ts)다. 분야 색을 칠한 그림에는 모두 --color-chart-outline 윤곽을 둔다
 * (분야 색이 흰 바탕 3:1 미만이라 윤곽이 경계 대비를 맡는다, WCAG 1.4.11). 살구(--color-accent)는 쓰지 않는다(PM 8).
 * 새 토큰은 lib/design-tokens.ts에 생기기 전이라 var(이름, 대체값)으로 쓴다.
 * 그림은 글로 읽지 않는다(aria-hidden). 카드 앞 숨은 요약 한 줄(화면이 만든다)이 같은 내용을 글로 준다. 분야 이름은 사용자 글이라 React 텍스트로만 그린다.
 */

/** 분야 색 그림의 윤곽 색(새 토큰, 대체값 = 지금 글자색) */
export const CHART_OUTLINE = "var(--color-chart-outline, var(--color-text))";

/** 보기들이 쓰는 글(화면의 GROWTH_TEXT가 넘긴다) */
export type GrowthViewText = {
  /** 위 띠·왼쪽 원 이름표 「목표 비율」 */
  ratioLine: string;
  /** 목록 오른쪽: 「10% / 목표 30%」, 목표 비율이 없는 줄(기타 등)은 「10%」 */
  ratioValue: (spent: number, ratio: number | null) => string;
  percent: (n: number) => string;
};

export type StatusViewProps = {
  chart: StatusChart;
  text: GrowthViewText;
  /** 아래 띠·오른쪽 원 이름표(기간 이름, 예 「이번 주」) */
  periodName: string;
  nameOf: (categoryId: ChartCategoryId) => string;
  onOpenCategory: (categoryId: ChartCategoryId, name: string) => void;
};

const keyOf = (id: ChartCategoryId) => id ?? "other";
/** 조각 색: 분야는 줄 안의 자리(받은 분야 순서 = 만든 순서), 기타는 기타 색 */
const colorOf = (order: (id: ChartCategoryId) => number, id: ChartCategoryId) => categoryColorValue(id === null ? null : order(id));
const chartOrder = (chart: StatusChart) => (id: ChartCategoryId) => chart.rows.findIndex((r) => r.categoryId === id);

/** 이 줄에 붙일 목표 비율(%). 목표 비율 줄이 비었거나, 기타가 목표 비율에 없으면 null(「목표 n%」를 붙이지 않는다) */
export function ratioOf(chart: StatusChart, id: ChartCategoryId): number | null {
  if (chart.ratioEmpty) return null;
  const r = chart.rows.find((row) => row.categoryId === id);
  if (!r) return null;
  if (id === null && r.ratioPercent === 0) return null; // 기타는 목표 비율에 없으면 「10%」만
  return r.ratioPercent;
}

/** 목표 비율 뷰 목록 한 줄의 오른쪽 글(화면 읽기 요약과 같은 값) */
export function ratioRowValue(chart: StatusChart, id: ChartCategoryId, text: GrowthViewText): string {
  const r = chart.rows.find((row) => row.categoryId === id);
  return text.ratioValue(r?.spentPercent ?? 0, ratioOf(chart, id));
}

/** 띠 아래 목록: 색 점(1px 윤곽) · 이름 · 오른쪽 「10% / 목표 30%」. 순서 = 만든 순서, 기타 끝. 굵은 줄 없음(PM 8). 누르면 그 분야 페이지 */
export function RatioList({ chart, text, nameOf, onOpenCategory }: StatusViewProps) {
  const order = chartOrder(chart);
  return (
    <ul className="growth-list">
      {chart.rows.map((r) => {
        const name = nameOf(r.categoryId);
        return (
          <li key={keyOf(r.categoryId)} className="growth-item">
            <button type="button" className="growth-row" onClick={() => onOpenCategory(r.categoryId, name)}>
              <span className="growth-name">
                <span className="growth-dot" aria-hidden="true" style={{ background: colorOf(order, r.categoryId), borderColor: CHART_OUTLINE }} />
                {name}
              </span>
              <span className="growth-row-value">{ratioRowValue(chart, r.categoryId, text)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type Line = { categoryId: ChartCategoryId; percent: number }[];

/** 띠 한 줄. kind=ratio는 점선 윤곽(목표 비율), spent는 실선 윤곽(기간). 칸 안 %는 칸이 28px보다 좁으면 CSS(컨테이너 쿼리)가 숨긴다 */
function BandLine({ chart, line, empty, caption, kind, text }: { chart: StatusChart; line: Line; empty: boolean; caption: string; kind: "ratio" | "spent"; text: GrowthViewText }) {
  const order = chartOrder(chart);
  const borderStyle = kind === "ratio" ? "dashed" : "solid";
  return (
    <div className="growth-band-line">
      <span className="growth-line-caption">{caption}</span>
      <div className={empty ? "growth-band is-empty" : "growth-band"} data-line={kind} style={empty ? { borderStyle, borderColor: CHART_OUTLINE } : undefined}>
        {bandSegments(line).map((seg) => {
          const style: CSSProperties = { inlineSize: `${seg.percent}%`, background: colorOf(order, seg.categoryId), borderStyle, borderColor: CHART_OUTLINE };
          return (
            <span key={keyOf(seg.categoryId)} className="growth-band-seg" data-category={keyOf(seg.categoryId)} style={style}>
              <span className="growth-seg-label">{text.percent(seg.percent)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 범례 한 줄: 점선 칸 「목표 비율」 · 실선 칸 「이번 주」(기간 이름) */
function BandLegend({ text, periodName }: { text: GrowthViewText; periodName: string }) {
  return (
    <div className="growth-legend">
      <span className="growth-legend-item">
        <span className="growth-legend-box" style={{ borderStyle: "dashed", borderColor: CHART_OUTLINE }} />
        {text.ratioLine}
      </span>
      <span className="growth-legend-item">
        <span className="growth-legend-box" style={{ borderStyle: "solid", borderColor: CHART_OUTLINE }} />
        {periodName}
      </span>
    </div>
  );
}

/** 띠그래프 두 줄(처음 보기, PM d-102): 위 「목표 비율」 점선 윤곽 · 아래 기간 실선 윤곽, 같은 분야 같은 색, 같은 순서. 연결선·살구 없음 */
function BandView(props: StatusViewProps) {
  const { chart, text, periodName } = props;
  return (
    <>
      <div className="growth-graph" aria-hidden="true">
        <BandLine chart={chart} line={chart.ratio} empty={chart.ratioEmpty} caption={text.ratioLine} kind="ratio" text={text} />
        <BandLine chart={chart} line={chart.spent} empty={chart.spentEmpty} caption={periodName} kind="spent" text={text} />
        <BandLegend text={text} periodName={periodName} />
      </div>
      <RatioList {...props} />
    </>
  );
}

/**
 * 기록 없음 빈 상태(창구 덧붙임 11-09 11:3x, Figma 50:598): 글 대신 예시 값 — 목표 비율 띠 한 줄(점선 윤곽, 칸에 %) + 기간 빈 띠 「0시간」.
 * 목표 비율이 없으면 그리지 않는다(화면은 단추만 둔다). 그림이라 글로 읽지 않는다(숨은 요약이 준다)
 */
export function EmptyBands({ chart, text, periodName, zeroText }: { chart: StatusChart; text: GrowthViewText; periodName: string; zeroText: string }) {
  if (chart.ratioEmpty) return null;
  return (
    <div className="growth-graph" aria-hidden="true">
      <BandLine chart={chart} line={chart.ratio} empty={false} caption={text.ratioLine} kind="ratio" text={text} />
      <div className="growth-band-line">
        <span className="growth-line-caption">{periodName}</span>
        <div className="growth-band is-empty" data-line="spent" style={{ borderStyle: "solid", borderColor: CHART_OUTLINE }}>
          <span className="growth-seg-label">{zeroText}</span>
        </div>
      </div>
    </div>
  );
}

/** 원그래프 반지름(그림 단위). 그림 칸은 원 밖 % 글 자리만큼 더 넓다 */
const PIE_RADIUS = 100;
const PIE_BOX = 150;

function Pie({ chart, line, empty, caption, text }: { chart: StatusChart; line: Line; empty: boolean; caption: string; text: GrowthViewText }) {
  const order = chartOrder(chart);
  const slices = pieSlices(line, PIE_RADIUS);
  return (
    <div className="growth-pie-box">
      <span className="growth-line-caption">{caption}</span>
      <svg className="growth-pie" viewBox={`${-PIE_BOX} ${-PIE_BOX} ${2 * PIE_BOX} ${2 * PIE_BOX}`} focusable="false">
        {empty ? (
          <circle r={PIE_RADIUS} className="growth-pie-empty" stroke={CHART_OUTLINE} />
        ) : (
          <>
            {slices.map((s) =>
              s.d === null ? null : (
                <path
                  key={keyOf(s.categoryId)}
                  d={s.d}
                  className="growth-pie-slice"
                  data-category={keyOf(s.categoryId)}
                  style={{ fill: colorOf(order, s.categoryId) }}
                  stroke={CHART_OUTLINE}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
            {pieLabels(slices, PIE_RADIUS).map((l) => (
              <g key={keyOf(l.categoryId)} className={l.inside ? "growth-pie-label is-inside" : "growth-pie-label is-outside"}>
                {l.leader && <line x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2} className="growth-pie-leader" stroke={CHART_OUTLINE} vectorEffect="non-scaling-stroke" />}
                <text x={l.x} y={l.y} textAnchor={l.anchor} dominantBaseline="central" className="growth-pie-text">
                  {text.percent(l.percent)}
                </text>
              </g>
            ))}
          </>
        )}
      </svg>
    </div>
  );
}

/** 원그래프: 원 둘 나란히(왼쪽 「목표 비율」 · 오른쪽 기간), 같은 크기, 조각마다 실선 1px 윤곽(점선 없음), 조각마다 %. 튀어나옴 없음 */
function PieView(props: StatusViewProps) {
  const { chart, text, periodName } = props;
  return (
    <>
      <div className="growth-graph" aria-hidden="true">
        <div className="growth-pies">
          <Pie chart={chart} line={chart.ratio} empty={chart.ratioEmpty} caption={text.ratioLine} text={text} />
          <Pie chart={chart} line={chart.spent} empty={chart.spentEmpty} caption={periodName} text={text} />
        </div>
      </div>
      <RatioList {...props} />
    </>
  );
}

export type StatusViewEntry = {
  id: string;
  /** 지금 이 보기일 때 다른 보기로 바꾸는 글 단추의 글 열쇠(D-049, 칩 아님) */
  switchLabel: "toPie" | "toBand";
  Component: ComponentType<StatusViewProps>;
};

/** 목표 비율 뷰의 보기 방식 목록(첫 줄이 처음 보기 = 띠그래프, PM d-102). 글 단추가 다음 보기로 돌린다 */
export const STATUS_VIEWS: StatusViewEntry[] = [
  { id: "band", switchLabel: "toPie", Component: BandView },
  { id: "pie", switchLabel: "toBand", Component: PieView },
];

// ── 이번 주 목표 뷰 ─────────────────────────────────────────────────────────

export type GoalViewText = {
  /** 오른쪽 글: 남은 시간이 있으면 「2시간 · 3시간 더」, 없거나 목표가 없으면 「12시간」 */
  goalValue: (spentMinutes: number, remainingMinutes: number) => string;
  /** 막대 아래 「목표 5시간」 / 「목표 없음」 */
  goalOf: (goalMinutes: number | null) => string;
  legendGoal: string;
  legendGap: string;
};

/**
 * 목표를 세우지 않은 주의 예시(창구 덧붙임 11-09 11:3x, Figma 50:741): 이름표 「예시」 + 흐린(불투명 40%) 막대 둘 — 고정 예시 글(포트폴리오 목표 6시간 · 어학 목표 5시간).
 * 실제 분야·값과 섞지 않는다(사용자 데이터를 받지 않는다). 누를 수 없고(단추 아님), 화면 읽기는 묶음 이름 「예시」로 시작해 실제 요약과 섞이지 않는다
 */
export const GOAL_EXAMPLE = [
  { name: "포트폴리오", goalMinutes: 360, colorOrder: 0 },
  { name: "어학", goalMinutes: 300, colorOrder: 1 },
] as const;

export function GoalExample({ label, goalOf }: { label: string; goalOf: (goalMinutes: number | null) => string }) {
  const axis = Math.max(...GOAL_EXAMPLE.map((e) => e.goalMinutes));
  return (
    <div className="growth-example" role="group" aria-label={label}>
      <p className="growth-example-label" aria-hidden="true">
        {label}
      </p>
      <ul className="growth-list growth-example-list">
        {GOAL_EXAMPLE.map((e) => {
          const tick = Number(((e.goalMinutes / axis) * 100).toFixed(3));
          return (
            <li key={e.name} className="growth-example-item">
              <span className="growth-name">{e.name}</span>
              <span className="growth-goal-bar" aria-hidden="true">
                <span className="growth-goal-fill" style={{ inlineSize: `${tick / 3}%`, background: categoryColorValue(e.colorOrder), borderColor: CHART_OUTLINE }} />
                <span className="growth-goal-gap" style={{ insetInlineStart: `${tick / 3}%`, insetInlineEnd: `${100 - tick}%`, borderColor: CHART_OUTLINE, borderStyle: "dashed" }} />
                <span className="growth-goal-tick" style={{ insetInlineStart: `clamp(0px, calc(${tick}% - 1px), calc(100% - 2px))`, background: CHART_OUTLINE }} />
              </span>
              <span className="growth-goal-of">{goalOf(e.goalMinutes)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 짧은 막대 채움 최소 폭(px, 명세 ③-S 공통) */
export const GOAL_FILL_MIN_PX = 6;

/**
 * 분야별 막대(이번 주 목표 뷰). 분야마다 한 줄: 윗줄 이름 · 오른쪽 값, 막대(축 = 이 화면에서 가장 큰 값, 채움 = 쓴 시간, 눈금 = 목표,
 * 채움 끝에서 눈금까지 점선 빈 자리 — 채움 없음), 막대 아래 「목표 n시간」/「목표 없음」. 누르면 그 분야 페이지
 */
export function GoalBars({
  chart,
  text,
  colorOrder,
  nameOf,
  onOpenCategory,
}: {
  chart: GoalChart;
  text: GoalViewText;
  /** 분야의 색 자리(만든 순서 안의 자리, 0부터) */
  colorOrder: (id: string) => number;
  nameOf: (categoryId: ChartCategoryId) => string;
  onOpenCategory: (categoryId: ChartCategoryId, name: string) => void;
}) {
  return (
    <>
      <div className="growth-legend" aria-hidden="true">
        <span className="growth-legend-item">
          <span className="growth-legend-tick" style={{ background: CHART_OUTLINE }} />
          {text.legendGoal}
        </span>
        <span className="growth-legend-item">
          <span className="growth-legend-box" style={{ borderStyle: "dashed", borderColor: CHART_OUTLINE, background: "transparent" }} />
          {text.legendGap}
        </span>
      </div>
      <ul className="growth-list">
        {chart.rows.map((r) => {
          const name = nameOf(r.categoryId);
          const color = categoryColorValue(r.categoryId === null ? null : colorOrder(r.categoryId));
          const fillEnd = r.spentMinutes > 0 ? `max(${GOAL_FILL_MIN_PX}px, ${r.fillPercent}%)` : "0%";
          return (
            <li key={keyOf(r.categoryId)} className="growth-item">
              <button type="button" className="growth-row growth-goal-row" onClick={() => onOpenCategory(r.categoryId, name)}>
                <span className="growth-name">{name}</span>
                <span className={r.remainingMinutes > 0 ? "growth-row-value is-left" : "growth-row-value"}>{text.goalValue(r.spentMinutes, r.remainingMinutes)}</span>
                <span className="growth-goal-bar" aria-hidden="true" data-category={keyOf(r.categoryId)}>
                  {r.spentMinutes > 0 && <span className="growth-goal-fill" style={{ inlineSize: fillEnd, background: color, borderColor: CHART_OUTLINE }} />}
                  {r.tickPercent !== null && r.remainingMinutes > 0 && (
                    <span
                      className="growth-goal-gap"
                      style={{ insetInlineStart: fillEnd, insetInlineEnd: `${100 - r.tickPercent}%`, borderColor: CHART_OUTLINE, borderStyle: "dashed" }}
                    />
                  )}
                  {r.tickPercent !== null && (
                    <span className="growth-goal-tick" style={{ insetInlineStart: `clamp(0px, calc(${r.tickPercent}% - 1px), calc(100% - 2px))`, background: CHART_OUTLINE }} />
                  )}
                </span>
                <span className="growth-goal-of">{text.goalOf(r.goalMinutes)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
