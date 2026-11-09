"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { minutesOf } from "../lib/growth/logic";
import { buildGoalChart, buildStatusChart, fillTimeFor, type ChartCategoryId, type GoalChart, type StatusChart } from "../lib/growth/status-chart";
import {
  DEFAULT_STATUS_PREF,
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
import { EmptyBands, GoalBars, GoalExample, ratioOf, STATUS_VIEWS } from "./growth-views";
import { Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";

/**
 * 상태보기(성장 화면, PRD 7-4). 원샷 v2 고침5: 뷰 둘(PM d-99·d-101·d-102, 의견 8, 덧붙임 d-110 — 명세 ③-S, ⑩이 본문보다 이김).
 * - 맨 위(제목 아래·뷰 탭 위): 처음 설정에서 받은 목표 한 문장(두 뷰 공통). 비었으면 줄을 두지 않는다. 모자란 분야 큰 글·숫자 줄은 없다(PM 8).
 * - 뷰 탭 둘(role=tablist): 「이번 주 목표」(시간·분야별 막대) / 「목표 비율」(%·띠그래프/원그래프).
 *   처음 탭은 이번 주 목표를 세운 주 → 이번 주 목표, 세우지 않은 주 → 목표 비율. 고른 탭은 그 주 동안 이 기기·이 사용자에 기억한다(api.viewPref).
 * - 이번 주 목표 뷰: 흰 카드 「목표 15시간 중 12시간」(lib/goals goalProgress) + 분야별 막대. 칩 없음, 기간은 이번 주만. 목표가 없는 주는 카드 안에 예시 → 보조 줄 → 「이번 주 목표 정하기」(고침6).
 * - 목표 비율 뷰: 흰 카드 합계 · 기간 칩(이번 주 / 총 시간 / 비교) · 글 단추 하나로 띠그래프 ↔ 원그래프(D-049). 「비교」는 D-093의 옛 보기(결정 대기).
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
  weekHeading: "이번 주 내 시간이 어느 분야에 쓰였나", // 안내 글(PM 11-09 11:1x 「설명 글 지우지 않기」로 남김)
  totalHeading: "분야마다 쌓인 시간",
  compareHeading: "분야마다 나란히",
  days: (n: number) => `오늘 기록 ${n}일`,
  empty: "아직 이번 주 오늘 기록이 없어요. 오늘 기록을 남기면 여기에 쌓여요.", // 이번 주 빈 안내(지우기는 발표 뒤 PM 7, 지금은 옛 이름만 「오늘 기록」으로)
  emptyTotal: "아직 오늘 기록이 없어요. 오늘 기록을 남기면 여기에 쌓여요.",
  ratioLine: "목표 비율",
  percent: (n: number) => `${n}%`,
  ratioValue: (spent: number, ratio: number | null) => (ratio === null ? `${spent}%` : `${spent}% / 목표 ${ratio}%`),
  // 이번 주 목표 뷰
  goalHead: (target: number, done: number) => ({ before: "목표 ", target: goalHours(target), middle: " 중 ", done: goalHours(done) }),
  goalValue: (spent: number, remaining: number) => (remaining > 0 ? `${formatMinutes(spent)} · ${formatMinutes(remaining)} 더` : formatMinutes(spent)),
  goalOf: (goal: number | null) => (goal === null ? "목표 없음" : `목표 ${formatMinutes(goal)}`),
  legendGoal: "목표",
  legendGap: "빈 자리",
  goalSetHint: "분야마다 시간 · 1시간 단위", // 목표 없는 주 카드: 예시 막대 아래 · 단추 바로 위(고침6 ②)
  example: "예시",
  zero: "0시간",
  // 화면 읽기 요약(카드 앞 숨은 글 하나, 순서는 화면 줄 순서와 같다)
  goalSummaryHead: (target: number, done: number) => `이번 주 목표 ${goalHours(target)} 중 ${goalHours(done)}.`,
  goalSummaryRow: (name: string, spent: number, goal: number | null, remaining: number, other: boolean) =>
    other
      ? `${name} ${formatMinutes(spent)}.`
      : goal === null
        ? `${name} ${formatMinutes(spent)}, 목표 없음.`
        : remaining > 0
          ? `${name} ${formatMinutes(spent)}, 목표 ${formatMinutes(goal)}, ${formatMinutes(remaining)} 더.`
          : `${name} ${formatMinutes(spent)}, 목표 ${formatMinutes(goal)}.`,
  ratioSummaryHead: (period: string, total: number) => `목표 비율과 견준 ${period}. ${goalHours(total)}.`,
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

/** 저장 직후 한 줄(오늘 기록 화면, AfterSaveShortfall)의 글. 상태보기 화면 글이 아니다. 분야 줄 아래 「2시간 30분 더」(고침6 ④-①, 「채울 시간」 제목은 없앰) */
export const AFTER_SAVE_TEXT = { more: (minutes: number) => `${formatMinutes(minutes)} 더` } as const;

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
}: {
  api: GrowthApi;
  /** 이 탭이 지금 보이는가 */
  active: boolean;
  /** 탭을 열 때마다 하나씩 커지는 값(열 때마다 다시 읽고 본 것을 한 번 남긴다) */
  activation: number;
  entry: ViewEntry;
  onOpenCategory: (categoryId: string | null, name: string) => void;
  /** 이번 주 기록이 없을 때 빈 자리의 「오늘 기록」(B17). 없으면 단추를 그리지 않는다 */
  onOpenEvening?: () => void;
  /** 목표를 세우지 않은 주의 이번 주 목표 뷰 「이번 주 목표 정하기」. 없으면 단추를 그리지 않는다 */
  onOpenGoal?: (data: GrowthData) => void;
  /** 바뀌면 다시 읽는다(본 것은 다시 남기지 않는다). 목표를 저장한 뒤 등 */
  refreshKey?: number;
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
  const tab: StatusTab | null = data ? initialStatusTab(pref, data.weekStart, hasWeekGoal(data)) : null;

  function selectTab(next: StatusTab, focus: boolean) {
    if (!data) return;
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
      <header className="today-header">
        <div>
          <h1 id="growth-title" className="today-title">
            {GROWTH_TEXT.title}
          </h1>
        </div>
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
              <GoalPanel data={data} onOpenCategory={onOpenCategory} onOpenEvening={onOpenEvening} onOpenGoal={onOpenGoal} />
            ) : (
              <RatioPanel data={data} pref={pref} choose={choose} onOpenCategory={onOpenCategory} onOpenEvening={onOpenEvening} />
            )}
          </div>
        </>
      )}
    </section>
  );
}

