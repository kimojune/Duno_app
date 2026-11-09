"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { categoryColorValue } from "../lib/category-color";
import type { GrowthApi } from "../lib/growth-api";
import { minutesOf } from "../lib/growth/logic";
import { buildStatusChart, polarPoint } from "../lib/growth/status-chart";
import type { GrowthData } from "../lib/growth/types";
import { dayBarPercent, longestDayMinutes } from "../lib/notes/category-minutes";
import type { CategoryPageData } from "../lib/notes/types";
import { formatMinutes } from "../lib/time-format";
import { describeTodoDay } from "../lib/todos/day";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { BackHeader } from "./back-header";
import { Notice, SecondaryButton } from "./ui";
import { dayText } from "./todo-view";

/**
 * 분야 페이지(PRD 7-4, G13-a, ③). 상태보기에서 분야를 누르면 열린다.
 * 그 분야 할 일들의 작업 기록이 날짜별로 모이고, 그날 어떤 일을 했는지 보인다(끝낸 일은 「끝냄」 글로).
 * 기타를 누르면 분야 없는 할 일이 모인다. 화면이 그려지면 본 것을 한 번 남긴다(스스로 연 것, G8).
 * 고침8(23 명세 2~4, PM 「141 나」): 맨 위 요약 카드(고리 = 전체 누적 중 이 분야 몫 · 총 시간 · 이번 주 · 목표 비율)와
 * 날짜마다 그날 이 분야 시간 + 시간 막대(이 페이지에서 가장 긴 날 = 폭 전체). 요약은 상태보기가 이미 가진 GrowthData를 props로 받고
 * 새 서버 호출이 없다. 날짜별 시간은 분야 페이지 응답 days[].minutes(서버가 이미 저장된 오늘 기록을 읽어 붙임).
 * 그림(고리·막대)은 aria-hidden이고 같은 내용을 글로 읽는다. 색만으로 가르지 않는다(숫자 글을 같이 둔다).
 * 모든 글은 React 텍스트로만 그린다.
 */

export const CATEGORY_PAGE_TEXT = {
  loading: "분야 페이지를 불러오는 중",
  loadFailed: "분야 페이지를 불러오지 못했어요.",
  reload: "다시 불러오기",
  empty: "할 일 0개", // 빈 상태(명세 ⑬ 24, PM 「143 가」 — 숫자 먼저). 요약 카드(0%) 아래에 둔다
  done: "끝냄",
  unreadable: "읽을 수 없는 할 일",
  unreadableNote: "읽을 수 없는 글",
  noNote: "작업 기록 없음",
  ofAll: "전체 중",
  percent: (n: number) => `${n}%`,
  total: (minutes: number) => `총 ${hoursText(minutes)}`,
  week: (minutes: number) => `이번 주 ${hoursText(minutes)}`,
  ratio: (n: number) => `목표 비율 ${n}%`,
  /** 카드 전체를 읽는 한 줄: 「어학, 총 12시간, 전체 중 25%, 이번 주 2시간, 목표 비율 30%」 */
  summary: (v: { name: string; totalMinutes: number; percent: number; weekMinutes: number; ratioPercent: number | null }) =>
    [v.name, `총 ${hoursText(v.totalMinutes)}`, `전체 중 ${v.percent}%`, `이번 주 ${hoursText(v.weekMinutes)}`, ...(v.ratioPercent === null ? [] : [`목표 비율 ${v.ratioPercent}%`])].join(", "),
  /** 날짜 머리를 읽는 글: 「11월 13일 목요일, 1시간 30분」. 시간이 0이면 날짜만 */
  dayHead: (day: string, minutes: number) => (minutes > 0 ? `${day}, ${formatMinutes(minutes)}` : day),
} as const;

/** 상태보기와 같은 시간 꼴. 0은 「0시간」(상태보기 zero와 같다), 나머지는 formatMinutes(「n시간 n분」) */
function hoursText(minutes: number): string {
  return minutes > 0 ? formatMinutes(minutes) : "0시간";
}

export type CategorySummary = {
  /** 누적(cumulative)의 이 분야 분 */
  totalMinutes: number;
  /** 전체(누적) 중 이 분야 몫(정수 %). 상태보기 「총 시간」과 같은 계산(buildStatusChart — 최대 나머지 방식, 보이는 분야끼리) */
  percent: number;
  /** 이번 주(thisWeek)의 이 분야 분 */
  weekMinutes: number;
  /** 목표 비율(정수 %). 목표 비율이 없는 분야(0%)·기타·비율 미설정이면 null — 줄을 그리지 않는다 */
  ratioPercent: number | null;
  /** 분야 색(조각) — 상태보기와 같은 자리(만든 순서), 기타는 기타 색 */
  color: string;
};

