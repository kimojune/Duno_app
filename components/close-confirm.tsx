"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { inertOutside } from "../lib/use-overlay-window";
import { PrimaryButton, SecondaryButton } from "./ui";

/**
 * 닫기 전 확인 한 단계(PM d-126, 글은 PM d-135로 하나). 오늘 기록·오늘 할 일 시트·내 정보 S8-b 「목표」가 함께 쓴다 — 적던 것이 있을 때 「닫기」·Esc·뒤로 가기·바깥 누름이 이 확인을 띄운다.
 * - role="alertdialog" + aria-modal, 제목이 이름. 처음 포커스는 「계속 적기」(주 단추, 먹남색). 닫히면 포커스는 확인을 띄운 자리(「닫기」 단추 등)로 돌아간다.
 * - 떠 있는 동안 확인 밖(그 창의 나머지)에 inert를 단다. 앱의 다른 확인(할 일 지우기·로그아웃)은 창 안 알림 줄이라 대화 창 규칙이 없어 이 부품을 새로 둔다.
 * - 「계속 적기」·Esc·바깥 누름 = 확인만 닫는다(입력은 그대로). 「나가기」 = 창을 닫는다(저장하지 않는다 — 저장 호출 없음).
 * - 글은 이 한 곳(CLOSE_CONFIRM_TEXT)에만 있다(PM d-135: 모든 「저장하지 않고 나가기」 확인 창을 하나로). 부르는 쪽은 글을 넘기지 않는다.
 */
export const CLOSE_CONFIRM_TEXT = {
  title: "저장하지 않고 나갈까요?",
  keep: "계속 적기",
  close: "나가기",
} as const;

export function CloseConfirm({ onKeep, onClose }: { onKeep: () => void; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const root = rootRef.current;
    const active = document.activeElement;
    const returnTo = active instanceof HTMLElement && active !== document.body && !root?.contains(active) ? active : null;
    const inerted = root ? inertOutside(root) : [];
    root?.querySelector<HTMLButtonElement>("[data-confirm-keep]")?.focus();
    return () => {
      for (const el of inerted) el.removeAttribute("inert");
      // 창이 함께 닫혔으면(「닫기」) 그 자리는 이미 없다 — 창의 훅이 연 단추로 돌려보낸다
      if (returnTo && returnTo.isConnected) returnTo.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation(); // 확인만 닫는다(아래 창의 Esc가 다시 확인을 띄우지 않게)
    onKeep();
  }

  return (
    <div ref={rootRef} className="close-confirm-layer" onKeyDown={onKeyDown}>
      <div className="close-confirm-backdrop" aria-hidden="true" onClick={onKeep} />
      <div className="close-confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="close-confirm-title">
          {CLOSE_CONFIRM_TEXT.title}
        </h2>
        <div className="close-confirm-actions">
          <PrimaryButton data-confirm-keep="" onClick={onKeep}>
            {CLOSE_CONFIRM_TEXT.keep}
          </PrimaryButton>
          <SecondaryButton onClick={onClose}>{CLOSE_CONFIRM_TEXT.close}</SecondaryButton>
        </div>
      </div>
    </div>
  );
}