function nameFor(data: GrowthData, id: string | null): string {
  return id === null ? GROWTH_TEXT.other : (data.categories.find((c) => c.id === id)?.name ?? GROWTH_TEXT.other);
}

/** 기록 없음의 빈 상태 단추 「오늘 기록」(누르면 오늘 기록이 열린다) */
function EveningButton({ onOpenEvening }: { onOpenEvening?: () => void }) {
  if (!onOpenEvening) return null;
  return (
    <div className="detail-actions">
      <SecondaryButton onClick={onOpenEvening}>{EVENING_TEXT.title}</SecondaryButton>
    </div>
  );
}

/** 이번 주 목표 뷰의 화면 읽기 요약(줄 순서 = 화면 줄 순서) */
export function goalSummary(chart: GoalChart, nameOf: (id: ChartCategoryId) => string): string {
  return [
    GROWTH_TEXT.goalSummaryHead(chart.targetMinutes, chart.doneMinutes),
    ...chart.rows.map((r) => GROWTH_TEXT.goalSummaryRow(nameOf(r.categoryId), r.spentMinutes, r.goalMinutes, r.remainingMinutes, r.categoryId === null)),
  ].join(" ");
}

/** 목표 비율 뷰의 화면 읽기 요약(줄 순서 = 화면 줄 순서) */
export function ratioSummary(chart: StatusChart, periodName: string, nameOf: (id: ChartCategoryId) => string): string {
  return [
    GROWTH_TEXT.ratioSummaryHead(periodName, chart.spentTotalMinutes),
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
            <strong>{head.target}</strong>
            {head.middle}
            <strong>{head.done}</strong>
          </p>
        </div>
        <GoalBars
          chart={chart}
          text={GROWTH_TEXT}
          colorOrder={(id) => categoryIds.indexOf(id)}
          nameOf={nameOf}
          onOpenCategory={onOpenCategory}
        />
      </div>
      {noRecord && <EveningButton onOpenEvening={onOpenEvening} />}
    </>
  );
}