/** 요약 카드 값. 상태보기 GrowthData에서만 센다(새 서버 호출 없음) */
export function categorySummary(growth: GrowthData, categoryId: string | null): CategorySummary {
  const categoryIds = growth.categories.map((c) => c.id);
  const chart = buildStatusChart({ categoryIds, ratios: growth.ratios, totals: growth.cumulative });
  const index = chart.rows.findIndex((r) => r.categoryId === categoryId);
  const row = index >= 0 ? chart.rows[index] : null;
  const ratio = categoryId === null || chart.ratioEmpty || !row || row.ratioPercent <= 0 ? null : row.ratioPercent;
  const clean = (m: number) => (Number.isFinite(m) && m > 0 ? Math.round(m) : 0);
  return {
    totalMinutes: row ? row.spentMinutes : clean(minutesOf(growth.cumulative, categoryId)),
    percent: row ? row.spentPercent : 0,
    weekMinutes: clean(minutesOf(growth.thisWeek, categoryId)),
    ratioPercent: ratio,
    color: categoryColorValue(categoryId === null || index < 0 ? null : index),
  };
}

/** 고리 크기(그림 단위 = px). 두께 = 반지름의 30% */
export const SUMMARY_RING_SIZE = 88;
const RING_R = SUMMARY_RING_SIZE / 2 - 0.5; // 1px 윤곽이 칸 밖으로 나가지 않게
const RING_INNER = RING_R * 0.7;
const fix = (n: number) => String(Number(n.toFixed(3))).replace(/^-0$/, "0");

/** 가운데 (0,0) 고리 전체(바깥 원 + 안 원, evenodd) */
function ringPath(): string {
  const o = fix(RING_R);
  const i = fix(RING_INNER);
  return `M 0 -${o} A ${o} ${o} 0 1 1 0 ${o} A ${o} ${o} 0 1 1 0 -${o} Z M 0 -${i} A ${i} ${i} 0 1 0 0 ${i} A ${i} ${i} 0 1 0 0 -${i} Z`;
}

/** 고리 조각: 12시에서 시계 방향으로 percent만큼. 0이면 null, 100이면 고리 전체 */
export function ringSlicePath(percent: number): string | null {
  if (!(percent > 0)) return null;
  if (percent >= 100) return ringPath();
  const f = percent / 100;
  const large = f > 0.5 ? 1 : 0;
  const [ox0, oy0] = polarPoint(0, RING_R);
  const [ox1, oy1] = polarPoint(f, RING_R);
  const [ix1, iy1] = polarPoint(f, RING_INNER);
  const [ix0, iy0] = polarPoint(0, RING_INNER);
  return `M ${fix(ox0)} ${fix(oy0)} A ${fix(RING_R)} ${fix(RING_R)} 0 ${large} 1 ${fix(ox1)} ${fix(oy1)} L ${fix(ix1)} ${fix(iy1)} A ${fix(RING_INNER)} ${fix(RING_INNER)} 0 ${large} 0 ${fix(ix0)} ${fix(iy0)} Z`;
}

/**
 * 고리 바탕(연한 면). 새 토큰 없이 있는 토큰에서 고른다: 23 명세 「고른 줄 바탕과 같은 토큰(그림 #ece8e0)」에 가장 가까운
 * --color-notice-bg(#F3EEE6, 지시 권장). 바탕 면이라 윤곽 없이 둔다(경계 대비는 분야 색 조각의 1px 윤곽이 맡는다)
 */
export const SUMMARY_RING_TRACK = "var(--color-notice-bg)";
const CHART_OUTLINE = "var(--color-chart-outline, var(--color-text))";

