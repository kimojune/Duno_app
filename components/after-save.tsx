"use client";

import { useEffect, useState } from "react";
import { categoryColorValue } from "../lib/category-color";
import type { ItemDelta } from "../lib/evening/logic";
import { barWidth, buildAfterSave, type AfterSaveRow } from "../lib/growth/after-save";
import type { GrowthData } from "../lib/growth/types";
import type { GrowthApi } from "../lib/growth-api";
import { formatDeltaMinutes, formatMinutes } from "../lib/time-format";
import { useReducedMotion } from "../lib/use-reduced-motion";

/**
 * 오늘 기록 저장 직후 「이번 주」 카드(S5-3 — 명세 ⑦-7 · ③-E 「저장 뒤」 · 고침6 ④-① · Figma 49:142 목표 세운 주 / 59:2 목표 없는 주).
 * 오늘 기록 화면(components/evening-record.tsx)의 저장 뒤 판에 놓인다. 머리(「오늘 기록 · 닫기」)·「✓ 저장했어요」·「상태보기에서 보기 ›」는 오늘 기록이 그린다.
 * - AfterSave: 저장한 뒤 상태보기 데이터(GrowthApi.fetchGrowth — 이미 있는 길, 새 서버 입구 없음)를 한 번 읽어 카드를 그린다.
 *   읽는 동안·못 읽으면 바뀐 분야와 바뀐 시간만 글로(AfterSaveCard data null).
 * - 카드: 「이번 주」(16 Bold) · 바뀐 분야마다 색 점 + 이름 · 오른쪽 「2시간 **+1시간**」 · 막대(채움 = 분야 색 + 1px 윤곽, 이번에 더한 몫 = 같은 색 위 먹남색 사선 빗금, 목표 눈금 2px)
 *   · 막대 아래 「3시간 더」/「목표 6시간」(목표 세운 주) 또는 「이번 주 20% / 목표 30%」(목표 없는 주). 많으면 넷 + 「그 밖 n개」.
 * - 막대는 0에서 400ms 차오른다(「동작 줄이기」면 움직임 없이 바로).
 * - 화면 읽기 상태 알림(role="status") 한 곳: 「저장했어요. 어학 1시간 더해서 이번 주 2시간. 목표까지 3시간.」
 * 분야 이름(사용자 글)은 React 텍스트로만 그린다.
 */

export const AFTER_SAVE_TEXT = {
  saved: "저장했어요",
  week: "이번 주",
  other: "기타",
  more: (m: number) => `${formatMinutes(m)} 더`,
  goal: (m: number) => `목표 ${formatMinutes(m)}`,
  ratio: (spent: number, ratio: number | null) => (ratio === null ? `이번 주 ${spent}%` : `이번 주 ${spent}% / 목표 ${ratio}%`),
  others: (n: number) => `그 밖 ${n}개`,
  noChange: "바뀐 시간이 없어요",
  openGrowth: "상태보기에서 보기",
  // 화면 읽기 한 문장(상태 알림)
  announceHead: "저장했어요.",
  announceRow: (name: string, delta: number, spent: number) =>
    delta >= 0 ? `${name} ${formatMinutes(delta)} 더해서 이번 주 ${formatMinutes(spent)}.` : `${name} ${formatMinutes(-delta)} 빼서 이번 주 ${formatMinutes(spent)}.`,
  announceRemaining: (m: number) => `목표까지 ${formatMinutes(m)}.`,
  announceGoal: (m: number) => `목표 ${formatMinutes(m)}.`,
  announceRatio: (spent: number, ratio: number | null) => (ratio === null ? `이번 주 ${spent}%.` : `이번 주 ${spent}%, 목표 ${ratio}%.`),
  announceOthers: (n: number) => `그 밖 ${n}개.`,
  announceDelta: (name: string, delta: number) => `${name} ${formatDeltaMinutes(delta)}.`,
} as const;

/** 막대가 차오르는 시간(ms) */
export const AFTER_SAVE_FILL_MS = 400;

type Names = { name: (id: string | null) => string; color: (id: string | null) => string };

function namesFrom(data: GrowthData | null, fallback: readonly { id: string; name: string }[]): Names {
  const list = data ? data.categories : fallback;
  return {
    name: (id) => (id === null ? AFTER_SAVE_TEXT.other : (list.find((c) => c.id === id)?.name ?? fallback.find((c) => c.id === id)?.name ?? AFTER_SAVE_TEXT.other)),
    color: (id) => {
      if (id === null) return categoryColorValue(null);
      const at = list.findIndex((c) => c.id === id);
      return categoryColorValue(at >= 0 ? at : null);
    },
  };
}

/** 화면 읽기 한 문장 */
export function afterSaveAnnouncement(delta: readonly ItemDelta[], data: GrowthData | null, fallback: readonly { id: string; name: string }[]): string {
  const names = namesFrom(data, fallback);
  const changed = delta.filter((d) => d.minutes !== 0);
  if (changed.length === 0) return `${AFTER_SAVE_TEXT.announceHead} ${AFTER_SAVE_TEXT.noChange}.`;
  if (!data) return [AFTER_SAVE_TEXT.announceHead, ...changed.map((d) => AFTER_SAVE_TEXT.announceDelta(names.name(d.categoryId), d.minutes))].join(" ");
  const view = buildAfterSave(delta, data);
  const parts: string[] = [AFTER_SAVE_TEXT.announceHead];
  for (const r of view.rows) {
    parts.push(AFTER_SAVE_TEXT.announceRow(names.name(r.categoryId), r.delta, r.spent));
    if (view.basis === "goal") {
      if (r.remaining !== null && r.remaining > 0) parts.push(AFTER_SAVE_TEXT.announceRemaining(r.remaining));
      else if (r.goal !== null) parts.push(AFTER_SAVE_TEXT.announceGoal(r.goal));
    } else if (r.spentPercent !== null) parts.push(AFTER_SAVE_TEXT.announceRatio(r.spentPercent, r.ratioPercent));
  }
  if (view.others > 0) parts.push(AFTER_SAVE_TEXT.announceOthers(view.others));
  return parts.join(" ");
}

