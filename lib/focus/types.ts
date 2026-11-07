/** 타이머(먼저 한 기록)가 화면에 돌려주는 모양(서버 비밀 없음, 화면도 import해도 된다) */

export const FOCUS_SURFACES = ["card", "timer_tab", "manual"] as const;
export type FocusSurface = (typeof FOCUS_SURFACES)[number];

export type FocusSession = {
  id: string;
  /** 서버가 시작을 받은 시각(ISO) */
  startedAt: string;
  /** 시작한 두노 하루 */
  day: string;
  plannedMinutes: number;
  endedAt: string | null;
  elapsedSeconds: number | null;
  todoId: string | null;
  /** null은 기타 */
  categoryId: string | null;
  /** 건넨 것(제시 기록)으로 켰으면 그 번호 */
  offerId: string | null;
  surface: FocusSurface;
  oppositeByGoal: boolean | null;
  oppositeByRatio: boolean | null;
};

/** 타이머 화면이 열릴 때 읽는 것 */
export type FocusState = {
  /** 서버 시각(ISO). 화면은 기기 시계와의 차이로 남은 시간을 맞춘다 */
  serverNow: string;
  /** 아직 끝내지 않은 가장 최근 세션(없으면 null) */
  active: FocusSession | null;
  /** 오늘(두노 하루) 시작한 세션들(오래된 것이 위) */
  today: FocusSession[];
};

export type StartedFocus = { session: FocusSession; serverNow: string };
export type EndedFocus = { session: FocusSession };