/** 목표 비율 뷰: 카드 머리(합계 · 기간 칩 · 보기 바꾸기 글 단추) + 띠/원 + 목록. 「비교」는 옛 보기 */
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
  const period = pref.period;
  const compare = period === "compare";
  const week = period === "week";
  const categoryIds = data.categories.map((c) => c.id);
  const chart = buildStatusChart({ categoryIds, ratios: data.ratios, totals: week ? data.thisWeek : data.cumulative });
  const viewIndex = Math.max(0, STATUS_VIEWS.findIndex((v) => v.id === pref.view));
  const view = STATUS_VIEWS[viewIndex];
  const nextView = STATUS_VIEWS[(viewIndex + 1) % STATUS_VIEWS.length];
  const nameOf = (id: ChartCategoryId) => nameFor(data, id);
  const periodName = GROWTH_TEXT[PERIOD_LABEL[period]];
  const View = view.Component;
  // 기록 없음(이 기간에 쓴 시간 0): 글 대신 예시 값 — 목표 비율 띠 + 빈 띠 「0시간」 + 「오늘 기록」 단추. 목표 비율이 없으면 띠 없이 단추만(창구 덧붙임 11-09 11:3x)
  const empty = !compare && chart.spentTotalMinutes === 0;
  return (
    <>
      <h2 className="growth-sub-title growth-period-title">{compare ? GROWTH_TEXT.compareHeading : week ? GROWTH_TEXT.weekHeading : GROWTH_TEXT.totalHeading}</h2>
      <p className="todo-sub growth-days">{GROWTH_TEXT.days(week ? data.loggedDaysThisWeek : data.loggedDaysTotal)}</p>
      {!compare && <p className="sr-only">{ratioSummary(chart, periodName, nameOf)}</p>}
      <div className="growth-card">
        <div className="growth-card-head">
          {!compare && (
            <p className="growth-card-total" aria-hidden="true">
              {empty ? GROWTH_TEXT.zero : formatMinutes(chart.spentTotalMinutes)}
            </p>
          )}
          <div className="growth-periods" role="group" aria-label={GROWTH_TEXT.periodGroup}>
            {STATUS_PERIODS.map((p) => (
              <button key={p} type="button" className="growth-period" aria-pressed={period === p} onClick={() => choose({ ...pref, period: p })}>
                <span className="growth-period-face">{GROWTH_TEXT[PERIOD_LABEL[p]]}</span>
              </button>
            ))}
          </div>
        </div>
        {!compare && !empty && (
          <div className="growth-switch">
            <TextButton onClick={() => choose({ ...pref, view: nextView.id })}>{GROWTH_TEXT[view.switchLabel]}</TextButton>
          </div>
        )}
        {compare ? (
          <CompareView data={data} onOpenCategory={onOpenCategory} />
        ) : empty ? (
          <EmptyBands chart={chart} text={GROWTH_TEXT} periodName={periodName} zeroText={GROWTH_TEXT.zero} />
        ) : (
          <View chart={chart} text={GROWTH_TEXT} periodName={periodName} nameOf={nameOf} onOpenCategory={onOpenCategory} />
        )}
      </div>
      {!compare && chart.spentTotalMinutes === 0 && (
        <>
          <p className="todo-sub growth-empty">{week ? GROWTH_TEXT.empty : GROWTH_TEXT.emptyTotal}</p>
          <EveningButton onOpenEvening={onOpenEvening} />
        </>
      )}
    </>
  );
}

function CompareView({ data, onOpenCategory }: { data: GrowthData; onOpenCategory: (id: string | null, name: string) => void }) {
  const rows = [...data.categories.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: GROWTH_TEXT.other }];
  return (
    <ul className="growth-list">
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
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 오늘 기록 저장 직후 한 줄 아래에 얹는 남은 시간(F4 ㄴ, 고침6 ④-① — Figma 49:142·59:2). 오늘 기록 화면에 놓인다(상태보기 화면이 아니다).
 * 남은 시간이 있는 분야만 한 줄씩: 분야 이름 줄 아래 「n시간 더」(12 보조). 기준은 목표를 세운 주 = 이번 주 목표까지, 세우지 않은 주 = 목표 비율(fillTimeFor 그대로).
 * 제목(옛 「채울 시간」)은 두지 않는다. 남은 분야가 없으면 아무것도 그리지 않는다.
 */
export function AfterSaveShortfall({ api }: { api: GrowthApi }) {
  const [data, setData] = useState<GrowthData | null>(null);
  useEffect(() => {
    let alive = true;
    void api.fetchGrowth().then((res) => {
      if (alive && res.ok) setData(res.data);
    });
    return () => {
      alive = false;
    };
  }, [api]);
  if (!data) return null;
  const { items } = fillTimeFor({
    categoryIds: data.categories.map((c) => c.id),
    ratios: data.ratios,
    goalItems: data.goal?.items ?? null,
    thisWeek: data.thisWeek,
  });
  const rows = items.filter((s) => s.minutes > 0);
  if (rows.length === 0) return null;
  return (
    <div className="after-save-line after-save-short">
      <ul className="after-save-rows">
        {rows.map((s) => (
          <li key={s.categoryId ?? "other"} className="after-save-row">
            <span className="after-save-name">{nameFor(data, s.categoryId)}</span>
            <span className="after-save-more">{AFTER_SAVE_TEXT.more(s.minutes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
