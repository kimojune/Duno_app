import { describe, expect, it } from "vitest";
import { describeTodoDay, todoDayFor } from "../../lib/todos/day";

// 서울은 UTC+9. 서울 시각 → UTC로 바꿔 넣는다.
const seoul = (iso: string) => new Date(`${iso}+09:00`);

describe("todoDayFor (서울 새벽 4시 경계)", () => {
  it("03:59는 전날, 04:00은 그날", () => {
    expect(todoDayFor(seoul("2026-11-05T03:59:59.999"))).toBe("2026-11-04");
    expect(todoDayFor(seoul("2026-11-05T04:00:00.000"))).toBe("2026-11-05");
  });

  it("서울 자정~04시는 아직 전날", () => {
    expect(todoDayFor(seoul("2026-11-05T00:00:00"))).toBe("2026-11-04");
    expect(todoDayFor(seoul("2026-11-04T23:59:59"))).toBe("2026-11-04");
  });

  it("UTC 날짜가 바뀌는 시각 근처(서울 09시)", () => {
    expect(todoDayFor(new Date("2026-11-04T23:59:59Z"))).toBe("2026-11-05");
    expect(todoDayFor(new Date("2026-11-05T00:00:00Z"))).toBe("2026-11-05");
    // UTC 18:59 = 서울 03:59, UTC 19:00 = 서울 04:00
    expect(todoDayFor(new Date("2026-11-04T18:59:59Z"))).toBe("2026-11-04");
    expect(todoDayFor(new Date("2026-11-04T19:00:00Z"))).toBe("2026-11-05");
  });

  it("월말", () => {
    expect(todoDayFor(seoul("2026-12-01T03:59:00"))).toBe("2026-11-30");
    expect(todoDayFor(seoul("2026-12-01T04:00:00"))).toBe("2026-12-01");
    expect(todoDayFor(seoul("2028-03-01T03:59:00"))).toBe("2028-02-29"); // 윤년
    expect(todoDayFor(seoul("2027-03-01T03:59:00"))).toBe("2027-02-28");
  });

  it("연말", () => {
    expect(todoDayFor(seoul("2027-01-01T03:59:00"))).toBe("2026-12-31");
    expect(todoDayFor(seoul("2027-01-01T04:00:00"))).toBe("2027-01-01");
  });

  it("잘못된 날짜는 던진다", () => {
    expect(() => todoDayFor(new Date("nope"))).toThrow(RangeError);
  });
});

describe("describeTodoDay (화면 날짜 글 재료)", () => {
  it("연·월·일·요일(0=일)", () => {
    expect(describeTodoDay("2026-11-05")).toEqual({ date: "2026-11-05", year: 2026, month: 11, dayOfMonth: 5, weekday: 4 });
    expect(describeTodoDay("2000-01-01").weekday).toBe(6); // 토요일
    expect(describeTodoDay("2028-02-29")).toMatchObject({ month: 2, dayOfMonth: 29 });
  });

  it("형식이 아니면 던진다", () => {
    expect(() => describeTodoDay("2026-1-5")).toThrow(RangeError);
  });
});
