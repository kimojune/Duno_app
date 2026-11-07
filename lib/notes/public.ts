/**
 * 작업 기록 글자 수 규칙의 화면용 값(서버 전용 모듈을 가져오지 않으려고 core와 따로 둔다. 값은 lib/notes/core.ts와 같다).
 */
export const NOTE_MAX_LENGTH_PUBLIC = 2000;

/** 앞뒤 공백을 지운 뒤 코드 포인트 수 */
export function countNoteChars(text: string): number {
  return [...text.trim()].length;
}
