import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTodoForToday, listTodosForToday, setTodoDoneForUser } from "../../lib/todos/core";
import { decryptTodoText, encryptTodoText, parseTodoKey, type TodoKey } from "../../lib/todos/crypto";
import { todoDayFor } from "../../lib/todos/day";
import { FakeDb, fakeClient, type FakeRow } from "./fake-supabase";

// 시험 키는 무작위로 만든다(진짜 TODO_ENCRYPTION_KEY를 쓰지 않는다).
const newKey = (): TodoKey => parseTodoKey(randomBytes(32).toString("base64"))!;
const NOW = new Date("2026-11-05T10:00:00+09:00"); // 서울 오전 10시
const TODAY = todoDayFor(NOW); // 2026-11-05
const now = () => NOW;

const me = randomUUID();
const other = randomUUID();

let db: FakeDb;
let key: TodoKey;
const signedIn = () => fakeClient(db, { sub: me });
const signedOut = () => fakeClient(db, { sub: null });

const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  db = new FakeDb();
  key = newKey();
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, level).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled(); // 로그에 아무것도 찍지 않는다
  consoleSpies.splice(0).forEach((s) => s.mockRestore());
});

function seed(row: Partial<FakeRow> & { user_id: string; text?: string }): FakeRow {
  const id = row.id ?? randomUUID();
  const full: FakeRow = {
    id,
    user_id: row.user_id,
    day: row.day ?? TODAY,
    text_encrypted: row.text_encrypted ?? encryptTodoText(row.text ?? "seed", row.user_id, key),
    done: row.done ?? false,
    created_at: row.created_at ?? db.nextCreatedAt(),
  };
  db.rows.push(full);
  return full;
}

describe("로그인 안 됨·만료 (T13)", () => {
  it("적기·체크·목록 모두 unauthenticated, DB를 부르지 않는다", async () => {
    const supabase = signedOut();
    expect(await createTodoForToday({ supabase, key, now }, randomUUID(), "글")).toEqual({ ok: false, error: "unauthenticated" });
    expect(await setTodoDoneForUser({ supabase }, randomUUID(), true)).toEqual({ ok: false, error: "unauthenticated" });
    expect(await listTodosForToday({ supabase, key, now })).toEqual({ ok: false, error: "unauthenticated" });
    expect(db.calls).toHaveLength(0);
  });

  it("세션 검증 실패(만료 등)도 같은 코드", async () => {
    const supabase = fakeClient(db, { claimsError: true });
    expect(await createTodoForToday({ supabase, key, now }, randomUUID(), "글")).toEqual({ ok: false, error: "unauthenticated" });
    expect(await setTodoDoneForUser({ supabase }, randomUUID(), true)).toEqual({ ok: false, error: "unauthenticated" });
    expect(db.calls).toHaveLength(0);
  });

  it("세션 확인이 예외를 내면 unavailable(원문 없음)", async () => {
    const supabase = fakeClient(db, { claimsThrow: true });
    const result = await createTodoForToday({ supabase, key, now }, randomUUID(), "글");
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("network");
    expect(db.calls).toHaveLength(0);
  });
});

describe("설정 오류", () => {
  it("키가 없으면 config, DB 쓰기를 부르지 않는다", async () => {
    const res = await createTodoForToday({ supabase: signedIn(), key: null, now }, randomUUID(), "글");
    expect(res).toEqual({ ok: false, error: "config" });
    expect(db.calls).toHaveLength(0);
  });

  it("키 길이가 틀리면(parseTodoKey → null) config, DB를 부르지 않는다", async () => {
    const wrong = parseTodoKey(randomBytes(16).toString("base64"));
    expect(wrong).toBeNull();
    expect(await createTodoForToday({ supabase: signedIn(), key: wrong, now }, randomUUID(), "글")).toEqual({
      ok: false,
      error: "config",
    });
    expect(await listTodosForToday({ supabase: signedIn(), key: wrong, now })).toEqual({ ok: false, error: "config" });
    expect(db.calls).toHaveLength(0);
  });
});

