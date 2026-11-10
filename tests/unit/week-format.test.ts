import { describe, expect, it } from "vitest";
import { seoulHour } from "../../lib/app-config";
import { formatClock, formatDeltaMinutes, formatMinutes, formatTimer } from "../../lib/time-format";
import { addDays, dayInRange, isDayString, monthStartFor, previousMonthRange, weekDates, weekStartFor } from "../../lib/week";

describe("week", () => {
  it("한 주는 월~일: 어느 요일이든 그 주 월요일을 돌려준다", () => {
    expect(weekStartFor("2026-11-02")).toBe("2026-11-02"); // 월
    expect(weekStartFor("2026-11-07")).toBe("2026-11-02"); // 토
    expect(weekStartFor("2026-11-08")).toBe("2026-11-02"); // 일
    expect(weekStartFor("2026-11-09")).toBe("2026-11-09"); // 다음 월
  });
  it("월 경계와 연 경계를 넘어 계산한다", () => {
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekStartFor("2027-01-01")).toBe("2026-12-28");
    expect(weekDates("2026-12-28")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  });
  it("지난 달 범위와 달 첫날", () => {
    expect(monthStartFor("2026-11-07")).toBe("2026-11-01");
    expect(previousMonthRange("2026-11-07")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(previousMonthRange("2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(previousMonthRange("2026-03-01")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("날짜 문자열 검사와 범위", () => {
    expect(isDayString("2026-02-30")).toBe(false);
    expect(isDayString("2026-11-07")).toBe(true);
    expect(isDayString(20261107)).toBe(false);
    expect(() => addDays("x", 1)).toThrow();
    expect(dayInRange("2026-11-07", "2026-11-02", "2026-11-08")).toBe(true);
    expect(dayInRange("2026-11-09", "2026-11-02", "2026-11-08")).toBe(false);
  });
});

describe("time-format", () => {
  it("0분은 0분으로 보인다", () => {
    expect(formatMinutes(0)).toBe("0분");
    expect(formatMinutes(45)).toBe("45분");
    expect(formatMinutes(60)).toBe("1시간");
    expect(formatMinutes(150)).toBe("2시간 30분");
    expect(formatMinutes(-5)).toBe("0분");
    expect(formatMinutes(Number.NaN)).toBe("0분");
  });
  it("바뀐 시간은 부호가 붙는다", () => {
    expect(formatDeltaMinutes(90)).toBe("+1시간 30분");
    expect(formatDeltaMinutes(-30)).toBe("−30분");
    expect(formatDeltaMinutes(0)).toBe("+0분");
  });
  it("시계와 타이머 글", () => {
    expect(formatClock(19 * 60 + 30)).toBe("오후 7:30");
    expect(formatClock(10 * 60)).toBe("오전 10:00");
    expect(formatClock(0)).toBe("오전 12:00");
    expect(formatClock(12 * 60)).toBe("오후 12:00");
    expect(formatTimer(1800)).toBe("30:00");
    expect(formatTimer(61)).toBe("01:01");
    expect(formatTimer(-3)).toBe("00:00");
  });
});

describe("서울 시각(저녁 판정은 없어졌다 — 고침 11, d-223)", () => {
  it("서울 시각으로 읽는다", () => {
    expect(seoulHour(new Date("2026-11-07T09:00:00.000Z"))).toBe(18);
    expect(seoulHour(new Date("2026-11-07T08:59:00.000Z"))).toBe(17);
    expect(seoulHour(new Date("2026-11-07T18:59:00.000Z"))).toBe(3);
    expect(seoulHour(new Date("2026-11-07T19:00:00.000Z"))).toBe(4);
  });
});
