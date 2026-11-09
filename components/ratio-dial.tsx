"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { dragBoundary, toTotal } from "../lib/ratio-dial-calc";

/**
 * 원형 다이얼(옛 시안 RatioDial에서 이식). 처음 정한 비율(처음 설정·내 정보 「비율 고치기」)과 오늘 기록 「분야마다 나누기」가 같이 쓴다.
 * - 모양(PM 9 · 명세 ② 「다이얼의 고른 조각」 — 고침 5바퀴): 조각마다 1px 윤곽(--color-chart-outline), 조각 사이 흰 틈 2px.
 *   고른 조각은 모양 그대로 통째로 조각 가운데 각도 쪽 바깥으로 3px 나오고, 그 조각에만 같은 분야 색 빛 번짐(흐림 24 · 퍼짐 2 · 불투명 80%).
 *   빛 번짐은 SVG filter(퍼짐 = feMorphology 2, 흐림 24 = CSS·Figma 흐림 값이라 표준 편차 12, 80% = 알파 0.8)이고, svg는 overflow visible이라 칸 끝에서 잘리지 않는다.
 *   원을 다 채운 조각(경계 없음)은 나오지 않고 빛도 없다. 나옴은 120ms로 움직이고, 「동작 줄이기」(prefers-reduced-motion: reduce)면 움직임 없이 바로 나온다(나옴·빛은 보인다).
 *   손잡이는 흰 원 + 2px --color-text(보이는 지름 22), 누르는 자리는 지름 50.
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
  // 조각 화면 읽기(PM 10 ⑩): 「{분야} {시간}, 고름」. 키보드로 조각을 골랐을 때 바뀐 내용 안내도 같은 글
  picked: (name: string, value: string) => `${name} ${value}, 고름`,
  // 조각 하나의 접근 이름(고르지 않은 조각): 「{분야} {시간}」
  slice: (name: string, value: string) => `${name} ${value}`,
} as const;

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
/** 조각 안쪽 반지름(가운데 구멍) */
const INNER = R * HOLE;
/** 다이얼 그림 칸의 사방 여유(viewBox 단위 = 최대 폭에서 px). 나온 조각·빛 번짐은 이 여유와 overflow visible로 잘리지 않는다 */
const HANDLE_R = 20;
/** 손잡이 누르는 자리(보이지 않는 원)의 반지름. 다이얼이 최대 폭(240px = viewBox 240)일 때 지름 50px — --tap-min(48) 이상 */
export const HIT_R = 25;
/** 손잡이 보이는 흰 원의 반지름. 테두리 2px(CSS .dial-ring)를 더해 보이는 지름 22(명세 ③ E: 20~22) */
export const KNOB_R = 10;
/** 손잡이 테두리 굵기(CSS .dial-ring stroke-width와 같다) */
export const KNOB_STROKE = 2;
/** 조각 사이 흰 틈(px). 윤곽(1px)과 윤곽 사이에 이만큼 흰 바탕이 보인다 */
export const DIAL_GAP = 2;
/** 조각 윤곽 굵기(px, CSS .dial-slice stroke-width와 같다) */
export const DIAL_OUTLINE = 1;
/** 고른 조각이 나오는 거리(px, PM 9 — 8px·6px에서 3px로) */
export const DIAL_POP = 3;
/** 고른 조각의 빛 번짐(PM 9): 흐림 24 · 퍼짐 2 · 불투명 80%(같은 분야 색) */
export const DIAL_GLOW = { blur: 24, spread: 2, opacity: 0.8 } as const;
/** 고른 조각이 나오는 움직임(ms). 동작 줄이기면 움직임 없음 */
export const DIAL_MOTION_MS = 120;
const KNOB_AT = (R * (1 + HOLE)) / 2;
const NAME_MAX = 7;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(REDUCED_MOTION);
  mql.addEventListener?.("change", onChange);
  return () => mql.removeEventListener?.("change", onChange);
}
/** 「동작 줄이기」를 켰나. matchMedia가 없으면(서버·옛 브라우저) 끈 것으로 본다 */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

function polar(t: number, r = R): [number, number] {
  const a = (t - 0.25) * 2 * Math.PI;
  return [r * Math.cos(a), r * Math.sin(a)];
}
const fx = (n: number) => n.toFixed(3);

/**
 * 조각 하나(고리 조각)의 모양. from·to는 바퀴(0~1, 0 = 12시, 시계 방향).
 * 두 곧은 변을 각각 조각 안쪽으로 (틈 ÷ 2 + 윤곽 ÷ 2)만큼 평행하게 옮겨, 이웃 조각의 윤곽과 윤곽 사이에 흰 틈 DIAL_GAP이 보이게 한다.
 * 아주 가는 조각은 안쪽 변이 엇갈리지 않게 옮기는 거리를 줄인다. 원을 다 채우면(경계 없음) 틈 없는 고리 하나다.
 */