describe("적기 입력 검증 (암호화·DB 쓰기 전에 거절)", () => {
  it("빈 글·공백만은 empty, 201자는 too_long, 200자는 통과", async () => {
    const deps = { supabase: signedIn(), key, now };
    expect(await createTodoForToday(deps, randomUUID(), "")).toEqual({ ok: false, error: "empty" });
    expect(await createTodoForToday(deps, randomUUID(), "   ")).toEqual({ ok: false, error: "empty" });
    expect(await createTodoForToday(deps, randomUUID(), "가".repeat(201))).toEqual({ ok: false, error: "too_long" });
    expect(await createTodoForToday(deps, randomUUID(), "x".repeat(50_000))).toEqual({ ok: false, error: "too_long" });
    expect(db.calls).toHaveLength(0);
    expect((await createTodoForToday(deps, randomUUID(), "가😀".repeat(100))).ok).toBe(true);
  });

  it("id가 uuid가 아니면 invalid_input, DB를 부르지 않는다", async () => {
    const deps = { supabase: signedIn(), key, now };
    for (const id of ["", "1", "abc", null, undefined, 7, { id: randomUUID() }]) {
      expect(await createTodoForToday(deps, id, "글")).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(db.calls).toHaveLength(0);
  });

  it("글 자리에 user_id·day를 섞은 객체를 보내도 invalid_input", async () => {
    const res = await createTodoForToday({ supabase: signedIn(), key, now }, randomUUID(), {
      text: "글",
      user_id: other,
      day: "1999-01-01",
    });
    expect(res).toEqual({ ok: false, error: "invalid_input" });
    expect(db.calls).toHaveLength(0);
  });
});

describe("적기", () => {
  it("user_id는 세션, day는 서버 시계로 정하고 암호문만 저장한다", async () => {
    const id = randomUUID();
    const text = "  토익 단어 30개 외우기  ";
    const res = await createTodoForToday({ supabase: signedIn(), key, now }, id, text);
    expect(res).toEqual({
      ok: true,
      data: {
        day: { date: TODAY, year: 2026, month: 11, dayOfMonth: 5, weekday: 4 },
        todo: { id, readable: true, text: "토익 단어 30개 외우기", done: false, createdAt: expect.any(String) },
      },
    });

    const insert = db.calls.find((c) => c.op === "insert")!;
    expect(Object.keys(insert.payload!).sort()).toEqual(["day", "id", "text_encrypted", "user_id"]);
    expect(insert.payload!.user_id).toBe(me);
    expect(insert.payload!.day).toBe(TODAY);
    const stored = db.rows[0].text_encrypted;
    expect(stored).not.toContain("토익");
    expect(decryptTodoText(stored, me, key)).toEqual({ ok: true, text: "토익 단어 30개 외우기" });
  });

  it("서울 03:59에 적으면 전날로 들어간다", async () => {
    await createTodoForToday(
      { supabase: signedIn(), key, now: () => new Date("2026-11-05T03:59:00+09:00") },
      randomUUID(),
      "새벽",
    );
    expect(db.rows[0].day).toBe("2026-11-04");
  });

  it("같은 id로 두 번 보내면 행은 하나, 둘 다 성공 (D4)", async () => {
    const id = randomUUID();
    const deps = { supabase: signedIn(), key, now };
    const first = await createTodoForToday(deps, id, "처음 글");
    const second = await createTodoForToday(deps, id, "다시 보낸 글");
    expect(first.ok && second.ok).toBe(true);
    expect(db.rows).toHaveLength(1);
    if (first.ok && second.ok) {
      expect(second.data.todo).toEqual(first.data.todo); // 처음 저장된 행 그대로
    }
  });

  it("남의 행과 id가 겹치면 conflict, 남의 행 그대로", async () => {
    const theirs = seed({ user_id: other, text: "남의 글" });
    const before = { ...theirs };
    const res = await createTodoForToday({ supabase: signedIn(), key, now }, theirs.id, "내 글");
    expect(res).toEqual({ ok: false, error: "conflict" });
    expect(db.rows).toEqual([before]);
  });

  it("DB 하루 상한·전체 상한은 짧은 코드", async () => {
    db.insertError = { code: "P0001", hint: "todos_daily_limit", message: "daily todo limit reached" };
    expect(await createTodoForToday({ supabase: signedIn(), key, now }, randomUUID(), "글")).toEqual({
      ok: false,
      error: "daily_limit",
    });
    db.insertError = { code: "P0001", hint: "todos_total_limit", message: "total todo limit reached" };
    expect(await createTodoForToday({ supabase: signedIn(), key, now }, randomUUID(), "글")).toEqual({
      ok: false,
      error: "total_limit",
    });
  });

  it("이미 들어간 할 일의 재시도가 상한에 걸려도 성공으로 돌려준다", async () => {
    const mine = seed({ user_id: me, text: "이미 들어감" });
    db.insertError = { code: "P0001", hint: "todos_daily_limit" };
    const res = await createTodoForToday({ supabase: signedIn(), key, now }, mine.id, "이미 들어감");
    expect(res.ok).toBe(true);
    expect(db.rows).toHaveLength(1);
  });

  it("알 수 없는 DB 오류는 unavailable이고 원문을 내지 않는다", async () => {
    db.insertError = { code: "XX000", message: "internal secret detail", details: "stack here" };
    const res = await createTodoForToday({ supabase: signedIn(), key, now }, randomUUID(), "글");
    expect(res).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(res)).not.toMatch(/internal|stack|XX000/);
  });
});

