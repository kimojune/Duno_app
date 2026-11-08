"use client";

import type { ComponentType, ReactNode } from "react";
import { categoryColorValue } from "../lib/category-color";
import { bandSegments, pieSlices, type ChartCategoryId, type StatusChart } from "../lib/growth/status-chart";
import { formatMinutes } from "../lib/time-format";

/**
 * 상태보기의 보기 방식들(띠그래프 · 원그래프 · 분야별 줄 막대). 보기 하나 = 같은 데이터(buildStatusChart 결과)를 받는 부품 하나.
 * 보기를 늘리려면 STATUS_VIEWS 목록에 {id, label, Component} 한 줄을 더한다 — 고르는 줄·기억한 값 검사(parseStatusPref)가 이 목록을 따른다.
 * 어떤 보기를 최종으로 넣을지·모양·「그래프 전환 문구」(D-049)를 셋 이상에서 어떻게 할지는 디자인(23)이 정한다. 지금은 고르는 줄(단추 셋)이 자리다.
 * 색: 조각 색을 정하는 곳은 categoryColorValue 한 군데(lib/category-color.ts)다. 다이얼과 같은 분야에 같은 색이다. 모든 모양·글은 임시(디자인 확정 뒤 바꿈).
 */

/** 보기들이 쓰는 글(화면의 GROWTH_TEXT가 넘긴다. 임시 글) */
export type GrowthViewText = {
  ratioLine: string;
  spentLine: string;
  /** 그래프를 글로 읽을 때: 한 줄의 이름과 조각 글들 */
  lineSummary: (line: string, parts: string[]) => string;
  lineNone: (line: string) => string;
  /** 조각 하나를 글로: 분야 이름과 % */
  piece: (name: string, percent: number) => string;
  /** 처음 정한 비율과 쓴 시간의 차이 글 */
  diff: (deltaMinutes: number) => string;
};

export type StatusViewProps = {
  chart: StatusChart;
  text: GrowthViewText;
  nameOf: (categoryId: ChartCategoryId) => string;
  onOpenCategory: (categoryId: ChartCategoryId, name: string) => void;
};

const indexOfRow = (chart: StatusChart, id: ChartCategoryId) => chart.rows.findIndex((r) => r.categoryId === id);
const keyOf = (id: ChartCategoryId) => id ?? "other";
/** 조각 색: 분야는 줄 안의 자리(받은 분야 순서), 기타는 기타 색 */
const colorOf = (chart: StatusChart, id: ChartCategoryId) => categoryColorValue(id === null ? null : indexOfRow(chart, id));

/** 한 줄(처음 정한 비율 또는 쓴 시간)을 글로: 0%는 빼고 「이름 n%」를 모은다. 줄이 비었으면 「… 없음」 */
function lineText(chart: StatusChart, line: { categoryId: ChartCategoryId; percent: number }[], empty: boolean, label: string, props: StatusViewProps): string {
  if (empty) return props.text.lineNone(label);
  return props.text.lineSummary(
    label,
    line.filter((p) => p.percent > 0).map((p) => props.text.piece(props.nameOf(p.categoryId), p.percent)),
  );
}

/**
 * 그래프 둘레: 그림은 글로 읽지 않으므로(색·길이뿐) 바깥에 role="img"와 aria-label로 두 줄의 내용을 글로 준다.
 * 안쪽 그림은 aria-hidden. 분야 줄 목록(CategoryRows)은 쓴 시간·차이를 글로 주고 분야 페이지로 가는 단추이고, %는 이 aria-label이 준다.
 */
function GraphFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="growth-graph" role="img" aria-label={label}>
      <div className="growth-graph-art" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

function graphLabel(props: StatusViewProps): string {
  const { chart, text } = props;
  return [lineText(chart, chart.ratio, chart.ratioEmpty, text.ratioLine, props), lineText(chart, chart.spent, chart.spentEmpty, text.spentLine, props)].join(". ");
}

