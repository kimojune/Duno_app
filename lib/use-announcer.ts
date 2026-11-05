"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 화면 읽기 프로그램용 안내 글(명세 2-6). announce(text)는 글을 넣는다.
 * 같은 글을 다시 읽히려면 announce(text, { again: true }): 비운 뒤 100ms 뒤에 다시 넣는다.
 */
export function useAnnouncer(initial = ""): [string, (text: string, options?: { again?: boolean }) => void] {
  const [message, setMessage] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const announce = useCallback((text: string, options?: { again?: boolean }) => {
    if (timer.current) clearTimeout(timer.current);
    if (options?.again) {
      setMessage("");
      timer.current = setTimeout(() => setMessage(text), 100);
    } else {
      setMessage(text);
    }
  }, []);

  return [message, announce];
}