export function SummaryCard({ name, summary }: { name: string; summary: CategorySummary }) {
  const slice = ringSlicePath(summary.percent);
  const h = SUMMARY_RING_SIZE / 2;
  const said = CATEGORY_PAGE_TEXT.summary({ name, ...summary });
  return (
    <section className="category-summary" aria-label={said}>
      <p className="sr-only">{said}</p>
      <div className="category-ring" aria-hidden="true">
        <svg viewBox={`${-h} ${-h} ${SUMMARY_RING_SIZE} ${SUMMARY_RING_SIZE}`} width={SUMMARY_RING_SIZE} height={SUMMARY_RING_SIZE} focusable="false">
          <path d={ringPath()} fillRule="evenodd" style={{ fill: SUMMARY_RING_TRACK }} className="category-ring-track" />
          {slice && (
            <path
              d={slice}
              fillRule="evenodd"
              className="category-ring-slice"
              style={{ fill: summary.color }}
              stroke={CHART_OUTLINE}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <span className="category-ring-center">
          <span className="category-ring-percent">{CATEGORY_PAGE_TEXT.percent(summary.percent)}</span>
          <span className="category-ring-caption">{CATEGORY_PAGE_TEXT.ofAll}</span>
        </span>
      </div>
      <div className="category-summary-lines" aria-hidden="true">
        <p className="category-summary-total">{CATEGORY_PAGE_TEXT.total(summary.totalMinutes)}</p>
        <p className="category-summary-week">{CATEGORY_PAGE_TEXT.week(summary.weekMinutes)}</p>
        {summary.ratioPercent !== null && <p className="category-summary-ratio">{CATEGORY_PAGE_TEXT.ratio(summary.ratioPercent)}</p>}
      </div>
    </section>
  );
}

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; data: CategoryPageData };

function composing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export function CategoryPage({
  api,
  categoryId,
  name,
  growth,
  onClose,
}: {
  api: GrowthApi;
  categoryId: string | null;
  name: string;
  /** 상태보기가 이미 가진 값(요약 카드). 분야 페이지는 이것으로 새 서버 호출을 하지 않는다 */
  growth: GrowthData;
  onClose: () => void;
}) {
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const recordedRef = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // 서버에서 읽는 일(바깥 시스템과 맞추기). 상태는 응답을 받은 뒤에만 바꾼다.
  useEffect(() => {
    let alive = true;
    void api.fetchCategoryPage(categoryId).then((res) => {
      if (alive) setLoad(res.ok ? { status: "ready", data: res.data } : { status: "error" });
    });
    return () => {
      alive = false;
    };
  }, [api, categoryId]);

  const ready = load.status === "ready";
  useEffect(() => {
    if (!ready || recordedRef.current) return;
    recordedRef.current = true;
    void api.recordView({ id: crypto.randomUUID(), screen: "category", entry: "self" });
  }, [api, ready]);

  function reload() {
    setLoad({ status: "loading" });
    void api.fetchCategoryPage(categoryId).then((res) => setLoad(res.ok ? { status: "ready", data: res.data } : { status: "error" }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !composing(event)) {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div ref={rootRef} className="detail" role="dialog" aria-modal="true" aria-labelledby="category-page-title" onKeyDown={onKeyDown}>
      <div className="detail-inner">
        {/* 고침10 A(146:10): 왼쪽 위 머리 단추 「‹」(이전). 오른쪽 위 글 「닫기」는 없다 */}
        <BackHeader onBack={onClose} />
        <div className="detail-head">
          <div className="category-head-name">
            <h2 id="category-page-title" className="detail-title" tabIndex={-1} ref={titleRef}>
              {name}
            </h2>
            {/* 색 점(23 명세 1, Figma 50:620 — 12px 원): 분야 색 + 1px 윤곽. 이름 글이 같이 있어 그림은 읽지 않는다 */}
            <span className="growth-dot category-head-dot" aria-hidden="true" style={{ background: categorySummary(growth, categoryId).color }} />
          </div>
        </div>

        {load.status === "loading" && (
          <p className="todo-sub" role="status">
            {CATEGORY_PAGE_TEXT.loading}
          </p>
        )}
        {load.status === "error" && (
          <Notice role="alert" actions={<SecondaryButton onClick={reload}>{CATEGORY_PAGE_TEXT.reload}</SecondaryButton>}>
            {CATEGORY_PAGE_TEXT.loadFailed}
          </Notice>
        )}
        {load.status === "ready" && <SummaryCard name={name} summary={categorySummary(growth, categoryId)} />}
        {load.status === "ready" && load.data.days.length === 0 && <p className="todo-sub category-empty">{CATEGORY_PAGE_TEXT.empty}</p>}
        {load.status === "ready" && <CategoryDays data={load.data} color={categorySummary(growth, categoryId).color} />}
      </div>
    </div>
  );
}

/** 날짜별: 최근 날 먼저. 날짜 머리(날짜 · 그날 이 분야 시간) → 시간 막대 → 할 일 카드(할 일이 있는 날만) */
function CategoryDays({ data, color }: { data: CategoryPageData; color: string }) {
  const longest = longestDayMinutes(data.days);
  if (data.days.length === 0) return null;
  return (
    <div className="category-days">
      {data.days.map((day) => {
        const date = dayText(describeTodoDay(day.day));
        const bar = dayBarPercent(day.minutes, longest);
        return (
          <section key={day.day} className="category-day" aria-label={date}>
            <h3 className="category-day-head" aria-label={CATEGORY_PAGE_TEXT.dayHead(date, day.minutes)}>
              <span className="category-day-date">{date}</span>
              {day.minutes > 0 && <span className="category-day-minutes">{formatMinutes(day.minutes)}</span>}
            </h3>
            {bar > 0 && (
              <div className="category-day-bar" aria-hidden="true">
                <span className="category-day-fill chart-outline" style={{ inlineSize: `${bar}%`, background: color }} />
              </div>
            )}
            {day.todos.length > 0 && (
              <ul className="category-day-card">
                {day.todos.map((todo) => (
                  <li key={todo.id} className="category-day-todo">
                    <p className="note-text">
                      {todo.text ?? CATEGORY_PAGE_TEXT.unreadable}
                      {todo.done && <span className="category-tag done-tag">{CATEGORY_PAGE_TEXT.done}</span>}
                    </p>
                    {todo.notes.length === 0 ? (
                      <p className="todo-sub">{CATEGORY_PAGE_TEXT.noNote}</p>
                    ) : (
                      <ul className="note-sublist">
                        {todo.notes.map((note) => (
                          <li key={note.id} className="note-text">
                            {note.readable ? note.text : CATEGORY_PAGE_TEXT.unreadableNote}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
