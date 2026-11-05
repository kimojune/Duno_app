import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCategoryForUser, listCategoriesForUser } from "../../lib/categories/core";
import {
  CATEGORY_NAME_MAX_LENGTH,
  categoryNameKey,
  checkCategoryName,
  normalizeCategoryName,
  sameCategoryName,
} from "../../lib/categories/validation";
import { decryptCategoryName, encryptCategoryName, encryptTodoText, parseTodoKey, type TodoKey } from "../../lib/todos/crypto";
import { FakeDb, fakeClient, type FakeCategoryRow } from "./fake-supabase";

// 시험 키는 무작위로 만든다(진짜 TODO_ENCRYPTION_KEY를 쓰지 않는다).
const newKey = (): TodoKey => parseTodoKey(randomBytes(32).toString("base64"))!;

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
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled(); // 로그에 아무것도 찍지 않는다(평문 이름 포함)
  consoleSpies.splice(0).forEach((s) => s.mockRestore());
});

function seedCategory(row: Partial<FakeCategoryRow> & { user_id: string; name?: string }): FakeCategoryRow {
  const full: FakeCategoryRow = {
    id: row.id ?? randomUUID(),
    user_id: row.user_id,
    name_encrypted: row.name_encrypted ?? encryptCategoryName(row.name ?? "분야", row.user_id, key),
    archived_at: row.archived_at ?? null,
    created_at: row.created_at ?? db.nextCreatedAt(),
  };
  db.categories.push(full);
  return full;
}

describe("악용 1: 로그인 안 됨·만료", () => {
  it("목록·더하기 모두 unauthenticated, DB를 부르지 않는다", async () => {
    const supabase = signedOut();
    expect(await listCategoriesForUser({ supabase, key })).toEqual({ ok: false, error: "unauthenticated" });
    expect(await createCategoryForUser({ supabase, key }, randomUUID(), "취업")).toEqual({ ok: false, error: "unauthenticated" });
    expect(db.calls).toHaveLength(0);
    expect(db.categories).toHaveLength(0);
  });

  it("세션 검증 실패도 같은 코드, 세션 확인 예외는 unavailable(원문 없음)", async () => {
    const expired = fakeClient(db, { claimsError: true });
    expect(await createCategoryForUser({ supabase: expired, key }, randomUUID(), "취업")).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    const broken = fakeClient(db, { claimsThrow: true });
    const res = await listCategoriesForUser({ supabase: broken, key });
    expect(res).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(res)).not.toContain("network");
    expect(db.calls).toHaveLength(0);
  });

  it("정상 대조: 로그인하면 같은 호출이 통과한다", async () => {
    expect((await createCategoryForUser({ supabase: signedIn(), key }, randomUUID(), "취업")).ok).toBe(true);
    expect((await listCategoriesForUser({ supabase: signedIn(), key })).ok).toBe(true);
  });
});

describe("설정 오류", () => {
  it("키가 없으면 config, DB를 부르지 않는다", async () => {
    expect(await listCategoriesForUser({ supabase: signedIn(), key: null })).toEqual({ ok: false, error: "config" });
    expect(await createCategoryForUser({ supabase: signedIn(), key: null }, randomUUID(), "취업")).toEqual({
      ok: false,
      error: "config",
    });
    expect(db.calls).toHaveLength(0);
  });
});

