import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CIPHERTEXT_MAX_LENGTH,
  DECRYPT_FAILED,
  decryptCategoryName,
  decryptTodoText,
  encryptCategoryName,
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

  it("풀기 길이 상한은 용도별이다(작업 기록은 DB 상한 16000자까지, 분야 이름은 512자까지)", () => {
    const key = newKey();
    const note = encryptTodoText("가".repeat(2000), user, key, "todo_note");
    expect(note.length).toBeGreaterThan(CIPHERTEXT_MAX_LENGTH);
    expect(decryptTodoText(note, user, key, "todo_note")).toEqual({ ok: true, text: "가".repeat(2000) });
    // 같은 길이의 암호문이라도 할 일 글 자리에서는 상한 4096자를 넘어 풀지 않는다
    expect(decryptTodoText(note, user, key)).toBe(DECRYPT_FAILED);
    const cat = encryptCategoryName("어학", user, key);
    expect(decryptTodoText(cat + "A".repeat(600), user, key, "category_name")).toBe(DECRYPT_FAILED);
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

describe("용도별 AAD: 할 일 글과 분야 이름 (악용 9)", () => {
  const user = randomUUID();

  // base(c35cf7b, 용도 구분 전) 코드의 encryptTodoText로 만든 고정 값. 이미 DB에 있는 할 일 글이 이 꼴이다.
  // 키는 0x2a 32바이트(시험용, 비밀 아님), 소유자 id와 평문은 아래와 같다. 이 시험이 깨지면 할 일 글 AAD가 바뀐 것이다.
  const BASE_USER = "0b0e7a52-6f1c-4d8e-9a3b-2c4d5e6f7a8b";
  const BASE_PLAIN = "기존 할 일 글 v1";
  const BASE_VALUE = "v1:RyiG6Y1pUkzvnw-v:ReHw8O7rXDh7vkt0Z4YirmhGRuPB:z88r7YPWbcj49CabgfTfsw";
  const baseKey = () => parseTodoKey(Buffer.alloc(32, 0x2a).toString("base64"))!;

  it("base 코드로 암호화한 할 일 글이 바뀐 코드로도 풀린다(할 일 글 AAD 그대로)", () => {
    expect(decryptTodoText(BASE_VALUE, BASE_USER, baseKey())).toEqual({ ok: true, text: BASE_PLAIN });
    expect(decryptTodoText(BASE_VALUE, BASE_USER, baseKey(), "todo_text")).toEqual({ ok: true, text: BASE_PLAIN });
  });

  it("base 할 일 글 값을 분야 이름으로 풀면 실패", () => {
    expect(decryptCategoryName(BASE_VALUE, BASE_USER, baseKey())).toBe(DECRYPT_FAILED);
  });

  it("분야 이름은 왕복하고, 같은 v1 형식(DB 형식 규칙)을 지킨다", () => {
    const key = newKey();
    const value = encryptCategoryName("취업 준비", user, key);
    expect(value).toMatch(dbFormatRule());
    expect(value.startsWith("v1:")).toBe(true);
    expect(value).not.toContain("취업");
    expect(decryptCategoryName(value, user, key)).toEqual({ ok: true, text: "취업 준비" });
  });

  it("할 일 글 암호문을 분야 이름 자리에 옮기면 풀리지 않는다", () => {
    const key = newKey();
    const todo = encryptTodoText("할 일 글", user, key);
    expect(decryptTodoText(todo, user, key)).toEqual({ ok: true, text: "할 일 글" }); // 양성 대조
    expect(decryptCategoryName(todo, user, key)).toBe(DECRYPT_FAILED);
  });

  it("분야 이름 암호문을 할 일 글 자리에 옮기면 풀리지 않는다", () => {
    const key = newKey();
    const name = encryptCategoryName("분야", user, key);
    expect(decryptCategoryName(name, user, key)).toEqual({ ok: true, text: "분야" }); // 양성 대조
    expect(decryptTodoText(name, user, key)).toBe(DECRYPT_FAILED);
  });

  it("분야 이름도 다른 사용자·다른 키로는 풀리지 않는다", () => {
    const key = newKey();
    const name = encryptCategoryName("분야", user, key);
    expect(decryptCategoryName(name, randomUUID(), key)).toBe(DECRYPT_FAILED);
    expect(decryptCategoryName(name, user, newKey())).toBe(DECRYPT_FAILED);
  });

  it("모르는 용도는 암호화에서 던지고, 풀기에서는 실패(할 일 글 AAD로 넘어가지 않는다)", () => {
    const key = newKey();
    const todo = encryptTodoText("글", user, key);
    const bogus = "toString" as unknown as "todo_text";
    expect(() => encryptTodoText("글", user, key, bogus)).toThrow(TypeError);
    expect(decryptTodoText(todo, user, key, bogus)).toBe(DECRYPT_FAILED);
  });
});
