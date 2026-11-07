"use client";

import { useEffect, useRef, useState } from "react";
import { barPercents, minutesOf, shortfallFor, totalOf } from "../lib/growth/logic";
import type { GrowthData } from "../lib/growth/types";
import type { GrowthApi } from "../lib/growth-api";
import { formatDeltaMinutes, formatMinutes } from "../lib/time-format";
import type { ViewEntry } from "../lib/views/core-types";
import { EVENING_ENTRY_LABEL } from "./evening-record";
import { Notice, SecondaryButton } from "./ui";

/**
 * 상태보기(성장 화면, PRD 7-4, ③). 이번 판의 「늘어난 것」은 분야에 쓴 시간이다(G5): 화면 글에서 「역량」이라 부르지 않는다.
 * - 「이번 주」: 맨 위는 「이번 주 내 시간이 어느 분야에 쓰였나」(분야마다 한 줄: 이름 · 시간 · 가로 막대, 0분도 보임, 기타도 한 줄, D-111).
 *   그 아래 「채울 시간」(처음 정한 비율보다 덜 한 분야. 이번 주 목표가 있는 주는 목표 기준, F3 ㄴ). 재촉·평가·경고 색 없이 숫자로(D-141).
 * - 「비교」: 이번 주 · 지난주 · 지난달 · 쌓인 것(누적)을 분야마다 나란히(D-093, F2 ㄷ).
 * - 분야 줄을 누르면 그 분야의 페이지로 간다(작업 기록이 날짜별로, G13-a).
 * - 화면이 그려지면 본 것을 한 번 남긴다(입구별: 탭으로 연 것 self, 저녁 기록 저장 직후의 한 줄 after_save, G8).
 * 탭이 보일 때마다 다시 읽는다. 모든 글은 React 텍스트로만 그린다.
 */

export const GROWTH_TEXT = {
  title: "상태보기",
  modeGroup: "보기 방식",
  modeWeek: "이번 주",
  modeCompare: "비교",
  weekHeading: "이번 주 내 시간이 어느 분야에 쓰였나",
  other: "기타",
  empty: "아직 이번 주 저녁 기록이 없어요. 저녁 기록을 남기면 여기에 쌓여요.",
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
  const [mode, setMode] = useState<"week" | "compare">("week");
  const recordedRef = useRef(-1);

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
        {load.status === "loading" && (
          <p className="todo-sub" role="status">
            {GROWTH_TEXT.loading}
          </p>
        )}
        {load.status === "error" && (
          <Notice role="alert" actions={<SecondaryButton onClick={reload}>{GROWTH_TEXT.reload}</SecondaryButton>}>
            {GROWTH_TEXT.loadFailed}
          </Notice>
        )}
        {load.status === "ready" && (
          <>
            <div className="detail-chips" role="group" aria-label={GROWTH_TEXT.modeGroup}>
              {(["week", "compare"] as const).map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={mode === m} onClick={() => setMode(m)}>
                  <span className="chip-face">
                    <span className="chip-label">{m === "week" ? GROWTH_TEXT.modeWeek : GROWTH_TEXT.modeCompare}</span>
                  </span>
                </button>
              ))}
            </div>
            {mode === "week" ? (
              <WeekView data={load.data} onOpenCategory={onOpenCategory} onOpenEvening={onOpenEvening} />
            ) : (
              <CompareView data={load.data} onOpenCategory={onOpenCategory} />
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

/** 보이는 분야 줄: 분야마다 하나(0분도), 맨 끝에 기타 */
function rowsFor(data: GrowthData): { id: string | null; name: string }[] {
  return [...data.categories.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: GROWTH_TEXT.other }];
}

function WeekView({
  data,
  onOpenCategory,
  onOpenEvening,
}: {
  data: GrowthData;
  onOpenCategory: (id: string | null, name: string) => void;
  onOpenEvening?: () => void;
}) {
  const rows = rowsFor(data);
  const minutes = rows.map((r) => minutesOf(data.thisWeek, r.id));
  const bars = barPercents(minutes);
  const total = totalOf(data.thisWeek);
  const shortfall = shortfallFor({ ratios: data.ratios, goalItems: data.goal?.items ?? null, totals: data.thisWeek });
  return (
    <>
      <h2 className="growth-sub-title">{GROWTH_TEXT.weekHeading}</h2>
      <p className="todo-sub">{GROWTH_TEXT.days(data.loggedDaysThisWeek)}</p>
      <ul className="growth-list">
        {rows.map((r, i) => (
          <li key={r.id ?? "other"} className="growth-item">
            <button type="button" className="growth-row" onClick={() => onOpenCategory(r.id, r.name)}>
              <span className="growth-name">{r.name}</span>
              <span className="growth-time">{formatMinutes(minutes[i])}</span>
              <span className="growth-bar" aria-hidden="true">
                <span className="growth-bar-fill" style={{ inlineSize: `${bars[i]}%` }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {total === 0 && data.goal === null && (
        <>
          <p className="todo-sub">{GROWTH_TEXT.empty}</p>
          {onOpenEvening && (
            <div className="detail-actions">
              <SecondaryButton onClick={onOpenEvening}>{EVENING_ENTRY_LABEL}</SecondaryButton>
            </div>
          )}
        </>
      )}

      <h2 className="growth-sub-title">{GROWTH_TEXT.shortfallHeading}</h2>
      <p className="todo-sub">{shortfall.basis === "goal" ? GROWTH_TEXT.basisGoal : GROWTH_TEXT.basisRatio}</p>
      {shortfall.items.length > 0 ? (
        <ul className="growth-short">
          {shortfall.items.map((s) => (
            <li key={s.categoryId ?? "other"}>
              {nameFor(data, s.categoryId)} {formatMinutes(s.minutes)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="todo-sub">{shortfall.basis === "ratio" && total === 0 ? GROWTH_TEXT.shortfallWait : GROWTH_TEXT.shortfallEmpty}</p>
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
  const { items } = shortfallFor({ ratios: data.ratios, goalItems: data.goal?.items ?? null, totals: data.thisWeek });
  if (items.length === 0) return null;
  return (
    <div className="after-save-line">
      <span className="after-save-title">{GROWTH_TEXT.shortfallHeading}</span>
      <span className="after-save-text">{items.map((s) => `${nameFor(data, s.categoryId)} ${formatMinutes(s.minutes)}`).join(" · ")}</span>
    </div>
  );
}
