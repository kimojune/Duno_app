import { describe, expect, it } from "vitest";
import { CLOCK_GEOMETRY, CLOCK_LOOP_MINUTES, clockRatio, clockTicks, sectorAngles, sectorShape } from "../../lib/timer-clock";

/** 고침 11 T1·T5: 시계 한 바퀴 = 30분(d-224). 각도 = −90° + (1 − 남은 초 ÷ 1800) × 360°, 끝 270° */
describe("남은 비율 · 부채꼴 각도(순수)", () => {
  it("24:12가 남았으면 남은 비율 0.8067, 시작 −20.4°, 끝 270°", () => {
    const ratio = clockRatio(24 * 60 + 12);
    expect(ratio).toBeCloseTo(0.8067, 4);
    const angles = sectorAngles(ratio)!;
    expect(angles.startDeg).toBeCloseTo(-20.4, 6);
    expect(angles.endDeg).toBe(270);
  });
  it("남은 0이면 부채꼴이 없다(T5 「00:00」). 음수·숫자 아님도 그리지 않는다", () => {
    expect(clockRatio(0)).toBe(0);
    expect(sectorAngles(0)).toBeNull();
    expect(sectorShape(0)).toBeNull();
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY * -1]) expect(sectorShape(clockRatio(bad))).toBeNull();
  });
  it("시작(1800초 남음)은 꽉 찬 원이고, 한 바퀴보다 큰 값도 꽉 찬 원이다", () => {
    expect(clockRatio(1800)).toBe(1);
    expect(clockRatio(5000)).toBe(1);
    expect(sectorAngles(1)).toEqual({ startDeg: -90, endDeg: 270 });
    expect(sectorShape(1)).toEqual({ kind: "full", radius: 116 });
  });
  it("반원(15분 남음): 시작 90°(6시)에서 시계 방향으로 12시까지, 큰 호 아님", () => {
    expect(sectorAngles(clockRatio(900))).toEqual({ startDeg: 90, endDeg: 270 });
    expect(sectorShape(clockRatio(900))).toEqual({ kind: "path", d: "M0 0L0 116A116 116 0 0 1 0 -116Z" });
  });
  it("24:12의 path: 가운데에서 시작 점(반지름 116)으로 가서 큰 호(시계 방향)로 12시까지", () => {
    const shape = sectorShape(clockRatio(24 * 60 + 12));
    expect(shape?.kind).toBe("path");
    if (shape?.kind !== "path") return;
    const m = /^M0 0L(-?[\d.]+) (-?[\d.]+)A116 116 0 1 1 0 -116Z$/.exec(shape.d);
    expect(m, shape.d).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(116 * Math.cos((-20.4 * Math.PI) / 180), 2);
    expect(Number(m![2])).toBeCloseTo(116 * Math.sin((-20.4 * Math.PI) / 180), 2);
  });
  it("남은 시간이 줄수록 부채꼴이 줄어든다(시작 각도가 12시를 향해 커진다)", () => {
    const start = (s: number) => sectorAngles(clockRatio(s))!.startDeg;
    expect(start(1500)).toBeGreaterThan(start(1700));
    expect(start(60)).toBeGreaterThan(start(600));
    expect(start(1)).toBeLessThan(270);
  });
  it("움직임 줄이기: 남은 분이 바뀔 때만 바뀐다(같은 분 안의 초는 같은 값), 숫자는 부르는 쪽이 1초마다", () => {
    const at = (s: number) => clockRatio(s, true);
    for (let s = 1741; s <= 1800; s++) expect(at(s)).toBe(1);
    expect(at(1740)).toBeCloseTo(1740 / 1800, 6);
    expect(at(1740)).toBe(at(1700));
    expect(at(1680)).not.toBe(at(1700));
    expect(at(1)).toBeCloseTo(60 / 1800, 6);
    expect(at(0)).toBe(0);
    // 끄면 1초마다 바뀐다
    expect(clockRatio(1799)).not.toBe(clockRatio(1800));
  });
});

describe("눈금 30개 · 숫자 0·5…25(반시계)", () => {
  const ticks = clockTicks();
  it("한 바퀴 30분이라 눈금이 30개이고, 5분마다 큰 눈금 6개에만 숫자가 있다", () => {
    expect(CLOCK_LOOP_MINUTES).toBe(30);
    expect(ticks).toHaveLength(30);
    expect(ticks.filter((t) => t.major).map((t) => t.minute)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(ticks.filter((t) => t.label).map((t) => t.label!.text)).toEqual(["0", "5", "10", "15", "20", "25"]);
  });
  it("0이 12시, 숫자는 반시계 방향으로 커진다(5는 왼쪽 위, 15는 6시, 25는 오른쪽 위)", () => {
    const label = (n: number) => ticks.find((t) => t.label?.text === String(n))!.label!;
    expect(label(0)).toEqual({ text: "0", x: 0, y: -146 });
    expect(label(5).x).toBeLessThan(0);
    expect(label(5).y).toBeLessThan(0);
    expect(label(15)).toEqual({ text: "15", x: 0, y: 146 });
    expect(label(25).x).toBeGreaterThan(0);
    expect(label(25).y).toBeLessThan(0);
  });
  it("큰 눈금은 반지름 120→132, 작은 눈금은 126→132, 숫자는 반지름 146", () => {
    const g = CLOCK_GEOMETRY;
    expect([g.plateRadius, g.sectorRadius, g.coreRadius, g.labelRadius]).toEqual([132, 116, 72, 146]);
    expect(ticks[0]).toMatchObject({ x1: 0, y1: -120, x2: 0, y2: -132, major: true });
    const minor = ticks[1];
    expect(Math.hypot(minor.x1, minor.y1)).toBeCloseTo(126, 2);
    expect(Math.hypot(minor.x2, minor.y2)).toBeCloseTo(132, 2);
    expect(g.extent).toBe(160); // 숫자 상자(28×16)까지 들어가는 SVG 가장자리
  });
  it("부채꼴 끝(남은 분)이 가리키는 숫자가 남은 분과 맞다: 24분 12초 남음 → 24.2 근처(반시계 눈금)", () => {
    const { startDeg } = sectorAngles(clockRatio(24 * 60 + 12))!;
    const counterClockwiseMinutes = ((((-90 - startDeg) / 360) % 1) + 1) % 1 * CLOCK_LOOP_MINUTES;
    expect(counterClockwiseMinutes).toBeCloseTo(24.2, 6);
  });
});
