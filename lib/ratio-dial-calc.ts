/**
 * 원형 다이얼의 정수 계산(순수 함수). 옛 시안 RatioDial의 calc/ratio.ts(largestRemainder·dragBoundary·setByInput)에서 옮겨 지금 앱에 맞췄다.
 * - 처음 정한 비율은 늘 합 100이다(PM 확정 11-08). 분야도 기타도 0%까지 내려간다.
 * - 12시(맨 위)에는 경계가 없다 — 첫 조각의 앞과 마지막 조각의 끝은 이어지지 않는다.
 * - 저녁 「분야마다 나누기」는 같은 계산을 분 단위로 쓴다: 합(total) = 그날 쓴 시간, 맨 끝 조각(기타) = 나머지.
 * 값은 모두 0 이상의 정수다.
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
 * 경계 k(조각 k와 k+1 사이)를 시계 방향으로 delta만큼 끈다. 합은 그대로다.
 * - 경계의 새 자리는 step의 배수로 반올림한다(비율 1%, 저녁 5분). 양옆 조각이 0 밑으로 내려가기 전에 멈춘다 —
 *   멈추는 자리(이웃이 꼭 0이 되는 자리)는 step의 배수가 아니어도 된다(예: 쓴 시간 62분이면 마지막 분야가 기타 2분까지 다 가져갈 수 있다).
 * - 경계는 0..n-2뿐이다: 12시 경계(첫 조각의 앞·마지막 조각의 끝)는 없어서 움직이지 않는다. 없는 경계·NaN은 값을 그대로 돌려준다.
 * - delta가 ±Infinity면 끝까지 민다(Home/End).
 */
export function dragBoundary(values: number[], k: number, delta: number, step = 1): number[] {
  if (!Number.isInteger(k) || k < 0 || k >= values.length - 1 || Number.isNaN(delta)) return values;
  const s = Number.isFinite(step) && step > 0 ? step : 1;
  const at = values.slice(0, k + 1).reduce((a, b) => a + b, 0); // 지금 경계 자리
  const lo = at - values[k];
  const hi = at + values[k + 1];
  const want = Number.isFinite(delta) ? Math.round((at + delta) / s) * s : delta > 0 ? hi : lo;
  const p = Math.max(lo, Math.min(hi, want));
  if (p === at) return values;
  const out = values.slice();
  out[k] = p - lo;
  out[k + 1] = hi - p;
  return out;
}

/**
 * −/+ 단추와 숫자 칸이 함께 쓰는 「한 조각을 이 값으로」(합 total 고정). 손잡이와 같은 직관으로 고른 조각과 이웃끼리 주고받는다:
 * - 이웃 순서: 뒤 조각(i+1)이 먼저, 마지막 조각은 앞 조각(i-1)이 먼저. 그다음 앞뒤로 한 칸씩 멀어진다(i+1, i-1, i+2, i-2 …).
 * - 늘리면 이웃 순서대로 0이 될 때까지 떼어 온다(옛 setByInput은 양옆에서만 떼어 와 넣은 값에 못 미칠 때가 있었다 — 지금은 넣은 값에 닿는다).
 * - 줄이면 줄인 몫을 첫 이웃에 모두 준다(끝 손잡이를 반시계로 끈 것과 같다).
 * want는 0..total 정수로 자른다. 정수가 아니거나 NaN이면 값을 그대로 돌려준다. 조각이 하나면 늘 [total].
 */
export function setShare(values: number[], i: number, want: number, total = 100): number[] {
  const n = values.length;
  if (!Number.isInteger(i) || i < 0 || i >= n || !Number.isFinite(want) || !Number.isInteger(want)) return values;
  if (n === 1) return [total];
  const target = Math.max(0, Math.min(total, want));
  const order: number[] = [];
  for (let d = 1; d < n; d++) {
    if (i + d < n) order.push(i + d);
    if (i - d >= 0) order.push(i - d);
  }
  const out = values.slice();
  let delta = target - out[i];
  if (delta === 0) return values;
  if (delta < 0) {
    out[order[0]] -= delta;
    out[i] = target;
    return out;
  }
  for (const j of order) {
    if (delta <= 0) break;
    const take = Math.min(delta, out[j]);
    out[j] -= take;
    delta -= take;
  }
  out[i] = target - delta;
  return out;
}

/**
 * 처음 정한 비율을 열 때의 값(합 100 고정, PM 확정 11-08). 합이 0보다 크면 비율을 지켜 합 100의 정수로 맞춘다.
 * 모두 0이면(새 사용자 등) evenIdx 조각끼리 고르게 나눈 값(even)으로 시작하고 나머지는 0, evenIdx가 비면 맨 끝 조각(기타)에 100.
 */
export function startHundred(values: number[], even: (count: number) => number[], evenIdx: number[]): number[] {
  if (values.length === 0) return [];
  if (values.some((v) => clean(v) > 0)) return toTotal(values, 100);
  const out = values.map(() => 0);
  if (evenIdx.length === 0) {
    out[out.length - 1] = 100;
    return out;
  }
  const split = even(evenIdx.length);
  evenIdx.forEach((idx, k) => {
    out[idx] = split[k] ?? 0;
  });
  return out;
}

/**
 * 저녁 「분야마다 나누기」: 쓴 시간이 oldTotal → newTotal로 바뀔 때 분야마다 나눈 분(기타 제외)을 다시 나눈다.
 * 비율(기타 몫까지)을 지키며 step 단위로 나누고, 나눈 합은 newTotal을 넘지 않는다. 남는 것은 기타(= newTotal − 합)다.
 * 쓴 시간이 그대로면 값을 그대로 돌려준다. 이전 쓴 시간이 0이거나 나눈 것이 없으면 모두 0(전부 기타).
 */
export function rescaleSplit(values: number[], oldTotal: number, newTotal: number, step = 5): number[] {
  if (oldTotal === newTotal) return values;
  const w = values.map(clean);
  const sum = w.reduce((a, b) => a + b, 0);
  if (oldTotal <= 0 || newTotal <= 0 || sum <= 0) return w.map(() => 0);
  const units = Math.min(Math.floor(newTotal / step), Math.round((Math.min(sum, oldTotal) * newTotal) / oldTotal / step));
  return toTotal(w, units).map((u) => u * step);
}

/** 숫자 칸 글을 0..max 정수로 읽는다. 빈 칸·글자·소수·음수·지수(1e9)·max 넘는 값은 null(이전 값으로 돌린다) */
export function parseShare(text: string, max = 100): number | null {
  const t = text.trim();
  if (!/^[0-9]{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
}