describe("끝냄 체크 (D5: 원하는 값으로 둔다)", () => {
  it("같은 값을 여러 번 보내도 결과가 같다", async () => {
    const mine = seed({ user_id: me });
    const deps = { supabase: signedIn() };
    expect(await setTodoDoneForUser(deps, mine.id, true)).toEqual({ ok: true, data: { id: mine.id, done: true } });
    expect(await setTodoDoneForUser(deps, mine.id, true)).toEqual({ ok: true, data: { id: mine.id, done: true } });
    expect(await setTodoDoneForUser(deps, mine.id, false)).toEqual({ ok: true, data: { id: mine.id, done: false } });
    expect(db.rows[0].done).toBe(false);
  });

  it("세션 사용자로 범위를 좁혀 update한다", async () => {
    const mine = seed({ user_id: me });
    await setTodoDoneForUser({ supabase: signedIn() }, mine.id, true);
    const update = db.calls.find((c) => c.op === "update")!;
    expect(update.payload).toEqual({ done: true });
    expect(update.filters).toEqual(expect.arrayContaining([["id", mine.id], ["user_id", me]]));
  });

  it("남의 id·없는 id는 not_found, 남의 행 그대로", async () => {
    const theirs = seed({ user_id: other });
    expect(await setTodoDoneForUser({ supabase: signedIn() }, theirs.id, true)).toEqual({ ok: false, error: "not_found" });
    expect(theirs.done).toBe(false);
    expect(await setTodoDoneForUser({ supabase: signedIn() }, randomUUID(), true)).toEqual({ ok: false, error: "not_found" });
  });

  it("id·done 형식이 틀리면 invalid_input, DB를 부르지 않는다", async () => {
    const deps = { supabase: signedIn() };
    expect(await setTodoDoneForUser(deps, "abc", true)).toEqual({ ok: false, error: "invalid_input" });
    expect(await setTodoDoneForUser(deps, randomUUID(), "true")).toEqual({ ok: false, error: "invalid_input" });
    expect(await setTodoDoneForUser(deps, randomUUID(), undefined)).toEqual({ ok: false, error: "invalid_input" });
    expect(db.calls).toHaveLength(0);
  });
});

describe("오늘 목록", () => {
  it("오늘 내 행만, created_at 오름차순(같으면 id), DTO 필드만 (D8·D9)", async () => {
    const t = "2026-11-05T01:00:00.000Z";
    const b = seed({ user_id: me, text: "둘째", created_at: "2026-11-05T02:00:00.000Z" });
    const a2 = seed({ id: "ffffffff-ffff-4fff-bfff-ffffffffffff", user_id: me, text: "첫째-2", created_at: t });
    const a1 = seed({ id: "00000000-0000-4000-8000-000000000000", user_id: me, text: "첫째-1", created_at: t });
    seed({ user_id: me, text: "어제", day: "2026-11-04" });
    seed({ user_id: other, text: "남의 오늘" });

    const res = await listTodosForToday({ supabase: signedIn(), key, now });
    // 가짜 DB는 order()를 부른 만큼만 정렬한다: created_at 오름차순, 그다음 id 오름차순으로 불렀는지 본다
    const listCall = db.calls.find((c) => c.op === "select");
    expect(listCall?.orders).toEqual([
      ["created_at", true],
      ["id", true],
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.day).toEqual({ date: TODAY, year: 2026, month: 11, dayOfMonth: 5, weekday: 4 });
    expect(res.data.todos.map((x) => x.id)).toEqual([a1.id, a2.id, b.id]);
    expect(res.data.todos.map((x) => x.text)).toEqual(["첫째-1", "첫째-2", "둘째"]);
    for (const item of res.data.todos) {
      expect(Object.keys(item).sort()).toEqual(["createdAt", "done", "id", "readable", "text"]);
    }
  });

  it("풀 수 없는 행은 그 행만 「읽을 수 없음」, 목록은 깨지지 않는다", async () => {
    const good = seed({ user_id: me, text: "멀쩡한 글" });
    // 형식만 맞춘 가짜 암호문(REST로 직접 넣은 경우)
    const forged = seed({
      user_id: me,
      text_encrypted: `v1:${randomBytes(12).toString("base64url")}:${randomBytes(20).toString("base64url")}:${randomBytes(16).toString("base64url")}`,
    });
    // 다른 사용자에 묶인 암호문
    const wrongOwner = seed({ user_id: me, text_encrypted: encryptTodoText("남에게 묶인 글", other, key) });
    // 다른 키로 만든 암호문
    const wrongKey = seed({ user_id: me, text_encrypted: encryptTodoText("다른 키", me, newKey()) });

    const res = await listTodosForToday({ supabase: signedIn(), key, now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byId = new Map(res.data.todos.map((x) => [x.id, x]));
    expect(byId.get(good.id)).toMatchObject({ readable: true, text: "멀쩡한 글" });
    for (const bad of [forged, wrongOwner, wrongKey]) {
      expect(byId.get(bad.id)).toEqual({ id: bad.id, readable: false, text: null, done: false, createdAt: bad.created_at });
    }
  });

  it("DB 오류는 unavailable", async () => {
    db.alwaysError = { code: "08006", message: "connection failure to 10.0.0.1" };
    const res = await listTodosForToday({ supabase: signedIn(), key, now });
    expect(res).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(res)).not.toContain("10.0.0.1");
  });
});
