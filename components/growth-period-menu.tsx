"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

/**
 * 상태보기 목표 비율 뷰의 기간 칩 하나(원샷 v2 고침9, Figma 50:193·50:598·111:79 「칩 이번 주 ▾」 — 명세 ③-S ② 3).
 * 카드 머리 합계 옆의 작은 칩(보이는 면 높이 24, 11px, --radius-pill, 누름 영역 48). 누르면 기간 목록(이번 주 / 총 시간 / 비교)이 열린다.
 *
 * 메뉴 단추 꼴(WAI-ARIA APG Menu Button):
 * - 칩: aria-haspopup="menu" · aria-expanded · aria-controls(열렸을 때). 이름 = 「기간, {지금 기간}」(aria-label — 보이는 글 「이번 주」를 이름 안에 담는다, ▾는 숨김)
 * - 목록: role="menu", 항목 role="menuitemradio" + aria-checked(지금 기간). 열면 지금 기간 항목에 포커스
 * - 키보드: 칩에서 ↓·Enter·Space = 열기(지금 항목), ↑ = 열기(끝 항목). 목록에서 ↑↓ 옆 항목(끝에서 돌아감), Home·End 처음·끝,
 *   Enter·Space = 고르기(단추 눌림), Esc = 닫고 칩으로 포커스, Tab = 닫기(포커스는 다음 자리로)
 * - 바깥을 누르면 닫힌다(포커스는 옮기지 않는다). 고르면 닫고 칩으로 포커스를 돌린다
 * 고른 값을 기억하는 일(periodWeek)은 부르는 쪽(onSelect)이 한다. 이 부품은 값을 바꾸지 않는다.
 */
export function PeriodMenu<P extends string>({
  value,
  options,
  labelOf,
  groupLabel,
  onSelect,
}: {
  value: P;
  options: readonly P[];
  labelOf: (p: P) => string;
  /** 화면 읽기 묶음 이름(「기간」) */
  groupLabel: string;
  onSelect: (p: P) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** 열 때 포커스를 줄 항목(번호). 열린 뒤 효과가 한 번 쓴다 */
  const focusOnOpen = useRef(0);
  const menuId = useId();

  function openAt(index: number) {
    focusOnOpen.current = index;
    setOpen(true);
  }

  function close(focusChip: boolean) {
    setOpen(false);
    if (focusChip) chipRef.current?.focus();
  }

  // 열리면 정한 항목에 포커스
  useEffect(() => {
    if (open) itemRefs.current[focusOnOpen.current]?.focus();
  }, [open]);

  // 바깥을 누르면 닫는다(칩·목록 안은 제외)
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const current = Math.max(0, options.indexOf(value));

  function onChipKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openAt(current);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(options.length - 1);
    }
  }

  function onMenuKey(event: KeyboardEvent<HTMLUListElement>) {
    const n = options.length;
    const at = itemRefs.current.findIndex((el) => el === document.activeElement);
    const i = at < 0 ? current : at;
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (i + 1) % n;
    else if (event.key === "ArrowUp") next = (i - 1 + n) % n;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    } else if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    itemRefs.current[next]?.focus();
  }

  return (
    <div className="growth-period-menu" ref={rootRef}>
      <button
        ref={chipRef}
        type="button"
        className="growth-period-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${groupLabel}, ${labelOf(value)}`}
        onClick={() => (open ? close(false) : openAt(current))}
        onKeyDown={onChipKey}
      >
        <span className="growth-period-chip-face">
          {labelOf(value)}
          <span className="growth-period-caret" aria-hidden="true">
            {" ▾"}
          </span>
        </span>
      </button>
      {open && (
        <ul className="growth-period-list" role="menu" id={menuId} aria-label={groupLabel} onKeyDown={onMenuKey}>
          {options.map((p, i) => (
            <li key={p} role="none">
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={p === value}
                tabIndex={-1}
                className="growth-period-option"
                onClick={() => {
                  onSelect(p);
                  close(true);
                }}
              >
                {labelOf(p)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
