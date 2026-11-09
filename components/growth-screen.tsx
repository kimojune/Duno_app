"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { minutesOf } from "../lib/growth/logic";
import { buildGoalChart, buildStatusChart, type ChartCategoryId, type GoalChart, type StatusChart } from "../lib/growth/status-chart";
import {
  DEFAULT_STATUS_PREF,
  initialStatusPeriod,
  initialStatusTab,
  parseStatusPref,
  STATUS_PERIODS,
  STATUS_TABS,
  type StatusPeriod,
  type StatusPref,
  type StatusTab,
} from "../lib/growth/status-view-pref";
import type { GrowthData } from "../lib/growth/types";
import type { GrowthApi } from "../lib/growth-api";
import { formatDeltaMinutes, formatMinutes } from "../lib/time-format";
import type { ViewEntry } from "../lib/views/core-types";
import { EVENING_TEXT } from "./evening-record";
import { GOAL_TEXT } from "./goal";
import { visibleStreak } from "../lib/growth/streak";
import { PeriodMenu } from "./growth-period-menu";
import { GoalBars, GoalExample, ratioOf, RowChevron, STATUS_VIEWS } from "./growth-views";
import { Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";
import { Wordmark } from "./wordmark";

/**
 * 상태보기(성장 화면, PRD 7-4). 원샷 v2 고침5: 뷰 둘(PM d-99·d-101·d-102, 의견 8, 덧붙임 d-110 — 명세 ③-S, ⑩이 본문보다 이김).
 * 고침9(Figma 정합 A5 · S6 공통, Figma 50:137·50:193·50:260·50:598·50:741·51:107·111:79·121:240·121:315):
 * - 맨 위 = 워드마크(고리 18 + 「duno」) → 목표 한 줄 → 뷰 탭. 보이는 큰 제목 「상태보기」는 없고, 화면 읽기용 숨은 제목 h1만 둔다(페이지 제목 구조).
 * - 탭 바로 아래가 카드다(카드 위 머리 줄 「이번 주 내 시간이 …」·「오늘 기록 n일」 없음). 기간은 카드 머리 합계 옆 칩 하나(PeriodMenu).
 * - 목록 줄마다 오른쪽 「›」(숨김), 카드 아래 연속 기록 줄 「◯ n주 이어서 기록」(2주 이상만, 명세 ⑦-9).
 * - 빈 상태의 「오늘 기록」은 카드 안 끝 폭 가득 보조 단추. 카드 밖 안내 글은 없다(⑬ 20).
 * - 맨 위(워드마크 아래·뷰 탭 위): 처음 설정에서 받은 목표 한 문장(두 뷰 공통). 비었으면 줄을 두지 않는다. 모자란 분야 큰 글·숫자 줄은 없다(PM 8).
 * - 뷰 탭 둘(role=tablist): 「이번 주 목표」(시간·분야별 막대) / 「목표 비율」(%·띠그래프/원그래프).
 *   처음 탭은 이번 주 목표를 세운 주 → 이번 주 목표, 세우지 않은 주 → 목표 비율. 고른 탭은 그 주 동안 이 기기·이 사용자에 기억한다(api.viewPref).
 * - 이번 주 목표 뷰: 흰 카드 「목표 15시간 중 12시간」(lib/goals goalProgress) + 분야별 막대. 칩 없음, 기간은 이번 주만. 목표가 없는 주는 카드 안에 예시 → 보조 줄 → 「이번 주 목표 정하기」(고침6).
 * - 목표 비율 뷰: 흰 카드 합계 · 기간 칩(이번 주 / 총 시간 / 비교) · 글 단추 하나로 띠그래프 ↔ 원그래프(D-049). 「비교」는 D-093의 옛 보기(결정 대기).
 *   빈 상태(고침7, PM 15:1x)도 같은 머리(합계 · 칩 · 글 단추)를 둔다. 이번 주 0시간이고 쌓인 시간이 있으면 「총 시간」으로 시작해 머리 아래 「이번 주 0시간」.
 * - 「채울 시간」 카드·놓친 분야 문장·「쌓인 것」·살구 강조는 없다(PM 8). 재촉·평가·경고 색 없이 숫자로(D-141).
 * - 카드 앞에 숨은 요약 한 줄(화면 읽기, INF-05). 분야 줄을 누르면 그 분야의 페이지로 간다(G13-a).
 * - 화면이 그려지면 본 것을 한 번 남긴다(입구별: 탭으로 연 것 self, 오늘 기록 저장 직후의 한 줄 after_save, G8).
 * 탭이 보일 때마다 다시 읽는다. 모든 글(목표 한 줄·분야 이름은 사용자 글)은 React 텍스트로만 그린다.
 */

/** 「목표 15시간 중 0시간」: 목표는 시간 단위라 0도 「0시간」(명세 ③-S 공통 기록 없음 예). 0이 아니면 formatMinutes 그대로 */
const goalHours = (minutes: number) => (minutes > 0 ? formatMinutes(minutes) : "0시간");

export const GROWTH_TEXT = {
  title: "상태보기",
  goalLinePrefix: "목표, ", // 화면 읽기만: 「목표, {문장}」(이름표는 보이지 않는다, PM 8)
  tabsLabel: "상태보기 뷰",
  tabGoal: "이번 주 목표",
  tabRatio: "목표 비율",
  periodGroup: "기간",
  modeWeek: "이번 주", // PM 확정 11-09(기간 이름)
  modeTotal: "총 시간",
  modeCompare: "비교",
  toPie: "원그래프로 보기", // d-106 ⑦-10, D-049(칩 아님)
  toBand: "띠그래프로 보기",
  other: "기타",
  // 고침9(Figma 정합 S6 공통): 카드 위 머리 줄(「이번 주 내 시간이 어느 분야에 쓰였나」·「분야마다 쌓인 시간」·「오늘 기록 n일」)과
  // 카드 밖 빈 안내 글(「아직 이번 주 오늘 기록이 없어요. …」, ⑬ 20 — PM d-143 가)은 없앴다. 탭 바로 아래가 카드다
  /** 카드 아래 연속 기록 줄(명세 ⑦-9): 「**3주** 이어서 기록」(숫자 Bold) */
  streak: (weeks: number) => ({ count: `${weeks}주`, rest: " 이어서 기록" }),
  ratioLine: "목표 비율",
  percent: (n: number) => `${n}%`,
  ratioValue: (spent: number, ratio: number | null) => (ratio === null ? `${spent}%` : `${spent}% / 목표 ${ratio}%`),
  // 이번 주 목표 뷰
  goalHead: (target: number, done: number) => ({ before: "목표 ", target: goalHours(target), middle: " 중 ", done: goalHours(done) }),
  // 0은 「0시간」(고침9, Figma 51:107 「0시간 · 6시간 더」 — 머리 「목표 15시간 중 0시간」과 같은 규칙)
  goalValue: (spent: number, remaining: number) => (remaining > 0 ? `${goalHours(spent)} · ${formatMinutes(remaining)} 더` : goalHours(spent)),
  goalOf: (goal: number | null) => (goal === null ? "목표 없음" : `목표 ${formatMinutes(goal)}`),
  legendGoal: "목표",
  legendGap: "빈 자리",
  goalSetHint: "분야마다 시간 · 1시간 단위", // 목표 없는 주 카드: 예시 막대 아래 · 단추 바로 위(고침6 ②)
  example: "예시",
  zero: "0시간",
  weekZero: "이번 주 0시간", // 목표 비율 뷰가 이번 주 0시간이라 「총 시간」으로 견줄 때 머리 아래 한 줄(고침7 ①)
  // 화면 읽기 요약(카드 앞 숨은 글 하나, 순서는 화면 줄 순서와 같다)
  goalSummaryHead: (target: number, done: number) => `이번 주 목표 ${goalHours(target)} 중 ${goalHours(done)}.`,
  goalSummaryRow: (name: string, spent: number, goal: number | null, remaining: number, other: boolean) =>
    other
      ? `${name} ${formatMinutes(spent)}.`
      : goal === null
        ? `${name} ${formatMinutes(spent)}, 목표 없음.`
        : remaining > 0
          ? `${name} ${goalHours(spent)}, 목표 ${formatMinutes(goal)}, ${formatMinutes(remaining)} 더.`
          : `${name} ${formatMinutes(spent)}, 목표 ${formatMinutes(goal)}.`,
  ratioSummaryHead: (period: string, total: number) => `목표 비율과 견준 ${period}. ${goalHours(total)}.`,
  ratioSummaryWeekZero: "이번 주 0시간.",
  ratioSummaryRow: (name: string, spent: number, ratio: number | null) => (ratio === null ? `${name} ${spent}%.` : `${name} ${spent}%, 목표 ${ratio}%.`),
  // 비교(D-093의 옛 보기, 결정 대기 — 꼴은 그대로, 「쌓인 것」은 기간 이름 「총 시간」으로)
  thisWeek: "이번 주",
  lastWeek: "지난주",
  lastMonth: "지난달",
  cumulative: "총 시간",
  vsLastWeek: "지난주보다",
  loading: "상태보기를 불러오는 중",
  loadFailed: "상태보기를 불러오지 못했어요.",
  reload: "다시 불러오기",
} as const;

const VIEW_IDS = STATUS_VIEWS.map((v) => v.id);
const PERIOD_LABEL: Record<StatusPeriod, "modeWeek" | "modeTotal" | "modeCompare"> = { week: "modeWeek", total: "modeTotal", compare: "modeCompare" };
const TAB_LABEL: Record<StatusTab, "tabGoal" | "tabRatio"> = { goal: "tabGoal", ratio: "tabRatio" };
const tabId = (t: StatusTab) => `growth-tab-${t}`;
const panelId = (t: StatusTab) => `growth-panel-${t}`;
/** 기억한 값을 기다리는 가장 긴 시간(ms). 넘으면 처음 값으로 그린다 */
const PREF_WAIT_MS = 800;

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; data: GrowthData };

