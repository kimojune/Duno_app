import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerConfig } from "../server-config";

/**
 * 할 일 글 암호화(서버 전용). AES-256-GCM.
 *
 * 저장 형식: v<판 번호>:<IV>:<암호문>:<태그>  (세 조각 모두 base64url, 패딩 없음)
 *  - IV 12바이트(16자)는 암호화마다 새로 뽑는다. 태그 16바이트(22자).
 *  - 추가 인증 데이터(AAD)에 그 행 소유자의 user id를 넣어, 다른 사용자 id로는 풀리지 않게 묶는다.
 *  - DB check 제약(마이그레이션 todos_text_encrypted_format, 4096자)과 같은 규칙이다.
 *
 * 키 교체 이음매: 판 번호. 지금은 v1 하나만 쓴다. 키를 바꿀 때는 새 판(v2)과 키를 더하고
 * 풀기에서 판 번호로 키를 고르게 바꾼다(방법은 결정 필요).
 *
 * 평문·키·암호문을 로그에 찍지 않는다. 풀기 실패는 원래 오류를 버리고 DECRYPT_FAILED만 돌려준다.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD_PREFIX = "duno.todos.text|v1|user:";

export const CIPHERTEXT_MAX_LENGTH = 4096;
const CIPHERTEXT_FORMAT = /^v([1-9][0-9]{0,2}):([A-Za-z0-9_-]{16}):([A-Za-z0-9_-]+):([A-Za-z0-9_-]{22})$/;
// 32바이트를 표준 base64로 쓰면 43자 + '=' 하나
const KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

declare const todoKeyBrand: unique symbol;
/** 검사를 마친 32바이트 키. parseTodoKey로만 만든다. */
export type TodoKey = { readonly version: typeof VERSION; readonly bytes: Buffer; readonly [todoKeyBrand]: true };

export type DecryptResult = { ok: true; text: string } | { ok: false };
export const DECRYPT_FAILED: DecryptResult = Object.freeze({ ok: false });

/** base64 문자열을 키로 바꾼다. 없거나, base64가 아니거나, 디코드해 32바이트가 아니면 null(설정 오류). */
export function parseTodoKey(raw: string | null | undefined): TodoKey | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!KEY_BASE64.test(trimmed)) return null;
  const bytes = Buffer.from(trimmed, "base64");
  if (bytes.length !== KEY_BYTES) return null;
  return { version: VERSION, bytes } as TodoKey;
}

/** 서버 환경 변수 TODO_ENCRYPTION_KEY에서 키를 읽는다. 없거나 틀리면 null. */
export function getTodoKeyFromEnv(): TodoKey | null {
  return parseTodoKey(getServerConfig().todoEncryptionKey);
}

function aadFor(userId: string): Buffer {
  return Buffer.from(AAD_PREFIX + userId, "utf8");
}

/** 평문을 소유자 userId에 묶어 암호화한다. */
export function encryptTodoText(plaintext: string, userId: string, key: TodoKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key.bytes, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadFor(userId));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64url")}:${body.toString("base64url")}:${tag.toString("base64url")}`;
}

/** 저장된 값을 푼다. 키 다름·변조·형식 깨짐·다른 소유자는 모두 DECRYPT_FAILED. 던지지 않는다. */
export function decryptTodoText(value: unknown, userId: string, key: TodoKey): DecryptResult {
  try {
    if (typeof value !== "string" || value.length > CIPHERTEXT_MAX_LENGTH) return DECRYPT_FAILED;
    const match = CIPHERTEXT_FORMAT.exec(value);
    if (!match) return DECRYPT_FAILED;
    const [, version, ivPart, bodyPart, tagPart] = match;
    if (`v${version}` !== key.version) return DECRYPT_FAILED;

    const iv = Buffer.from(ivPart, "base64url");
    const body = Buffer.from(bodyPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    // base64url 디코드는 관대하므로 다시 인코드해 같은지 본다(같은 값의 다른 표기를 막는다).
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return DECRYPT_FAILED;
    if (iv.toString("base64url") !== ivPart || tag.toString("base64url") !== tagPart) return DECRYPT_FAILED;
    if (body.length === 0 || body.toString("base64url") !== bodyPart) return DECRYPT_FAILED;

    const decipher = createDecipheriv(ALGORITHM, key.bytes, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadFor(userId));
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    return { ok: true, text };
  } catch {
    return DECRYPT_FAILED;
  }
}
