"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { inertOutside, useConfirmBack } from "../lib/use-overlay-window";
import { PrimaryButton, SecondaryButton } from "./ui";

/**
 * 공통 확인 창(고침10 B — Figma 146:11 · 쓰는 곳 147:2 · 상태 150:58 · PM 9 · PM 11). 앱의 확인 창은 모두 이 부품 하나다.
 *
 * ── 쓰는 법 ──────────────────────────────────────────────
 *   {open && (
 *     <ConfirmDialog
 *       title="이 작업 기록을 지울까요?"        // 18 Bold. 창이 뜨면 초점이 여기로 온다
 *       description="작업 기록도 함께 지워져요." // (선택) 14 Regular 보조색. 없으면 그리지 않는다
 *       confirmLabel="지우기"                  // 위 단추 = 떠나기·지우기(테두리 1.5, 바탕 없음)
 *       busyLabel="지우는 중"                   // (선택) 위 단추를 누른 뒤 응답 전 글
 *       cancelLabel="그대로 두기"               // 아래 단추 = 안전한 쪽 주 단추(먹남색 채움)
 *       onConfirm={() => api.deleteNote(id).then(...)} // 위 단추 동작. Promise를 돌려주면 끝날 때까지 막힌다
 *       onCancel={() => setOpen(false)}         // 아래 단추 · Esc · 막 누름 · 안드로이드 뒤로 가기
 *     />
 *   )}
 *   - 부르는 쪽이 창을 그리고 지운다(마운트 = 열림). 창은 스스로 닫지 않는다: 위 단추가 끝나면 부르는 쪽이 창을 지운다.
 *
 * ── 막힘(서버 쓰기 — 지우기·로그아웃, 명세 O-7) ─────────────
 * - onConfirm이 Promise를 돌려주면 그 Promise가 끝날 때까지 「막힘」이다: 누른 단추 글이 busyLabel로 바뀌고, 두 단추가 막힌다
 *   (disabled + aria-busy, 흐림 0.45 — components/ui.tsx). 막힌 동안 위 단추를 다시 눌러도(연타·Enter 연타) onConfirm을 다시 부르지 않는다.
 *   막힌 동안 Esc·막 누름·뒤로 가기는 아무것도 하지 않는다(이미 보낸 요청을 「취소」처럼 보이지 않게).
 * - Promise가 끝났는데 창이 아직 떠 있으면(실패 등) 막힘이 풀린다. 실패 안내는 부르는 쪽 몫이다.
 * - 페이지를 떠나는 동작(로그아웃)처럼 끝까지 막아 두려면 busy를 넘긴다: busy가 true면 Promise와 상관없이 막힌다.
 *
 * ── 키보드·화면 읽기 ─────────────────────────────────────
 * - role="alertdialog" + aria-modal, 이름 = 제목, 설명 = 보조 글. 뜨면 초점은 제목(tabIndex -1). 단추 이름 = 보이는 글.
 * - Tab·Shift+Tab은 창 안(두 단추)에서만 돈다. 떠 있는 동안 창 밖에는 inert를 단다.
 * - 닫히면 초점은 창을 연 단추로 돌아간다. 그 단추가 이미 없으면(메뉴 항목 등) 건드리지 않는다 — 부르는 쪽(창의 훅)이 정한 자리로 간다.
 *
 * ── 안드로이드 뒤로 가기 = 아래 단추(onCancel) ───────────────
 * - 겹친 창(useOverlayWindow)·적는 창 위에 뜨면 그 창의 뒤로 가기 길이 이 확인을 먼저 닫는다(lib/use-overlay-window.ts useConfirmBack).
 * - 겹친 창 없이 뜨는 확인(할 일 탭의 로그아웃)은 ownHistory를 넘긴다: 이 창이 history에 한 칸을 쌓고 뒤로 가기에 onCancel을 부른다.
 *
 * 글은 React 텍스트로만 그린다. 「저장하지 않고 나갈까요?」는 아래 CloseConfirm이 이 부품에 글을 채워 쓴다.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busyLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy: busyProp = false,
  ownHistory = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** 위 단추(떠나기·지우기) 글 */
  confirmLabel: string;
  /** 위 단추를 누른 뒤 응답 전 글(예: 「지우는 중」 · 「로그아웃 중」). 없으면 confirmLabel 그대로 */
  busyLabel?: string;
  /** 아래 주 단추(안전한 쪽) 글 */
  cancelLabel: string;
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
  /** 부르는 쪽이 막힘을 정한다(true면 늘 막힘) */
  busy?: boolean;
  /** 겹친 창 없이 뜨는 확인: 스스로 history 한 칸을 쌓아 뒤로 가기를 받는다 */
  ownHistory?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const busy = busyProp || pending;
  const busyRef = useRef(busy);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    busyRef.current = busy;
    cancelRef.current = onCancel;
  });

  /** 막힘이 아닐 때만 아래 단추와 같은 동작 */
  function cancel() {
    if (busyRef.current || pendingRef.current) return;
    cancelRef.current();
  }

  /** 위 단추를 눌렀다(ownHistory면 닫힐 때 history 칸을 거두지 않는다 — 떠나는 이동과 겹치지 않게) */
  const confirmed = useRef(false);
  useConfirmBack(() => cancel(), ownHistory, () => confirmed.current);

  useEffect(() => {
    mountedRef.current = true;
    const root = rootRef.current;
    const active = document.activeElement;
    const returnTo = active instanceof HTMLElement && active !== document.body && !root?.contains(active) ? active : null;
    const inerted = root ? inertOutside(root) : [];
    titleRef.current?.focus();
    return () => {
      mountedRef.current = false;
      for (const el of inerted) el.removeAttribute("inert");
      // 연 단추가 아직 있으면 그리로. 없으면(창이 함께 닫힘·메뉴 항목) 건드리지 않는다 — 창의 훅·부르는 쪽이 정한 자리
      if (returnTo && returnTo.isConnected) returnTo.focus();
    };
  }, []);

  function confirm() {
    if (busyRef.current || pendingRef.current) return; // 연타·Enter 연타: 한 번만 부른다
    pendingRef.current = true;
    confirmed.current = true;
    const result = onConfirm();
    if (!result || typeof (result as Promise<unknown>).then !== "function") {
      pendingRef.current = false;
      return;
    }
    setPending(true);
    // 막히면 단추가 disabled라 초점이 떨어진다 — 제목에 둔다(창 밖으로 새지 않게)
    titleRef.current?.focus();
    const settle = () => {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    };
    (result as Promise<unknown>).then(settle, settle);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // 확인만 닫는다(아래 창의 Esc가 다시 확인을 띄우거나 창을 닫지 않게)
      cancel();
      return;
    }
    if (event.key !== "Tab") return;
    // Tab은 창 안에서만 돈다
    const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
    event.preventDefault();
    if (buttons.length === 0) {
      titleRef.current?.focus();
      return;
    }
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.shiftKey ? (at <= 0 ? buttons.length - 1 : at - 1) : at < 0 || at >= buttons.length - 1 ? 0 : at + 1;
    buttons[next]?.focus();
  }

  return (
    <div ref={rootRef} className="close-confirm-layer" onKeyDown={onKeyDown}>
      <div className="close-confirm-backdrop" aria-hidden="true" data-confirm-backdrop="" onClick={cancel} />
      <div
        ref={dialogRef}
        className="close-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        aria-busy={busy ? true : undefined}
      >
        <h2 id={titleId} ref={titleRef} className="close-confirm-title" tabIndex={-1}>
          {title}
        </h2>
        {description ? (
          <p id={descId} className="close-confirm-desc">
            {description}
          </p>
        ) : null}
        <div className="close-confirm-actions">
          <SecondaryButton data-confirm-yes="" busy={busy} onClick={confirm}>
            {busy && busyLabel ? busyLabel : confirmLabel}
          </SecondaryButton>
          <PrimaryButton data-confirm-keep="" busy={busy} onClick={cancel}>
            {cancelLabel}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/**
 * 「저장하지 않고 나갈까요?」(PM d-126 · d-135, 147:2 첫째). 오늘 기록·오늘 할 일 시트·적는 창·이번 주 목표·S8-a·S8-b가 쓴다 —
 * 적던 것이 있을 때 머리 단추·Esc·뒤로 가기·바깥 누름이 이 확인을 띄운다.
 * 위 「나가기」 = 창을 닫는다(저장하지 않는다 — 저장 호출 없음) · 아래 「계속 적기」 = 확인만 닫는다(입력은 그대로). Esc·막·뒤로 가기 = 「계속 적기」.
 * 글은 이 한 곳(CLOSE_CONFIRM_TEXT)에만 있다(PM d-135). 부르는 쪽은 글을 넘기지 않는다.
 */
export const CLOSE_CONFIRM_TEXT = {
  title: "저장하지 않고 나갈까요?",
  keep: "계속 적기",
  close: "나가기",
} as const;

export function CloseConfirm({ onKeep, onClose }: { onKeep: () => void; onClose: () => void }) {
  return <ConfirmDialog title={CLOSE_CONFIRM_TEXT.title} confirmLabel={CLOSE_CONFIRM_TEXT.close} cancelLabel={CLOSE_CONFIRM_TEXT.keep} onConfirm={onClose} onCancel={onKeep} />;
}

/** 147:2 쓰는 곳 글(한 곳). 부르는 쪽은 여기서 가져다 넘긴다 */
export const CONFIRM_TEXT = {
  noteRemove: { title: "이 작업 기록을 지울까요?", confirm: "지우기", busy: "지우는 중", cancel: "그대로 두기" },
  todoRemove: { title: "이 할 일을 지울까요?", description: "작업 기록도 함께 지워져요.", confirm: "지우기", busy: "지우는 중", cancel: "그대로 두기" },
  goalClear: { title: "이번 주 목표를 없앨까요?", confirm: "없애기", busy: "없애는 중", cancel: "그대로 두기" },
  logout: {
    title: "로그아웃할까요?",
    description: "아직 저장되지 않은 기록은 이 기기에서 지워져요.",
    confirm: "로그아웃",
    busy: "로그아웃 중",
    cancel: "계속 쓰기",
  },
} as const;
