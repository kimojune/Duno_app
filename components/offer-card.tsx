"use client";

import { APP_CONFIG } from "../lib/app-config";
import { needsAddToToday, writtenDayLine } from "../lib/offers/logic";
import type { Offer } from "../lib/offers/types";
import { todoDayFor } from "../lib/todos/day";
import { Notice, PrimaryButton, TextButton } from "./ui";

/**
 * 「오늘 먼저 할 일 · 분야」 카드(PRD 7-5, ⑤). 할 일 화면 목록 위에 얹힌다. 건네기까지만 한다: 켤지는 사용자가 정한다.
 * - 「30분 시작」은 타이머를 켠다(먼저 한 기록이 남는다). 「넘기기」는 이 제시를 넘긴 것으로 남기고 카드를 거둔다.
 * - 왜 이 분야인지는 문장 대신 숫자로(분야·30분). 재촉하는 말·평가하는 말이 없다(D-141).
 * - 건넬 할 일이 없으면 분야와 길이만 건넨다(예: 「어학 30분」).
 * - 건넨 할 일이 지난 날 것이면(고침 11, 23 명세 K1~K4) 적은 날 줄과 「오늘 할 일에 추가」(d-227)를 보인다: 누르면 오늘 할 일로 복사하고 타이머 탭에서 골라 둔다(시작은 사용자가). 오늘 것이면 「30분 시작」.
 * 모든 글은 React 텍스트로만 그린다.
 */
export const OFFER_TEXT = {
  title: (category: string) => `오늘 먼저 할 일 · ${category}`,
  start: (m: number) => `${m}분 시작`,
  starting: "시작하는 중",
  skip: "넘기기",
  add: "오늘 할 일에 추가",
  adding: "추가하는 중",
  failed: "시작하지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 시작할 수 있어요.",
  addFailed: "추가하지 못했어요. 다시 눌러 주세요.",
  addOffline: "인터넷에 연결되면 추가할 수 있어요.",
  running: "타이머가 돌고 있어요. 타이머 탭에서 볼 수 있어요.",
  openTimer: "타이머 탭 열기",
} as const;

export function OfferCard({
  offer,
  busy,
  error,
  onStart,
  onAdd,
  onDismiss,
  running = false,
  onOpenTimer,
  today = todoDayFor(new Date()),
}: {
  offer: Offer;
  busy: boolean;
  error: "failed" | "offline" | null;
  onStart: () => void;
  /** 「오늘 할 일에 추가」(지난 날 할 일일 때) */
  onAdd?: () => void;
  onDismiss: () => void;
  /** 오늘(두노 하루). 건넨 할 일이 이보다 앞선 날 것이면 추가 꼴로 보인다 */
  today?: string;
  /** 타이머가 이미 돌고 있다(B3): 시작 단추 대신 안내와 타이머 탭 열기를 둔다 */
  running?: boolean;
  onOpenTimer?: () => void;
}) {
  const minutes = APP_CONFIG.timerMinutes;
  if (running) {
    return (
      <section className="entry-card" aria-label="오늘 먼저 할 일">
        <p className="entry-title">{OFFER_TEXT.title(offer.categoryName)}</p>
        <p className="offer-text">{offer.todoText ?? `${offer.categoryName} ${minutes}분`}</p>
        <p className="todo-sub" role="status">
          {OFFER_TEXT.running}
        </p>
        <div className="detail-actions">
          <PrimaryButton onClick={onOpenTimer}>{OFFER_TEXT.openTimer}</PrimaryButton>
        </div>
      </section>
    );
  }
  if (needsAddToToday(offer, today)) {
    // K1~K4: 지난 날 할 일. 「넘기기」는 추가하는 동안 막힌다(시작하는 중과 같은 규칙)
    return (
      <section className="entry-card" aria-label="오늘 먼저 할 일">
        <p className="entry-title">{OFFER_TEXT.title(offer.categoryName)}</p>
        <p className="offer-text">{offer.todoText ?? `${offer.categoryName} ${minutes}분`}</p>
        <p className="todo-sub offer-written">{writtenDayLine(offer.todoDay, today)}</p>
        {error && <Notice role="alert" className="notice-compact">{error === "offline" ? OFFER_TEXT.addOffline : OFFER_TEXT.addFailed}</Notice>}
        <div className="detail-actions">
          <PrimaryButton busy={busy} disabled={busy} onClick={onAdd}>
            {busy ? OFFER_TEXT.adding : OFFER_TEXT.add}
          </PrimaryButton>
          <TextButton className="offer-skip" disabled={busy} onClick={onDismiss}>
            {OFFER_TEXT.skip}
          </TextButton>
        </div>
      </section>
    );
  }
  return (
    <section className="entry-card" aria-label="오늘 먼저 할 일">
      <p className="entry-title">{OFFER_TEXT.title(offer.categoryName)}</p>
      <p className="offer-text">{offer.todoText ?? `${offer.categoryName} ${minutes}분`}</p>
      {error && <Notice role="alert">{error === "offline" ? OFFER_TEXT.offline : OFFER_TEXT.failed}</Notice>}
      <div className="detail-actions">
        <PrimaryButton busy={busy} disabled={busy} onClick={onStart}>
          {busy ? OFFER_TEXT.starting : OFFER_TEXT.start(minutes)}
        </PrimaryButton>
        <TextButton disabled={busy} onClick={onDismiss}>
          {OFFER_TEXT.skip}
        </TextButton>
      </div>
    </section>
  );
}
