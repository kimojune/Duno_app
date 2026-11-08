import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_COLOR_COUNT,
  CATEGORY_COLOR_OTHER,
  categoryColor,
  categoryColorNumber,
  categoryColorVar,
} from "../../lib/category-color";
import { CATEGORY_COLOR_TOKENS } from "../../lib/design-tokens";

describe("분야 색 번호(순서 0부터 → 1~8, 9번째부터 다시 1)", () => {
  it("경계: 0→1, 7→8, 8→1, 49→2", () => {
    expect(categoryColorNumber(0)).toBe(1);
    expect(categoryColorNumber(7)).toBe(8);
    expect(categoryColorNumber(8)).toBe(1);
    expect(categoryColorNumber(49)).toBe(2); // 분야 한도 50의 마지막(순서 49)
  });

  it("순서대로 1~8을 쓰고 돌아온다(0~49 전부)", () => {
    for (let i = 0; i < 50; i += 1) expect(categoryColorNumber(i), `순서 ${i}`).toBe((i % 8) + 1);
  });

  it("음수·소수·NaN·무한대·숫자가 아닌 값이 들어와도 1~8 안이다", () => {
    const odd = [-1, -8, -9, -1000, 0.5, 7.9, 8.1, -0.5, 1e21, -1e21, Number.MAX_SAFE_INTEGER, Number.NaN, Infinity, -Infinity];
    for (const value of odd) {
      const n = categoryColorNumber(value);
      expect(Number.isInteger(n), `${value} → ${n}`).toBe(true);
      expect(n, `${value}`).toBeGreaterThanOrEqual(1);
      expect(n, `${value}`).toBeLessThanOrEqual(CATEGORY_COLOR_COUNT);
    }
    expect(categoryColorNumber(Number.NaN)).toBe(1);
    expect(categoryColorNumber(-1)).toBe(8);
    expect(categoryColorNumber(7.9)).toBe(8); // 소수는 0 쪽으로 버린다
    expect(categoryColorNumber("3" as unknown as number)).toBe(1); // 타입을 어긴 입력도 안에 머문다
    expect(categoryColorNumber(undefined as unknown as number)).toBe(1);
  });
});

describe("분야 색 = 번호와 CSS 변수 이름", () => {
  it("순서 → { key, cssVar, cssValue }", () => {
    expect(categoryColor(0)).toEqual({ key: 1, cssVar: "--color-category-1", cssValue: "var(--color-category-1)" });
    expect(categoryColor(7)).toEqual({ key: 8, cssVar: "--color-category-8", cssValue: "var(--color-category-8)" });
    expect(categoryColor(8).key).toBe(1);
    expect(categoryColor(49).cssVar).toBe("--color-category-2");
  });

  it("기타(null)는 기타 색이다. 번호 색과 섞이지 않는다", () => {
    expect(categoryColor(null)).toEqual({
      key: CATEGORY_COLOR_OTHER,
      cssVar: "--color-category-other",
      cssValue: "var(--color-category-other)",
    });
    for (let i = 0; i < 50; i += 1) expect(categoryColor(i).key).not.toBe(CATEGORY_COLOR_OTHER);
  });

  it("돌려주는 변수 이름은 모두 출처 표와 globals.css에 있다(없는 변수를 가리키지 않는다)", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
    const names = new Set<string>([categoryColor(null).cssVar]);
    for (let i = 0; i < 50; i += 1) names.add(categoryColor(i).cssVar);
    expect(names.size).toBe(CATEGORY_COLOR_COUNT + 1);
    for (const name of names) {
      expect(Object.keys(CATEGORY_COLOR_TOKENS), `${name} 출처 표`).toContain(name);
      expect(css, `${name} globals.css`).toContain(`${name}: `);
    }
    // 반대로 표에 있는 분야 색 변수는 모두 이 함수가 가리킨다(쓰이지 않는 자리값이 없다)
    for (const name of Object.keys(CATEGORY_COLOR_TOKENS)) expect(names, name).toContain(name);
    expect(categoryColorVar(3)).toBe("--color-category-3");
  });
});
