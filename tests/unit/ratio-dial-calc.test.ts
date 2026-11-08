import { describe, expect, it } from "vitest";
import { dragBoundary, toTotal } from "../../lib/ratio-dial-calc";

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const isIntegers = (v: number[]) => v.every((x) => Number.isInteger(x));

describe("원형 다이얼 계산: 합 맞추기(toTotal)", () => {
  it("합이 100이 아닌 값은 정수이고 합 100이며 비율 순서를 지킨다", () => {
    for (const input of [[30, 30, 0], [5, 0], [1, 2, 3], [33, 33, 33], [7, 0, 0, 1], [50, 50, 50, 50, 50, 50, 50], [100, 1], [0.4, 0.4, 0.2]]) {
      const out = toTotal(input);
      expect(isIntegers(out), JSON.stringify(input)).toBe(true);
      expect(sum(out), JSON.stringify(input)).toBe(100);
      for (let i = 0; i < input.length; i++) {
        for (let j = 0; j < input.length; j++) {
          if (input[i] > input[j]) expect(out[i], `${JSON.stringify(input)} ${i}>${j}`).toBeGreaterThanOrEqual(out[j]);
        }
        if (input[i] === 0) expect(out[i]).toBe(0); // 0은 0으로 남는다
      }
    }
  });

  it("구체 값: 30·30·0 → 50·50·0, 5·0 → 100·0, 1·2·3 → 17·33·50", () => {
    expect(toTotal([30, 30, 0])).toEqual([50, 50, 0]);
    expect(toTotal([5, 0])).toEqual([100, 0]);
    expect(toTotal([1, 2, 3])).toEqual([17, 33, 50]);
  });

  it("이미 합 100인 정수는 그대로다", () => {
    expect(toTotal([60, 30, 10])).toEqual([60, 30, 10]);
    expect(toTotal([100])).toEqual([100]);
  });

  it("모두 0이면 깨지지 않고 모두 0을 돌려준다(합 0: 없는 비율을 지어내지 않는다). 빈 목록은 빈 목록", () => {
    expect(toTotal([0, 0, 0])).toEqual([0, 0, 0]);
    expect(toTotal([])).toEqual([]);
  });

  it("음수·NaN·무한대는 0으로 본다", () => {
    expect(toTotal([-5, 10, Number.NaN, Infinity])).toEqual([0, 100, 0, 0]);
  });

  it("합 total을 바꿔 쓸 수 있다(분 단위)", () => {
    const out = toTotal([1, 1, 1], 100);
    expect(sum(out)).toBe(100);
    const minutes = toTotal([30, 30, 0], 90);
    expect(minutes).toEqual([45, 45, 0]);
  });
});

describe("원형 다이얼 계산: 경계 끌기(dragBoundary)", () => {
  it("경계를 끌어도 합이 늘 100이고, 값은 0~100 정수다", () => {
    for (const base of [[50, 50], [34, 33, 33], [60, 30, 10, 0], [0, 100, 0], [10, 0, 90]]) {
      for (let k = 0; k < base.length - 1; k++) {
        for (const d of [-1000, -100, -7, -1, -0.4, 0, 0.4, 0.6, 1, 5, 7, 100, 1000]) {
          const out = dragBoundary(base, k, d);
          const label = `${JSON.stringify(base)} k${k} d${d}`;
          expect(sum(out), label).toBe(100);
          expect(isIntegers(out), label).toBe(true);
          for (const v of out) {
            expect(v, label).toBeGreaterThanOrEqual(0);
            expect(v, label).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it("고른 조각과 이웃 조각 둘만 바뀐다", () => {
    expect(dragBoundary([40, 30, 30], 0, 5)).toEqual([45, 25, 30]);
    expect(dragBoundary([40, 30, 30], 1, -5)).toEqual([40, 25, 35]);
  });

  it("분야도 기타(맨 끝)도 0%까지 내려가고 거기서 멈춘다(음수 없음)", () => {
    expect(dragBoundary([50, 40, 10], 1, 1000)).toEqual([50, 50, 0]); // 맨 끝(기타)이 0까지
    expect(dragBoundary([50, 40, 10], 1, -1000)).toEqual([50, 0, 50]); // 가운데 분야가 0까지
    expect(dragBoundary([50, 40, 10], 0, 1000)).toEqual([90, 0, 10]); // 앞의 분야도 0까지
    expect(dragBoundary([50, 40, 10], 0, -1000)).toEqual([0, 90, 10]);
  });

  it("12시 경계는 움직이지 않는다: 첫 조각의 앞(-1)·마지막 조각의 끝(n-1)·없는 경계는 값을 그대로 돌려준다", () => {
    const base = [40, 30, 30];
    expect(dragBoundary(base, -1, 10)).toBe(base);
    expect(dragBoundary(base, 2, 10)).toBe(base); // 마지막 조각의 끝 = 12시: 첫 조각의 앞과 이어 붙지 않는다
    expect(dragBoundary(base, 3, -10)).toBe(base);
    expect(dragBoundary(base, 0.5, 10)).toBe(base);
    expect(dragBoundary([100], 0, 10)).toEqual([100]);
    expect(dragBoundary([], 0, 10)).toEqual([]);
  });

  it("첫 조각의 시작은 늘 0 위치다(경계를 어떻게 끌어도 첫 조각 앞 누적이 0)", () => {
    let v = [20, 30, 50];
    for (const [k, d] of [[0, 15], [1, -40], [0, -100], [1, 100], [0, 3]] as const) {
      v = dragBoundary(v, k, d);
      expect(sum(v)).toBe(100);
      expect(v.length).toBe(3);
    }
  });

  it("NaN은 값을 그대로 돌려준다. 입력 배열은 바뀌지 않는다", () => {
    const base = [50, 50];
    expect(dragBoundary(base, 0, Number.NaN)).toBe(base);
    dragBoundary(base, 0, 10);
    expect(base).toEqual([50, 50]);
  });
});
