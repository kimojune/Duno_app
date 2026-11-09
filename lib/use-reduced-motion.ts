"use client";

import { useSyncExternalStore } from "react";

/** 「동작 줄이기」 미디어 질의(OS 설정). 다이얼 조각 나옴·두 줄 휠 걸림·저장 직후 막대 차오름이 같이 따른다 */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener?.("change", onChange);
  return () => mql.removeEventListener?.("change", onChange);
}

/** 「동작 줄이기」를 켰나. matchMedia가 없으면(서버·옛 브라우저) 끈 것으로 본다 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}
