"use client";

import type { KeyboardEvent } from "react";
import { checkGoal, countGoalChars, GOAL_MAX_LENGTH, type GoalCheck } from "../lib/settings/validation";

/**
 * 목표 한 문장 칸(처음 설정 S1-1 목표 단계와 내 정보 S8-b 「목표」가 같이 쓴다 — 고침6 ③, USE-04).
 * - 칸 라벨 「목표」 · 글 칸 · 칸 아래 한 줄(도움 글). 너무 길면 도움 글 자리에 길이 안내(검사는 checkGoal 그대로, 상한 GOAL_MAX_LENGTH).
 * - 도움 글·흐린 글(placeholder)은 쓰는 화면이 정한다(고침9부터 처음 설정·S8-b 모두 칸 아래 예시 GOAL_FIELD_TEXT.example만, 흐린 글 없음).
 * 글은 React 텍스트로만 그린다.
 */
export const GOAL_FIELD_TEXT = {
  label: "목표",
  /** 칸 아래 예시(⑬ 1 — 칸 안 흐린 글이 아님, UI-06). 처음 설정 S1-1과 S8-b가 같이 쓴다 */
  example: "예: 포트폴리오 끝내고 토익 800점 넘기기",
  tooLong: (n: number) => `${GOAL_MAX_LENGTH}자까지 적을 수 있어요. 지금 ${n}자예요.`,
} as const;

/** 칸 값의 검사 결과와 「너무 김」 여부(화면이 저장·다음 단추를 막을 때 쓴다) */
export function goalFieldCheck(value: string): { check: GoalCheck; over: boolean } {
  const check = checkGoal(value);
  return { check, over: !check.ok && check.error === "too_long" };
}

export function GoalField({
  inputId,
  helpId,
  value,
  onChange,
  help,
  placeholder,
  onKeyDown,
  enterKeyHint,
}: {
  inputId: string;
  helpId: string;
  value: string;
  onChange: (value: string) => void;
  /** 칸 아래 한 줄(너무 길지 않을 때) */
  help: string;
  placeholder?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  enterKeyHint?: "next" | "done";
}) {
  const { over } = goalFieldCheck(value);
  return (
    <>
      <label htmlFor={inputId} className="input-label">
        {GOAL_FIELD_TEXT.label}
      </label>
      <input
        id={inputId}
        className="input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-describedby={helpId}
        aria-invalid={over ? true : undefined}
        autoComplete="off"
        enterKeyHint={enterKeyHint}
      />
      <p id={helpId} className="input-help">
        {over ? GOAL_FIELD_TEXT.tooLong(countGoalChars(value)) : help}
      </p>
    </>
  );
}
