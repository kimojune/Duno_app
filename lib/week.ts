/**
 * 두노 하루 문자열('YYYY-MM-DD')로 하는 날짜 계산(순수 함수, 시간대 없음).
 * 한 주는 월~일(PRD 10절). 하루가 새벽 4시에 바뀌는 계산은 lib/todos/day.ts가 맡고, 여기는 이미 정해진 하루 문자열만 다룬다.
 */

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(day: string): Date {
  const m = DAY_PATTERN.exec(day);
  if (!m) throw new RangeError("invalid day");
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date.toISOString().slice(0, 10) !== day) throw new RangeError("invalid day");
  return date;
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isDayString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    parse(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(day: string, amount: number): string {
  const date = parse(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return format(date);
}

/** 그 하루가 속한 주의 월요일 */
export function weekStartFor(day: string): string {
  const date = parse(day);
  const weekday = date.getUTCDay(); // 0=일
  const back = (weekday + 6) % 7; // 월=0 … 일=6
  return addDays(day, -back);
}

/** 월요일부터 7일 */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** 그 하루가 속한 달의 첫날 */
export function monthStartFor(day: string): string {
  parse(day);
  return `${day.slice(0, 8)}01`;
}

/** 그 하루가 속한 달의 바로 앞 달 전체(from~to 모두 포함) */
export function previousMonthRange(day: string): { from: string; to: string } {
  const thisMonth = monthStartFor(day);
  const to = addDays(thisMonth, -1);
  return { from: monthStartFor(to), to };
}

/** a가 b보다 앞이면 음수, 같으면 0 (같은 형식 문자열은 사전순이 날짜순) */
export function compareDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** from~to(둘 다 포함)에 든 하루인가 */
export function dayInRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}
