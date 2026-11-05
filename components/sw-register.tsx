"use client";

import { useEffect } from "react";

// 프로덕션 빌드에서만 서비스 워커를 등록한다.
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // 등록 실패는 앱 동작에 영향 없음
      });
  }, []);
  return null;
}
