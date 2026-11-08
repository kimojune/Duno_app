"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { dragBoundary, toTotal } from "../lib/ratio-dial-calc";

/**
 * 원형 다이얼(옛 시안 RatioDial에서 이식). 처음 정한 비율(처음 설정·내 정보 「비율 고치기」)과 저녁 「분야마다 나누기」가 같이 쓴다.
 * - 조각을 누르면 고르고, 고른 조각의 앞뒤 경계에 손잡이가 선다. 손잡이마다 고른 조각과 그쪽 이웃 조각 둘만 바뀐다. 합(total)은 그대로다.
 * - 12시(맨 위)는 고정이다: 첫 조각은 끝 손잡이만, 마지막 조각은 앞 손잡이만 있고, 12시에는 눈금이 있다.
 * - 폭 0인 조각을 고르면 두 경계가 한 자리라 손잡이를 하나만 그린다. 끌기 시작한 방향으로 어느 경계인지 정한다
 *   (시계 방향이면 뒤 경계, 반시계 방향이면 앞 경계 — 어느 쪽이든 고른 조각이 커진다).
 * - 끌지 않는 길이 함께 있다(WCAG 2.5.7): 손잡이에서 화살표 step·PageUp/PageDown bigStep·Home/End 끝까지.
 * - 조각을 고르는 키보드 길이 부품 안에 있다: 다이얼(원 전체)이 탭 한 자리이고, 화살표로 앞뒤 조각·Home/End로 첫·마지막 조각을 고른다.
 *   폭 0인 조각도 고를 수 있다. 바깥 목록(처음 정한 비율의 이름 단추)은 같은 고른 조각을 쓰는 또 하나의 길이다.
 * - 바뀐 값과 고른 조각을 「바뀐 내용 안내」(aria-live)로 알린다. 모든 글은 React 텍스트다(innerHTML 없음). 가운데 표시는 긴 이름을 줄여 그리고, 전체 이름은 손잡이의 접근성 이름에 있다.
 * - 선택은 바깥이 가진다(selectedKey·onSelect). 목록에 없는 key는 「아무것도 안 고름」으로 읽는다(바깥 목록과 같게).
 * - 값은 합 total의 정수로 그린다. 합이 total이 아니면 합으로 나눠 그린다(처음 정한 비율은 RatioEditor가 열 때 합 100으로 맞춰 둔다).
 * - 끌기는 원 전체(svg)가 포인터를 잡는다: 끄는 동안 손잡이가 바뀌어도(폭 0 손잡이가 둘로 갈림) 끌기가 끊기지 않는다. 각도는 조금씩 더해 가므로 12시를 넘어도 뛰지 않는다.
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
  // 임시 글, 디자인 확정 뒤: 조각 고르기 안내를 다이얼 이름에 붙였다(고침4 2단계)
  group: "원형 다이얼",
  groupHint: "화살표 키로 조각을 고를 수 있어요",
  // 임시 글, 디자인 확정 뒤: 한 걸음 글을 바깥 단위(1%·5분)로 바꿨다(고침4 2단계)
  handle: (name: string, other: string, stepText: string) => `${name}·${other} 사이 손잡이. 화살표 키로 ${stepText}씩 바꿀 수 있어요`,
  // 임시 글, 디자인 확정 뒤: 폭 0 조각의 겹친 손잡이(고침4 2단계)
  handleBoth: (name: string, prev: string, next: string, stepText: string) =>
    `${prev}·${name}·${next} 사이 손잡이. 화살표 키로 ${name}을 ${stepText}씩 키울 수 있어요`,
  // 임시 글, 디자인 확정 뒤: 키보드로 조각을 골랐을 때 바뀐 내용 안내
  picked: (name: string, value: string) => `${name} 고름, ${value}`,
} as const;

/**
 * 조각 색을 정하는 한 곳(처음 정한 비율·저녁 나누기가 같이 쓴다). 지금은 있는 토큰만 돌려 쓴다(임시, 1단계 값 그대로).
 * 합치기 워커가 분야 색 배정 함수(lib/category-color.ts, 다른 워커가 만든다)에 이 함수를 잇는다: index = 분야 순서(0부터), other = 기타 조각.
 * 분야 색은 9번째부터 돌려 쓴다(PM 확정 11-08) — 그 규칙은 분야 색 함수가 맡는다.
 */
const SLICE_COLORS = ["var(--color-primary)", "var(--color-text-sub)", "var(--color-primary-pressed)", "var(--color-text)"];
const OTHER_SLICE_COLOR = "var(--color-border-input)";
export function dialSliceColor(index: number, other: boolean): string {
  return other ? OTHER_SLICE_COLOR : SLICE_COLORS[((index % SLICE_COLORS.length) + SLICE_COLORS.length) % SLICE_COLORS.length];
}

