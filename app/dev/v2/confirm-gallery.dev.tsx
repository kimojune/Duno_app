"use client";

import { useState, type ReactNode } from "react";
import { BackHeader } from "../../../components/back-header";
import { CLOSE_CONFIRM_TEXT, CONFIRM_TEXT, ConfirmDialog } from "../../../components/close-confirm";

/**
 * 고침10 공통 부품 둘의 개발 갤러리(/dev/v2?s=…). 다음 화면 워커와 사진 워커가 같은 자리에서 찍는다.
 *  - confirm-leave · confirm-note · confirm-todo · confirm-goal · confirm-logout: 확인 창 쓰는 곳 다섯(Figma 147:2 글 그대로). 창이 열린 채로 뜬다
 *  - confirm-busy: 작업 기록 지우기 확인에서 「지우기」를 누른 뒤 응답 전(「지우는 중」 + 두 단추 막힘, 150:58)
 *  - head-back · head-close: 머리 단추 두 변형(146:10). head-back = 전체 화면 「‹」, head-close = 아래에서 올라온 시트 「✕」
 * 확인 창의 단추를 누르면 창이 닫히고 「다시 열기」가 남는다(초점이 연 단추로 돌아가는지 본다). 서버·네트워크를 부르지 않는다.
 */

export const CONFIRM_GALLERY_IDS = ["confirm-leave", "confirm-note", "confirm-todo", "confirm-goal", "confirm-logout", "confirm-busy", "head-back", "head-close"] as const;
export type ConfirmGalleryId = (typeof CONFIRM_GALLERY_IDS)[number];

export function isConfirmGalleryId(id: string): id is ConfirmGalleryId {
  return (CONFIRM_GALLERY_IDS as readonly string[]).includes(id);
}

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <main style={{ padding: 16 }}>
      <p className="todo-sub">창 뒤의 본문</p>
      {children}
    </main>
  );
}

function never(): Promise<void> {
  return new Promise(() => {});
}

function Dialog({ id, onDone }: { id: ConfirmGalleryId; onDone: () => void }) {
  switch (id) {
    case "confirm-leave":
      return <ConfirmDialog title={CLOSE_CONFIRM_TEXT.title} confirmLabel={CLOSE_CONFIRM_TEXT.close} cancelLabel={CLOSE_CONFIRM_TEXT.keep} onConfirm={onDone} onCancel={onDone} />;
    case "confirm-note":
    case "confirm-busy": {
      const t = CONFIRM_TEXT.noteRemove;
      return <ConfirmDialog title={t.title} confirmLabel={t.confirm} busyLabel={t.busy} cancelLabel={t.cancel} busy={id === "confirm-busy"} onConfirm={never} onCancel={onDone} />;
    }
    case "confirm-todo": {
      const t = CONFIRM_TEXT.todoRemove;
      return <ConfirmDialog title={t.title} description={t.description} confirmLabel={t.confirm} busyLabel={t.busy} cancelLabel={t.cancel} onConfirm={never} onCancel={onDone} />;
    }
    case "confirm-goal": {
      const t = CONFIRM_TEXT.goalClear;
      return <ConfirmDialog title={t.title} confirmLabel={t.confirm} busyLabel={t.busy} cancelLabel={t.cancel} onConfirm={never} onCancel={onDone} />;
    }
    case "confirm-logout": {
      const t = CONFIRM_TEXT.logout;
      return <ConfirmDialog title={t.title} description={t.description} confirmLabel={t.confirm} busyLabel={t.busy} cancelLabel={t.cancel} ownHistory onConfirm={never} onCancel={onDone} />;
    }
    default:
      return null;
  }
}

export function ConfirmGallery({ id }: { id: ConfirmGalleryId }) {
  const [open, setOpen] = useState(true);
  if (id === "head-back") {
    return (
      <div className="detail" role="dialog" aria-modal="true" aria-labelledby="dev-head-title">
        <div className="detail-inner">
          <BackHeader onBack={() => {}} />
          <h2 id="dev-head-title" className="detail-title">
            지난 날
          </h2>
          <p className="todo-sub">머리 단추 돌아가기 「‹」(화면 읽기 「이전」)</p>
        </div>
      </div>
    );
  }
  if (id === "head-close") {
    return (
      <Backdrop>
        <div className="category-sheet-layer">
          <div className="category-sheet-backdrop" aria-hidden="true" />
          <div className="category-sheet" role="dialog" aria-modal="true" aria-labelledby="dev-head-title">
            <BackHeader
              onClose={() => {}}
              titleAlign="start"
              title={
                <h2 id="dev-head-title" className="category-sheet-title">
                  분야 고르기
                </h2>
              }
            />
            <p className="todo-sub" style={{ padding: "8px 24px 24px" }}>
              머리 단추 닫기 「✕」(화면 읽기 「닫기」)
            </p>
          </div>
        </div>
      </Backdrop>
    );
  }
  return (
    <Backdrop>
      <button type="button" className="btn btn-secondary" id="dev-confirm-open" onClick={() => setOpen(true)}>
        다시 열기
      </button>
      {open && <Dialog id={id} onDone={() => setOpen(false)} />}
    </Backdrop>
  );
}
