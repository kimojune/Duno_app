"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import {
  canMove,
  clampTotal,
  columnEdge,
  moveColumn,
  neighbors,
  nudgeTotal,
  pad2,
  parseColumnInput,
  splitTotal,
  WHEEL_HOUR_BIG,
  WHEEL_HOUR_MAX,
  WHEEL_MINUTE_BIG,
  WHEEL_MINUTE_MAX,
  WHEEL_MINUTE_STEP,
  withColumn,
  type WheelColumn,
} from "../lib/time-wheel";
import { useReducedMotion } from "../lib/use-reduced-motion";

/**
 * 두 줄 휠(오늘 기록 시간 단계, 명세 ⑦-4 · D-170 · Figma 49:5 / 66:170).
 * - 왼쪽 「시간」 열(0~24), 오른쪽 「분」 열(00~55, 5분 단위). 가운데 값 32 Bold, 위아래 흐린 값 둘씩(24·20, 보조 글 색), 가운데 띠 위아래 1px 선.
 * - 열마다 role="spinbutton"(aria-label 「시간」「분」, aria-valuetext 「2시간」「30분」). 위/아래 화살표 한 걸음(1시간 · 5분), PageUp/PageDown 큰 걸음(임시 3시간 · 15분), Home/End 끝값.
 * - 끌기(손가락·마우스 — 포인터)와 휠·트랙패드로 한 칸씩 걸린다. 손을 떼면 가운데로 걸려 들어가는 짧은 움직임(160ms) — 「동작 줄이기」면 움직임 없이.
 * - 가운데 숫자를 누르거나(또는 열에서 Enter) 두 열이 숫자 칸으로 바뀌어 바로 쓴다(숫자 자판 inputmode numeric, 누른 열 칸에 포커스 2px 테두리 — 66:170).
 *   검사는 지금 앱 숫자 칸과 같다(숫자 아니면 그대로, 범위 밖은 끝값, 정수). 분은 5분 단위로 맞춘다. Enter·칸 밖으로 나가면 끝, Esc면 쓰기 전 값으로 되돌린다.
 * - 아래 「− 5분」「+ 5분」 큰 알약 둘: 끌지 않는 길(WCAG 2.5.7). 합을 5분씩(분이 넘치면 시간으로).
 * 합은 0~24시간(APP_CONFIG.maxDayMinutes)을 넘지 않는다.
 */

export const WHEEL_TEXT = {
  hours: "시간",
  minutes: "분",
  hourValue: (h: number) => `${h}시간`,
  minuteValue: (m: number) => `${m}분`,
  minus: "− 5분",
  plus: "+ 5분",
} as const;

/** 한 칸 높이(px). CSS .time-wheel-row와 같다. 끌기·휠이 이만큼마다 한 칸 걸린다 */
export const WHEEL_ROW_PX = 44;
/** 휠·트랙패드가 한 칸 옮기는 양(px) */
const WHEEL_DELTA_PX = 40;
/** 이만큼 넘게 움직이면 누름이 아니라 끌기(가운데 숫자 바로 쓰기를 열지 않는다) */
const DRAG_SLOP_PX = 4;
/** 손을 뗀 뒤 가운데로 걸려 들어가는 움직임(ms) */
export const WHEEL_SNAP_MS = 160;

const COLUMNS: WheelColumn[] = ["hours", "minutes"];
const label = (c: WheelColumn) => (c === "hours" ? WHEEL_TEXT.hours : WHEEL_TEXT.minutes);
const show = (c: WheelColumn, v: number) => (c === "hours" ? String(v) : pad2(v));
const valueText = (c: WheelColumn, v: number) => (c === "hours" ? WHEEL_TEXT.hourValue(v) : WHEEL_TEXT.minuteValue(v));

type Drag = { column: WheelColumn; pointerId: number; startY: number; startTotal: number; moved: boolean };

