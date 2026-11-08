"use client";

import { useEffect, useState } from "react";
import { parseShare, setShare, startHundred } from "../lib/ratio-dial-calc";
import type { RatioItem } from "../lib/settings/types";
import { evenRatios, RATIO_STEP } from "../lib/settings/validation";
import { categoryColorValue } from "../lib/category-color";
import { RatioDial, type DialSlice } from "./ratio-dial";
import { SecondaryButton } from "./ui";

/**
 * 처음 정한 비율 입력(처음 설정 3단계와 내 정보 「비율 고치기」가 같이 쓴다).
 * 위에 원형 다이얼, 아래에 분야마다 −/+ 단추(5% 단위)와 숫자 칸 목록이다. 셋은 같은 값과 같은 「고른 조각」을 쓴다.
 * 끌지 않는 길이 늘 함께 있다(WCAG 2.5.7): 다이얼 손잡이의 화살표 키, −/+ 단추, 숫자 칸. 숫자를 숨기지 않고 합계도 보인다.
 * 합은 늘 100이다(PM 확정 11-08). 열 때 저장값의 합이 100이 아니면 비율을 지켜 합 100의 정수로 맞추고(바깥 상태에도 바로 알린다),
 * 모두 0이면 분야끼리 균등 배분(기타 0)으로 시작한다. −/+·숫자 칸은 고른 줄과 이웃끼리 주고받는다(setShare: 뒤 줄 먼저, 마지막 줄은 앞 줄).
 * 모든 글은 React 텍스트로만 그린다. 숫자 칸 값은 0~100 정수로 읽은 뒤에만 쓴다.
 */

/**
 * colorOrder: 분야 색을 정하는 분야 순서(0부터, 보관하지 않은 읽을 수 있는 내 분야를 만든 순서에서의 자리). 상태보기·저녁 다이얼과 같은 분야에 같은 색을 주려고
 * 부르는 쪽이 넣는다(처음 설정은 고르지 않은 분야도 자리를 차지한다). 없으면 목록 안의 자리를 쓴다. 기타 줄은 쓰지 않는다.
 */
export type RatioEntry = { id: string; name: string; percent: number; colorOrder?: number };

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

/**
 * 화면 줄들을 저장할 비율로. 0% 줄은 분야든 기타든 싣지 않는다(저장 목록에 없는 분야는 어디서나 0%로 읽는다: 상태보기·놓친 분야·채울 시간,
 * 처음 설정·내 정보를 다시 열 때의 숫자 칸). 분야 50개인 사람이 기타에 몫을 줘도 목록이 51항목이 되어 상한 50에 거절되는 일이 없다.
 * 서버 저장은 받은 목록에 없는 분야의 옛 비율 행을 지우므로(saveRatiosForUser), 0%로 줄인 분야의 옛 몫이 남지 않는다.
 */
export function entriesToRatios(entries: RatioEntry[]): RatioItem[] {
  return entries.flatMap((e): RatioItem[] =>
    e.percent > 0 ? [{ categoryId: e.id === OTHER_RATIO_ID ? null : e.id, percent: e.percent }] : [],
  );
}

export const RATIO_TEXT = {
  total: (n: number) => `합계 ${n}%`,
  // 글은 지금 그대로(기존 시험이 이 글로 단추를 찾는다). 이름 기준(2026-10-13-feature-names)의 이름은 「균등 배분」 — 디자인 바퀴에서 맞춘다
  even: "고르게 나누기",
  minus: (name: string) => `${name} ${RATIO_STEP}% 줄이기`,
  plus: (name: string) => `${name} ${RATIO_STEP}% 늘리기`,
  // 임시 글, 디자인 확정 뒤: 숫자 칸의 접근성 이름(고침4 2단계)
  field: (name: string) => `${name} 비율(%)`,
  // 임시 글, 디자인 확정 뒤: 합 100 고정(PM 확정 11-08)으로 「합이 100이 아니어도 비율로 읽어요」가 거짓이 되어 바꿨다
  hint: "대략이면 돼요. 합은 늘 100%로 맞춰져요. 나중에 고칠 수 있어요.",
} as const;

