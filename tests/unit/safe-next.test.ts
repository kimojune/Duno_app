import { describe, expect, it } from "vitest";
import { safeNextPath } from "../../lib/safe-next";

describe("safeNextPath", () => {
  it.each([
    ["//evil.example", "슬래시 두 개"],
    [String.raw`/\evil.example`, "슬래시+백슬래시"],
    ["https://evil.example", "https 스킴"],
    ["javascript:alert(1)", "javascript 스킴"],
    ["evil.example", "슬래시로 시작하지 않음"],
    ["/\t/evil.example", "탭이 섞임"],
    ["/\n/evil.example", "줄바꿈이 섞임"],
    ["///evil.example", "슬래시 세 개"],
    ["", "빈 문자열"],
  ])("악성 %j (%s) → /", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it("값이 없으면 /", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });

  it.each(["/", "/foo", "/foo?x=1", "/foo/bar#a"])("정상 %s → 그대로", (input) => {
    expect(safeNextPath(input)).toBe(input);
  });
});