/** 이번 주 목표를 세운 주인가(목표 항목이 하나 이상) */
export function hasWeekGoal(data: GrowthData): boolean {
  return data.goal !== null && data.goal.items.length > 0;
}

export function GrowthScreen({
  api,
  active,
  activation,
  entry,
  onOpenCategory,
  onOpenEvening,
  onOpenGoal,
  refreshKey = 0,
  openByGoal = false,
}: {
  api: GrowthApi;
  /** 이 탭이 지금 보이는가 */
  active: boolean;
  /** 탭을 열 때마다 하나씩 커지는 값(열 때마다 다시 읽고 본 것을 한 번 남긴다) */
  activation: number;
  entry: ViewEntry;
  /** 분야를 누르면. growth = 지금 그린 GrowthData(분야 페이지 요약 카드가 새 서버 호출 없이 쓴다, 고침8) */
  onOpenCategory: (categoryId: string | null, name: string, growth: GrowthData) => void;
  /** 이번 주 기록이 없을 때 빈 자리의 「오늘 기록」(B17). 없으면 단추를 그리지 않는다 */
  onOpenEvening?: () => void;
  /** 목표를 세우지 않은 주의 이번 주 목표 뷰 「이번 주 목표 정하기」. 없으면 단추를 그리지 않는다 */
  onOpenGoal?: (data: GrowthData) => void;
  /** 바뀌면 다시 읽는다(본 것은 다시 남기지 않는다). 목표를 저장한 뒤 등 */
  refreshKey?: number;
  /**
   * 오늘 기록 저장 직후 「상태보기에서 보기 ›」로 열었나(고침9, 23 흐름도 135:2). true면 이번 열림(activation)에서는 기억한 탭보다
   * 목표 유무로 정한 탭이 먼저다: 목표 세운 주 → 「이번 주 목표」, 없는 주 → 「목표 비율」. 그 열림에서 사용자가 탭을 고르면 고른 것.
   */
  openByGoal?: boolean;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [pref, setPref] = useState<StatusPref>(DEFAULT_STATUS_PREF);
  // 기억한 값을 쓸 수 없는 구현(viewPref 없음)이면 기다릴 것이 없다
  const [prefReady, setPrefReady] = useState(() => !api.viewPref);
  const touchedRef = useRef(false);
  const recordedRef = useRef(-1);
  const tabRefs = useRef<Record<StatusTab, HTMLButtonElement | null>>({ goal: null, ratio: null });

  // 기억한 탭·기간·보기 방식을 한 번 읽는다(이 기기·이 사용자). 못 읽거나 늦으면 처음 값으로 그린다. 읽기 전에 사용자가 이미 골랐으면 고른 것이 이긴다.
  useEffect(() => {
    const store = api.viewPref;
    if (!store) return;
    let alive = true;
    // 기다리는 시간을 넘겨 이미 처음 값으로 그린 뒤에 온 값은 무시한다(읽고 있는 화면이 갑자기 다른 보기로 바뀌지 않게. 다음에 열 때 반영된다)
    let late = false;
    const settle = () => {
      if (alive) setPrefReady(true);
    };
    const timer = setTimeout(() => {
      late = true;
      settle();
    }, PREF_WAIT_MS);
    Promise.resolve()
      .then(() => store.load())
      .then(
        (raw) => {
          if (alive && !late && !touchedRef.current) setPref(parseStatusPref(raw, VIEW_IDS));
        },
        () => {},
      )
      .finally(() => {
        clearTimeout(timer);
        settle();
      });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api]);

  function choose(next: StatusPref) {
    touchedRef.current = true;
    setPref(next);
    const store = api.viewPref;
    if (store) void Promise.resolve().then(() => store.save(next)).catch(() => {});
  }

  // 탭이 보일 때마다 서버에서 다시 읽는다(바깥 시스템과 맞추기). 상태는 응답을 받은 뒤에만 바꾼다. 읽는 동안 옛 값은 그대로 둔다.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void api.fetchGrowth().then((res) => {
      if (!alive) return;
      if (res.ok) setLoad({ status: "ready", data: res.data });
      else setLoad((prev) => (prev.status === "ready" ? prev : { status: "error" }));
    });
    return () => {
      alive = false;
    };
  }, [api, active, activation, refreshKey]);

  // 화면이 실제로 그려진 때 한 번(탭을 연 횟수마다). 그리지 못한(읽기 실패) 때는 세지 않는다.
  const ready = load.status === "ready";
  useEffect(() => {
    if (!active || !ready || recordedRef.current === activation) return;
    recordedRef.current = activation;
    void api.recordView({ id: crypto.randomUUID(), screen: "growth", entry });
  }, [api, active, ready, activation, entry]);

  function reload() {
    setLoad({ status: "loading" });
    void api.fetchGrowth().then((res) => setLoad(res.ok ? { status: "ready", data: res.data } : { status: "error" }));
  }

  const data = load.status === "ready" ? load.data : null;
  // openByGoal: 이 열림에서 사용자가 탭을 고르기 전까지만(고른 열림 번호를 둔다)
  const [pickedAt, setPickedAt] = useState<number | null>(null);
  const byGoal = openByGoal && pickedAt !== activation;
  const tab: StatusTab | null = data ? (byGoal ? (hasWeekGoal(data) ? "goal" : "ratio") : initialStatusTab(pref, data.weekStart, hasWeekGoal(data))) : null;

  function selectTab(next: StatusTab, focus: boolean) {
    if (!data) return;
    setPickedAt(activation);
    choose({ ...pref, tab: next, tabWeek: data.weekStart });
    if (focus) tabRefs.current[next]?.focus();
  }

  // 탭 키보드(APG 탭 꼴, 고르면 바로 바뀜): 좌우 화살표로 옆 탭(끝에서 돌아감), Home·End로 처음·끝 탭
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!tab) return;
    const i = STATUS_TABS.indexOf(tab);
    const n = STATUS_TABS.length;
    const next =
      event.key === "ArrowRight" ? STATUS_TABS[(i + 1) % n] : event.key === "ArrowLeft" ? STATUS_TABS[(i - 1 + n) % n] : event.key === "Home" ? STATUS_TABS[0] : event.key === "End" ? STATUS_TABS[n - 1] : null;
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  }

  return (
    <section className="growth" aria-labelledby="growth-title" aria-busy={load.status === "loading"}>
      <header className="growth-head">
        <h1 id="growth-title" className="sr-only">
          {GROWTH_TEXT.title}
        </h1>
        <Wordmark className="growth-wordmark" />
      </header>
      {data && data.goalText && (
        <p className="growth-goal-line">
          <span className="sr-only">{GROWTH_TEXT.goalLinePrefix}</span>
          {data.goalText}
        </p>
      )}
      {(load.status === "loading" || (load.status === "ready" && !prefReady)) && (
        <div className="growth-body">
          <p className="todo-sub" role="status">
            {GROWTH_TEXT.loading}
          </p>
        </div>
      )}
      {load.status === "error" && (
        <div className="growth-body">
          <Notice role="alert" actions={<SecondaryButton onClick={reload}>{GROWTH_TEXT.reload}</SecondaryButton>}>
            {GROWTH_TEXT.loadFailed}
          </Notice>
        </div>
      )}
      {data && tab && prefReady && (
        <>
          <div className="growth-tabs" role="tablist" aria-label={GROWTH_TEXT.tabsLabel} onKeyDown={onTabKey}>
            {STATUS_TABS.map((t) => (
              <button
                key={t}
                ref={(el) => {
                  tabRefs.current[t] = el;
                }}
                type="button"
                role="tab"
                id={tabId(t)}
                className="growth-tab"
                aria-selected={tab === t}
                aria-controls={tab === t ? panelId(t) : undefined}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => selectTab(t, false)}
              >
                {GROWTH_TEXT[TAB_LABEL[t]]}
              </button>
            ))}
          </div>
          <div className="growth-body" role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
            {tab === "goal" ? (
              <GoalPanel data={data} onOpenCategory={(id, name) => onOpenCategory(id, name, data)} onOpenEvening={onOpenEvening} onOpenGoal={onOpenGoal} />
            ) : (
              <RatioPanel data={data} pref={pref} choose={choose} onOpenCategory={(id, name) => onOpenCategory(id, name, data)} onOpenEvening={onOpenEvening} />
            )}
            <StreakLine weeks={data.streakWeeks} />
          </div>
        </>
      )}
    </section>
  );
}

