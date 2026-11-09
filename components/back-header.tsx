"use client";

import type { ReactNode } from "react";

/**
 * 머리 단추 · 화면 머리 · 아래 주 단추 자리 — 여러 화면이 같이 쓰는 부품(고침10 A — Figma 146:10 · 상태 150:58 · PM 3, 앞서 Figma 정합 A1·A2).
 *
 * ── HeadButton(머리 단추, 146:10) ─────────────────────────
 *   <HeadButton kind="back" onClick={...} />   // 「‹」 돌아가기, 화면 읽기 이름 「이전」
 *   <HeadButton kind="close" onClick={...} />  // 「✕」 닫기,    화면 읽기 이름 「닫기」
 * - 겹친 화면마다 왼쪽 위에 하나. 누름 틀 48×48, 아이콘 24 가운데(선 2, --color-text). 아이콘만 보이므로 이름(aria-label)이 꼭 붙는다.
 * - 돌아가기(back): 전체 화면으로 겹친 것 — 할 일 페이지(S2-b) · 분야 페이지(S7) · 지난 날(S2-e) · 처음 설정 2~4단계 · S8-a · S8-b · 오늘 기록(S5).
 * - 닫기(close): 아래에서 올라온 시트 — 적는 창(S2-a) · 이번 주 목표(S2-d) · 분야 고르기(S2-b′) · 오늘 할 일 시트(S5-1).
 * - 상태(150:58): 초점 = 틀 둘레 2px #1C2340 링, 틀에서 2px 떨어짐, 모서리 12 · 눌림 = 틀 바탕 #E7E1D6(--color-secondary-pressed) · 막힘 = disabled(흐림, 처음 설정 저장 중만).
 * - 자리: 판(화면·시트) 왼쪽 4 · 위 10. 판의 안 여백이 기본(위 24 · 옆 16)과 다르면 판에 CSS 변수 --panel-pad-top · --panel-pad-x를 둔다(app/globals.css).
 * - 「‹ 할 일」 같은 글 단추, 오른쪽 위 글 「닫기」는 쓰지 않는다(고침10 A). 닫기 전 확인은 부르는 쪽 몫(components/close-confirm.tsx).
 *
 * ── BackHeader(화면 머리 한 줄, 위 HeadButton을 품는다) ─────────
 *   <BackHeader onBack={...} />                               // 왼쪽 위 「‹」만(큰 제목은 머리 밖, 아래)
 *   <BackHeader onBack={...} title="오늘 기록" titleId="..." /> // 「‹」 + 가운데 화면 이름 16 Bold
 *   <BackHeader onClose={...} title={<h2 …>…</h2>} titleAlign="start" /> // 시트: 「✕」 + 바로 옆 제목
 *   <BackHeader onBack={...} end={<저장 상태 · ⋯>} />          // 오른쪽 끝에 화면 도구
 *   <BackHeader onBack={step > 1 ? goBack : undefined} step={{ n, total }} /> // 처음 설정: 「4단계 중 n단계」 + 진행 막대 넷
 * - onBack과 onClose는 둘 중 하나만 넘긴다(둘 다 넘기면 onBack). 둘 다 없으면 단추 자리 없이 줄만 그린다(처음 설정 1단계).
 * - disabled(옛 이름 backDisabled)로 머리 단추를 막는다(저장 중). buttonId는 머리 단추의 id(초점 되돌리기용).
 * - title이 글이면 <p>로, 요소면 그대로 그린다(시트가 자기 h2·label을 넘길 수 있다). titleId는 글일 때 그 <p>에 붙는다.
 *
 * ── BottomActions(A2 주 단추 자리) ─────────────────────────
 * 폭 가득(좌우 = 화면 안쪽 16), 화면 아래에 붙고(아래 여백 36), 내용이 짧아도 아래로 밀린다(부모가 .screen-fill).
 * 단추는 위에서 아래로 쌓인다. 내용이 길면 화면 끝 내용이 단추에 가리지 않는다(흐름 안에 있는 sticky).
 * 아래 탭이 있는 화면은 --bottom-actions-offset(탭 높이)만큼 위에 붙는다.
 * 저장 중(O-7)은 주 단추의 busy(components/ui.tsx — 막힘 + aria-busy + 흐림 0.45)와 글 「저장 중」(BACK_HEADER_TEXT.saving)으로 보인다.
 *
 * 글은 React 텍스트로만 그린다.
 */