export function TimeWheel({ id, total, onChange, disabled }: { id: string; total: number; onChange: (next: number) => void; disabled?: boolean }) {
  const reduced = useReducedMotion();
  // PM 14 원인: 타이머가 채운 1·2분 같은 5의 배수 아닌 합을 그대로 보여 분 열에 「00 · 01 · 05」처럼 격자에서 어긋난 값이 끼었다.
  // 휠은 5분 눈금으로 가까운 값만 보이고(1·2 → 00, 3·47 → 05·45), 합도 같은 눈금으로 한 번 맞춘다(보이는 값과 저장되는 값이 같게).
  const raw = clampTotal(total);
  const value = clampTotal(Math.round(raw / WHEEL_MINUTE_STEP) * WHEEL_MINUTE_STEP);
  const parts = splitTotal(value);
  const totalRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    totalRef.current = value;
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    if (value !== raw) onChangeRef.current(value);
  }, [value, raw]);
  const set = (next: number) => {
    const safe = clampTotal(next);
    if (safe === totalRef.current) return;
    totalRef.current = safe;
    onChangeRef.current(safe);
  };

  const spinRefs = useRef<Record<WheelColumn, HTMLDivElement | null>>({ hours: null, minutes: null });
  const inputRefs = useRef<Record<WheelColumn, HTMLInputElement | null>>({ hours: null, minutes: null });

  const [editing, setEditing] = useState<WheelColumn | null>(null);

  // ---- 끌기 ----
  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef(false);
  const [offset, setOffset] = useState<{ column: WheelColumn; px: number; settling: boolean } | null>(null);

  function onPointerDown(column: WheelColumn, e: PointerEvent<HTMLDivElement>) {
    if (disabled || editing) return;
    suppressClickRef.current = false;
    // 포인터는 끌기가 시작될 때 잡는다(누르기만 하면 click이 가운데 숫자에 그대로 가서 숫자 바로 쓰기가 열린다)
    dragRef.current = { column, pointerId: e.pointerId, startY: e.clientY, startTotal: totalRef.current, moved: false };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dy = drag.startY - e.clientY; // 손가락을 위로 올리면(+) 큰 값이 가운데로 온다
    if (!drag.moved && Math.abs(dy) > DRAG_SLOP_PX) {
      drag.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (!drag.moved) return;
    e.preventDefault();
    const steps = Math.round(dy / WHEEL_ROW_PX);
    const next = moveColumn(drag.startTotal, drag.column, steps);
    set(next);
    let rest = dy - steps * WHEEL_ROW_PX;
    const dir = rest > 0 ? 1 : -1;
    if (rest !== 0 && !canMove(next, drag.column, dir)) rest *= 0.3; // 끝에서는 덜 따라온다
    setOffset({ column: drag.column, px: reduced ? 0 : -rest, settling: false });
  }
  function endDrag(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return; // 누름: click이 맡는다
    suppressClickRef.current = true;
    // 가운데로 걸려 들어감(동작 줄이기면 바로)
    setOffset(reduced ? null : { column: drag.column, px: 0, settling: true });
  }

  // ---- 휠·트랙패드(스크롤을 막아야 해서 passive 아닌 바깥 듣기) ----
  useEffect(() => {
    if (editing || disabled) return;
    const stops: (() => void)[] = [];
    for (const column of COLUMNS) {
      const el = spinRefs.current[column];
      if (!el) continue;
      let acc = 0;
      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const unit = event.deltaMode === 1 ? WHEEL_DELTA_PX : event.deltaMode === 2 ? WHEEL_DELTA_PX * 5 : 1;
        acc += event.deltaY * unit;
        const steps = Math.trunc(acc / WHEEL_DELTA_PX);
        if (steps === 0) return;
        acc -= steps * WHEEL_DELTA_PX;
        set(moveColumn(totalRef.current, column, steps)); // 아래로 굴리면(+) 큰 값
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      stops.push(() => el.removeEventListener("wheel", onWheel));
    }
    return () => stops.forEach((s) => s());
  }, [editing, disabled]);

  // ---- 키보드 ----
  function onSpinKey(column: WheelColumn, e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const big = column === "hours" ? WHEEL_HOUR_BIG : WHEEL_MINUTE_BIG / WHEEL_MINUTE_STEP;
    const now = totalRef.current;
    let next: number | null = null;
    if (e.key === "ArrowUp") next = moveColumn(now, column, 1);
    else if (e.key === "ArrowDown") next = moveColumn(now, column, -1);
    else if (e.key === "PageUp") next = moveColumn(now, column, big);
    else if (e.key === "PageDown") next = moveColumn(now, column, -big);
    else if (e.key === "Home") next = columnEdge(now, column, "min");
    else if (e.key === "End") next = columnEdge(now, column, "max");
    else if (e.key === "Enter") {
      e.preventDefault();
      startEdit(column);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    set(next);
  }

  // ---- 숫자 바로 쓰기 ----
  const [drafts, setDrafts] = useState<Record<WheelColumn, string>>({ hours: "", minutes: "" });
  const editStartRef = useRef(0);
  const focusAfterRef = useRef<WheelColumn | null>(null);
  function startEdit(column: WheelColumn) {
    if (disabled) return;
    const now = splitTotal(totalRef.current);
    editStartRef.current = totalRef.current;
    setDrafts({ hours: String(now.hours), minutes: pad2(now.minutes) });
    setOffset(null);
    focusAfterRef.current = column;
    setEditing(column);
  }
  function finishEdit(focusColumn: WheelColumn | null) {
    focusAfterRef.current = focusColumn;
    setEditing(null);
  }
  useLayoutEffect(() => {
    const column = focusAfterRef.current;
    if (column === null) return;
    focusAfterRef.current = null;
    if (editing) {
      const input = inputRefs.current[column];
      input?.focus();
      input?.select();
    } else {
      spinRefs.current[column]?.focus();
    }
  }, [editing]);

  function onDraft(column: WheelColumn, raw: string) {
    setDrafts((d) => ({ ...d, [column]: raw }));
    const v = parseColumnInput(raw, column);
    if (v !== null) set(withColumn(totalRef.current, column, v));
  }
  function onInputKey(column: WheelColumn, e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      finishEdit(column);
    } else if (e.key === "Escape") {
      // 칸만 닫는다(오늘 기록 창은 닫지 않는다). 쓰기 전 값으로
      e.preventDefault();
      e.stopPropagation();
      set(editStartRef.current);
      finishEdit(column);
    }
  }
  function onInputBlur(e: FocusEvent<HTMLInputElement>) {
    const next = e.relatedTarget;
    if (next && (next === inputRefs.current.hours || next === inputRefs.current.minutes)) return;
    finishEdit(null);
  }

  const motion = (column: WheelColumn) => {
    if (!offset || offset.column !== column) return undefined;
    return { transform: `translateY(${offset.px}px)`, transition: offset.settling && !reduced ? `transform ${WHEEL_SNAP_MS}ms ease-out` : "none" };
  };

  return (
    <div className="time-wheel" id={id}>
      <div className={"time-wheel-cols" + (editing ? " is-editing" : "")}>
        <span className="time-wheel-band" aria-hidden="true" />
        {COLUMNS.map((column) => {
          const v = parts[column];
          const near = neighbors(v, column);
          const rows = (list: (number | null)[], where: "above" | "below") =>
            list.map((n, i) => (
              <span key={`${where}${i}`} className={"time-wheel-row time-wheel-dim" + ((where === "above" ? i === 0 : i === 1) ? " is-far" : "")} aria-hidden="true">
                {n === null ? "" : show(column, n)}
              </span>
            ));
          return (
            <div key={column} className="time-wheel-col" data-column={column}>
              <span className="time-wheel-label" aria-hidden="true">
                {label(column)}
              </span>
              {editing ? (
                <div className="time-wheel-window">
                  <div className="time-wheel-track">
                    {rows(near.above, "above")}
                    <span className="time-wheel-row time-wheel-center">
                      <input
                        id={`${id}-${column}-input`}
                        ref={(el) => {
                          inputRefs.current[column] = el;
                        }}
                        className="input time-wheel-input"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        enterKeyHint="done"
                        aria-label={label(column)}
                        value={drafts[column]}
                        onChange={(e) => onDraft(column, e.target.value)}
                        onKeyDown={(e) => onInputKey(column, e)}
                        onBlur={onInputBlur}
                      />
                    </span>
                    {rows(near.below, "below")}
                  </div>
                </div>
              ) : (
                <div
                  ref={(el) => {
                    spinRefs.current[column] = el;
                  }}
                  id={`${id}-${column}`}
                  className="time-wheel-window"
                  role="spinbutton"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={label(column)}
                  aria-valuemin={0}
                  aria-valuemax={column === "hours" ? WHEEL_HOUR_MAX : WHEEL_MINUTE_MAX}
                  aria-valuenow={v}
                  aria-valuetext={valueText(column, v)}
                  aria-disabled={disabled ? true : undefined}
                  onKeyDown={(e) => onSpinKey(column, e)}
                  onPointerDown={(e) => onPointerDown(column, e)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <div className="time-wheel-track" style={motion(column)} onTransitionEnd={() => setOffset((o) => (o && o.settling ? null : o))}>
                    {rows(near.above, "above")}
                    <span
                      className="time-wheel-row time-wheel-center"
                      onClick={() => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        startEdit(column);
                      }}
                    >
                      {show(column, v)}
                    </span>
                    {rows(near.below, "below")}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="time-wheel-nudge">
        <button type="button" className="btn btn-secondary time-wheel-nudge-btn" disabled={disabled || value <= 0} onClick={() => set(nudgeTotal(totalRef.current, -1))}>
          {WHEEL_TEXT.minus}
        </button>
        <button type="button" className="btn btn-secondary time-wheel-nudge-btn" disabled={disabled || value >= WHEEL_HOUR_MAX * 60} onClick={() => set(nudgeTotal(totalRef.current, 1))}>
          {WHEEL_TEXT.plus}
        </button>
      </div>
    </div>
  );
}
