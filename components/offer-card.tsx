"use client";

import { APP_CONFIG } from "../lib/app-config";
import type { Offer } from "../lib/offers/types";
import { Notice, PrimaryButton, TextButton } from "./ui";

/**
 * 「오늘 먼저 할 일 · 분야」 카드(PRD 7-5, ⑤). 할 일 화면 목록 위에 얹힌다. 건네기까지만 한다: 켤지는 사용자가 정한다.
 * - 「30분 시작」은 타이머를 켠다(먼저 한 기록이 남는다). 「넘기기」는 이 제시를 넘긴 것으로 남기고 카드를 거둔다.
 * - 왜 이 분야인지는 문장 대신 숫자로(분야·30분). 재촉하는 말·평가하는 말이 없다(D-141).
 * - 건넬 할 일이 없으면 분야와 길이만 건넨다(예: 「어학 30분」).
 * 모든 글은 React 텍스트로만 그린다.
 */
export const OFFER_TEXT = {
  title: (category: string) => `오늘 먼저 할 일 · ${category}`,
  start: (m: number) => `${m}분 시작`,
  starting: "시작하는 중",
  skip: "넘기기",
  failed: "시작하지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 시작할 수 있어요.",
} as const;

export function OfferCard({
  offer,
  busy,
  error,
  onStart,
  onDismiss,
}: {
  offer: Offer;
  busy: boolean;
  error: "failed" | "offline" | null;
  onStart: () => void;
  onDismiss: () => void;
}) {
  const minutes = APP_CONFIG.timerMinutes;
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
