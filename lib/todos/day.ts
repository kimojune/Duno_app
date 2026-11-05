import type { TodoDay } from "./types";

/**
 * 두노의 하루: Asia/Seoul 기준 새벽 4시에 바뀐다(기획서 9절, 디자인 명세 D9).
 * 서울 03:59는 전날, 04:00부터 그날이다. 순수 함수라 화면·서버 어디서나 쓸 수 있다.
 */
export const DAY_TIME_ZONE = "Asia/Seoul";
export const DAY_START_HOUR = 4;

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** now가 속한 두노 하루를 'YYYY-MM-DD'로 돌려준다. */
export function todoDayFor(now: Date): string {
  const ms = now.getTime();
  if (Number.isNaN(ms)) throw new RangeError("invalid date");
  // 서울은 일광 절약 시간이 없어, 시각을 4시간 당긴 뒤 서울 날짜를 읽으면 된다.
  const parts = formatter.formatToParts(new Date(ms - DAY_START_HOUR * 60 * 60 * 1000));
  const get = (type: "year" | "month" | "day") => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** 'YYYY-MM-DD'를 화면 날짜 글의 재료로 나눈다. 요일은 시간대와 상관없이 달력 날짜로 센다. */
export function describeTodoDay(date: string): TodoDay {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("invalid day");
  const [year, month, dayOfMonth] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
  return { date, year, month, dayOfMonth, weekday };
}
