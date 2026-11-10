"use client";

import type { ReactNode } from "react";
import { CLOCK_GEOMETRY, clockRatio, clockTicks, sectorShape } from "../lib/timer-clock";

/**
 * 타이머 시계 배경(고침 11, 23 명세 4절 T1·T5·T6). 흰 판 · 30개 눈금(5분마다 큰 눈금과 숫자, 12시에서 반시계 방향으로 커짐) ·
 * 남은 시간 분야 색 부채꼴(윤곽 1 필수: 분야 색 채움은 흰 판과 대비가 3:1 아래라 경계는 윤곽이 맡는다) · 가운데 판.
 * 그림(SVG)은 꾸밈이라 화면 읽기가 건너뛴다(aria-hidden). 남은 시간은 가운데 글(children, role=timer)이 전한다.
 * 색은 app/globals.css 토큰(--color-category-N · --color-category-other)이다. 부채꼴 색은 부르는 쪽이 CSS 값으로 넘긴다.
 * 움직임 줄이기(reducedMotion)면 부채꼴이 남은 분이 바뀔 때만 바뀐다(숫자는 부르는 쪽이 1초마다 그린다).
 */
const TICKS = clockTicks();

export function TimerClock({ remainingSeconds, color, reducedMotion, children }: { remainingSeconds: number; color: string; reducedMotion: boolean; children: ReactNode }) {
  const g = CLOCK_GEOMETRY;
  const sector = sectorShape(clockRatio(remainingSeconds, reducedMotion));
  const size = g.extent * 2;
  return (
    <div className="timer-face">
      <svg className="timer-face-svg" viewBox={`${-g.extent} ${-g.extent} ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="clock-plate" r={g.plateRadius} />
        {TICKS.map((t) => (
          <line key={t.minute} className={t.major ? "clock-tick-major" : "clock-tick-minor"} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
        ))}
        {TICKS.map((t) =>
          t.label ? (
            <text key={`n${t.minute}`} className="clock-num" x={t.label.x} y={t.label.y} textAnchor="middle" dominantBaseline="central">
              {t.label.text}
            </text>
          ) : null,
        )}
        {sector?.kind === "full" && <circle className="clock-sector chart-outline-svg" r={sector.radius} style={{ fill: color }} />}
        {sector?.kind === "path" && <path className="clock-sector chart-outline-svg" d={sector.d} style={{ fill: color }} />}
        <circle className="clock-core" r={g.coreRadius} />
      </svg>
      <div className="timer-face-text">{children}</div>
    </div>
  );
}
