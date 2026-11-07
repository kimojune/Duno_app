"use client";

import { evenRatios, RATIO_STEP } from "../lib/settings/validation";
import { SecondaryButton } from "./ui";

/**
 * 처음 정한 비율 입력(처음 설정 3단계와 내 정보 「비율 고치기」가 같이 쓴다).
 * 원형 다이얼 대신 분야마다 −/+ 단추(5% 단위)다: 끌지 않고도 넣을 수 있다(WCAG 2.5.7, 23 5-5 보기). 숫자를 숨기지 않고 합계도 보인다.
 * 합이 100이 아니어도 된다(앱이 합으로 나눠 읽는다). 모든 글은 React 텍스트로만 그린다.
 */

export type RatioEntry = { id: string; name: string; percent: number };

export const RATIO_TEXT = {
  total: (n: number) => `합계 ${n}%`,
  even: "고르게 나누기",
  minus: (name: string) => `${name} ${RATIO_STEP}% 줄이기`,
  plus: (name: string) => `${name} ${RATIO_STEP}% 늘리기`,
  hint: "대략이면 돼요. 합이 100이 아니어도 비율로 읽어요. 나중에 고칠 수 있어요.",
} as const;

export function RatioEditor({ entries, onChange }: { entries: RatioEntry[]; onChange: (next: RatioEntry[]) => void }) {
  const total = entries.reduce((sum, e) => sum + e.percent, 0);

  function set(id: string, percent: number) {
    onChange(entries.map((e) => (e.id === id ? { ...e, percent: Math.min(100, Math.max(0, percent)) } : e)));
  }
  function even() {
    const split = evenRatios(entries.map((e) => e.id));
    onChange(entries.map((e) => ({ ...e, percent: split.find((s) => s.categoryId === e.id)?.percent ?? 0 })));
  }

  return (
    <div className="ratio">
      <p className="todo-sub">{RATIO_TEXT.hint}</p>
      <ul className="ratio-list">
        {entries.map((e) => (
          <li key={e.id} className="ratio-row">
            <span className="ratio-name" id={`ratio-name-${e.id}`}>
              {e.name}
            </span>
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