function nameFor(data: GrowthData, id: string | null): string {
  return id === null ? GROWTH_TEXT.other : (data.categories.find((c) => c.id === id)?.name ?? GROWTH_TEXT.other);
}

/** 기록 없음의 빈 상태 단추 「오늘 기록」(누르면 오늘 기록이 열린다). 카드 안 끝, 폭 가득 보조 단추(테두리, 보이는 높이 40 — Figma 51:24·111:149) */
function EveningButton({ onOpenEvening }: { onOpenEvening?: () => void }) {
  if (!onOpenEvening) return null;
  return (
    <div className="growth-evening">
      <SecondaryButton className="growth-evening-button" onClick={onOpenEvening}>
        <span className="growth-evening-face">{EVENING_TEXT.title}</span>
      </SecondaryButton>
    </div>
  );
}

/**
 * 카드 아래 연속 기록 한 줄(명세 ⑦-9, Figma 60:4~60:6): 보조색 고리 14 + 「**3주** 이어서 기록」(14, 숫자 Bold).
 * 2주 이상일 때만 그린다. 끊기면 줄이 조용히 사라진다(알림·「끊겼어요」·경고 색 없음)
 */
function StreakLine({ weeks }: { weeks: number }) {
  const n = visibleStreak(weeks);
  if (n === null) return null;
  const text = GROWTH_TEXT.streak(n);
  return (
    <p className="growth-streak">
      <svg className="growth-streak-ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="3" />
      </svg>
      <span>
        <strong className="growth-streak-count">{text.count}</strong>
        {text.rest}
      </span>
    </p>
  );
}

