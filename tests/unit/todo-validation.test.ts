import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkTodoText, countTodoChars, todoDoneSchema, todoIdSchema } from "../../lib/todos/validation";

describe("checkTodoText (앞뒤 공백 지운 뒤 1~200 코드 포인트)", () => {
  it("빈 값·공백만은 empty", () => {
    expect(checkTodoText("")).toEqual({ ok: false, error: "empty" });
    expect(checkTodoText("   ")).toEqual({ ok: false, error: "empty" });
    expect(checkTodoText("\n\t 　")).toEqual({ ok: false, error: "empty" });
  });

  it("200자는 통과, 201자는 too_long", () => {
    expect(checkTodoText("a".repeat(200))).toEqual({ ok: true, text: "a".repeat(200) });
    expect(checkTodoText("a".repeat(201))).toEqual({ ok: false, error: "too_long" });
  });

  it("한글 200자 통과, 201자 거절", () => {
    expect(checkTodoText("가".repeat(200)).ok).toBe(true);
    expect(checkTodoText("가".repeat(201))).toEqual({ ok: false, error: "too_long" });
  });

  it("이모지 200자(UTF-16으로는 400) 통과, 201자 거절", () => {
    expect(checkTodoText("😀".repeat(200)).ok).toBe(true);
    expect(checkTodoText("😀".repeat(201))).toEqual({ ok: false, error: "too_long" });
  });

  it("한글·이모지 섞인 200자 통과, 201자 거절", () => {
    const mixed = "가😀".repeat(100);
    expect(countTodoChars(mixed)).toBe(200);
    expect(checkTodoText(mixed).ok).toBe(true);
    expect(checkTodoText(mixed + "나")).toEqual({ ok: false, error: "too_long" });
  });

  it("앞뒤 공백은 지운 뒤 센다", () => {
    expect(checkTodoText(`  ${"a".repeat(200)}  `)).toEqual({ ok: true, text: "a".repeat(200) });
    expect(checkTodoText("  할 일  ")).toEqual({ ok: true, text: "할 일" });
  });

  it("아주 긴 글도 too_long", () => {
    expect(checkTodoText("가".repeat(100_000))).toEqual({ ok: false, error: "too_long" });
  });

  it("문자열이 아니면 invalid_input", () => {
    for (const v of [undefined, null, 1, true, ["a"], { text: "a" }]) {
      expect(checkTodoText(v)).toEqual({ ok: false, error: "invalid_input" });
    }
  });

  it("countTodoChars는 코드 포인트 수", () => {
    expect(countTodoChars("가나다")).toBe(3);
    expect(countTodoChars("😀")).toBe(1);
    expect(countTodoChars("👍🏽")).toBe(2);
    expect(countTodoChars("  a  ")).toBe(1);
  });
});

describe("id·done 검증", () => {
  it("uuid만 받는다", () => {
    expect(todoIdSchema.safeParse(randomUUID()).success).toBe(true);
    for (const v of ["", "1", "not-a-uuid", "00000000-0000-0000-0000-00000000000", 123, null, "' or 1=1 --"]) {
      expect(todoIdSchema.safeParse(v).success).toBe(false);
    }
  });

  it("done은 참·거짓만", () => {
    expect(todoDoneSchema.safeParse(true).success).toBe(true);
    expect(todoDoneSchema.safeParse(false).success).toBe(true);
    for (const v of ["true", 1, 0, null, undefined]) expect(todoDoneSchema.safeParse(v).success).toBe(false);
  });
});
