/**
 * 타이머 시계 배경의 순수 계산(고침 11, 23 명세 4절). 화면·시험이 같이 쓴다. 시계·DOM을 건드리지 않는다.
 * - 한 바퀴 = 30분(PM d-224). 60분판은 만들지 않는다.
 * - 각도: 12시 = −90°, 시계 방향이 +. 남은 비율 = 남은 초 ÷ (한 바퀴 분 × 60). 부채꼴 시작 = −90° + (1 − 남은 비율) × 360°, 끝 = 270°(다시 12시).
 * - 눈금 숫자는 0이 12시이고 반시계 방향으로 커진다(남은 시간이 줄어드는 쪽 끝이 남은 분을 가리킨다).
 */
export const CLOCK_LOOP_MINUTES = 30;
export const CLOCK_LOOP_SECONDS = CLOCK_LOOP_MINUTES * 60;

/** 판·부채꼴·눈금 크기(SVG 좌표, 가운데가 0,0). 값은 23 명세 4절 */
export const CLOCK_GEOMETRY = {
  /** 흰 판 반지름(지름 264) */
  plateRadius: 132,
  /** 남은 시간 부채꼴 반지름(지름 232) */
  sectorRadius: 116,
  /** 가운데 판 반지름(지름 144) */
  coreRadius: 72,
  /** 1분 눈금 안쪽·바깥 반지름 */
  minorTick: [126, 132] as const,
  /** 5분 눈금 안쪽·바깥 반지름 */
  majorTick: [120, 132] as const,
  /** 눈금 숫자를 놓는 반지름 */
  labelRadius: 146,
  /** SVG가 보이는 가장자리(±). 숫자 상자(28×16) 바깥까지 */
  extent: 160,
} as const;

/**
 * 남은 비율(0~1). 움직임 줄이기면 남은 분이 바뀔 때만 바뀌도록 올림한 분으로 센다(숫자는 그대로 1초마다).
 * 0 이하·숫자가 아닌 값은 0, 한 바퀴보다 크면 1.
 */
export function clockRatio(remainingSeconds: number, reducedMotion = false): number {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return 0;
  const seconds = reducedMotion ? Math.ceil(remainingSeconds / 60) * 60 : remainingSeconds;
  return Math.min(1, seconds / CLOCK_LOOP_SECONDS);
}

/** 부채꼴의 시작·끝 각도(도). 남은 비율이 0이면 그리지 않으니 null */
export function sectorAngles(ratio: number): { startDeg: number; endDeg: number } | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const r = Math.min(1, ratio);
  return { startDeg: -90 + (1 - r) * 360, endDeg: 270 };
}

const round = (n: number) => Math.round(n * 1000) / 1000 + 0; // + 0: -0을 0으로
const point = (radius: number, deg: number) => ({ x: round(radius * Math.cos((deg * Math.PI) / 180)), y: round(radius * Math.sin((deg * Math.PI) / 180)) });

export type ClockSector = { kind: "full"; radius: number } | { kind: "path"; d: string };

/** 부채꼴 그림. 안 그리면 null, 꽉 찬 원이면 full, 그 밖에는 가운데에서 시작 각도로 가고 시계 방향 호로 12시까지 가는 path */
export function sectorShape(ratio: number, radius: number = CLOCK_GEOMETRY.sectorRadius): ClockSector | null {
  const angles = sectorAngles(ratio);
  if (!angles) return null;
  if (ratio >= 1) return { kind: "full", radius };
  const start = point(radius, angles.startDeg);
  const end = point(radius, angles.endDeg);
  const sweep = angles.endDeg - angles.startDeg;
  const large = sweep > 180 ? 1 : 0;
  return { kind: "path", d: `M0 0L${start.x} ${start.y}A${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}Z` };
}

export type ClockTick = { minute: number; major: boolean; x1: number; y1: number; x2: number; y2: number; label: { text: string; x: number; y: number } | null };

/** 눈금 30개(1분마다, 5분마다 큰 눈금과 숫자 0·5…25). 숫자는 12시에서 반시계 방향으로 커진다 */
export function clockTicks(): ClockTick[] {
  const g = CLOCK_GEOMETRY;
  return Array.from({ length: CLOCK_LOOP_MINUTES }, (_, minute) => {
    const deg = -90 - (minute / CLOCK_LOOP_MINUTES) * 360;
    const major = minute % 5 === 0;
    const [inner, outer] = major ? g.majorTick : g.minorTick;
    const a = point(inner, deg);
    const b = point(outer, deg);
    const at = point(g.labelRadius, deg);
    return { minute, major, x1: a.x, y1: a.y, x2: b.x, y2: b.y, label: major ? { text: String(minute), x: at.x, y: at.y } : null };
  });
}
