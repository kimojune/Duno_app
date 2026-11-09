"use client";

import type { ReactNode } from "react";
import { TextButton } from "./ui";

/**
 * 화면 머리 · 아래 주 단추 자리 — 여러 화면이 같이 쓰는 부품(Figma 정합 A1·A2, PM d-146 · 디자인 명세 ⑩ PM 1 · ④-2).
 *
 * BackHeader(A1): 맨 위 한 줄 머리. 셋을 props로 켜고 끈다.
 * - onBack → 왼쪽 위 「‹」(PM 1-A). 아이콘만 보이므로 화면 읽기 이름 「이전」(WCAG 1.1.1·4.1.2), 누름 48×48, 머리 줄 맨 앞이라 포커스 순서 첫째.
 *   단계가 있는 화면(처음 설정 2~4단계 · 오늘 기록 나누기)과 S8-a·S8-b가 쓴다. 아래 단추 줄에는 「이전」 글 단추를 두지 않는다.
 * - title → 가운데 화면 이름(16 Bold). 큰 제목(24 Bold)은 머리 밖(부르는 쪽, 머리 아래)에 둔다.
 * - onClose → 오른쪽 「닫기」(14 보조, 누름 48). 닫기 전 확인은 부르는 쪽 몫(components/close-confirm.tsx).
 * - step → 처음 설정의 단계 글 「4단계 중 n단계」(「‹」 오른쪽, 없으면 왼쪽 끝) + 아래 진행 막대 넷(높이 4, 지난 단계까지 먹남색 — 꾸밈이라 화면 읽기에서 숨김).
 *
 * BottomActions(A2): 주 단추 자리. 폭 가득(좌우 = 화면 안쪽 16), 화면 아래에 붙고(아래 여백 36), 내용이 짧아도 아래로 밀린다(부모가 .screen-fill).
 * 단추는 위에서 아래로 쌓인다(주 단추 위 · 보조 단추 아래 등). 내용이 길면 화면 끝 내용이 단추에 가리지 않는다(흐름 안에 있는 sticky).
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

export function BackHeader({
  onBack,
  backDisabled,
  title,
  titleId,
  onClose,
  closeLabel = BACK_HEADER_TEXT.close,
  closeDisabled,
  step,
}: {
  /** 있으면 왼쪽 위 「‹」(화면 읽기 「이전」) */
  onBack?: () => void;
  backDisabled?: boolean;
  /** 가운데 화면 이름(16 Bold) */
  title?: ReactNode;
  titleId?: string;
  /** 있으면 오른쪽 「닫기」 */
  onClose?: () => void;
  closeLabel?: string;
  closeDisabled?: boolean;
  /** 처음 설정 단계 글 + 진행 막대 */
  step?: { n: number; total: number };
}) {
  const centered = !step && (title !== undefined || onClose !== undefined);
  return (
    <div className={onBack ? "screen-head" : "screen-head screen-head-no-back"}>
      <div className={step ? "screen-head-row" : "screen-head-row screen-head-row-center"}>
        {onBack ? (
          <button type="button" className="overlay-back" aria-label={BACK_HEADER_TEXT.back} disabled={backDisabled} onClick={onBack}>
            <span aria-hidden="true">‹</span>
          </button>
        ) : (
          centered && <span className="screen-head-slot" aria-hidden="true" />
        )}
        {step ? (
          <p className="screen-head-step">{BACK_HEADER_TEXT.step(step.n, step.total)}</p>
        ) : (
          <p className="screen-head-title" id={titleId}>
            {title}
          </p>
        )}
        {onClose ? (
          <TextButton className="screen-head-close text-tap" disabled={closeDisabled} onClick={onClose}>
            {closeLabel}
          </TextButton>
        ) : (
          centered && <span className="screen-head-slot" aria-hidden="true" />
        )}
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
