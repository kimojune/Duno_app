"use client";

import { useRef, useState } from "react";
import { dragBoundary, toTotal } from "../lib/ratio-dial-calc";

/**
 * 원형 다이얼(옛 시안 RatioDial에서 이식). 처음 정한 비율(처음 설정·내 정보 「비율 고치기」)과 저녁 「분야마다 나누기」가 같이 쓴다.
 * - 조각을 누르면 고르고, 고른 조각의 앞뒤 경계에 손잡이가 선다. 손잡이마다 고른 조각과 그쪽 이웃 조각 둘만 바뀐다.
 * - 12시(맨 위)는 고정이다: 첫 조각은 끝 손잡이만, 마지막 조각은 앞 손잡이만 있고, 12시에는 눈금이 있다.
 * - 끌지 않는 길이 함께 있다(WCAG 2.5.7): 손잡이에서 화살표 1%·PageUp/PageDown 5%. 조각을 고르는 키보드 길은 바깥 목록의 이름 단추가 맡는다.
 * - 바뀐 값을 「바뀐 내용 안내」(aria-live)로 알린다. 모든 글은 React 텍스트다(innerHTML 없음). 가운데 표시는 긴 이름을 줄여 그리고, 전체 이름은 손잡이의 접근성 이름에 있다.
 * - 선택은 바깥이 가진다(selectedKey·onSelect) — 목록과 다이얼이 같은 「고른 조각」을 쓴다.
 * - 값은 합 total의 정수로 그린다. 합이 total이 아니면 합으로 나눠 그리고, 처음 만지는 순간 합 total의 정수로 맞춘 뒤 그 위에 바꾼다.
 * - touch-action: none은 손잡이에만 있다(CSS .dial-handle와 아래 인라인 스타일). 원의 나머지와 화면은 손가락으로 스크롤된다.
 */

export interface DialSlice {
  key: string;
  name: string;
  /** CSS 색 값(토큰 var(--color-*) 가능) */
  color: string;
  /** 0 이상의 정수. 합이 total이 아니어도 된다 */
  value: number;
}

export const DIAL_TEXT = {
  group: "원형 다이얼",
  handle: (name: string, other: string) => `${name}·${other} 사이 손잡이. 화살표 키로 ${name} 비율을 1%씩 바꿀 수 있어요`,
} as const;

interface Props {
  id: string;
  slices: DialSlice[];
  /** 고른 조각의 key. null이면 아무것도 안 골랐다. 목록에 없는 key는 첫 조각으로 읽는다 */
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** 바뀐 값들(slices와 같은 순서, 합 total의 정수) */
  onChange: (values: number[]) => void;
  total?: number;
  /** 값을 글로: 가운데 표시·손잡이 값 글·바뀐 내용 안내에 쓴다. 기본 「N%」 */
  format?: (value: number) => string;
  /** 조각마다 가운데 표시 아래 줄 글(예: 쓴 시간). 없으면 format(값) */
  sub?: (slice: DialSlice, value: number) => string;
  /** 아무것도 안 골랐을 때 가운데 글 */
  center?: string;
}

const R = 100;
const HOLE = 0.62;
const HANDLE_R = 20;
const KNOB_AT = (R * (1 + HOLE)) / 2;
const NAME_MAX = 7;

function polar(t: number, r = R): [number, number] {
  const a = (t - 0.25) * 2 * Math.PI;
  return [r * Math.cos(a), r * Math.sin(a)];
}
function arcPath(from: number, to: number) {
  if (to - from >= 1) return `M0 ${-R} A${R} ${R} 0 1 1 -0.01 ${-R} Z`;
  const p1 = polar(from);
  const p2 = polar(to);
  return `M0 0 L${p1[0].toFixed(3)} ${p1[1].toFixed(3)} A${R} ${R} 0 ${to - from > 0.5 ? 1 : 0} 1 ${p2[0].toFixed(3)} ${p2[1].toFixed(3)} Z`;
}
function rimPath(from: number, to: number) {
  const r = R - 3;
  if (to - from <= 0) return "";
  if (to - from >= 1) return `M0 ${-r} A${r} ${r} 0 1 1 0 ${r} A${r} ${r} 0 1 1 0 ${-r}`;
  const p1 = polar(from, r);
  const p2 = polar(to, r);
  return `M${p1[0].toFixed(3)} ${p1[1].toFixed(3)} A${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${p2[0].toFixed(3)} ${p2[1].toFixed(3)}`;
}
/** 긴 이름은 글자(코드 포인트) 기준으로 줄인다 */
export function shortName(name: string): string {
  const chars = [...name];
  return chars.length > NAME_MAX ? chars.slice(0, NAME_MAX - 1).join("") + "…" : name;
}