export function sectorPath(from: number, to: number): string {
  const span = to - from;
  if (span >= 1) {
    return `M0 ${-R} A${R} ${R} 0 1 1 0 ${R} A${R} ${R} 0 1 1 0 ${-R} Z M0 ${-INNER} A${INNER} ${INNER} 0 1 0 0 ${INNER} A${INNER} ${INNER} 0 1 0 0 ${-INNER} Z`;
  }
  const want = DIAL_GAP / 2 + DIAL_OUTLINE / 2;
  const d = span >= 0.5 ? want : Math.min(want, INNER * Math.sin(span * Math.PI) * 0.45);
  const a1 = (from - 0.25) * 2 * Math.PI;
  const a2 = (to - 0.25) * 2 * Math.PI;
  /* 변 위의 점: 반지름 r 원과, 각도 a의 반지름 선을 조각 안쪽(dir 1 = 시계 방향 쪽, -1 = 반대쪽)으로 d 옮긴 선이 만나는 곳 */
  const at = (a: number, r: number, dir: 1 | -1): [number, number] => {
    const s = Math.sqrt(r * r - d * d);
    return [s * Math.cos(a) - dir * d * Math.sin(a), s * Math.sin(a) + dir * d * Math.cos(a)];
  };
  const o1 = at(a1, R, 1);
  const o2 = at(a2, R, -1);
  const i2 = at(a2, INNER, -1);
  const i1 = at(a1, INNER, 1);
  // 옮긴 뒤 실제 호의 각도로 큰 호 여부를 정한다(반 바퀴 근처에서 엉뚱한 쪽 호를 그리지 않게)
  const outerLarge = span * 2 * Math.PI - 2 * Math.asin(d / R) > Math.PI ? 1 : 0;
  const innerLarge = span * 2 * Math.PI - 2 * Math.asin(d / INNER) > Math.PI ? 1 : 0;
  return `M${fx(o1[0])} ${fx(o1[1])} A${R} ${R} 0 ${outerLarge} 1 ${fx(o2[0])} ${fx(o2[1])} L${fx(i2[0])} ${fx(i2[1])} A${INNER} ${INNER} 0 ${innerLarge} 0 ${fx(i1[0])} ${fx(i1[1])} Z`;
}

/** 고른 조각이 나오는 자리(조각 가운데 각도 쪽 바깥으로 DIAL_POP). 원을 다 채운 조각·폭 0인 조각은 나오지 않는다 */
export function popOffset(from: number, to: number): [number, number] {
  const span = to - from;
  if (!(span > 0) || span >= 1) return [0, 0];
  return polar((from + to) / 2, DIAL_POP);
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
  const reducedMotion = useReducedMotion();
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
  /* 고른 조각: 나오는 자리와 빛 번짐. 경계가 있는 조각(0 < 폭 < 원 전체)만 */
  const popFrom = sel && total > 0 ? starts[si] / total : 0;
  const popTo = sel && total > 0 ? (starts[si] + selValue) / total : 0;
  const pop = sel && total > 0 && selValue > 0 && selValue < total ? popOffset(popFrom, popTo) : null;
  const motion = reducedMotion ? "none" : `transform ${DIAL_MOTION_MS}ms ease-out`;
  const moved = (i: number) => (pop && i === si ? `translate(${pop[0].toFixed(2)}px, ${pop[1].toFixed(2)}px)` : "translate(0px, 0px)");
  const glowId = `${id}-glow`;
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
        <defs>
          {/* 빛 번짐(PM 9): 퍼짐 2 → 흐림 24(표준 편차 12) → 불투명 80%. 칸 전체를 필터 영역으로 둬 가는 조각의 빛도 잘리지 않는다 */}
          <filter id={glowId} filterUnits="userSpaceOnUse" x={-2 * pad} y={-2 * pad} width={4 * pad} height={4 * pad} colorInterpolationFilters="sRGB">
            <feMorphology operator="dilate" radius={DIAL_GLOW.spread} />
            <feGaussianBlur stdDeviation={DIAL_GLOW.blur / 2} />
            <feComponentTransfer>
              <feFuncA type="linear" slope={DIAL_GLOW.opacity} />
            </feComponentTransfer>
          </filter>
        </defs>
        {/* 고른 조각의 빛: 같은 모양·같은 분야 색을 조각들 뒤에 흐리게 깐다(윤곽 없이) */}
        {pop && sel && (
          <path
            className="dial-glow"
            aria-hidden="true"
            d={sectorPath(popFrom, popTo)}
            filter={`url(#${glowId})`}
            style={{ fill: sel.color, transform: moved(si), transition: motion }}
          />
        )}
        {slices.map((s, i) =>
          norm[i] > 0 ? (
            <path
              key={s.key}
              className={"dial-slice" + (i === si ? " is-picked" : "")}
              role="img"
              aria-label={i === si ? DIAL_TEXT.picked(s.name, format(norm[i])) : DIAL_TEXT.slice(s.name, format(norm[i]))}
              d={sectorPath(starts[i] / total, (starts[i] + norm[i]) / total)}
              style={{ fill: s.color, transform: moved(i), transition: motion }}
              onClick={() => select(s.key)}
            />
          ) : null,
        )}
        <circle r={INNER - DIAL_OUTLINE} className="dial-hole" />
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
              <circle r={KNOB_R} className="dial-ring" />
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
