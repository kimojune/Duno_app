"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

/**
 * 아래 탭 줄의 실제 높이(B9): 글자가 커져 두 줄이 되면 본문 아래 여백(--tabbar-h)도 따라 늘린다.
 * 재기 전·아직 그려지지 않았을 때(0)는 한 줄 기준 값 + 안전 영역을 쓴다.
 * AppShell과 개발용 화면 모음(/dev/v2)이 같은 코드를 쓴다: 시험 화면이 실제 앱과 다른 여백을 쓰지 않게.
 * 돌려받은 ref를 .tabbar를 품은 가장 바깥 요소에 달고, style을 같은 요소에 건다.
 */
export function useTabbarHeight<T extends HTMLElement = HTMLDivElement>(): { shellRef: RefObject<T | null>; shellStyle: CSSProperties } {
  const shellRef = useRef<T | null>(null);
  const [tabbarH, setTabbarH] = useState<number | null>(null);
  useEffect(() => {
    const bar = shellRef.current?.querySelector<HTMLElement>(".tabbar");
    if (!bar) return;
    const measure = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height);
      if (height > 0) setTabbarH(height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  const shellStyle = { "--tabbar-h": tabbarH === null ? "calc(56px + env(safe-area-inset-bottom))" : `${tabbarH}px` } as CSSProperties;
  return { shellRef, shellStyle };
}
