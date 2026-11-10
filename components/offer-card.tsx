"use client";

import { APP_CONFIG } from "../lib/app-config";
import { needsAddToToday, writtenDayLine } from "../lib/offers/logic";
import type { Offer } from "../lib/offers/types";
import { todoDayFor } from "../lib/todos/day";
import { categoryColorValue } from "../lib/category-color";
import { Notice, PrimaryButton, TextButton } from "./ui";

/**
 * 「오늘 먼저 할 일 · 분야」 카드(PRD 7-5, ⑤). 할 일 화면 목록 위에 얹힌다. 건네고 목록에 등록하는 것까지가 일이다(고침 11-2, PM d-232).
 * 카드에는 「30분 시작」이 없다(타이머 입구는 타이머 탭 하나). 주 단추는 경우마다 하나다:
 * - 지난 날 할 일(L1~L4): 적은 날 줄 + 「오늘 할 일에 추가」. 누르면 오늘 할 일로 복사하고 할 일 탭에 머문다.
 * - 추가한 뒤(L5): 「오늘 할 일에 넣었어요」 + 글 단추 「타이머에서 시작 ›」 하나(타이머 탭으로 가서 그 할 일을 골라 둔다. 시작은 사용자가).
 * - 이미 오늘 목록에 있는 할 일(L6): 「오늘 할 일 목록에 있어요」 + 「목록에서 보기」(그 줄로 스크롤 · 강조 · 포커스).
 * - 분야만 건넬 때(L8): 「{분야} 할 일 적기」(적는 창을 그 분야를 골라 둔 채 연다).
 * 「넘기기」는 이 제시를 넘긴 것으로 남기고 카드를 거둔다. 타이머가 이미 돌면(K7) 안내와 「타이머 탭 열기」.
 * 왜 이 분야인지는 문장 대신 숫자로(분야·30분). 재촉하는 말·평가하는 말이 없다(D-141). 모든 글은 React 텍스트로만 그린다.
 */
export const OFFER_TEXT = {
  title: (category: string) => `오늘 먼저 할 일 · ${category}`,
  skip: "넘기기",
  start: (m: number) => `${m}분 시작`,
  starting: "시작하는 중",
  startFailed: "시작하지 못했어요. 다시 눌러 주세요.",
  startOffline: "인터넷에 연결되면 시작할 수 있어요.",
  add: "오늘 할 일에 추가",
  adding: "추가하는 중",
  addFailed: "추가하지 못했어요. 다시 눌러 주세요.",
  addOffline: "인터넷에 연결되면 추가할 수 있어요.",
  added: "오늘 할 일에 넣었어요",
  startInTimer: "타이머에서 시작 ›",
  inList: "오늘 할 일 목록에 있어요",
  showInList: "목록에서 보기",
  composeFor: (category: string) => `${category} 할 일 적기`,
  running: "타이머가 돌고 있어요. 타이머 탭에서 볼 수 있어요.",
  openTimer: "타이머 탭 열기",
} as const;

