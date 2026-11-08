"use client";

import { useEffect, useRef, useState } from "react";
import { minutesOf } from "../lib/growth/logic";
import { buildStatusChart, fillTimeFor, type ChartCategoryId } from "../lib/growth/status-chart";
import { DEFAULT_STATUS_PREF, parseStatusPref, STATUS_PERIODS, type StatusPeriod, type StatusPref } from "../lib/growth/status-view-pref";
import type { GrowthData } from "../lib/growth/types";
import type { GrowthApi } from "../lib/growth-api";
import { formatDeltaMinutes, formatMinutes } from "../lib/time-format";
import type { ViewEntry } from "../lib/views/core-types";
import { EVENING_ENTRY_LABEL } from "./evening-record";
import { STATUS_VIEWS } from "./growth-views";
import { Notice, SecondaryButton } from "./ui";

/**
 * 상태보기(성장 화면, PRD 7-4, ③). 이번 판의 「늘어난 것」은 분야에 쓴 시간이다(G5): 화면 글에서 「역량」이라 부르지 않는다.
 * 「기간 × 보기 방식」 구조(PM 11-08: 보기 방식은 여러 가지, 늘릴 수 있게):
 * - 기간: 「이번 주」(달력 주 월~일, 처음) / 「총 시간」(쓰기 시작한 때부터 쌓인 것). 「비교」는 D-093의 옛 보기(이번 주·지난주·지난달·쌓인 것 나란히)로 남긴 것(결정 대기).
 * - 보기 방식(비교 아닐 때): 띠그래프 / 원그래프 / 분야별 줄 막대(처음 보기, PM 확정 11-09). 보기 하나 = 같은 데이터(buildStatusChart)를 받는 부품 하나(components/growth-views.tsx의 STATUS_VIEWS).
 *   보기 방식 전환 문구(D-049)를 셋 이상에서 어떻게 할지는 디자인(23)이 정한다. 지금은 고르는 줄(단추 셋)이 자리다.
 * - 고른 기간·보기 방식은 이 기기·이 사용자에 기억한다(api.viewPref, 기기 저장소). 못 읽으면 처음 값으로 돈다.
 * - 이번 주 보기: 보기 + 쓴 시간 합계(큰 숫자) + 놓친 분야 문장 + 「채울 시간」(이번 주 목표가 있는 주는 목표 기준, F3 ㄴ). 재촉·평가·경고 색 없이 숫자로(D-141).
 * - 분야 줄을 누르면 그 분야의 페이지로 간다(작업 기록이 날짜별로, G13-a).
 * - 화면이 그려지면 본 것을 한 번 남긴다(입구별: 탭으로 연 것 self, 저녁 기록 저장 직후의 한 줄 after_save, G8).
 * 탭이 보일 때마다 다시 읽는다. 모든 글은 React 텍스트로만 그린다.
 * 아래 글 가운데 「임시 글」은 디자인 확정 뒤 바꾼다.
 */

export const GROWTH_TEXT = {
  title: "상태보기",
  periodGroup: "기간", // 임시 글, 디자인 확정 뒤 바꿈
  modeWeek: "이번 주", // PM 확정 11-09(기간 이름)
  modeTotal: "총 시간",
  modeCompare: "비교",
  viewGroup: "보기 방식", // 임시 글, 디자인 확정 뒤 바꿈
  bandName: "띠그래프",
  pieName: "원그래프",
  rowsName: "분야별 줄 막대", // 임시 글, 디자인 확정 뒤 바꿈
  // 임시 글, 디자인 확정 뒤 바꿈
  weekHeading: "이번 주 내 시간이 어느 분야에 쓰였나",
  totalHeading: "분야마다 쌓인 시간", // 임시 글, 디자인 확정 뒤 바꿈
  other: "기타",
  empty: "아직 이번 주 저녁 기록이 없어요. 저녁 기록을 남기면 여기에 쌓여요.", // 이번 주 빈 안내
  emptyTotal: "아직 저녁 기록이 없어요. 저녁 기록을 남기면 여기에 쌓여요.", // 임시 글, 디자인 확정 뒤 바꿈
  ratioLine: "처음 정한 비율", // 이름 기준 파일의 이름
  spentLine: "쓴 시간",
  spentTotal: "쓴 시간 합계", // 임시 글, 디자인 확정 뒤 바꿈
  lineSummary: (line: string, parts: string[]) => `${line} ${parts.join(", ")}`, // 임시 글(그래프를 글로 읽는 말)
  lineNone: (line: string) => `${line} 없음`, // 임시 글
  piece: (name: string, percent: number) => `${name} ${percent}%`, // 임시 글
  diff: (deltaMinutes: number) => `처음 정한 비율보다 ${formatDeltaMinutes(deltaMinutes)}`, // 임시 글(차이)
  missed: (name: string) => `「${name}」 시간을 채울 수 있어요`, // 놓친 분야 문장 자리, 임시 글(말은 「채울」 쪽, 탓하지 않는다)
  shortfallHeading: "채울 시간",
  basisRatio: "처음 정한 비율 기준",
  basisGoal: "이번 주 목표 기준",
  shortfallEmpty: "채울 시간이 없어요",
  shortfallWait: "이번 주 저녁 기록이 쌓이면 채울 시간이 보여요.",
  goalHeading: "이번 주 목표",
  compareHeading: "분야마다 나란히",
  thisWeek: "이번 주",
  lastWeek: "지난주",
  lastMonth: "지난달",
  cumulative: "쌓인 것",
  vsLastWeek: "지난주보다",
  days: (n: number) => `저녁 기록 ${n}일`,
  loading: "상태보기를 불러오는 중",
  loadFailed: "상태보기를 불러오지 못했어요.",
  reload: "다시 불러오기",
} as const;