/** 이번 주 목표 뷰의 화면 읽기 요약(줄 순서 = 화면 줄 순서) */
export function goalSummary(chart: GoalChart, nameOf: (id: ChartCategoryId) => string): string {
  return [
    GROWTH_TEXT.goalSummaryHead(chart.targetMinutes, chart.doneMinutes),
    ...chart.rows.map((r) => GROWTH_TEXT.goalSummaryRow(nameOf(r.categoryId), r.spentMinutes, r.goalMinutes, r.remainingMinutes, r.categoryId === null)),
  ].join(" ");
}

/**
 * 목표 비율 뷰의 화면 읽기 요약(줄 순서 = 화면 줄 순서)
 * @param weekZero 이번 주 0시간이라 「총 시간」으로 견주는가(머리 아래 「이번 주 0시간」 줄과 같이 읽는다)
 */
export function ratioSummary(chart: StatusChart, periodName: string, nameOf: (id: ChartCategoryId) => string, weekZero = false): string {
  return [
    GROWTH_TEXT.ratioSummaryHead(periodName, chart.spentTotalMinutes),
    ...(weekZero ? [GROWTH_TEXT.ratioSummaryWeekZero] : []),
    ...chart.rows.map((r) => GROWTH_TEXT.ratioSummaryRow(nameOf(r.categoryId), r.spentPercent, ratioOf(chart, r.categoryId))),
  ].join(" ");
}

