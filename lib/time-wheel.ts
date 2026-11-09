import { APP_CONFIG } from "./app-config";

/**
 * 두 줄 휠(오늘 기록 「오늘 몇 시간 썼어요?」, 명세 ⑦-4 · D-170)의 값 계산. 화면 없는 순수 함수라 시험이 바로 본다.
 * - 왼쪽 「시간」 열 0~24, 오른쪽 「분」 열 00~55(5분 단위). 합은 하루 최대(APP_CONFIG.maxDayMinutes = 24시간)를 넘지 않는다 — 24시간이면 분은 0.
 * - 분 열이 5의 배수가 아닌 값(예: 타이머로 47분이 미리 채워짐)을 들고 있으면 한 걸음에 가까운 5분 눈금으로 걸린다(47 → 50 / 45).
 * - 숫자 바로 쓰기는 지금 앱의 숫자 칸 검사(숫자가 아니면 그대로, 범위 밖은 끝값으로, 정수로)를 따르고, 분은 5분 단위로 맞춘다.
 */

export const WHEEL_HOUR_MAX = Math.floor(APP_CONFIG.maxDayMinutes / 60); // 24
export const WHEEL_MINUTE_STEP = APP_CONFIG.minuteStep; // 5
export const WHEEL_MINUTE_MAX = 60 - WHEEL_MINUTE_STEP; // 55
/** PageUp/PageDown 한 걸음(임시): 시간 3시간, 분 15분 */
export const WHEEL_HOUR_BIG = 3;
export const WHEEL_MINUTE_BIG = WHEEL_MINUTE_STEP * 3;

export type WheelColumn = "hours" | "minutes";

export function splitTotal(total: number): { hours: number; minutes: number } {
  const safe = clampTotal(total);
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

/** 합(분)을 0~하루 최대 안 정수로 */
export function clampTotal(total: number): number {
  if (!Number.isFinite(total)) return 0;
  return Math.min(APP_CONFIG.maxDayMinutes, Math.max(0, Math.round(total)));
}

export function composeTotal(hours: number, minutes: number): number {
  return clampTotal(hours * 60 + minutes);
}

/** 분 열 한 걸음(dir 1 = 늘림). 5분 눈금으로 걸리고 0~55 밖으로 나가지 않는다 */
export function stepMinute(minutes: number, dir: 1 | -1): number {
  if (dir > 0) return Math.min(WHEEL_MINUTE_MAX, Math.floor(minutes / WHEEL_MINUTE_STEP) * WHEEL_MINUTE_STEP + WHEEL_MINUTE_STEP);
  return Math.max(0, Math.ceil(minutes / WHEEL_MINUTE_STEP) * WHEEL_MINUTE_STEP - WHEEL_MINUTE_STEP);
}

export function stepHour(hours: number, delta: number): number {
  return Math.min(WHEEL_HOUR_MAX, Math.max(0, hours + delta));
}

/** 열 하나를 n걸음 옮긴 합(분). 끝에 닿으면 멈춘다 */
export function moveColumn(total: number, column: WheelColumn, steps: number): number {
  const { hours, minutes } = splitTotal(total);
  if (column === "hours") return composeTotal(stepHour(hours, steps), minutes);
  let m = minutes;
  const dir = steps > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(steps); i++) m = stepMinute(m, dir);
  return composeTotal(hours, m);
}

/** 열을 처음/끝 값으로(Home/End) */
export function columnEdge(total: number, column: WheelColumn, edge: "min" | "max"): number {
  const { hours, minutes } = splitTotal(total);
  if (column === "hours") return composeTotal(edge === "min" ? 0 : WHEEL_HOUR_MAX, minutes);
  return composeTotal(hours, edge === "min" ? 0 : WHEEL_MINUTE_MAX);
}

/** 열이 지금 더 올라가거나 내려갈 수 있나(합 최대·열 끝) */
export function canMove(total: number, column: WheelColumn, dir: 1 | -1): boolean {
  return moveColumn(total, column, dir) !== clampTotal(total);
}

/** 「− 5분」 「+ 5분」: 합을 5분 눈금으로 옮긴다(분이 넘치면 시간으로 넘어간다). 끌지 않는 길(WCAG 2.5.7) */
export function nudgeTotal(total: number, dir: 1 | -1): number {
  const safe = clampTotal(total);
  const next = dir > 0 ? Math.floor(safe / WHEEL_MINUTE_STEP) * WHEEL_MINUTE_STEP + WHEEL_MINUTE_STEP : Math.ceil(safe / WHEEL_MINUTE_STEP) * WHEEL_MINUTE_STEP - WHEEL_MINUTE_STEP;
  return clampTotal(next);
}

/**
 * 숫자 바로 쓰기 칸의 글 → 열 값. 지금 앱 숫자 칸(Stepper)의 검사: 숫자로 못 읽으면 null(값을 바꾸지 않음), 범위 밖은 끝값, 정수로.
 * 분은 5분 단위로 맞춘다(가까운 눈금, 55 넘으면 55). 빈 칸도 null.
 */
export function parseColumnInput(raw: string, column: WheelColumn): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  if (column === "hours") return Math.min(WHEEL_HOUR_MAX, Math.max(0, Math.round(n)));
  const snapped = Math.round(Math.max(0, n) / WHEEL_MINUTE_STEP) * WHEEL_MINUTE_STEP;
  return Math.min(WHEEL_MINUTE_MAX, snapped);
}

/** 바로 쓴 열 값을 합에 넣는다(다른 열은 그대로, 합 최대를 넘으면 최대) */
export function withColumn(total: number, column: WheelColumn, value: number): number {
  const { hours, minutes } = splitTotal(total);
  return column === "hours" ? composeTotal(value, minutes) : composeTotal(hours, value);
}

/** 가운데 위아래로 보이는 흐린 값(위 둘 = 작은 값, 아래 둘 = 큰 값). 범위 밖 자리는 null */
export function neighbors(value: number, column: WheelColumn): { above: (number | null)[]; below: (number | null)[] } {
  if (column === "hours") {
    const at = (h: number) => (h >= 0 && h <= WHEEL_HOUR_MAX ? h : null);
    return { above: [at(value - 2), at(value - 1)], below: [at(value + 1), at(value + 2)] };
  }
  const down1 = value > 0 ? stepMinute(value, -1) : null;
  const down2 = down1 !== null && down1 > 0 ? stepMinute(down1, -1) : null;
  const up1 = value < WHEEL_MINUTE_MAX ? stepMinute(value, 1) : null;
  const up2 = up1 !== null && up1 < WHEEL_MINUTE_MAX ? stepMinute(up1, 1) : null;
  return { above: [down2, down1], below: [up1, up2] };
}

/** 분 열 글: 두 자리(00~55) */
export const pad2 = (n: number) => String(n).padStart(2, "0");