/** 분야 줄(색점 · 이름 · 쓴 시간 · 차이). 누르면 그 분야 페이지. bars면 얇은 막대와 처음 정한 비율 눈금을 더한다 */
export function CategoryRows({ chart, text, nameOf, onOpenCategory, bars }: StatusViewProps & { bars: boolean }) {
  return (
    <ul className="growth-list">
      {chart.rows.map((r) => {
        const name = nameOf(r.categoryId);
        return (
          <li key={keyOf(r.categoryId)} className="growth-item">
            <button type="button" className="growth-row" onClick={() => onOpenCategory(r.categoryId, name)}>
              <span className="growth-name">
                <span className="growth-dot" aria-hidden="true" style={{ background: colorOf(chart, r.categoryId) }} />
                {name}
              </span>
              <span className="growth-time">{formatMinutes(r.spentMinutes)}</span>
              {bars && (
                <span className="growth-bar" aria-hidden="true">
                  <span className="growth-bar-fill" style={{ inlineSize: `${r.barPercent}%`, background: colorOf(chart, r.categoryId) }} />
                  {r.tickPercent !== null && <span className="growth-tick" style={{ insetInlineStart: `clamp(0px, calc(${r.tickPercent}% - 1px), calc(100% - 2px))` }} />}
                </span>
              )}
              {r.diffMinutes !== null && <span className="growth-diff">{text.diff(r.diffMinutes)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function BandLine({ chart, line, empty, caption }: { chart: StatusChart; line: { categoryId: ChartCategoryId; percent: number }[]; empty: boolean; caption: string }) {
  return (
    <div className="growth-band-line">
      <span className="growth-line-caption">{caption}</span>
      <div className={empty ? "growth-band is-empty" : "growth-band"}>
        {bandSegments(line).map((seg) => (
          <span key={keyOf(seg.categoryId)} className="growth-band-seg" style={{ inlineSize: `${seg.percent}%`, background: colorOf(chart, seg.categoryId) }} />
        ))}
      </div>
    </div>
  );
}

/** 띠그래프: 위 줄 「처음 정한 비율」, 바로 아래 줄 「쓴 시간」(처음 정한 비율이 기준선). 두 줄의 조각 순서가 같다 */
function BandView(props: StatusViewProps) {
  const { chart, text } = props;
  return (
    <>
      <GraphFrame label={graphLabel(props)}>
        <BandLine chart={chart} line={chart.ratio} empty={chart.ratioEmpty} caption={text.ratioLine} />
        <BandLine chart={chart} line={chart.spent} empty={chart.spentEmpty} caption={text.spentLine} />
      </GraphFrame>
      <CategoryRows {...props} bars={false} />
    </>
  );
}

const PIE_RADIUS = 100;

function Pie({ chart, line, empty, caption }: { chart: StatusChart; line: { categoryId: ChartCategoryId; percent: number }[]; empty: boolean; caption: string }) {
  return (
    <div className="growth-pie-box">
      <svg className="growth-pie" viewBox={`${-PIE_RADIUS} ${-PIE_RADIUS} ${2 * PIE_RADIUS} ${2 * PIE_RADIUS}`} focusable="false">
        {empty ? (
          <circle r={PIE_RADIUS} className="growth-pie-empty" />
        ) : (
          pieSlices(line, PIE_RADIUS).map((s) =>
            s.d === null ? null : <path key={keyOf(s.categoryId)} d={s.d} className="growth-pie-slice" style={{ fill: colorOf(chart, s.categoryId) }} />,
          )
        )}
      </svg>
      <span className="growth-line-caption">{caption}</span>
    </div>
  );
}

/** 원그래프: 같은 두 값을 원 둘로(처음 정한 비율 / 쓴 시간). 12시에서 시작해 시계 방향 */
function PieView(props: StatusViewProps) {
  const { chart, text } = props;
  return (
    <>
      <GraphFrame label={graphLabel(props)}>
        <div className="growth-pies">
          <Pie chart={chart} line={chart.ratio} empty={chart.ratioEmpty} caption={text.ratioLine} />
          <Pie chart={chart} line={chart.spent} empty={chart.spentEmpty} caption={text.spentLine} />
        </div>
      </GraphFrame>
      <CategoryRows {...props} bars={false} />
    </>
  );
}

/** 분야별 줄 막대: 분야마다 한 줄(0분도, 기타도) · 얇은 막대 · 처음 정한 비율 눈금 · 차이 */
function RowsView(props: StatusViewProps) {
  return <CategoryRows {...props} bars />;
}

export type StatusViewEntry = { id: string; label: "bandName" | "pieName" | "rowsName"; Component: ComponentType<StatusViewProps> };

/** 보기 방식 목록(순서가 고르는 줄의 순서, 첫 줄이 처음 보기). 보기를 늘리려면 여기에 한 줄 */
export const STATUS_VIEWS: StatusViewEntry[] = [
  { id: "band", label: "bandName", Component: BandView },
  { id: "pie", label: "pieName", Component: PieView },
  { id: "rows", label: "rowsName", Component: RowsView },
];