describe("악용 6: 큰 입력·이상한 입력 (DB 쓰기 전에 거절)", () => {
  it("이름 10만 자는 too_long, 21자 too_long, 20자(코드 포인트) 통과", async () => {
    const deps = { supabase: signedIn(), key };
    expect(await createCategoryForUser(deps, randomUUID(), "가".repeat(100_000))).toEqual({ ok: false, error: "too_long" });
    expect(await createCategoryForUser(deps, randomUUID(), "가".repeat(CATEGORY_NAME_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: "too_long",
    });
    expect(db.calls).toHaveLength(0);
    const twenty = "😀".repeat(10) + "가".repeat(10); // 코드 포인트 20, UTF-16 30
    const res = await createCategoryForUser(deps, randomUUID(), twenty);
    expect(res).toMatchObject({ ok: true, data: { category: { readable: true, name: twenty } } });
  });

  it("숫자·객체·배열·null 등 문자열이 아니면 invalid_input", async () => {
    const deps = { supabase: signedIn(), key };
    for (const name of [42, 0, null, undefined, true, {}, ["취업"], { name: "취업", user_id: other }]) {
      expect(await createCategoryForUser(deps, randomUUID(), name)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(db.calls).toHaveLength(0);
  });

  it("빈 이름·공백만은 empty", async () => {
    const deps = { supabase: signedIn(), key };
    for (const name of ["", " ", "\t\n ", "　"]) {
      expect(await createCategoryForUser(deps, randomUUID(), name)).toEqual({ ok: false, error: "empty" });
    }
    expect(db.calls).toHaveLength(0);
  });

  it("「기타」는 앞뒤 공백·조합형으로 보내도 reserved (임시, 결정 필요)", async () => {
    const deps = { supabase: signedIn(), key };
    for (const name of ["기타", "  기타 ", "기타".normalize("NFD")]) {
      expect(await createCategoryForUser(deps, randomUUID(), name)).toEqual({ ok: false, error: "reserved" });
    }
    expect(db.calls).toHaveLength(0);
    // 「기타」를 품은 다른 이름은 된다
    expect((await createCategoryForUser(deps, randomUUID(), "기타 공부")).ok).toBe(true);
  });

  it("id가 uuid가 아니면 invalid_input, DB를 부르지 않는다", async () => {
    const deps = { supabase: signedIn(), key };
    for (const id of ["", "1", "abc", null, undefined, 7, { id: randomUUID() }, `${randomUUID()}x`]) {
      expect(await createCategoryForUser(deps, id, "취업")).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(db.calls).toHaveLength(0);
  });

  it("이미 있는 (보관 안 한) 내 이름은 duplicate와 그 분야의 번호·이름, 새 행 없음 (C-D12, 임시, 결정 필요)", async () => {
    const deps = { supabase: signedIn(), key };
    const firstId = randomUUID();
    expect((await createCategoryForUser(deps, firstId, "취업")).ok).toBe(true);
    expect(await createCategoryForUser(deps, randomUUID(), "  취업  ")).toEqual({
      ok: false,
      error: "duplicate",
      existing: { id: firstId, name: "취업" },
    });
    expect(db.categories).toHaveLength(1);
    // 다른 이름은 된다
    expect((await createCategoryForUser(deps, randomUUID(), "취업 준비")).ok).toBe(true);
    expect(db.categories).toHaveLength(2);
  });

  it("보관한 분야·남의 분야와 이름이 같은 것은 duplicate가 아니다", async () => {
    seedCategory({ user_id: me, name: "운동", archived_at: "2026-11-01T00:00:00.000Z" });
    seedCategory({ user_id: other, name: "독서" });
    const deps = { supabase: signedIn(), key };
    expect((await createCategoryForUser(deps, randomUUID(), "운동")).ok).toBe(true);
    expect((await createCategoryForUser(deps, randomUUID(), "독서")).ok).toBe(true);
  });

  it("checkCategoryName은 앞뒤 공백을 지운 이름을 돌려준다", () => {
    expect(checkCategoryName("  취업 \n")).toEqual({ ok: true, name: "취업" });
  });
});

describe("분야 더하기", () => {
  it("user_id는 세션에서, 암호문만 저장하고 보내는 열은 id·user_id·name_encrypted뿐", async () => {
    const id = randomUUID();
    const res = await createCategoryForUser({ supabase: signedIn(), key }, id, "  취업 준비 ");
    expect(res).toEqual({
      ok: true,
      data: { category: { id, readable: true, name: "취업 준비", createdAt: expect.any(String) } },
    });
    const insert = db.calls.find((c) => c.op === "insert")!;
    expect(insert.table).toBe("categories");
    expect(Object.keys(insert.payload!).sort()).toEqual(["id", "name_encrypted", "user_id"]);
    expect(insert.payload!.user_id).toBe(me);
    const stored = db.categories[0].name_encrypted;
    expect(stored).not.toContain("취업");
    expect(decryptCategoryName(stored, me, key)).toEqual({ ok: true, text: "취업 준비" });
  });

  it("같은 id로 다시 오면 행은 하나, 처음 저장된 이름으로 둘 다 성공 (재시도)", async () => {
    const id = randomUUID();
    const deps = { supabase: signedIn(), key };
    const first = await createCategoryForUser(deps, id, "처음 이름");
    const again = await createCategoryForUser(deps, id, "처음 이름");
    const changed = await createCategoryForUser(deps, id, "다른 이름");
    expect(first.ok && again.ok && changed.ok).toBe(true);
    expect(db.categories).toHaveLength(1);
    if (first.ok && again.ok && changed.ok) {
      expect(again.data.category).toEqual(first.data.category);
      expect(changed.data.category).toEqual(first.data.category);
    }
  });

  it("목록을 읽은 뒤 같은 id가 먼저 들어갔으면(동시 재시도, 23505) 내 행으로 성공", async () => {
    const id = randomUUID();
    db.beforeInsert = () => void seedCategory({ id, user_id: me, name: "먼저 들어감" });
    const res = await createCategoryForUser({ supabase: signedIn(), key }, id, "먼저 들어감");
    expect(res).toMatchObject({ ok: true, data: { category: { id, name: "먼저 들어감" } } });
    expect(db.categories).toHaveLength(1);
    expect(db.calls.map((c) => c.op)).toEqual(["select", "insert", "select"]); // insert가 23505로 막힌 뒤 다시 읽었다
  });

  it("id가 남의 분야와 겹치면 conflict, 남의 행 그대로", async () => {
    const theirs = seedCategory({ user_id: other, name: "남의 분야" });
    const before = { ...theirs };
    const res = await createCategoryForUser({ supabase: signedIn(), key }, theirs.id, "내 분야");
    expect(res).toEqual({ ok: false, error: "conflict" });
    expect(db.categories).toEqual([before]);
  });
});

describe("악용 5: 분야 대량 생성 → 상한(DB 트리거, 임시 50)", () => {
  it("상한에 닿으면 category_limit, 행이 늘지 않는다", async () => {
    db.categoryLimit = 3;
    const deps = { supabase: signedIn(), key };
    for (let i = 0; i < 3; i += 1) expect((await createCategoryForUser(deps, randomUUID(), `분야 ${i}`)).ok).toBe(true);
    expect(await createCategoryForUser(deps, randomUUID(), "넷째")).toEqual({ ok: false, error: "category_limit" });
    expect(db.categories).toHaveLength(3);
  });

  it("DB가 돌려준 상한 오류(P0001, hint categories_limit)는 짧은 코드이고 원문이 없다", async () => {
    db.insertError = { code: "P0001", hint: "categories_limit", message: "category limit reached" };
    const res = await createCategoryForUser({ supabase: signedIn(), key }, randomUUID(), "분야");
    expect(res).toEqual({ ok: false, error: "category_limit" });
    expect(JSON.stringify(res)).not.toContain("limit reached");
  });

  it("상한에 걸렸어도 같은 id가 이미 내 것으로 있으면(재시도) 성공", async () => {
    db.categoryLimit = 1;
    const deps = { supabase: signedIn(), key };
    const id = randomUUID();
    expect((await createCategoryForUser(deps, id, "하나")).ok).toBe(true);
    expect((await createCategoryForUser(deps, id, "하나")).ok).toBe(true);
    expect(db.categories).toHaveLength(1);
  });
});

describe("악용 11: DB 오류로 내부 노출", () => {
  it("알 수 없는 insert 오류는 unavailable, 원문·세부·코드가 반환값에 없다", async () => {
    db.insertError = { code: "XX000", message: "internal secret detail at 10.0.0.1", details: "stack here" };
    const res = await createCategoryForUser({ supabase: signedIn(), key }, randomUUID(), "분야");
    expect(res).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(res)).not.toMatch(/internal|stack|XX000|10\.0\.0\.1/);
  });

  it("check 제약 위반(23514)은 invalid_input", async () => {
    db.insertError = { code: "23514", message: 'violates check constraint "categories_name_encrypted_format"' };
    const res = await createCategoryForUser({ supabase: signedIn(), key }, randomUUID(), "분야");
    expect(res).toEqual({ ok: false, error: "invalid_input" });
    expect(JSON.stringify(res)).not.toContain("categories_name_encrypted_format");
  });

  it("목록 읽기 DB 오류는 unavailable, 원문 없음", async () => {
    db.alwaysError = { code: "08006", message: "connection failure to 10.0.0.1" };
    const list = await listCategoriesForUser({ supabase: signedIn(), key });
    expect(list).toEqual({ ok: false, error: "unavailable" });
    const add = await createCategoryForUser({ supabase: signedIn(), key }, randomUUID(), "분야");
    expect(add).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify([list, add])).not.toContain("10.0.0.1");
  });
});

describe("분야 목록", () => {
  it("보관 안 한 내 분야만, created_at 오름차순(같으면 id), DTO 필드만, 세션 사용자로 좁혀 읽는다", async () => {
    const t = "2026-11-05T01:00:00.000Z";
    const b = seedCategory({ user_id: me, name: "둘째", created_at: "2026-11-05T02:00:00.000Z" });
    const a2 = seedCategory({ id: "ffffffff-ffff-4fff-bfff-ffffffffffff", user_id: me, name: "첫째-2", created_at: t });
    const a1 = seedCategory({ id: "00000000-0000-4000-8000-000000000000", user_id: me, name: "첫째-1", created_at: t });
    seedCategory({ user_id: me, name: "보관함", archived_at: "2026-11-04T00:00:00.000Z" });
    seedCategory({ user_id: other, name: "남의 분야" });

    const res = await listCategoriesForUser({ supabase: signedIn(), key });
    const call = db.calls.find((c) => c.op === "select")!;
    expect(call.table).toBe("categories");
    expect(call.filters).toEqual(expect.arrayContaining([["user_id", me], ["archived_at", null]]));
    expect(call.orders).toEqual([
      ["created_at", true],
      ["id", true],
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.categories.map((c) => c.id)).toEqual([a1.id, a2.id, b.id]);
    expect(res.data.categories.map((c) => c.name)).toEqual(["첫째-1", "첫째-2", "둘째"]);
    for (const item of res.data.categories) expect(Object.keys(item).sort()).toEqual(["createdAt", "id", "name", "readable"]);
  });

  it("악용 9: 풀 수 없는 이름(가짜 암호문·할 일 글 암호문·남에게 묶인 값·다른 키)은 그 행만 readable=false", async () => {
    const good = seedCategory({ user_id: me, name: "멀쩡한 분야" });
    const forged = seedCategory({
      user_id: me,
      name_encrypted: `v1:${randomBytes(12).toString("base64url")}:${randomBytes(20).toString("base64url")}:${randomBytes(16).toString("base64url")}`,
    });
    const swapped = seedCategory({ user_id: me, name_encrypted: encryptTodoText("할 일 글을 옮겨 넣음", me, key) });
    const wrongOwner = seedCategory({ user_id: me, name_encrypted: encryptCategoryName("남에게 묶임", other, key) });
    const wrongKey = seedCategory({ user_id: me, name_encrypted: encryptCategoryName("다른 키", me, newKey()) });

    const res = await listCategoriesForUser({ supabase: signedIn(), key });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byId = new Map(res.data.categories.map((c) => [c.id, c]));
    expect(byId.get(good.id)).toMatchObject({ readable: true, name: "멀쩡한 분야" });
    for (const bad of [forged, swapped, wrongOwner, wrongKey]) {
      expect(byId.get(bad.id)).toEqual({ id: bad.id, readable: false, name: null, createdAt: bad.created_at });
    }
    expect(JSON.stringify(res)).not.toContain("할 일 글을 옮겨 넣음");
  });

  it("풀 수 없는 이름은 같은 이름 검사에서 건너뛴다(그 이름으로 새로 만들 수 있다)", async () => {
    seedCategory({ user_id: me, name_encrypted: encryptTodoText("취업", me, key) }); // 할 일 글 AAD라 분야 이름으로 안 풀림
    expect((await createCategoryForUser({ supabase: signedIn(), key }, randomUUID(), "취업")).ok).toBe(true);
  });
});

describe("분야 이름 정규화와 같은 이름 판정 (디자인 명세 12-7)", () => {
  it("정규화: NFC, 이어진 공백류는 공백 하나, 앞뒤 공백 없음", () => {
    expect(normalizeCategoryName("  CS \t\n  공부　 ")).toBe("CS 공부");
    expect(normalizeCategoryName("취업".normalize("NFD"))).toBe("취업".normalize("NFC"));
    expect(normalizeCategoryName("취업".normalize("NFD")).length).toBe(2);
  });

  it("같음·다름·대소문자: 「CS 공부」=「cs 공부」, 「CS공부」≠「CS 공부」", () => {
    expect(sameCategoryName("CS 공부", "cs 공부")).toBe(true);
    expect(sameCategoryName("CS공부", "CS 공부")).toBe(false);
    expect(sameCategoryName("CS  공부", "CS 공부")).toBe(true); // 가운데 이어진 공백은 하나로
    expect(sameCategoryName("영어", "영어 ")).toBe(true);
  });

  it("NFD로 적은 한글은 NFC 이름과 같다", () => {
    expect(sameCategoryName("취업 준비".normalize("NFD"), "취업 준비")).toBe(true);
  });

  it("대소문자는 로마자 A~Z만 가리지 않는다(다른 글자는 그대로)", () => {
    expect(categoryNameKey("ABC xyz")).toBe("abc xyz");
    expect(sameCategoryName("Été", "été")).toBe(false); // É는 A~Z가 아니다
    expect(sameCategoryName("ＣＳ", "ｃｓ")).toBe(false); // 전각 로마자도 A~Z가 아니다
  });

  it("글자 수 20은 정규화한 이름으로 센다: 공백을 줄여 20자 안이면 통과", () => {
    const spaced = "가 " + " ".repeat(30) + "나".repeat(18); // 정규화하면 「가 나…」 20자
    expect(checkCategoryName(spaced)).toEqual({ ok: true, name: "가 " + "나".repeat(18) });
    expect(checkCategoryName("가".repeat(21))).toEqual({ ok: false, error: "too_long" });
  });

  it("저장하는 이름은 정규화한 꼴이다(암호를 풀면 정규화 이름)", async () => {
    const id = randomUUID();
    const res = await createCategoryForUser({ supabase: signedIn(), key }, id, "  CS \t 공부 ".normalize("NFD"));
    expect(res).toMatchObject({ ok: true, data: { category: { id, name: "CS 공부" } } });
    expect(decryptCategoryName(db.categories[0].name_encrypted, me, key)).toEqual({ ok: true, text: "CS 공부" });
  });

  it("서버 판정: 「cs 공부」가 있으면 「CS 공부」는 duplicate(기존 분야와 함께), 「CS공부」는 새로 만든다", async () => {
    const deps = { supabase: signedIn(), key };
    const firstId = randomUUID();
    expect((await createCategoryForUser(deps, firstId, "cs 공부")).ok).toBe(true);
    expect(await createCategoryForUser(deps, randomUUID(), "CS 공부")).toEqual({
      ok: false,
      error: "duplicate",
      existing: { id: firstId, name: "cs 공부" },
    });
    expect(await createCategoryForUser(deps, randomUUID(), "취업".normalize("NFD"))).toMatchObject({ ok: true });
    expect(await createCategoryForUser(deps, randomUUID(), "취업")).toMatchObject({ ok: false, error: "duplicate" });
    expect((await createCategoryForUser(deps, randomUUID(), "CS공부")).ok).toBe(true);
    expect(db.categories).toHaveLength(3);
  });

  it("「기타」도 같은 판정: 공백·NFD로 적어도 reserved", () => {
    expect(checkCategoryName(" 기타 ".normalize("NFD"))).toEqual({ ok: false, error: "reserved" });
    expect(checkCategoryName("기 타")).toEqual({ ok: true, name: "기 타" }); // 띄어쓰기가 다르면 다른 이름
  });

  it("C-D4: 15초 한도로 화면이 실패로 본 뒤 같은 id로 다시 보내도 분야는 하나, 둘 다 성공 응답(번호·이름)", async () => {
    const id = randomUUID();
    const deps = { supabase: signedIn(), key };
    const first = await createCategoryForUser(deps, id, "느린 망 분야");
    const retry = await createCategoryForUser(deps, id, "느린 망 분야");
    expect(first).toMatchObject({ ok: true, data: { category: { id, name: "느린 망 분야" } } });
    expect(retry).toMatchObject({ ok: true, data: { category: { id, name: "느린 망 분야" } } });
    expect(db.categories).toHaveLength(1);
  });
});