/** 이번 주 목표 뷰 */
function GoalPanel({
  data,
  onOpenCategory,
  onOpenEvening,
  onOpenGoal,
}: {
  data: GrowthData;
  onOpenCategory: (id: string | null, name: string) => void;
  onOpenEvening?: () => void;
  onOpenGoal?: (data: GrowthData) => void;
}) {
  if (!hasWeekGoal(data) || !data.goal) {
    // 목표를 세우지 않은 주(고침6 ②, Figma 50:741): 흰 카드 하나 안에 위→아래 = 이름표 「예시」 + 흐린 막대 둘 → 「분야마다 시간 · 1시간 단위」(가운데)
    // → 「이번 주 목표 정하기」 주 단추(폭 가득, 카드 끝). 무엇이 채워질지 먼저 보이고 행동은 끝에 온다. 주 단추는 하나
    return (
      <div className="growth-goal-set">
        <GoalExample label={GROWTH_TEXT.example} goalOf={GROWTH_TEXT.goalOf} />
        <p className="growth-goal-hint">{GROWTH_TEXT.goalSetHint}</p>
        {onOpenGoal && (
          <PrimaryButton className="growth-goal-set-button" onClick={() => onOpenGoal(data)}>
            {GOAL_TEXT.set}
          </PrimaryButton>
        )}
      </div>
    );
  }
  const categoryIds = data.categories.map((c) => c.id);
  const chart = buildGoalChart({ categoryIds, goalItems: data.goal.items, totals: data.thisWeek });
  const nameOf = (id: ChartCategoryId) => nameFor(data, id);
  const head = GROWTH_TEXT.goalHead(chart.targetMinutes, chart.doneMinutes);
  const noRecord = data.thisWeek.every((t) => !(t.minutes > 0));
  return (
    <>
      <p className="sr-only">{goalSummary(chart, nameOf)}</p>
      <div className="growth-card">
        <div className="growth-card-head" aria-hidden="true">
          <p className="growth-card-title">
            {head.before}
            {head.target}
            {head.middle}
            {head.done}
          </p>
        </div>
        <GoalBars
          chart={chart}
          text={GROWTH_TEXT}
          colorOrder={(id) => categoryIds.indexOf(id)}
          nameOf={nameOf}
          onOpenCategory={onOpenCategory}
        />
        {/* 목표를 세운 주 · 기록 없음(Figma 51:107): 막대는 모두 빈 칸. 「오늘 기록」은 빈 상태 공통 자리(카드 안 끝)에 둔다 — 51:107 그림에는 단추가 없다(보고에 적음) */}
        {noRecord && <EveningButton onOpenEvening={onOpenEvening} />}
      </div>
    </>
  );
}

