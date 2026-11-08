/**
 * 원형 다이얼의 정수 계산(순수 함수). 옛 시안 RatioDial의 calc/ratio.ts(largestRemainder·dragBoundary)에서 옮겨 지금 앱에 맞췄다.
 * 옛 시안과 다른 점: ① 합이 100이 아닌 값도 받는다(앱이 합으로 나눠 읽는다) ② 분야도 0%까지 내려간다(지금 앱이 0%를 허용한다)
 * ③ 12시(맨 위)에는 경계가 없다 — 첫 조각의 앞과 마지막 조각의 끝은 이어지지 않는다(옛 시안의 % 입력·똑같이 나누기·조각 더하기/빼기는 옮기지 않았다).
 * 값은 모두 0 이상의 정수다. 합은 total(기본 100, 비율 다이얼). 저녁 「분야마다 나누기」는 total에 그날 쓴 분을 준다.
 */

function clean(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 값들을 합이 total인 정수로 맞춘다(최대 나머지 방식). 비율 순서는 지키고(큰 값이 작은 값보다 작아지지 않는다) 0은 0으로 남는다.
 * 음수·NaN은 0으로 본다. 모두 0이거나 조각이 없으면 정할 비율이 없으니 모두 0으로 돌려준다(합 0) — 없는 비율을 지어내지 않는다.
 */
export function toTotal(values: number[], total = 100): number[] {
  const w = values.map(clean);
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return w.map(() => 0);
  const scaled = w.map((v) => v * total);
  const out = scaled.map((s) => Math.floor(s / sum));
  const order = scaled
    .map((s, i) => ({ i, rem: s - out[i] * sum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i)
    .map((o) => o.i);
  let left = total - out.reduce((a, b) => a + b, 0);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length) {
    out[order[k]] += 1;
    left -= 1;
  }
  return out;
}

/**
 * 경계 k(조각 k와 k+1 사이)를 시계 방향으로 delta만큼 끈다(반올림한 정수). 양옆 조각이 0 밑으로 내려가기 전에 멈추고, 합은 그대로다.
 * 경계는 0..n-2뿐이다: 12시 경계(첫 조각의 앞·마지막 조각의 끝)는 없어서 움직이지 않는다. 없는 경계·NaN은 값을 그대로 돌려준다.
 */
export function dragBoundary(values: number[], k: number, delta: number): number[] {
  if (!Number.isInteger(k) || k < 0 || k >= values.length - 1 || !Number.isFinite(delta)) return values;
  const out = values.slice();
  const d = Math.max(-out[k], Math.min(out[k + 1], Math.round(delta)));
  out[k] += d;
  out[k + 1] -= d;
  return out;
}
