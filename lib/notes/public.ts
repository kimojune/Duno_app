import { z } from "zod";

/**
 * 작업 기록 글자 수 규칙의 화면용 값(서버 전용 모듈을 가져오지 않으려고 core와 따로 둔다. 값은 lib/notes/core.ts와 같다).
 */
export const NOTE_MAX_LENGTH_PUBLIC = 2000;

/** 앞뒤 공백을 지운 뒤 코드 포인트 수 */
export function countNoteChars(text: string): number {
  return [...text.trim()].length;
}

export type NoteTextCheck = { ok: true; text: string } | { ok: false; error: "invalid_input" | "empty" | "too_long" };

const stringSchema = z.string();

/** 글 검사: 앞뒤 공백을 지운 뒤 0자면 empty, 2000자를 넘으면 too_long. 줄바꿈은 그대로 둔다. 서버(core)와 기기(lib/local)가 같이 쓴다 */
export function checkNoteText(input: unknown): NoteTextCheck {
  const parsed = stringSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const text = parsed.data.trim();
  if (text.length === 0) return { ok: false, error: "empty" };
  if (text.length > NOTE_MAX_LENGTH_PUBLIC * 2 || [...text].length > NOTE_MAX_LENGTH_PUBLIC) return { ok: false, error: "too_long" };
  return { ok: true, text };
}
