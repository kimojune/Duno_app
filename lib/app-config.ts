/**
 * 대상에 묶인 값을 한 곳에서 읽는다(PRD 5절 원칙 5). 나중에 대상을 넓힐 때 여기만 바꾼다.
 * 화면 코드에 「취업 준비」·분야 예시를 박지 않는다. 값은 모두 (임시)이고 docs/oneshot-v2/임시값.md에 적혀 있다.
 */
export const APP_CONFIG = {
  /** 처음 설정의 분야 예시 칩. 마감 있는 일은 두지 않는다(D-132). 마감이 있는 일로 읽히는 예시는 「글쓰기」로 바꿨다(고침 3바퀴, PM 답 d-69) */
  categoryExamples: ["어학", "글쓰기", "CS 공부", "자격증"] as readonly string[],
  /** 처음 설정 목표 칸의 안내 예시 */
  goalPlaceholder: "예: 글 한 편 끝내고 토익 800점 넘기기",
  /**
   * 먼저 할 일 카드에서 바로 타이머를 켜는 길(「30분 시작」)을 보일까(PM 11-10: 따로 기능으로 보관). 기본 false = 고침 11-2 화면(카드에 「30분 시작」 없음, 타이머 입구는 타이머 탭 하나).
   * true로 바꾸면 이미 목록에 있는 할 일 · 분야만 건넬 때의 카드가 예전(고침 11)처럼 「30분 시작」 + 「넘기기」가 되고, 누르면 타이머가 켜지며 offer_id = 카드 제시 id · surface card로 센다.
   * 지난 날 할 일(「오늘 할 일에 추가」)·추가한 뒤(L5) 꼴은 값과 상관없다.
   */
  cardStartEnabled: false,
  /** 건네는 타이머 길이(분) */
  timerMinutes: 30,
  /** 알림 기본 시각(자정부터 분). 저녁 오후 7시 30분, 아침 오전 10시 */
  notifyEveningMinute: 19 * 60 + 30,
  notifyMorningMinute: 10 * 60,
  /** 분야 시간 입력 단위(분) */
  minuteStep: 5,
  /** 하루 쓴 시간 최대(분). 24시간 */
  maxDayMinutes: 24 * 60,
  /** 이번 주 목표 한 주 최대(시간). 168시간 */
  maxWeekGoalHours: 168,
} as const;

/** 서울 시간 기준 시(0~23) */
export function seoulHour(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}
