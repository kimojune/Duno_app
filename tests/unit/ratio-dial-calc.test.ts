import { describe, expect, it } from "vitest";
import { dragBetween, dragBoundary, parseShare, rescaleSplit, setShare, skipZeroHandles, startHundred, toTotal } from "../../lib/ratio-dial-calc";
import { evenRatios } from "../../lib/settings/validation";

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

  it("경계를 이어 끌어도 조각 수·합이 그대로이고, 12시를 넘어 값이 돌지 않는다(첫 조각은 0까지만, 마지막 조각도 0까지만)", () => {
    let v = [20, 30, 50];
    const seen: number[][] = [];
    for (const [k, d] of [[0, 15], [1, -40], [0, -100], [1, 100], [0, 3], [0, -1000], [1, 1000]] as const) {
      v = dragBoundary(v, k, d);
      seen.push(v);
      expect(sum(v)).toBe(100);
      expect(v.length).toBe(3);
    }
    // 첫 조각을 반시계로 크게 밀면 0에서 멈추고(12시를 넘어 맨 끝 조각에 붙지 않는다), 마지막 경계를 시계로 크게 밀면 마지막 조각이 0
    expect(seen[5][0]).toBe(0);
    expect(seen[6][2]).toBe(0);
    expect(seen[6]).toEqual([0, 100, 0]);
    // (화면에 그린 첫 조각이 12시에서 시작하는지는 ratio-dial.test.tsx 「첫 조각은 늘 12시에서 시작」에서 본다)
  });

  it("NaN은 값을 그대로 돌려준다. 입력 배열은 바뀌지 않는다", () => {
    const base = [50, 50];
    expect(dragBoundary(base, 0, Number.NaN)).toBe(base);
    dragBoundary(base, 0, 10);
    expect(base).toEqual([50, 50]);
  });
});