export function OfferCard({
  offer,
  busy,
  error,
  onAdd,
  onDismiss,
  onShowInList,
  onCompose,
  onStartInTimer,
  onStart,
  startEnabled = APP_CONFIG.cardStartEnabled,
  added = false,
  running = false,
  onOpenTimer,
  today = todoDayFor(new Date()),
  categoryColor = categoryColorValue(null),
}: {
  offer: Offer;
  busy: boolean;
  error: "failed" | "offline" | null;
  /** 「오늘 할 일에 추가」(지난 날 할 일일 때) */
  onAdd?: () => void;
  onDismiss: () => void;
  /** 「목록에서 보기」(이미 오늘 목록에 있을 때) */
  onShowInList?: () => void;
  /** 「{분야} 할 일 적기」(분야만 건넬 때) */
  onCompose?: () => void;
  /** 「타이머에서 시작 ›」(추가한 뒤) */
  onStartInTimer?: () => void;
  /** 「30분 시작」(APP_CONFIG.cardStartEnabled를 켰을 때만, 이미 목록에 있는 할 일 · 분야만): 타이머를 켠다 */
  onStart?: () => void;
  /** 카드 시작 길을 보일까(기본은 설정 값 APP_CONFIG.cardStartEnabled, 시험이 바꿔 준다) */
  startEnabled?: boolean;
  /** 방금 「오늘 할 일에 추가」를 눌렀다(L5): 탭을 떠나거나 앱을 다시 열 때까지 */
  added?: boolean;
  /** 타이머가 이미 돌고 있다(B3): 단추 대신 안내와 타이머 탭 열기를 둔다 */
  running?: boolean;
  onOpenTimer?: () => void;
  /** 오늘(두노 하루). 건넨 할 일이 이보다 앞선 날 것이면 추가 꼴로 보인다 */
  today?: string;
  /** 분야 점 색(분야 색 값). 분야 순서를 아는 호출처가 넘기고, 모르면 기타 색 */
  categoryColor?: string;
}) {
  const minutes = APP_CONFIG.timerMinutes;
  const text = offer.todoText ?? `${offer.categoryName} ${minutes}분`;
  const head = (
    <>
      <span className="offer-dot" style={{ background: categoryColor }} aria-hidden="true" />
      <p className="entry-title">{OFFER_TEXT.title(offer.categoryName)}</p>
      <p className="offer-text">{text}</p>
    </>
  );
  if (running) {
    return (
      <section className="entry-card offer-card" aria-label="오늘 먼저 할 일">
        {head}
        <p className="todo-sub" role="status">
          {OFFER_TEXT.running}
        </p>
        <div className="detail-actions">
          <PrimaryButton onClick={onOpenTimer}>{OFFER_TEXT.openTimer}</PrimaryButton>
        </div>
      </section>
    );
  }
  if (added) {
    // L5: 주 단추·「넘기기」 없음. 포커스는 보조 길로(추가 단추가 사라지므로)
    return (
      <section className="entry-card offer-card entry-card-stack" aria-label="오늘 먼저 할 일">
        {head}
        <p className="todo-sub offer-written offer-added" role="status">
          {OFFER_TEXT.added}
        </p>
        <div className="detail-actions">
          <TextButton className="offer-secondary" autoFocus onClick={onStartInTimer}>
            {OFFER_TEXT.startInTimer}
          </TextButton>
        </div>
      </section>
    );
  }
  if (needsAddToToday(offer, today)) {
    // L1~L4: 지난 날 할 일. 「넘기기」는 추가하는 동안 막힌다
    return (
      <section className="entry-card offer-card entry-card-stack" aria-label="오늘 먼저 할 일">
        {head}
        <p className="todo-sub offer-written">{writtenDayLine(offer.todoDay, today)}</p>
        {error && (
          <Notice role="alert" className="notice-compact">
            {error === "offline" ? OFFER_TEXT.addOffline : OFFER_TEXT.addFailed}
          </Notice>
        )}
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
  if (startEnabled) {
    // 예전(고침 11) 꼴: 이미 목록에 있는 할 일 · 분야만 → 「30분 시작」 + 「넘기기」. 시작하는 동안 「넘기기」 막힘
    return (
      <section className="entry-card offer-card" aria-label="오늘 먼저 할 일">
        {head}
        {error && (
          <Notice role="alert" className="notice-compact">
            {error === "offline" ? OFFER_TEXT.startOffline : OFFER_TEXT.startFailed}
          </Notice>
        )}
        <div className="detail-actions">
          <PrimaryButton busy={busy} disabled={busy} onClick={onStart}>
            {busy ? OFFER_TEXT.starting : OFFER_TEXT.start(minutes)}
          </PrimaryButton>
          <TextButton className="offer-skip" disabled={busy} onClick={onDismiss}>
            {OFFER_TEXT.skip}
          </TextButton>
        </div>
      </section>
    );
  }
  if (offer.todoId !== null) {
    // L6: 이미 오늘 목록에 있는 할 일
    return (
      <section className="entry-card offer-card entry-card-stack" aria-label="오늘 먼저 할 일">
        {head}
        <p className="todo-sub offer-written">{OFFER_TEXT.inList}</p>
        <div className="detail-actions">
          <PrimaryButton onClick={onShowInList}>{OFFER_TEXT.showInList}</PrimaryButton>
          <TextButton className="offer-skip" onClick={onDismiss}>
            {OFFER_TEXT.skip}
          </TextButton>
        </div>
      </section>
    );
  }
  // L8: 분야만 건넬 때(건넬 할 일이 없다)
  return (
    <section className="entry-card offer-card" aria-label="오늘 먼저 할 일">
      {head}
      <div className="detail-actions">
        <PrimaryButton onClick={onCompose}>{OFFER_TEXT.composeFor(offer.categoryName)}</PrimaryButton>
        <TextButton className="offer-skip" onClick={onDismiss}>
          {OFFER_TEXT.skip}
        </TextButton>
      </div>
    </section>
  );
}