const VIEW_IDS = STATUS_VIEWS.map((v) => v.id);
const PERIOD_LABEL: Record<StatusPeriod, "modeWeek" | "modeTotal" | "modeCompare"> = { week: "modeWeek", total: "modeTotal", compare: "modeCompare" };
/** 기억한 값을 기다리는 가장 긴 시간(ms). 넘으면 처음 값으로 그린다 */
const PREF_WAIT_MS = 800;

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; data: GrowthData };

export function GrowthScreen({
  api,
  active,
  activation,
  entry,
  onOpenCategory,
  onOpenEvening,
}: {
  api: GrowthApi;
  /** 이 탭이 지금 보이는가 */
  active: boolean;
  /** 탭을 열 때마다 하나씩 커지는 값(열 때마다 다시 읽고 본 것을 한 번 남긴다) */
  activation: number;
  entry: ViewEntry;
  onOpenCategory: (categoryId: string | null, name: string) => void;
  /** 이번 주 기록이 없을 때 빈 안내 아래의 「저녁 기록 남기기」(B17). 없으면 단추를 그리지 않는다 */
  onOpenEvening?: () => void;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [pref, setPref] = useState<StatusPref>(DEFAULT_STATUS_PREF);
  // 기억한 값을 쓸 수 없는 구현(viewPref 없음)이면 기다릴 것이 없다
  const [prefReady, setPrefReady] = useState(() => !api.viewPref);
  const touchedRef = useRef(false);
  const recordedRef = useRef(-1);

  // 기억한 기간·보기 방식을 한 번 읽는다(이 기기·이 사용자). 못 읽거나 늦으면 처음 값으로 그린다. 읽기 전에 사용자가 이미 골랐으면 고른 것이 이긴다.
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
  }, [api, active, activation]);

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

  return (
    <section className="growth" aria-labelledby="growth-title" aria-busy={load.status === "loading"}>
      <header className="today-header">
        <div>
          <h1 id="growth-title" className="today-title">
            {GROWTH_TEXT.title}
          </h1>
        </div>
      </header>
      <div className="growth-body">
        {(load.status === "loading" || (load.status === "ready" && !prefReady)) && (
          <p className="todo-sub" role="status">
            {GROWTH_TEXT.loading}
          </p>
        )}
        {load.status === "error" && (
          <Notice role="alert" actions={<SecondaryButton onClick={reload}>{GROWTH_TEXT.reload}</SecondaryButton>}>
            {GROWTH_TEXT.loadFailed}
          </Notice>
        )}
        {load.status === "ready" && prefReady && (
          <>
            <div className="detail-chips" role="group" aria-label={GROWTH_TEXT.periodGroup}>
              {STATUS_PERIODS.map((period) => (
                <button key={period} type="button" className="chip" aria-pressed={pref.period === period} onClick={() => choose({ ...pref, period })}>
                  <span className="chip-face">
                    <span className="chip-label">{GROWTH_TEXT[PERIOD_LABEL[period]]}</span>
                  </span>
                </button>
              ))}
            </div>
            {pref.period !== "compare" && (
              <div className="detail-chips" role="group" aria-label={GROWTH_TEXT.viewGroup}>
                {STATUS_VIEWS.map((v) => (
                  <button key={v.id} type="button" className="chip" aria-pressed={pref.view === v.id} onClick={() => choose({ ...pref, view: v.id })}>
                    <span className="chip-face">
                      <span className="chip-label">{GROWTH_TEXT[v.label]}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {pref.period === "compare" ? (
              <CompareView data={load.data} onOpenCategory={onOpenCategory} />
            ) : (
              <PeriodView data={load.data} period={pref.period} viewId={pref.view} onOpenCategory={onOpenCategory} onOpenEvening={onOpenEvening} />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function nameFor(data: GrowthData, id: string | null): string {
  return id === null ? GROWTH_TEXT.other : (data.categories.find((c) => c.id === id)?.name ?? GROWTH_TEXT.other);
}

/** 보이는 분야 줄: 분야마다 하나(0분도), 맨 끝에 기타(비교 보기가 쓴다) */
function rowsFor(data: GrowthData): { id: string | null; name: string }[] {
  return [...data.categories.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: GROWTH_TEXT.other }];
}

/** 기간 하나(이번 주 또는 총 시간)의 화면: 쓴 시간 합계 + 고른 보기 + 놓친 분야 문장, 이번 주에는 채울 시간도 */
function PeriodView({
  data,
  period,
  viewId,
  onOpenCategory,
  onOpenEvening,
}: {
  data: GrowthData;
  period: "week" | "total";
  viewId: string;
  onOpenCategory: (id: string | null, name: string) => void;
  onOpenEvening?: () => void;
}) {
  const week = period === "week";
  const categoryIds = data.categories.map((c) => c.id);
  const chart = buildStatusChart({ categoryIds, ratios: data.ratios, totals: week ? data.thisWeek : data.cumulative });
  const View = (STATUS_VIEWS.find((v) => v.id === viewId) ?? STATUS_VIEWS[0]).Component;
  const nameOf = (id: ChartCategoryId) => nameFor(data, id);
  const fill = fillTimeFor({ categoryIds, ratios: data.ratios, goalItems: data.goal?.items ?? null, thisWeek: data.thisWeek });
  const missed = chart.missed[0];
  return (
    <>
      <h2 className="growth-sub-title">{week ? GROWTH_TEXT.weekHeading : GROWTH_TEXT.totalHeading}</h2>
      <p className="todo-sub">{GROWTH_TEXT.days(week ? data.loggedDaysThisWeek : data.loggedDaysTotal)}</p>
      {chart.spentTotalMinutes > 0 && (
        <p className="growth-total">
          <span className="growth-total-label">{GROWTH_TEXT.spentTotal}</span>
          <strong className="growth-total-number">{formatMinutes(chart.spentTotalMinutes)}</strong>
        </p>
      )}
      <View chart={chart} text={GROWTH_TEXT} nameOf={nameOf} onOpenCategory={onOpenCategory} />
      {missed && <p className="growth-missed">{GROWTH_TEXT.missed(nameOf(missed.categoryId))}</p>}
      {chart.spentTotalMinutes === 0 && (!week || data.goal === null) && (
        <>
          <p className="todo-sub">{week ? GROWTH_TEXT.empty : GROWTH_TEXT.emptyTotal}</p>
          {onOpenEvening && (
            <div className="detail-actions">
              <SecondaryButton onClick={onOpenEvening}>{EVENING_ENTRY_LABEL}</SecondaryButton>
            </div>
          )}
        </>
      )}

      {week && (
        <>
          <h2 className="growth-sub-title">{GROWTH_TEXT.shortfallHeading}</h2>
          <p className="todo-sub">{fill.basis === "goal" ? GROWTH_TEXT.basisGoal : GROWTH_TEXT.basisRatio}</p>
          {fill.items.length > 0 ? (
            <ul className="growth-short">
              {fill.items.map((s) => (
                <li key={s.categoryId ?? "other"}>
                  {nameOf(s.categoryId)} {formatMinutes(s.minutes)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="todo-sub">{fill.basis === "ratio" && chart.spentTotalMinutes === 0 ? GROWTH_TEXT.shortfallWait : GROWTH_TEXT.shortfallEmpty}</p>
          )}
        </>
      )}
    </>
  );
}

function CompareView({ data, onOpenCategory }: { data: GrowthData; onOpenCategory: (id: string | null, name: string) => void }) {
  const rows = rowsFor(data);
  return (
    <>
      <h2 className="growth-sub-title">{GROWTH_TEXT.compareHeading}</h2>
      <p className="todo-sub">{GROWTH_TEXT.days(data.loggedDaysTotal)}</p>
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
    </>
  );
}

/** 저녁 기록 저장 직후 한 줄 아래에 얹는 「채울 시간」 한 줄(F4 ㄴ: 부족은 상태보기 안과 저장 직후 한 줄 둘 다에) */
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
  if (items.length === 0) return null;
  return (
    <div className="after-save-line">
      <span className="after-save-title">{GROWTH_TEXT.shortfallHeading}</span>
      <span className="after-save-text">{items.map((s) => `${nameFor(data, s.categoryId)} ${formatMinutes(s.minutes)}`).join(" · ")}</span>
    </div>
  );
}