/** 가운데 표시의 글을 숫자와 뒤 단위로 가른다(「45%」→ 45, %). 단위를 따로 그려 크기를 달리할 수 있다. 숫자로 시작하지 않으면 통째로 숫자 쪽이다 */
export function splitUnit(text: string): [string, string] {
  const m = /^(\d+)([\s\S]*)$/.exec(text);
  return m ? [m[1], m[2]] : [text, ""];
}

type Side = "start" | "end";

export function RatioDial({ id, slices, selectedKey, onSelect, onChange, total = 100, format = (v) => `${v}%`, sub, center }: Props) {
  const n = slices.length;
  const raw = slices.map((s) => s.value);
  const keySig = slices.map((s) => s.key).join("|");
  const norm = toTotal(raw, total);
  const empty = norm.every((v) => v === 0);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<null | { base: number[]; angle: number; k: number }>(null);
  const [dragging, setDragging] = useState<Side | null>(null);
  /* 바뀐 내용 안내는 조각 구성이 바뀌면(분야를 더하거나 뺌) 지운다. 상태에 구성 표시를 같이 두어 읽을 때 거른다 */
  const [changes, setChanges] = useState({ sig: keySig, text: "" });

  const si = selectedKey === null ? -1 : Math.max(0, slices.findIndex((s) => s.key === selectedKey));
  const sel = si >= 0 ? slices[si] : null;

  function apply(next: number[]) {
    if (next.every((v, i) => v === raw[i])) return;
    const ch: string[] = [];
    next.forEach((v, i) => {
      if (v !== norm[i]) ch.push(`${slices[i].name} ${format(norm[i])} → ${format(v)}`);
    });
    setChanges({ sig: keySig, text: ch.join(", ") });
    onChange(next);
  }
  function angleOf(e: { clientX: number; clientY: number }) {
    const box = svg.current!.getBoundingClientRect();
    const x = e.clientX - box.left - box.width / 2;
    const y = e.clientY - box.top - box.height / 2;
    const t = Math.atan2(y, x) / (2 * Math.PI) + 0.25;
    return ((t % 1) + 1) % 1;
  }
  const select = (key: string) => onSelect(si >= 0 && slices[si].key === key ? null : key);

  if (n === 0) return null;

  const starts = norm.map((_, i) => norm.slice(0, i).reduce((a, b) => a + b, 0)); // 조각마다 앞까지의 합
  const selValue = si >= 0 ? norm[si] : 0;
  const numText = sel ? (sub ? sub(sel, selValue) : format(selValue)) : "";
  const pad = R + HANDLE_R;
  /* 고른 조각의 앞 경계(start)와 끝 경계(end). 12시 쪽(첫 조각의 앞, 마지막 조각의 끝)에는 없다. 모두 0이면 끌 것이 없어 손잡이도 없다 */
  const handles: { side: Side; k: number; at: number; other: DialSlice }[] = [];
  if (sel && !empty && si > 0) handles.push({ side: "start", k: si - 1, at: starts[si], other: slices[si - 1] });
  if (sel && !empty && si < n - 1) handles.push({ side: "end", k: si, at: starts[si] + selValue, other: slices[si + 1] });
  /* 고른 조각이 커지는 쪽이 +. end 손잡이는 시계 방향, start 손잡이는 반시계 방향 */
  const grow = (side: Side, step: number) => (side === "end" ? step : -step);
  const note = changes.sig === keySig ? changes.text : "";

  return (
    <div className="ratio-dial">
      <svg ref={svg} viewBox={`${-pad} ${-pad} ${2 * pad} ${2 * pad}`} className="dial" role="group" aria-label={DIAL_TEXT.group}>
        {slices.map((s, i) =>
          norm[i] > 0 ? (
            <path
              key={s.key}
              className="dial-slice"
              d={arcPath(starts[i] / total, (starts[i] + norm[i]) / total)}
              style={{ fill: s.color }}
              onClick={() => select(s.key)}
            />
          ) : null,
        )}
        <path className="dial-rim" aria-hidden="true" d={sel ? rimPath(starts[si] / total, (starts[si] + selValue) / total) : ""} />
        <circle r={R * HOLE} className="dial-hole" />
        {n >= 2 && <line className="dial-noon" id={`${id}-noon`} x1={0} y1={-R - 3} x2={0} y2={-R - 11} aria-hidden="true" />}
        {/* 가운데 표시: 줄인 이름이라 읽어 주지 않는다(전체 이름은 손잡이 이름·바뀐 내용 안내에 있다) */}
        {sel ? (
          <>
            <text textAnchor="middle" className="dial-center-name" y={-12} aria-hidden="true">
              {shortName(sel.name)}
            </text>
            <text textAnchor="middle" className="dial-center-value" y={14} aria-hidden="true">
              {splitUnit(numText)[0]}
              <tspan className="dial-center-unit">{splitUnit(numText)[1]}</tspan>
            </text>
          </>
        ) : (
          <text textAnchor="middle" className="dial-center-value" y={5} aria-hidden="true">
            {center ?? ""}
          </text>
        )}
        {handles.map((h) => {
          const knob = polar(h.at / total, KNOB_AT);
          return (
            <g
              key={h.side}
              className={"dial-handle" + (dragging === h.side ? " dragging" : "")}
              id={`${id}-handle-${h.side}`}
              role="slider"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={selValue}
              aria-valuetext={format(selValue)}
              aria-label={DIAL_TEXT.handle(sel!.name, h.other.name)}
              style={{ touchAction: "none" }}
              transform={`translate(${knob[0].toFixed(2)} ${knob[1].toFixed(2)})`}
              onPointerDown={(e) => {
                e.preventDefault();
                try {
                  (e.currentTarget as Element).setPointerCapture(e.pointerId);
                } catch {
                  /* 포인터 잡기를 못 해도 끌기는 이어 간다 */
                }
                drag.current = { base: norm, angle: angleOf(e), k: h.k };
                setDragging(h.side);
              }}
              onPointerMove={(e) => {
                const dr = drag.current;
                if (!dr) return;
                let d = angleOf(e) - dr.angle;
                if (d > 0.5) d -= 1;
                if (d < -0.5) d += 1;
                apply(dragBoundary(dr.base, dr.k, d * total));
              }}
              onPointerUp={() => {
                drag.current = null;
                setDragging(null);
              }}
              onPointerCancel={() => {
                drag.current = null;
                setDragging(null);
              }}
              onKeyDown={(e) => {
                let step = 0;
                if (e.key === "ArrowRight" || e.key === "ArrowUp") step = 1;
                else if (e.key === "ArrowLeft" || e.key === "ArrowDown") step = -1;
                else if (e.key === "PageUp") step = 5;
                else if (e.key === "PageDown") step = -5;
                if (!step) return;
                e.preventDefault();
                apply(dragBoundary(norm, h.k, grow(h.side, step)));
              }}
            >
              <circle r={16} className="dial-ring" />
              <circle r={HANDLE_R} className="dial-hit" />
              <circle r={11} className="dial-knob" />
              <circle r={4} style={{ fill: sel!.color }} />
            </g>
          );
        })}
      </svg>
      <p className="dial-changes" id={`${id}-changes`} aria-live="polite">
        {note || " "}
      </p>
    </div>
  );
}
