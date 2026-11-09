"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";

/**
 * 분야 칩 줄(고침 5바퀴, PM 10-26 · D-125 · 명세 ⑦-1·④-2): 칩을 한 줄로만 놓고, 넘치면 옆으로 끌어(손가락·트랙패드 가로 스크롤) 넘긴다.
 * - 두 줄 감싸기 없음. 칩 모양·고르기 논리는 부르는 쪽이 정한다(칩은 자식으로 받는다).
 * - 넘친 쪽 끝 24px은 바탕으로 옅어진다(CSS mask, 뒤 바탕이 종이색이면 종이색으로). 오른쪽 끝 칩이 잘려 보여 더 있음을 알린다.
 * - 끌지 않는 길(WCAG 2.5.7): 줄 끝 「›」, 넘어간 뒤 왼쪽 「‹」. 보이는 면 32 · 누름 48, 칩 줄 밖 제 칸에 놓여 칩을 가리지 않는다.
 *   한 번 누르면 칩 줄 한 화면 폭만큼 넘긴다. 넘길 것이 없는 쪽 단추는 그리지 않는다.
 *   단추는 Tab 순서에 넣지 않는다(tabIndex -1): 키보드는 Tab으로 칩을 하나씩 지나고, 포커스한 칩이 보이게 줄이 넘어간다.
 *   화면 읽기 도구는 이름(「앞 분야 보기」·「분야 더 보기」)으로 단추에 닿는다.
 * - 움직임 줄이기(prefers-reduced-motion)면 부드러운 스크롤 없이 바로 옮긴다.
 */
export const CHIP_SCROLLER_TEXT = {
  prev: "앞 분야 보기",
  next: "분야 더 보기",
} as const;

/** 끝에 닿았다고 보는 여유(px). 소수 픽셀 반올림으로 단추가 남지 않게 */
const EDGE_SLACK = 1;

type GroupName = { "aria-label": string; "aria-labelledby"?: undefined } | { "aria-labelledby": string; "aria-label"?: undefined };

export type ChipScrollerProps = GroupName & {
  /** 칩 단추들. 칩 줄(role=group) 바로 아래 자식이 된다 */
  children: ReactNode;
  /** 칩 줄(.chip-row)에 더할 class */
  className?: string;
  /** 단추 이름을 바꿀 때만(기본은 분야 칩 줄의 이름) */
  prevLabel?: string;
  nextLabel?: string;
};

type Edges = { start: boolean; end: boolean };

/** 넘길 것이 왼쪽(start)·오른쪽(end)에 남았는가 */
export function scrollEdges(el: Pick<HTMLElement, "scrollLeft" | "scrollWidth" | "clientWidth">): Edges {
  const max = el.scrollWidth - el.clientWidth;
  return { start: el.scrollLeft > EDGE_SLACK, end: max - el.scrollLeft > EDGE_SLACK };
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ChipScroller({ children, className, prevLabel = CHIP_SCROLLER_TEXT.prev, nextLabel = CHIP_SCROLLER_TEXT.next, ...name }: ChipScrollerProps) {
  const viewportId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });
  // 칩에 포커스가 막 왔는가. 포커스한 칩을 보이게 넘기면 「‹」「›」가 나고 들어 칩 줄 폭이 48 바뀌고, 그 칩이 다시 줄 밖으로 밀릴 수 있다.
  // 그래서 포커스 뒤 단추가 바뀌면 한 번 더 보이게 넘긴다. 손가락·휠로 직접 넘기거나 단추로 넘기면 지운다(사용자가 넘기는 것과 싸우지 않게)
  const refocus = useRef(false);

  const measure = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const next = scrollEdges(el);
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  // 칩이 바뀌면(더함·고름으로 체크가 붙어 폭이 바뀜) 그리기 전에 다시 잰다
  useLayoutEffect(measure);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!refocus.current || !el) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== el && el.contains(active)) active.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [edges.start, edges.end]);

  // 줄 폭이 바뀌거나(화면 돌림·창 크기) 칩 폭이 바뀌면(글자 크기·글꼴 늦게 옴) 다시 잰다
  useEffect(() => {
    const el = viewport.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  });

  const page = (dir: 1 | -1) => {
    const el = viewport.current;
    if (!el) return;
    refocus.current = false;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const left = Math.min(max, Math.max(0, el.scrollLeft + dir * el.clientWidth));
    if (typeof el.scrollTo === "function") el.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    else el.scrollLeft = left;
    measure();
  };

  // 키보드로 칩에 옮기면 그 칩이 보이게 넘긴다(scroll-padding 24px이라 옅어지는 띠 밖으로 나온다)
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) return;
    refocus.current = true;
    (e.target as HTMLElement).scrollIntoView?.({ inline: "nearest", block: "nearest" });
  };
  const userScrolls = () => {
    refocus.current = false;
  };

  return (
    <div className="chip-scroller" data-more-start={edges.start || undefined} data-more-end={edges.end || undefined}>
      {edges.start && (
        <ChipNavButton dir="prev" label={prevLabel} controls={viewportId} onPress={() => page(-1)} />
      )}
      <div
        id={viewportId}
        ref={viewport}
        className={className ? `chip-row ${className}` : "chip-row"}
        role="group"
        {...name}
        onScroll={measure}
        onFocus={onFocus}
        onPointerDown={userScrolls}
        onWheel={userScrolls}
      >
        {children}
      </div>
      {edges.end && <ChipNavButton dir="next" label={nextLabel} controls={viewportId} onPress={() => page(1)} />}
    </div>
  );
}

function ChipNavButton({ dir, label, controls, onPress }: { dir: "prev" | "next"; label: string; controls: string; onPress: () => void }) {
  return (
    <button
      type="button"
      className={`chip-nav chip-nav-${dir}`}
      aria-label={label}
      aria-controls={controls}
      tabIndex={-1}
      // 손가락·마우스로 누를 때 단추가 포커스를 가져가지 않게(끝에 닿아 단추가 사라지면 포커스가 갈 곳을 잃는다)
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      <span className="chip-nav-face" aria-hidden="true">
        <svg width={16} height={16} viewBox="0 0 16 16" focusable="false">
          <path
            d={dir === "next" ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5"}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}