/**
 * 목표 비율 뷰: 카드 머리(합계 · 기간 칩 · 보기 바꾸기 글 단추) + 띠/원 + 목록. 「비교」는 옛 보기.
 * 빈 상태는 셋(고침7, PM 15:1x · 23 S6 빈 상태):
 * 1) 이번 주 0시간 + 쌓인 시간 있음 → 「총 시간」으로 시작(칩에서 이번 주를 고르지 않았다면), 머리 아래 「이번 주 0시간」, 카드 끝 「오늘 기록」
 * 2) 고른 기간에 기록 0 → 같은 머리(「0시간」 · 기간 칩 · 글 단추) + 예시 값(목표 비율 띠 + 빈 띠 「0시간」) + 카드 안 끝 「오늘 기록」(카드 밖 안내 글 없음, 고침9)
 * 3) 2)에서 원그래프 → 왼쪽 목표 비율 원 + 오른쪽 회색 빈 고리 「0시간」. 1)의 원그래프는 오른쪽이 「총 시간」 원
 */
function RatioPanel({
  data,
  pref,
  choose,
  onOpenCategory,
  onOpenEvening,
}: {
  data: GrowthData;
  pref: StatusPref;
  choose: (next: StatusPref) => void;
  onOpenCategory: (id: string | null, name: string) => void;
  onOpenEvening?: () => void;
}) {
  const categoryIds = data.categories.map((c) => c.id);
  // 두 기간의 그림 값(지금 앱의 이번 주 · 총 시간 계산 그대로). 처음 기간은 두 합계로 정한다
  const weekChart = buildStatusChart({ categoryIds, ratios: data.ratios, totals: data.thisWeek });
  const totalChart = buildStatusChart({ categoryIds, ratios: data.ratios, totals: data.cumulative });
  const period = initialStatusPeriod(pref, data.weekStart, { week: weekChart.spentTotalMinutes, total: totalChart.spentTotalMinutes });
  const compare = period === "compare";
  const week = period === "week";
  const chart = week ? weekChart : totalChart;
  const viewIndex = Math.max(0, STATUS_VIEWS.findIndex((v) => v.id === pref.view));
  const view = STATUS_VIEWS[viewIndex];
  const nextView = STATUS_VIEWS[(viewIndex + 1) % STATUS_VIEWS.length];
  const nameOf = (id: ChartCategoryId) => nameFor(data, id);
  const periodName = GROWTH_TEXT[PERIOD_LABEL[period]];
  const View = view.Component;
  const Empty = view.Empty;
  // 기록 없음(이 기간에 쓴 시간 0): 글 대신 예시 값 — 목표 비율 띠/원 + 빈 띠/빈 고리 「0시간」 + 「오늘 기록」 단추. 목표 비율이 없으면 그림 없이 단추만(창구 덧붙임 11-09 11:3x)
  const empty = !compare && chart.spentTotalMinutes === 0;
  // 이번 주는 비었는데 쌓인 시간으로 견주는 중(경우 1): 머리 아래 「이번 주 0시간」, 카드 끝 「오늘 기록」
  const weekZero = period === "total" && !empty && weekChart.spentTotalMinutes === 0;
  // 보기 바꾸기 단추는 빈 상태에도 같은 자리에. 다만 그릴 그림이 없으면(목표 비율도 기록도 없음) 바꿀 것이 없어 두지 않는다
  const canSwitch = !compare && !(empty && chart.ratioEmpty);
  return (
    <>
      {!compare && <p className="sr-only">{ratioSummary(chart, periodName, nameOf, weekZero)}</p>}
      <div className="growth-card">
        {/* 카드 머리 한 줄(Figma 50:208·50:212·60:8): 합계(16 Bold) · 기간 칩 「이번 주 ▾」 · 오른쪽 끝 보기 바꾸기 글 단추(누름 48) */}
        <div className="growth-card-head growth-ratio-head">
          {!compare && (
            <p className="growth-card-total" aria-hidden="true">
              {empty ? GROWTH_TEXT.zero : formatMinutes(chart.spentTotalMinutes)}
            </p>
          )}
          <PeriodMenu
            value={period}
            options={STATUS_PERIODS}
            labelOf={(p) => GROWTH_TEXT[PERIOD_LABEL[p]]}
            groupLabel={GROWTH_TEXT.periodGroup}
            onSelect={(p) => choose({ ...pref, period: p, periodWeek: data.weekStart })}
          />
          {canSwitch && (
            <TextButton className="growth-switch text-tap" onClick={() => choose({ ...pref, view: nextView.id })}>
              {GROWTH_TEXT[view.switchLabel]}
            </TextButton>
          )}
        </div>
        {weekZero && (
          <p className="growth-week-zero" aria-hidden="true">
            {GROWTH_TEXT.weekZero}
          </p>
        )}
        {compare ? (
          <CompareView data={data} onOpenCategory={onOpenCategory} />
        ) : empty ? (
          <Empty chart={chart} text={GROWTH_TEXT} periodName={periodName} zeroText={GROWTH_TEXT.zero} nameOf={nameOf} onOpenCategory={onOpenCategory} />
        ) : (
          <View chart={chart} text={GROWTH_TEXT} periodName={periodName} nameOf={nameOf} onOpenCategory={onOpenCategory} />
        )}
        {(weekZero || empty) && <EveningButton onOpenEvening={onOpenEvening} />}
      </div>
    </>
  );
}