export const BACK_HEADER_TEXT = {
  back: "이전",
  close: "닫기",
  step: (n: number, total: number) => `${total}단계 중 ${n}단계`,
  /** 저장 중 주 단추 글(명세 ⑭ O-7) */
  saving: "저장 중",
} as const;

export type HeadButtonKind = "back" | "close";

/** 머리 단추 아이콘 24(선 2, 끝 둥글게). 꾸밈이라 화면 읽기에서 숨긴다 — 이름은 단추의 aria-label */
function HeadIcon({ kind }: { kind: HeadButtonKind }) {
  return (
    <svg className="head-btn-icon" width={24} height={24} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {kind === "back" ? (
        <path d="M15 5L8 12L15 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M6 6L18 18M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export function HeadButton({
  kind,
  onClick,
  disabled,
  id,
}: {
  kind: HeadButtonKind;
  onClick: () => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      className={`head-btn head-btn-${kind}`}
      aria-label={kind === "back" ? BACK_HEADER_TEXT.back : BACK_HEADER_TEXT.close}
      data-head-button={kind}
      disabled={disabled}
      onClick={onClick}
    >
      <HeadIcon kind={kind} />
    </button>
  );
}

export function BackHeader({
  onBack,
  onClose,
  disabled,
  backDisabled,
  buttonId,
  title,
  titleId,
  titleAlign = "center",
  end,
  step,
}: {
  /** 있으면 왼쪽 위 「‹」(화면 읽기 「이전」) */
  onBack?: () => void;
  /** 있으면 왼쪽 위 「✕」(화면 읽기 「닫기」) — 시트 */
  onClose?: () => void;
  /** 머리 단추 막힘 */
  disabled?: boolean;
  /** disabled의 옛 이름(처음 설정·오늘 기록이 쓰던 것) */
  backDisabled?: boolean;
  /** 머리 단추의 id(부르는 쪽이 초점을 돌려보낼 때) */
  buttonId?: string;
  /** 화면 이름. 글이면 16 Bold <p>, 요소면 그대로 */
  title?: ReactNode;
  titleId?: string;
  /** 화면 이름 자리: 가운데(전체 화면) · 단추 바로 옆(시트) */
  titleAlign?: "center" | "start";
  /** 오른쪽 끝 도구(저장 상태 · 「⋯」 등) */
  end?: ReactNode;
  /** 처음 설정 단계 글 + 진행 막대 */
  step?: { n: number; total: number };
}) {
  const kind: HeadButtonKind | null = onBack ? "back" : onClose ? "close" : null;
  const handler = onBack ?? onClose;
  const button = kind && handler ? <HeadButton kind={kind} id={buttonId} onClick={handler} disabled={disabled ?? backDisabled} /> : null;
  const centered = !step && titleAlign === "center" && (title !== undefined || end !== undefined);
  const titleNode =
    title === undefined ? null : typeof title === "string" ? (
      <p className="screen-head-title" id={titleId}>
        {title}
      </p>
    ) : (
      <div className="screen-head-title">{title}</div>
    );
  const rowClass = ["screen-head-row", centered && "screen-head-row-center", !step && titleAlign === "start" && "screen-head-row-start"].filter(Boolean).join(" ");
  return (
    <div className={button ? "screen-head" : "screen-head screen-head-no-back"}>
      <div className={rowClass}>
        {button ?? (centered && <span className="screen-head-slot" aria-hidden="true" />)}
        {step ? <p className="screen-head-step">{BACK_HEADER_TEXT.step(step.n, step.total)}</p> : titleNode}
        {centered && !titleNode && <span />}
        {end ? <div className="screen-head-end">{end}</div> : centered && <span className="screen-head-slot" aria-hidden="true" />}
      </div>
      {step && (
        <div className="screen-head-progress" aria-hidden="true">
          {Array.from({ length: step.total }, (_, i) => (
            <span key={i} className={i < step.n ? "screen-head-bar is-done" : "screen-head-bar"} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BottomActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `bottom-actions ${className}` : "bottom-actions"}>{children}</div>;
}
