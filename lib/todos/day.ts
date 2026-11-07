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

/** 오프라인으로 적은 글이 쓰는 「적은 때」를 믿는 범위: 최근 72시간, 미래는 5분까지(기기 시계 오차). 이 밖은 서버 시계를 따른다(임시) */
export const WRITTEN_AT_MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const WRITTEN_AT_MAX_FUTURE_MS = 5 * 60 * 1000;

/** 할 일이 들어갈 하루: writtenAt이 믿을 수 있는 ISO 시각이면 그 시각의 하루, 아니면 now의 하루 */
export function resolveWriteDay(now: Date, writtenAt: unknown): string {
  if (typeof writtenAt === "string" && writtenAt.length <= 40) {
    const ms = Date.parse(writtenAt);
    if (Number.isFinite(ms)) {
      const delta = now.getTime() - ms;
      if (delta <= WRITTEN_AT_MAX_AGE_MS && delta >= -WRITTEN_AT_MAX_FUTURE_MS) return todoDayFor(new Date(ms));
    }
  }
  return todoDayFor(now);
}
