/**
 * 알림을 보낼 때가 됐는가(순수 계산, PRD 7-8). 시각은 서울 기준 자정부터의 분(0~1439).
 * 예약 실행이 windowMinutes마다 돈다고 보고, 「지금 창」 [now - window + 1, now] 안에 정한 시각이 있으면 이번 실행에서 보낸다.
 * 그러면 하루에 한 번씩만 걸리고(실행 간격 = 창 크기일 때), 자정을 넘는 창도 맞는다.
 */
export const NOTIFY_WINDOW_MINUTES_DEFAULT = 15;

export function seoulMinuteOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: "hour" | "minute") => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

export function isDue(targetMinute: number, nowMinute: number, windowMinutes: number): boolean {
  const elapsed = (nowMinute - targetMinute + 1440) % 1440; // 정한 시각 뒤로 몇 분 지났나
  return elapsed >= 0 && elapsed < windowMinutes;
}

/** 예약 실행 간격(분) 설정값을 읽는다. 1~120 사이 정수가 아니면 기본값 */
export function parseWindowMinutes(value: string | number | undefined | null): number {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 120 ? minutes : NOTIFY_WINDOW_MINUTES_DEFAULT;
}

/** 정한 시각이 지난 지 몇 분인가(0~1439). 아직 오지 않은 시각은 하루에서 남은 만큼 큰 수가 된다 */
export function minutesSince(targetMinute: number, nowMinute: number): number {
  return (nowMinute - targetMinute + 1440) % 1440;
}
