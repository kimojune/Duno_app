import { z } from "zod";

/**
 * 분야 입력 검증(공용, 순수 함수). 화면도 같은 함수를 쓸 수 있다. 키·DB를 건드리지 않는다.
 * 서버는 화면이 검사했더라도 반드시 다시 검사한다. 규칙 출처: 디자인 명세 12-7.
 *
 * 정규화(저장하는 이름): 유니코드 NFC로 맞추고, 이어진 공백류(띄어쓰기·탭·줄바꿈·전각 공백 등)를 공백 하나로,
 *   앞뒤 공백을 뺀다. 암호화해 저장하는 것은 이 정규화한 이름이다.
 * 임시, 결정 필요: 이름 상한 20 코드 포인트(정규화한 이름을 센다. 할 일 글과 같은 셈).
 * 같은 이름 판정: 정규화한 이름끼리, 로마자(A~Z)만 대소문자를 가리지 않는다. 띄어쓰기가 다르면 다른 이름이다
 *   (「CS공부」≠「CS 공부」, 「CS 공부」=「cs 공부」). 보관하지 않은 내 분야와 같으면 거절(임시, 결정 필요. core가 본다).
 * 임시, 결정 필요: 「기타」도 같은 판정으로 거절한다(분야 번호가 비면 기타로 보므로 둘이 겹친다).
 */
export const CATEGORY_NAME_MAX_LENGTH = 20;

/**
 * 사용자당 분야 수 상한. 임시, 결정 필요: 50(보관한 것 포함). DB 트리거(private.categories_enforce_limit)와 같은 값.
 * 화면은 이 값으로 「+ 분야」를 누를 때 미리 알리고(C20), 서버 거절(category_limit)에도 같은 문구를 쓴다.
 */
export const CATEGORY_LIMIT = 50;

/** 분야 번호가 비었을 때 화면이 보여 줄 이름이자, 분야 이름으로 쓸 수 없는 이름 */
export const OTHER_CATEGORY_NAME = "기타";

export type CategoryNameCheck =
  | { ok: true; name: string }
  | { ok: false; error: "invalid_input" | "empty" | "too_long" | "reserved" };

const stringSchema = z.string();

/** 저장하는 꼴: NFC, 이어진 공백류를 공백 하나로, 앞뒤 공백 없음 */
export function normalizeCategoryName(name: string): string {
  return name.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** 같은 이름 판정용 열쇠: 정규화한 뒤 로마자 대문자(A~Z)만 소문자로. 다른 글자의 대소문자는 건드리지 않는다. */
export function categoryNameKey(name: string): string {
  return normalizeCategoryName(name).replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** 화면 표시용 글자 수: 정규화한 이름의 코드 포인트 수(C16) */
export function countCategoryChars(name: string): number {
  return [...normalizeCategoryName(name)].length;
}

/** 두 이름이 같은 분야 이름인가(12-7 판정) */
export function sameCategoryName(a: string, b: string): boolean {
  return categoryNameKey(a) === categoryNameKey(b);
}

/** 이름 검사: 문자열이 아니면 invalid_input, 빈 이름 empty, 20자 넘음 too_long, 「기타」 reserved. 통과하면 정규화한 이름 */
export function checkCategoryName(input: unknown): CategoryNameCheck {
  const parsed = stringSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const name = normalizeCategoryName(parsed.data);
  if (name.length === 0) return { ok: false, error: "empty" };
  // 코드 포인트 하나는 UTF-16 단위로 1~2개라, 길이가 40을 넘으면 세 볼 것도 없이 넘는다(10만 자를 펼치지 않는다).
  if (name.length > CATEGORY_NAME_MAX_LENGTH * 2 || [...name].length > CATEGORY_NAME_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  if (sameCategoryName(name, OTHER_CATEGORY_NAME)) return { ok: false, error: "reserved" };
  return { ok: true, name };
}

/** 분야 id: uuid 형식만(화면이 crypto.randomUUID()로 만든다) */
export const categoryIdSchema = z.uuid();
