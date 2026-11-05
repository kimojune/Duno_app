import { z } from "zod";

/**
 * 할 일 입력 검증(공용, 순수 함수). 화면도 같은 함수를 쓸 수 있다. 키·DB를 건드리지 않는다.
 * 서버는 화면이 검사했더라도 반드시 다시 검사한다.
 *
 * 임시, 결정 필요: 글자 수 상한 200(디자인 명세 D7).
 * 세는 단위: 유니코드 코드 포인트(JavaScript 펼침 연산 [...text].length). 앞뒤 공백을 지운 뒤 센다.
 * 한글 한 자 = 1, 😀 = 1, 피부색이 붙은 👍🏽 = 2, 가족 이모지 👨‍👩‍👧 = 5.
 * 200 코드 포인트는 UTF-8로 많아야 800바이트라, 암호화해도 DB의 4096자 check 안에 든다.
 */
export const TODO_TEXT_MAX_LENGTH = 200;

/** 화면 표시용 글자 수(앞뒤 공백을 지운 뒤 코드 포인트 수) */
export function countTodoChars(text: string): number {
  return [...text.trim()].length;
}

export type TodoTextCheck =
  | { ok: true; text: string }
  | { ok: false; error: "invalid_input" | "empty" | "too_long" };

const stringSchema = z.string();

/** 글 검사: 문자열이 아니면 invalid_input, 앞뒤 공백을 지워 0자면 empty, 200자를 넘으면 too_long */
export function checkTodoText(input: unknown): TodoTextCheck {
  const parsed = stringSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const text = parsed.data.trim();
  if (text.length === 0) return { ok: false, error: "empty" };
  // 코드 포인트 하나는 UTF-16 단위로 1~2개라, 길이가 400을 넘으면 세 볼 것도 없이 넘는다.
  if (text.length > TODO_TEXT_MAX_LENGTH * 2 || [...text].length > TODO_TEXT_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  return { ok: true, text };
}

/** 할 일 id: uuid 형식만(화면이 crypto.randomUUID()로 만든다) */
export const todoIdSchema = z.uuid();

/** 끝냄 값: 참·거짓만(뒤집기가 아니라 원하는 값) */
export const todoDoneSchema = z.boolean();