/** 「고르게 나누기」와 모두 0에서 시작할 때의 값: 분야 n개를 5% 단위로 고르게(evenRatios와 같은 값) */
const evenPercents = (count: number) => evenRatios(Array.from({ length: count }, (_, i) => String(i))).map((r) => r.percent);

/** 숫자 칸: 쓰는 동안은 글 그대로 두고, 칸을 떠나거나 Enter를 누를 때 0~100 정수로 읽는다. 아니면(빈 칸·글자·소수·음수·100 넘음·붙여넣은 이상한 글) 이전 값으로 돌린다 */
function ShareField({ id, label, value, onCommit }: { id: string; label: string; value: number; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft === null) return;
    const next = parseShare(draft);
    setDraft(null);
    if (next !== null && next !== value) onCommit(next);
  }
  return (
    <input
      id={id}
      className="input stepper-input ratio-field"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

export function RatioEditor({ entries, onChange }: { entries: RatioEntry[]; onChange: (next: RatioEntry[]) => void }) {
  // 합 100 고정: 열 때(그리고 분야가 빠져 합이 바뀔 때) 합 100의 정수로 맞춘 값을 그리고, 바깥 상태에도 알린다(저장 값이 화면과 같게)
  const raw = entries.map((e) => e.percent);
  const categoryIdx = entries.flatMap((e, i) => (e.id === OTHER_RATIO_ID ? [] : [i]));
  const shown = startHundred(raw, evenPercents, categoryIdx);
  const needsFix = shown.some((v, i) => v !== raw[i]);
  useEffect(() => {
    if (needsFix) onChange(entries.map((e, i) => ({ ...e, percent: shown[i] })));
  });
  const total = shown.reduce((sum, v) => sum + v, 0);
  // 고른 조각: 처음에는 첫 조각. 다이얼의 조각과 목록의 이름 단추가 같이 쓴다. 목록에 없는 id면 둘 다 아무것도 안 고른 것으로 보인다
  const [selected, setSelected] = useState<string | null>(entries[0]?.id ?? null);
  const slices: DialSlice[] = entries.map((e, i) => ({
    key: e.id,
    name: e.name,
    color: categoryColorValue(e.id === OTHER_RATIO_ID ? null : (e.colorOrder ?? i)),
    value: shown[i],
  }));
  const withValues = (values: number[]) => entries.map((e, i) => ({ ...e, percent: values[i] }));

  function set(i: number, percent: number) {
    onChange(withValues(setShare(shown, i, percent, 100)));
  }
  // 「고르게 나누기」는 분야끼리 나눈다(기타 줄은 0%로 돌아간다: 기타를 비율에 넣는 것은 사용자가 고른 때만). 분야가 없으면 기타가 100%
  function even() {
    onChange(withValues(startHundred(raw.map(() => 0), evenPercents, categoryIdx)));
  }

  return (
    <div className="ratio">
      <p className="todo-sub">{RATIO_TEXT.hint}</p>
      <RatioDial id="ratio-dial" slices={slices} selectedKey={selected} onSelect={setSelected} onChange={(values) => onChange(withValues(values))} />
      <ul className="ratio-list">
        {entries.map((e, i) => (
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
                disabled={shown[i] <= 0 || entries.length < 2}
                onClick={() => set(i, shown[i] - RATIO_STEP)}
              >
                −
              </button>
              <ShareField id={`ratio-field-${e.id}`} label={RATIO_TEXT.field(e.name)} value={shown[i]} onCommit={(v) => set(i, v)} />
              <span className="stepper-unit" aria-hidden="true">
                %
              </span>
              <button
                type="button"
                className="btn btn-secondary ratio-btn"
                aria-label={RATIO_TEXT.plus(e.name)}
                disabled={shown[i] >= 100 || entries.length < 2}
                onClick={() => set(i, shown[i] + RATIO_STEP)}
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
