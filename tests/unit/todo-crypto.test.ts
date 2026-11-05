import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CIPHERTEXT_MAX_LENGTH,
  DECRYPT_FAILED,
  decryptTodoText,
  encryptTodoText,
  parseTodoKey,
  type TodoKey,
} from "../../lib/todos/crypto";
import { TODO_TEXT_MAX_LENGTH } from "../../lib/todos/validation";

// 시험 키는 여기서 무작위로 만든다(진짜 TODO_ENCRYPTION_KEY를 쓰지 않는다).
const newKey = (): TodoKey => {
  const key = parseTodoKey(randomBytes(32).toString("base64"));
  if (!key) throw new Error("test key");
  return key;
};

/** 마이그레이션의 check 제약 식을 그대로 읽어 온다(규칙이 어긋나면 시험이 깨지게). */
function dbFormatRule(): RegExp {
  const sql = readFileSync(
    path.resolve(__dirname, "../../supabase/migrations/20261104160723_create_todos.sql"),
    "utf8",
  );
  const m = /text_encrypted ~ '([^']+)'/.exec(sql);
  if (!m) throw new Error("format rule not found in migration");
  return new RegExp(m[1]);
}

const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, level).mockImplementation(() => {}));
  }
});
afterEach(() => {
  // 암호화·풀기 어느 경우에도 로그를 찍지 않는다
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  consoleSpies.splice(0).forEach((s) => s.mockRestore());
});

describe("parseTodoKey (설정 오류)", () => {
  it("없으면 null", () => {
    expect(parseTodoKey(undefined)).toBeNull();
    expect(parseTodoKey(null)).toBeNull();
    expect(parseTodoKey("")).toBeNull();
    expect(parseTodoKey("   ")).toBeNull();
  });

  it("디코드 길이가 32바이트가 아니면 null", () => {
    expect(parseTodoKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseTodoKey(randomBytes(31).toString("base64"))).toBeNull();
    expect(parseTodoKey(randomBytes(33).toString("base64"))).toBeNull();
    expect(parseTodoKey(randomBytes(64).toString("base64"))).toBeNull();
  });

  it("base64가 아니면 null", () => {
    expect(parseTodoKey("not a key")).toBeNull();
    expect(parseTodoKey("!".repeat(43) + "=")).toBeNull();
    // 패딩 없는 base64url 43자도 받지 않는다(형식은 표준 base64)
    expect(parseTodoKey(randomBytes(32).toString("base64url"))).toBeNull();
  });

  it("32바이트 base64면 키", () => {
    expect(parseTodoKey(randomBytes(32).toString("base64"))?.bytes.length).toBe(32);
    expect(parseTodoKey(` ${randomBytes(32).toString("base64")}\n`)).not.toBeNull();
  });
});

describe("암호화·풀기", () => {
  const user = randomUUID();

  it("왕복하면 원래 글", () => {
    const key = newKey();
    for (const text of ["토익 단어 30개", "a", "👍🏽 이모지와 한글 섞기 👨‍👩‍👧", "줄\n바꿈"]) {
      const value = encryptTodoText(text, user, key);
      expect(decryptTodoText(value, user, key)).toEqual({ ok: true, text });
    }
  });

  it("같은 글도 매번 IV가 다르다", () => {
    const key = newKey();
    const values = Array.from({ length: 20 }, () => encryptTodoText("같은 글", user, key));
    expect(new Set(values).size).toBe(20);
    expect(new Set(values.map((v) => v.split(":")[1])).size).toBe(20);
  });

  it("출력은 DB 형식 규칙을 지키고 평문이 들어 있지 않다", () => {
    const key = newKey();
    const rule = dbFormatRule();
    const text = "평문이 그대로 보이면 안 되는 글";
    const value = encryptTodoText(text, user, key);
    expect(value).toMatch(rule);
    expect(value.startsWith("v1:")).toBe(true);
    expect(value).not.toContain(text);
  });

  it("상한 글(200 코드 포인트)을 가장 긴 바이트로 써도 4096자 안", () => {
    const key = newKey();
    const rule = dbFormatRule();
    for (const text of ["가".repeat(TODO_TEXT_MAX_LENGTH), "😀".repeat(TODO_TEXT_MAX_LENGTH)]) {
      const value = encryptTodoText(text, user, key);
      expect(value).toMatch(rule);
      expect(value.length).toBeLessThanOrEqual(CIPHERTEXT_MAX_LENGTH);
    }
  });

  it("다른 키로 풀면 실패", () => {
    const value = encryptTodoText("글", user, newKey());
    expect(decryptTodoText(value, user, newKey())).toBe(DECRYPT_FAILED);
  });

  it("다른 user id로 풀면 실패(소유자에 묶임)", () => {
    const key = newKey();
    const value = encryptTodoText("글", user, key);
    expect(decryptTodoText(value, randomUUID(), key)).toBe(DECRYPT_FAILED);
  });

  it("IV·암호문·태그 어느 조각을 바꿔도 실패", () => {
    const key = newKey();
    const value = encryptTodoText("변조 시험용 글", user, key);
    const parts = value.split(":");
    for (const i of [1, 2, 3]) {
      const p = [...parts];
      const c = p[i][0] === "A" ? "B" : "A";
      p[i] = c + p[i].slice(1);
      expect(decryptTodoText(p.join(":"), user, key)).toBe(DECRYPT_FAILED);
    }
  });

  it("형식이 깨지면 실패(던지지 않음)", () => {
    const key = newKey();
    const good = encryptTodoText("글", user, key);
    const [, iv, ct, tag] = good.split(":");
    const broken: unknown[] = [
      "",
      "plain text",
      good.slice(2), // 판 번호 없음
      `v2:${iv}:${ct}:${tag}`, // 모르는 판
      `v1:${iv}:${ct}`, // 조각 모자람
      `v1:${iv}::${tag}`, // 빈 암호문
      `v1:${iv}:${ct}:${tag}:x`,
      `v1:${iv}=:${ct}:${tag}`, // 패딩
      good + "A".repeat(CIPHERTEXT_MAX_LENGTH),
      null,
      undefined,
      42,
      { value: good },
    ];
    for (const value of broken) expect(decryptTodoText(value, user, key)).toBe(DECRYPT_FAILED);
  });

  it("실패 값은 정해진 하나이고 원래 오류 내용을 담지 않는다", () => {
    const key = newKey();
    const result = decryptTodoText(encryptTodoText("글", user, key), user, newKey());
    expect(result).toEqual({ ok: false });
    expect(Object.keys(result)).toEqual(["ok"]);
  });
});