describe("원형 다이얼 계산: step 단위 끌기(저녁 5분)·끝까지(Home/End)", () => {
  it("경계 자리를 step의 배수로 반올림한다: 5분 단위", () => {
    expect(dragBoundary([30, 30, 60], 0, 2, 5)).toEqual([30, 30, 60]); // 32 → 30(그대로)
    expect(dragBoundary([30, 30, 60], 0, 3, 5)).toEqual([35, 25, 60]); // 33 → 35
    expect(dragBoundary([30, 30, 60], 1, -12, 5)).toEqual([30, 20, 70]); // 60-12=48 → 50
    for (const d of [-200, -37, -5, -2.4, 2.6, 5, 13, 999]) {
      const out = dragBoundary([30, 30, 60], 0, d, 5);
      expect(sum(out)).toBe(120);
      expect(out.every((x) => x % 5 === 0 && x >= 0), String(d)).toBe(true);
    }
  });

  it("쓴 시간이 5의 배수가 아닐 때(62분): 경계는 5분 단위, 끝까지 밀면 이웃이 꼭 0이 되는 자리(기타 2분까지 다 가져간다)", () => {
    // 분야 30·30, 기타 2
    expect(dragBoundary([30, 30, 2], 1, 1, 5)).toEqual([30, 30, 2]); // 61 → 60: 그대로
    expect(dragBoundary([30, 30, 2], 1, 3, 5)).toEqual([30, 32, 0]); // 63 → 65 → 넘침 → 62(이웃 0)
    expect(dragBoundary([30, 30, 2], 1, -7, 5)).toEqual([30, 25, 7]);
    for (const d of [-100, -7, -3, 0, 3, 7, 100]) {
      const out = dragBoundary([30, 30, 2], 1, d, 5);
      expect(sum(out)).toBe(62);
      expect(out.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    }
  });

  it("±Infinity는 끝까지 민다(Home/End): 이웃이 0 또는 자기가 0", () => {
    expect(dragBoundary([40, 30, 30], 0, Infinity)).toEqual([70, 0, 30]);
    expect(dragBoundary([40, 30, 30], 0, -Infinity)).toEqual([0, 70, 30]);
    expect(dragBoundary([40, 30, 30], 1, Infinity, 5)).toEqual([40, 60, 0]);
  });
});

describe("처음 정한 비율: 한 줄을 이 값으로(setShare, −/+·숫자 칸) — 합 100 고정", () => {
  const bases = [[50, 50, 0], [40, 30, 20, 10], [0, 0, 100], [100, 0, 0, 0], [5, 0, 95], [34, 33, 33], [0, 100]];
  it("어느 줄을 어느 값으로 바꿔도 합 100, 0~100 정수이고, 그 줄은 넣은 값이 된다", () => {
    for (const base of bases) {
      for (let i = 0; i < base.length; i++) {
        for (const want of [-50, -5, 0, 1, 5, 37, 50, 99, 100, 150, 100000]) {
          const out = setShare(base, i, want);
          const label = `${JSON.stringify(base)} i${i} want${want}`;
          expect(sum(out), label).toBe(100);
          expect(out.every((x) => Number.isInteger(x) && x >= 0 && x <= 100), label).toBe(true);
          expect(out[i], label).toBe(Math.max(0, Math.min(100, want)));
        }
      }
    }
  });

  it("줄이면 줄인 몫을 뒤 줄에(마지막 줄은 앞 줄에) 준다 — 끝 손잡이를 반시계로 끈 것과 같다", () => {
    expect(setShare([40, 30, 20, 10], 0, 35)).toEqual([35, 35, 20, 10]);
    expect(setShare([40, 30, 20, 10], 2, 15)).toEqual([40, 30, 15, 15]);
    expect(setShare([40, 30, 20, 10], 3, 0)).toEqual([40, 30, 30, 0]);
    expect(setShare([40, 30, 20, 10], 0, 35)).toEqual(dragBoundary([40, 30, 20, 10], 0, -5));
  });

  it("늘리면 뒤 줄(마지막 줄은 앞 줄)부터, 모자라면 앞뒤로 한 칸씩 멀어지며 떼어 온다", () => {
    expect(setShare([40, 30, 20, 10], 1, 35)).toEqual([40, 35, 15, 10]); // 뒤 줄(20)에서
    expect(setShare([40, 30, 20, 10], 1, 70)).toEqual([20, 70, 0, 10]); // 뒤 줄 20 → 0, 앞 줄 40 → 20
    expect(setShare([40, 30, 20, 10], 1, 100)).toEqual([0, 100, 0, 0]); // 넣은 값에 닿는다
    expect(setShare([40, 30, 20, 10], 3, 15)).toEqual([40, 30, 15, 15]); // 마지막 줄(기타)은 앞 줄에서
    expect(setShare([50, 50, 0], 1, 55)).toEqual([45, 55, 0]); // 뒤 줄(기타)이 0이면 앞 줄에서
  });

  it("조각이 하나면 늘 100. 정수가 아닌 값·NaN·없는 줄은 값을 그대로 돌려준다", () => {
    expect(setShare([100], 0, 40)).toEqual([100]);
    const base = [50, 50];
    expect(setShare(base, 0, 12.7)).toBe(base);
    expect(setShare(base, 0, Number.NaN)).toBe(base);
    expect(setShare(base, 2, 10)).toBe(base);
    expect(setShare(base, 0, 50)).toBe(base);
  });
});

describe("처음 정한 비율: 열 때의 값(startHundred)", () => {
  const even = (n: number) => evenRatios(Array.from({ length: n }, (_, i) => String(i))).map((r) => r.percent);
  it("합이 100이 아니면 비율을 지켜 합 100의 정수로", () => {
    expect(startHundred([30, 30, 0], even, [0, 1])).toEqual([50, 50, 0]);
    expect(startHundred([60, 30, 10], even, [0, 1])).toEqual([60, 30, 10]);
    expect(startHundred([1, 1, 1], even, [0, 1])).toEqual([34, 33, 33]);
  });
  it("모두 0이면(새 사용자) 분야끼리 균등 배분, 기타 0 — 「고르게 나누기」와 같은 값", () => {
    expect(startHundred([0, 0, 0], even, [0, 1])).toEqual([50, 50, 0]);
    expect(startHundred([0, 0, 0, 0], even, [0, 1, 2])).toEqual([35, 35, 30, 0]);
    expect(startHundred([0, 0], even, [0])).toEqual([100, 0]); // 처음 쓰는 사람: 분야 하나
  });
  it("분야가 없으면(기타뿐) 기타 100. 분야 50개도 합 100", () => {
    expect(startHundred([0], even, [])).toEqual([100]);
    const fifty = startHundred(Array(51).fill(0), even, Array.from({ length: 50 }, (_, i) => i));
    expect(sum(fifty)).toBe(100);
    expect(fifty.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    expect(fifty[50]).toBe(0);
  });
});

describe("숫자 칸 읽기(parseShare)", () => {
  it("0~100 정수만 받는다", () => {
    expect(parseShare("0")).toBe(0);
    expect(parseShare("40")).toBe(40);
    expect(parseShare(" 100 ")).toBe(100);
    expect(parseShare("007")).toBe(7);
  });
  it("빈 칸·글자·소수·음수·지수·100 넘음·붙여넣은 이상한 글은 null(이전 값으로)", () => {
    for (const bad of ["", "  ", "abc", "12.7", "-5", "150", "1e9", "1e2", "40%", "４０", "0x10", "+5", "1,000", "<b>1</b>", "Infinity", "NaN"]) {
      expect(parseShare(bad), bad).toBeNull();
    }
  });
});

describe("저녁 나누기: 쓴 시간이 바뀔 때 다시 나누기(rescaleSplit)", () => {
  it("비율을 지키며 5분 단위로 다시 나누고, 나눈 합은 새 쓴 시간을 넘지 않는다(남는 것은 기타)", () => {
    expect(rescaleSplit([60, 30], 120, 60, 5)).toEqual([30, 15]); // 기타 30 → 15
    expect(rescaleSplit([60, 60], 120, 240, 5)).toEqual([120, 120]);
    expect(rescaleSplit([30, 90], 120, 62, 5)).toEqual([15, 45]); // 62분: 나눈 합 60, 기타 2
    for (const [vals, from, to] of [[[30, 90], 120, 7], [[45, 40, 0], 90, 61], [[5, 5, 5], 20, 13], [[100], 100, 3], [[55, 35], 95, 1440]] as const) {
      const out = rescaleSplit([...vals], from, to, 5);
      const label = `${JSON.stringify(vals)} ${from}→${to}`;
      expect(sum(out), label).toBeLessThanOrEqual(to);
      expect(out.every((x) => x % 5 === 0 && x >= 0), label).toBe(true);
      expect(to - sum(out), label).toBeGreaterThanOrEqual(0);
    }
  });
  it("쓴 시간이 그대로면 값을 그대로, 새 쓴 시간이 0이거나 나눈 것이 없으면 모두 0(전부 기타)", () => {
    const vals = [7, 33];
    expect(rescaleSplit(vals, 60, 60, 5)).toBe(vals);
    expect(rescaleSplit([30, 30], 60, 0, 5)).toEqual([0, 0]);
    expect(rescaleSplit([0, 0], 60, 90, 5)).toEqual([0, 0]);
    expect(rescaleSplit([30, 30], 0, 90, 5)).toEqual([0, 0]);
  });
});

describe("고침6 PM d-129 ②: 폭 0 조각을 건너뛰는 손잡이(skipZeroHandles)·경계 끌기(dragBetween) — 오늘 기록 나누기", () => {
  it("기타 0분 + 마지막 분야 고름: 끝 손잡이(12시)가 없고 앞 손잡이만 있다. 손잡이 자리는 12시(0·합)가 아니다", () => {
    // 어학 60 · 포트폴리오 60 · 기타 0, 포트폴리오 고름
    expect(skipZeroHandles([60, 60, 0], 1)).toEqual([{ side: "start", at: 60, a: 0, b: 1 }]);
    // 첫 분야를 고르면 끝 손잡이 하나(어학·포트폴리오), 기타 0분을 고르면 손잡이 없음(자리가 12시)
    expect(skipZeroHandles([60, 60, 0], 0)).toEqual([{ side: "end", at: 60, a: 0, b: 1 }]);
    expect(skipZeroHandles([60, 60, 0], 2)).toEqual([]);
  });

  it("0분 분야 조각의 양옆 손잡이는 하나로: 이웃 고름이면 0분을 건너뛴 경계, 0분 고름이면 겹친 손잡이 하나", () => {
    // 어학 60 · 코딩 0 · 운동 60 · 기타 0
    expect(skipZeroHandles([60, 0, 60, 0], 0)).toEqual([{ side: "end", at: 60, a: 0, b: 2 }]);
    expect(skipZeroHandles([60, 0, 60, 0], 2)).toEqual([{ side: "start", at: 60, a: 0, b: 2 }]);
    expect(skipZeroHandles([60, 0, 60, 0], 1)).toEqual([{ side: "both", at: 60, a: 0, b: 2 }]);
    // 맨 앞(12시) 0분 조각·맨 끝(12시) 0분 조각은 손잡이 없음
    expect(skipZeroHandles([0, 60, 60, 0], 0)).toEqual([]);
    expect(skipZeroHandles([0, 60, 60, 0], 3)).toEqual([]);
    // 0분이 여럿 이어져도 하나
    expect(skipZeroHandles([30, 0, 0, 90], 0)).toEqual([{ side: "end", at: 30, a: 0, b: 3 }]);
  });

  it("기타 > 0이고 0분 조각이 없으면 지금 규칙(이웃마다 경계, 12시 없음)과 같다", () => {
    const v = [40, 30, 20, 10];
    expect(skipZeroHandles(v, 0)).toEqual([{ side: "end", at: 40, a: 0, b: 1 }]);
    expect(skipZeroHandles(v, 1)).toEqual([{ side: "start", at: 40, a: 0, b: 1 }, { side: "end", at: 70, a: 1, b: 2 }]);
    expect(skipZeroHandles(v, 3)).toEqual([{ side: "start", at: 90, a: 2, b: 3 }]);
    // 이웃 조각끼리 dragBetween = dragBoundary
    for (const d of [-100, -7, -1, 1, 3, 100, Infinity, -Infinity]) {
      for (let k = 0; k < 3; k++) expect(dragBetween(v, k, k + 1, d, 1)).toEqual(dragBoundary(v, k, d, 1));
    }
  });

  it("고른 것이 없거나·없는 조각·모두 0이면 손잡이 없음", () => {
    expect(skipZeroHandles([60, 60, 0], -1)).toEqual([]);
    expect(skipZeroHandles([60, 60, 0], 3)).toEqual([]);
    expect(skipZeroHandles([0, 0, 0], 1)).toEqual([]);
    expect(skipZeroHandles([120], 0)).toEqual([]);
  });

  it("dragBetween: 사이의 0 조각은 0 그대로, 양쪽 조각만 바뀌고 합 그대로. 5분 반올림·끝까지(±Infinity)", () => {
    expect(dragBetween([60, 0, 60, 0], 0, 2, 10, 5)).toEqual([70, 0, 50, 0]);
    expect(dragBetween([60, 0, 60, 0], 0, 2, -12, 5)).toEqual([50, 0, 70, 0]);
    expect(dragBetween([60, 0, 60, 0], 0, 2, Infinity, 5)).toEqual([120, 0, 0, 0]);
    expect(dragBetween([60, 0, 60, 0], 0, 2, -Infinity, 5)).toEqual([0, 0, 120, 0]);
    // 겹친 손잡이(코딩 0 고름): 뒤 쌍(1,2) 시계 = 운동에서, 앞 쌍(0,1) 반시계 = 어학에서
    expect(dragBetween([60, 0, 60, 0], 1, 2, 10, 5)).toEqual([60, 10, 50, 0]);
    expect(dragBetween([60, 0, 60, 0], 0, 1, -10, 5)).toEqual([50, 10, 60, 0]);
  });

  it("dragBetween: 사이에 0이 아닌 조각·a ≥ b·없는 조각·NaN이면 값을 그대로", () => {
    const v = [30, 30, 60];
    expect(dragBetween(v, 0, 2, 10, 5)).toBe(v);
    expect(dragBetween(v, 1, 1, 10, 5)).toBe(v);
    expect(dragBetween(v, 2, 1, 10, 5)).toBe(v);
    expect(dragBetween(v, -1, 1, 10, 5)).toBe(v);
    expect(dragBetween(v, 0, 3, 10, 5)).toBe(v);
    expect(dragBetween(v, 0, 1, Number.NaN, 5)).toBe(v);
    expect(dragBetween(v, 0.5, 1, 10, 5)).toBe(v);
  });

  it("악용: 기타 0분에서 시작해 손잡이 목록의 어느 손잡이를 어느 만큼 1200번 끌어도 합 = 쓴 시간, 값은 0 이상 정수, 12시에 손잡이가 서지 않는다", () => {
    let seed = 20261109;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const TOTAL = 95; // 5의 배수가 아닌 쓴 시간
    let values = [35, 0, 60, 0]; // 어학 35 · 코딩 0 · 운동 60 · 기타 0
    let moves = 0;
    let checked = 0;
    for (let i = 0; i < 1200; i++) {
      const si = Math.floor(rand() * values.length);
      const hs = skipZeroHandles(values, si);
      for (const h of hs) {
        expect(h.at).toBeGreaterThan(0); // 12시(0) 아님
        expect(h.at).toBeLessThan(TOTAL); // 12시(합) 아님
        expect(values[h.a]).toBeGreaterThan(0); // 경계 양쪽은 0분 아닌 조각
        expect(values[h.b]).toBeGreaterThan(0);
        for (let j = h.a + 1; j < h.b; j++) if (j !== si) expect(values[j]).toBe(0);
      }
      if (hs.length > 0) {
        const h = hs[Math.floor(rand() * hs.length)];
        const pick = [-Infinity, Infinity, -30, -5, -2, 2, 5, 30, 7.5][Math.floor(rand() * 9)];
        const pair: [number, number] = h.side === "both" ? (pick > 0 ? [si, h.b] : [h.a, si]) : [h.a, h.b];
        const next = dragBetween(values, pair[0], pair[1], pick, 5);
        if (next !== values) moves++;
        values = next;
      } else if (rand() < 0.3) {
        // Stepper −(끌지 않는 길): 고른 조각을 5분 줄여 첫 이웃(뒤, 마지막은 앞)에 준다 — 기타로 돌려주기
        values = setShare(values, si, Math.max(0, values[si] - 5), TOTAL);
      }
      expect(values.reduce((a, b) => a + b, 0)).toBe(TOTAL);
      expect(values.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
      checked++;
    }
    expect(checked).toBe(1200);
    expect(moves).toBeGreaterThan(100); // 실제로 움직였다(빈 걸음만 돈 것이 아니다)
  });
});
