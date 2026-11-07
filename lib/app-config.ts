/**
 * 대상에 묶인 값을 한 곳에서 읽는다(PRD 5절 원칙 5). 나중에 대상을 넓힐 때 여기만 바꾼다.
 * 화면 코드에 「취업 준비」·분야 예시를 박지 않는다. 값은 모두 (임시)이고 docs/oneshot-v2/임시값.md에 적혀 있다.
 */
export const APP_CONFIG = {
  /** 처음 설정의 분야 예시 칩. 마감 있는 일은 두지 않는다(D-132). 「포트폴리오」는 마감이 있는 일로 읽혀 「글쓰기」로 바꿨다(고침 3바퀴, PM 답 d-69) */
  categoryExamples: ["어학", "글쓰기", "CS 공부", "자격증"] as readonly string[],
  /** 처음 설정 목표 칸의 안내 예시 */
  goalPlaceholder: "예: 토익 900점, 포트폴리오 완성",
  /** 「저녁」의 시작 시각(서울 시). 끝은 새벽 4시(하루가 바뀔 때). 이 시각부터 새벽 4시 전까지는 먼저 할 일 카드를 건네지 않는다 */
  eveningStartHour: 18,
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

/** 지금이 저녁(오후 6시~새벽 4시 전)인가 */
export function isEvening(now: Date): boolean {
  const hour = seoulHour(now);
  return hour >= APP_CONFIG.eveningStartHour || hour < 4;
}
