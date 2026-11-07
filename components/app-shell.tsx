"use client";

import { defaultManageApi } from "../lib/manage-api";
import type { TodayRead } from "../lib/today-types";
import { TodoScreen } from "./todo-screen";

/**
 * 로그인한 뒤의 앱 전체 틀(클라이언트). 서버 컴포넌트(app/page.tsx)가 읽은 값을 받아 탭과 화면을 이어 붙인다.
 * 이번 단계: 할 일 화면에 고치기·지우기·순서·작업 기록·어제 것 가져오기를 단다(PRD 0·0-1번).
 */
export function AppShell({ initial }: { initial: TodayRead }) {
  return <TodoScreen initial={initial} manage={defaultManageApi} />;
}