interface Props {
  id: string;
  slices: DialSlice[];
  /** 고른 조각의 key. null이거나 목록에 없는 key면 아무것도 안 골랐다 */
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** 바뀐 값들(slices와 같은 순서, 합 total의 정수) */
  onChange: (values: number[]) => void;
  total?: number;
  /** 손잡이 한 걸음(화살표 키, 끌기 반올림 단위). 기본 1(비율 1%). 저녁 기록은 5분 */
  step?: number;
  /** PageUp/PageDown 한 걸음. 기본 5 */
  bigStep?: number;
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
/** 손잡이 누르는 자리(보이지 않는 원)의 반지름. 다이얼이 최대 폭(240px = viewBox 240)일 때 지름 50px — --tap-min(48) 이상 */
export const HIT_R = 25;
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

/** start = 고른 조각의 앞 경계, end = 뒤 경계, both = 폭 0 조각이라 두 경계가 겹친 하나 */
type Side = "start" | "end" | "both";

export function RatioDial({
  id,
  slices,
  selectedKey,
  onSelect,
  onChange,
  total = 100,
  step = 1,
  bigStep = 5,
  format = (v) => `${v}%`,
  sub,
  center,
}: Props) {
  const n = slices.length;
  const raw = slices.map((s) => s.value);
  const keySig = slices.map((s) => s.key).join("|");
  const norm = toTotal(raw, total);
  const empty = norm.every((v) => v === 0);
  const svg = useRef<SVGSVGElement>(null);
  /* 끌기: 시작 값(base), 마지막 각도, 더해 온 각도(acc), 어느 경계(k, 겹친 손잡이는 첫 움직임 전까지 null) */
  const drag = useRef<null | { base: number[]; last: number; acc: number; k: number | null; side: Side; si: number }>(null);
  const [dragging, setDragging] = useState<Side | null>(null);
  /* 키보드로 바꾼 뒤 포커스를 둘 손잡이(손잡이가 갈리거나 합쳐져도 포커스를 잃지 않게) */
  const focusSide = useRef<Side | null>(null);
  /* 바뀐 내용 안내는 조각 구성이 바뀌면(분야를 더하거나 뺌) 지운다. 상태에 구성 표시를 같이 두어 읽을 때 거른다 */
  const [changes, setChanges] = useState({ sig: keySig, text: "" });

  const si = selectedKey === null ? -1 : slices.findIndex((s) => s.key === selectedKey);
  const sel = si >= 0 ? slices[si] : null;

  useEffect(() => {
    const want = focusSide.current;
    if (!want) return;
    focusSide.current = null;
    const el = document.getElementById(`${id}-handle-${want}`) ?? document.getElementById(`${id}-handle-both`);
    // 포커스가 이 다이얼 안에 있거나(손잡이가 갈리거나 합쳐진 직후) 아무 데도 없을 때만 옮긴다 — 바깥(−/+·숫자 칸·Stepper)의 포커스는 뺏지 않는다
    const active = document.activeElement;
    const inDial = !active || active === document.body || (svg.current?.contains(active) ?? false);
    if (el && inDial && active !== el) (el as unknown as HTMLElement).focus();
  });

  function apply(next: number[]) {
    if (next.every((v, i) => v === raw[i])) return false;
    const ch: string[] = [];
    next.forEach((v, i) => {
      if (v !== norm[i]) ch.push(`${slices[i].name} ${format(norm[i])} → ${format(v)}`);
    });
    setChanges({ sig: keySig, text: ch.join(", ") });
    onChange(next);
    return true;
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
  /* 고른 조각의 앞 경계(start)와 끝 경계(end). 12시 쪽(첫 조각의 앞, 마지막 조각의 끝)에는 없다. 모두 0이면 끌 것이 없어 손잡이도 없다.
     폭 0인 조각이 앞뒤 경계를 다 가지면 두 손잡이가 한 자리에 겹치므로 하나(both)만 그린다 */
  const handles: { side: Side; at: number }[] = [];
  const hasStart = !!sel && !empty && si > 0;
  const hasEnd = !!sel && !empty && si < n - 1;
  if (hasStart && hasEnd && selValue === 0) handles.push({ side: "both", at: starts[si] });
  else {
    if (hasStart) handles.push({ side: "start", at: starts[si] });
    if (hasEnd) handles.push({ side: "end", at: starts[si] + selValue });
  }
  const note = changes.sig === keySig ? changes.text : "";

  /** 손잡이 키보드: 고른 조각이 커지는 쪽이 +. end는 시계 방향, start는 반시계 방향. both는 뒤 이웃이 있으면 뒤에서, 없으면 앞에서 가져온다 */
  function onHandleKey(e: KeyboardEvent<SVGGElement>, side: Side) {
    let grow = 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") grow = step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") grow = -step;
    else if (e.key === "PageUp") grow = bigStep;
    else if (e.key === "PageDown") grow = -bigStep;
    else if (e.key === "End") grow = Infinity;
    else if (e.key === "Home") grow = -Infinity;
    if (!grow) return;
    e.preventDefault();
    e.stopPropagation(); // 다이얼의 조각 고르기 키로 올라가지 않게
    let use: "start" | "end" = side === "start" ? "start" : "end";
    if (side === "both") {
      if (grow < 0) return; // 폭 0: 더 줄일 것이 없다
      use = norm[si + 1] > 0 ? "end" : "start";
    }
    const next = use === "end" ? dragBoundary(norm, si, grow, step) : dragBoundary(norm, si - 1, -grow, step);
    // 값이 실제로 바뀐 때만 포커스 표시를 세운다(끝에서 한 번 더 눌러 안 바뀌면 렌더가 없어 표시가 남았다가 뒤에 포커스를 뺏었다)
    if (apply(next)) focusSide.current = use;
  }

  /** 다이얼(원 전체)의 키보드: 조각 고르기. 화살표로 앞뒤, Home/End로 처음·끝. 폭 0인 조각도 고른다 */
  function onDialKey(e: KeyboardEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = si < 0 ? 0 : Math.min(n - 1, si + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = si < 0 ? n - 1 : Math.max(0, si - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    if (next === si) return;
    onSelect(slices[next].key);
    setChanges({ sig: keySig, text: DIAL_TEXT.picked(slices[next].name, format(norm[next])) });
  }

  function startDrag(e: PointerEvent<SVGGElement>, side: Side) {
    e.preventDefault();
    try {
      svg.current?.setPointerCapture(e.pointerId);
    } catch {
      /* 포인터 잡기를 못 해도 끌기는 이어 간다 */
    }
    const k = side === "start" ? si - 1 : side === "end" ? si : null;
    drag.current = { base: norm, last: angleOf(e), acc: 0, k, side, si };
    setDragging(side);
  }
  function moveDrag(e: PointerEvent<SVGSVGElement>) {
    const dr = drag.current;
    if (!dr) return;
    const a = angleOf(e);
    let d = a - dr.last;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    dr.last = a;
    dr.acc += d;
    if (dr.k === null) {
      if (dr.acc === 0) return;
      // 겹친 손잡이: 처음 움직인 방향으로 경계를 정한다(시계 = 뒤 경계, 반시계 = 앞 경계)
      dr.k = dr.acc > 0 ? dr.si : dr.si - 1;
      setDragging(dr.acc > 0 ? "end" : "start");
    }
    apply(dragBoundary(dr.base, dr.k, dr.acc * total, step));
  }
  function endDrag() {
    drag.current = null;
    setDragging(null);
  }

  const stepText = format(step);
  return (
    <div className="ratio-dial">
      <svg
        ref={svg}
        viewBox={`${-pad} ${-pad} ${2 * pad} ${2 * pad}`}
        className="dial"
        role="group"
        tabIndex={0}
        aria-label={`${DIAL_TEXT.group}. ${DIAL_TEXT.groupHint}`}
        onKeyDown={onDialKey}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
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
        <path className="dial-rim" aria-hidden="true" d={sel && total > 0 ? rimPath(starts[si] / total, (starts[si] + selValue) / total) : ""} />
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
          const label =
            h.side === "both"
              ? DIAL_TEXT.handleBoth(sel!.name, slices[si - 1].name, slices[si + 1].name, stepText)
              : DIAL_TEXT.handle(sel!.name, (h.side === "start" ? slices[si - 1] : slices[si + 1]).name, stepText);
          const isDragging = dragging === h.side || (h.side === "both" && dragging !== null);
          return (
            <g
              key={h.side}
              className={"dial-handle" + (isDragging ? " dragging" : "")}
              id={`${id}-handle-${h.side}`}
              role="slider"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={selValue}
              aria-valuetext={format(selValue)}
              aria-label={label}
              style={{ touchAction: "none" }}
              transform={`translate(${knob[0].toFixed(2)} ${knob[1].toFixed(2)})`}
              onPointerDown={(e) => startDrag(e, h.side)}
              onKeyDown={(e) => onHandleKey(e, h.side)}
            >
              <circle r={HIT_R} className="dial-hit" />
              <circle r={16} className="dial-ring" />
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