function Bar({ row, scale, color, grown, reduced }: { row: AfterSaveRow; scale: number; color: string; grown: boolean; reduced: boolean }) {
  const transition = reduced ? "none" : `width ${AFTER_SAVE_FILL_MS}ms ease-out`;
  const before = barWidth(row.before, scale);
  const added = barWidth(row.added, scale);
  return (
    <div className="after-save-bar" aria-hidden="true">
      {before > 0 && <span className="after-save-fill" data-part="before" style={{ background: color, width: `${grown ? before : 0}%`, transition }} />}
      {added > 0 && <span className="after-save-fill after-save-hatch" data-part="added" style={{ backgroundColor: color, width: `${grown ? added : 0}%`, transition }} />}
      {row.goal !== null && <span className="after-save-tick" style={{ insetInlineStart: `${barWidth(row.goal, scale)}%` }} />}
    </div>
  );
}

/**
 * 카드 하나(데이터를 받아 그리기만). data가 null이면(읽는 중·못 읽음) 막대 없이 바뀐 분야와 바뀐 시간만.
 * fallback = 오늘 기록이 읽어 둔 분야 목록(이름·색 자리 — 상태보기 데이터가 없을 때).
 */
export function AfterSaveCard({
  delta,
  data,
  fallback,
  pending = false,
}: {
  delta: readonly ItemDelta[];
  data: GrowthData | null;
  fallback: readonly { id: string; name: string }[];
  /** 상태보기 데이터를 읽는 중(상태 알림은 다 읽은 뒤 한 번만) */
  pending?: boolean;
}) {
  const reduced = useReducedMotion();
  // 차오름: 처음 그린 뒤 한 번 폭을 채운다(동작 줄이기면 처음부터 채운 폭)
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (!data) return;
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, [data]);
  const names = namesFrom(data, fallback);
  const changed = delta.filter((d) => d.minutes !== 0);
  const announcement = pending ? "" : afterSaveAnnouncement(delta, data, fallback);

  let body;
  if (changed.length === 0) {
    body = <p className="after-save-empty">{AFTER_SAVE_TEXT.noChange}</p>;
  } else if (!data) {
    body = (
      <ul className="after-save-rows">
        {changed.map((d) => (
          <li key={d.categoryId ?? "other"} className="after-save-row">
            <div className="after-save-row-head">
              <span className="chip-dot" style={{ background: names.color(d.categoryId) }} aria-hidden="true" />
              <span className="after-save-name">{names.name(d.categoryId)}</span>
              <span className="after-save-value">
                <b className="after-save-delta">{formatDeltaMinutes(d.minutes)}</b>
              </span>
            </div>
          </li>
        ))}
      </ul>
    );
  } else {
    const view = buildAfterSave(delta, data);
    body = (
      <>
        <ul className="after-save-rows">
          {view.rows.map((r) => (
            <li key={r.categoryId ?? "other"} className="after-save-row" data-category={r.categoryId ?? "other"}>
              <div className="after-save-row-head">
                <span className="chip-dot" style={{ background: names.color(r.categoryId) }} aria-hidden="true" />
                <span className="after-save-name">{names.name(r.categoryId)}</span>
                <span className="after-save-value">
                  <span className="after-save-spent">{formatMinutes(r.spent)}</span> <b className="after-save-delta">{formatDeltaMinutes(r.delta)}</b>
                </span>
              </div>
              <Bar row={r} scale={view.scale} color={names.color(r.categoryId)} grown={grown || reduced} reduced={reduced} />
              {view.basis === "goal" ? (
                r.goal !== null && <p className="after-save-more">{r.remaining !== null && r.remaining > 0 ? AFTER_SAVE_TEXT.more(r.remaining) : AFTER_SAVE_TEXT.goal(r.goal)}</p>
              ) : (
                r.spentPercent !== null && <p className="after-save-more">{AFTER_SAVE_TEXT.ratio(r.spentPercent, r.ratioPercent)}</p>
              )}
            </li>
          ))}
        </ul>
        {view.others > 0 && <p className="after-save-others">{AFTER_SAVE_TEXT.others(view.others)}</p>}
      </>
    );
  }
  return (
    <section className="card-box after-save-card" aria-labelledby="after-save-week">
      <h3 id="after-save-week" className="after-save-week">
        {AFTER_SAVE_TEXT.week}
      </h3>
      {/* 화면이 보이는 글과 같은 내용을 한 문장으로(막대는 화면 읽기에서 숨김) */}
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {body}
    </section>
  );
}

/** 저장 뒤 상태보기 데이터를 한 번 읽어 카드를 그린다(app-shell의 renderAfterSave) */
export function AfterSave({ api, delta, fallback }: { api: GrowthApi; delta: readonly ItemDelta[]; fallback: readonly { id: string; name: string }[] }) {
  const [load, setLoad] = useState<{ pending: boolean; data: GrowthData | null }>({ pending: true, data: null });
  useEffect(() => {
    let alive = true;
    void api
      .fetchGrowth()
      .then((res) => {
        if (alive) setLoad({ pending: false, data: res.ok ? res.data : null });
      })
      .catch(() => {
        if (alive) setLoad({ pending: false, data: null });
      });
    return () => {
      alive = false;
    };
  }, [api]);
  return <AfterSaveCard delta={delta} data={load.data} fallback={fallback} pending={load.pending} />;
}