function CompareView({ data, onOpenCategory }: { data: GrowthData; onOpenCategory: (id: string | null, name: string) => void }) {
  const rows = [...data.categories.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: GROWTH_TEXT.other }];
  return (
    <ul className="growth-list is-compare">
      {rows.map((r) => {
        const now = minutesOf(data.thisWeek, r.id);
        const last = minutesOf(data.lastWeek, r.id);
        return (
          <li key={r.id ?? "other"} className="growth-item">
            <button type="button" className="growth-compare" onClick={() => onOpenCategory(r.id, r.name)}>
              <span className="growth-name">{r.name}</span>
              <dl className="growth-dl">
                <div>
                  <dt>{GROWTH_TEXT.thisWeek}</dt>
                  <dd>{formatMinutes(now)}</dd>
                </div>
                <div>
                  <dt>{GROWTH_TEXT.lastWeek}</dt>
                  <dd>{formatMinutes(last)}</dd>
                </div>
                <div>
                  <dt>{GROWTH_TEXT.lastMonth}</dt>
                  <dd>{formatMinutes(minutesOf(data.lastMonth, r.id))}</dd>
                </div>
                <div>
                  <dt>{GROWTH_TEXT.cumulative}</dt>
                  <dd>{formatMinutes(minutesOf(data.cumulative, r.id))}</dd>
                </div>
              </dl>
              <span className="todo-sub">
                {GROWTH_TEXT.vsLastWeek} {formatDeltaMinutes(now - last)}
              </span>
              <RowChevron />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
