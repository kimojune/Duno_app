import type { RecordResult } from "./records/common";
import type { SettingsData } from "./settings/types";
import type { TodayRead } from "./today-types";

/**
 * 로그인한 앱이 처음 열릴 때 서버가 한꺼번에 읽어 넘기는 값(app/page.tsx → AppShell).
 * 칸마다 결과를 나눈다: 한 칸이 실패해도 나머지 화면은 보인다(오늘 목록·분야는 TodayRead 그대로).
 * 화면 코드도 import해도 되는 타입만 둔다.
 */
export type HomeRead = {
  today: TodayRead;
  /** 처음 설정·알림 설정·처음 정한 비율. 못 읽으면 처음 설정을 강요하지 않는다(임시) */
  settings: RecordResult<SettingsData>;
};
