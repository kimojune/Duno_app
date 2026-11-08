"use client";

import { useState } from "react";
import type { RatioItem } from "../lib/settings/types";
import { evenRatios, RATIO_STEP } from "../lib/settings/validation";
import { RatioDial, type DialSlice } from "./ratio-dial";
import { SecondaryButton } from "./ui";

/**
 * 처음 정한 비율 입력(처음 설정 3단계와 내 정보 「비율 고치기」가 같이 쓴다).
 * 위에 원형 다이얼, 아래에 분야마다 −/+ 단추(5% 단위) 목록이다. 둘은 같은 값과 같은 「고른 조각」을 쓴다.
 * 끌지 않는 길이 늘 함께 있다(WCAG 2.5.7): 다이얼 손잡이의 화살표 키, −/+ 단추. 숫자를 숨기지 않고 합계도 보인다.
 * 합이 100이 아니어도 된다(앱이 합으로 나눠 읽는다). 다이얼은 지금 값의 비율을 그리고, 처음 만지는 순간 합 100의 정수로 맞춘 뒤 그 위에 바꾼다.
 * 모든 글은 React 텍스트로만 그린다.
 */

export type RatioEntry = { id: string; name: string; percent: number };

/**
 * 기타(분야 없음)도 비율 한 줄이다(고침 3바퀴, PM 답 d-69). 줄을 가리키는 표시는 uuid가 아니라 이 값이고, 저장할 때 categoryId null로 바꾼다.
 * 기타가 0%면 저장 목록에 넣지 않는다(기타를 안 쓰는 사용자의 저장은 그대로).
 */
export const OTHER_RATIO_ID = "other";
export const OTHER_RATIO_NAME = "기타";

/** 저장된 비율 한 칸을 화면 줄 표시로 */
export function ratioKey(categoryId: string | null): string {
  return categoryId === null ? OTHER_RATIO_ID : categoryId;
}

/** 분야 줄들과 기타 줄(맨 끝)로 화면 줄 목록을 만든다 */
export function withOtherEntry(entries: RatioEntry[], percents: Record<string, number>): RatioEntry[] {
  return [...entries, { id: OTHER_RATIO_ID, name: OTHER_RATIO_NAME, percent: percents[OTHER_RATIO_ID] ?? 0 }];
}

/** 화면 줄들을 저장할 비율로(기타는 0보다 클 때만) */
export function entriesToRatios(entries: RatioEntry[]): RatioItem[] {
  return entries.flatMap((e): RatioItem[] =>
    e.id === OTHER_RATIO_ID ? (e.percent > 0 ? [{ categoryId: null, percent: e.percent }] : []) : [{ categoryId: e.id, percent: e.percent }],
  );
}

export const RATIO_TEXT = {
  total: (n: number) => `합계 ${n}%`,
  even: "고르게 나누기",
  minus: (name: string) => `${name} ${RATIO_STEP}% 줄이기`,
  plus: (name: string) => `${name} ${RATIO_STEP}% 늘리기`,
  hint: "대략이면 돼요. 합이 100이 아니어도 비율로 읽어요. 나중에 고칠 수 있어요.",
} as const;

/** 조각 색은 지금 있는 토큰만 돌려 쓴다(임시. 기타는 따로). 2단계에서 디자인 명세 값으로 바꾼다 */
const SLICE_COLORS = ["var(--color-primary)", "var(--color-text-sub)", "var(--color-primary-pressed)", "var(--color-text)"];
const OTHER_SLICE_COLOR = "var(--color-border-input)";

export function RatioEditor({ entries, onChange }: { entries: RatioEntry[]; onChange: (next: RatioEntry[]) => void }) {
  const total = entries.reduce((sum, e) => sum + e.percent, 0);
  // 고른 조각: 처음에는 첫 조각. 다이얼의 조각과 목록의 이름 단추가 같이 쓴다
  const [selected, setSelected] = useState<string | null>(entries[0]?.id ?? null);
  const slices: DialSlice[] = entries.map((e, i) => ({
    key: e.id,
    name: e.name,
    color: e.id === OTHER_RATIO_ID ? OTHER_SLICE_COLOR : SLICE_COLORS[i % SLICE_COLORS.length],
    value: e.percent,
  }));

  function set(id: string, percent: number) {
    onChange(entries.map((e) => (e.id === id ? { ...e, percent: Math.min(100, Math.max(0, percent)) } : e)));
  }
  // 「고르게 나누기」는 분야끼리 나눈다(기타 줄은 0%로 돌아간다: 기타를 비율에 넣는 것은 사용자가 고른 때만)
  function even() {
    const split = evenRatios(entries.filter((e) => e.id !== OTHER_RATIO_ID).map((e) => e.id));
    onChange(entries.map((e) => ({ ...e, percent: e.id === OTHER_RATIO_ID ? 0 : (split.find((s) => s.categoryId === e.id)?.percent ?? 0) })));
  }

  return (
    <div className="ratio">
      <p className="todo-sub">{RATIO_TEXT.hint}</p>
      <RatioDial
        id="ratio-dial"
        slices={slices}
        selectedKey={selected}
        onSelect={setSelected}
        onChange={(values) => onChange(entries.map((e, i) => ({ ...e, percent: values[i] })))}
      />
      <ul className="ratio-list">
        {entries.map((e) => (
          <li key={e.id} className="ratio-row">
            <button
              type="button"
              className="ratio-name ratio-name-btn"
              id={`ratio-name-${e.id}`}
              aria-pressed={selected === e.id}
              onClick={() => setSelected(selected === e.id ? null : e.id)}
            >
              {e.name}
            </button>
            <span className="ratio-control">
              <button
                type="button"
                className="btn btn-secondary ratio-btn"
                aria-label={RATIO_TEXT.minus(e.name)}
                disabled={e.percent <= 0}
                onClick={() => set(e.id, e.percent - RATIO_STEP)}
              >
                −
              </button>
              <output className="ratio-value" aria-labelledby={`ratio-name-${e.id}`}>
                {e.percent}%
              </output>
              <button
                type="button"
                className="btn btn-secondary ratio-btn"
                aria-label={RATIO_TEXT.plus(e.name)}
                disabled={e.percent >= 100}
                onClick={() => set(e.id, e.percent + RATIO_STEP)}
              >
                +
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="ratio-foot">
        <p className="ratio-total" role="status">
          {RATIO_TEXT.total(total)}
        </p>
        <SecondaryButton onClick={even}>{RATIO_TEXT.even}</SecondaryButton>
      </div>
    </div>
  );
}
