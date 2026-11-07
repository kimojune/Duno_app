import { describe, expect, it } from "vitest";
import { encryptCategoryName, encryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { createTodoForToday, listTodosForToday } from "../../lib/todos/core";
import { resolveWriteDay } from "../../lib/todos/day";
import {
  carryOverTodosForUser,
  deleteTodoForUser,
  editTodoForUser,
  listCarryOverCandidates,
  reorderTodosForUser,
  sortByPosition,
} from "../../lib/todos/manage-core";
import { FakeStore, fakeTablesClient, v2Rules, type Row } from "./fake-tables";

const KEY = parseTodoKey(Buffer.alloc(32, 7).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const CAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-11-07T03:00:00.000Z"); // 서울 12:00, 두노 하루 2026-11-07

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  return store;
}
function todoRow(store: FakeStore, id: string, text: string, extra: Row = {}) {
  return store.seed("todos", {
    id,
    user_id: ME,
    day: "2026-11-07",
    text_encrypted: encryptTodoText(text, ME, KEY!),
    done: false,
    category_id: null,
    ...extra,
  });
}

describe("sortByPosition", () => {
  it("순서를 정한 행이 앞, 정하지 않은 행은 들어온 순서대로 뒤", () => {
    const rows = [{ id: "a" }, { id: "b", position: 1 }, { id: "c" }, { id: "d", position: 0 }];
    expect(sortByPosition(rows).map((r) => r.id)).toEqual(["d", "b", "a", "c"]);
  });
});

describe("resolveWriteDay (오프라인으로 적은 때)", () => {
  it("믿는 범위 안이면 적은 때의 하루", () => {
    expect(resolveWriteDay(NOW, "2026-11-06T10:00:00.000Z")).toBe("2026-11-06"); // 서울 11-06 19:00
  });
  it("새벽 4시 전에 적은 글은 전날로 센다", () => {
    // 서울 11-07 03:30 → 두노 하루는 11-06
    expect(resolveWriteDay(NOW, "2026-11-06T18:30:00.000Z")).toBe("2026-11-06");
    // 서울 11-07 04:30 → 두노 하루는 11-07
    expect(resolveWriteDay(NOW, "2026-11-06T19:30:00.000Z")).toBe("2026-11-07");
  });
  it("72시간보다 오래됐거나 미래(5분 넘게)이거나 문자열이 아니면 서버 시계", () => {
    expect(resolveWriteDay(NOW, "2026-10-01T00:00:00.000Z")).toBe("2026-11-07");
    expect(resolveWriteDay(NOW, "2026-11-08T00:00:00.000Z")).toBe("2026-11-07");
    expect(resolveWriteDay(NOW, "아무 글")).toBe("2026-11-07");
    expect(resolveWriteDay(NOW, 123)).toBe("2026-11-07");
    expect(resolveWriteDay(NOW, undefined)).toBe("2026-11-07");
  });
});

describe("createTodoForToday + writtenAt", () => {
  it("적은 때가 어제면 어제 날짜로 들어간다", async () => {
    const store = setup();
    const client = fakeTablesClient(store, { sub: ME });
    const res = await createTodoForToday({ supabase: client, key: KEY, now: () => NOW }, T1, "어제 적은 글", null, "2026-11-06T10:00:00.000Z");
    expect(res.ok && res.data.day.date).toBe("2026-11-06");
    expect(store.table("todos")[0].day).toBe("2026-11-06");
  });
});

describe("listTodosForToday의 순서", () => {
  it("순서를 정한 행이 먼저, 나머지는 적은 순서", async () => {
    const store = setup();
    todoRow(store, T1, "첫째");
    todoRow(store, T2, "둘째");
    todoRow(store, T3, "셋째", { position: 0 });
    const client = fakeTablesClient(store, { sub: ME });
    const res = await listTodosForToday({ supabase: client, key: KEY, now: () => NOW });
    expect(res.ok && res.data.todos.map((t) => t.id)).toEqual([T3, T1, T2]);
  });
});

describe("editTodoForUser", () => {
  it("글을 바꾸면 암호화해 저장하고 바뀐 글을 돌려준다", async () => {
    const store = setup();
    todoRow(store, T1, "옛 글");
    const client = fakeTablesClient(store, { sub: ME });
    const res = await editTodoForUser({ supabase: client, key: KEY }, T1, { text: "  새 글  " });
    expect(res.ok && res.data.todo.readable && res.data.todo.text).toBe("새 글");
    expect(String(store.table("todos")[0].text_encrypted)).toMatch(/^v1:/);
    expect(String(store.table("todos")[0].text_encrypted)).not.toContain("새 글");
    const call = store.calls.find((c) => c.op === "update");
    expect(Object.keys(call!.payload as Row)).toEqual(["text_encrypted"]); // 분야는 안 보냈으니 그대로
  });
  it("분야를 바꾸거나(내 분야) 기타(null)로 돌린다", async () => {
    const store = setup();
    store.seed("categories", { id: CAT, user_id: ME, name_encrypted: encryptCategoryName("어학", ME, KEY!), archived_at: null });
    todoRow(store, T1, "글");
    const client = fakeTablesClient(store, { sub: ME });
    const set = await editTodoForUser({ supabase: client, key: KEY }, T1, { categoryId: CAT });
    expect(set.ok && set.data.todo.categoryId).toBe(CAT);
    const unset = await editTodoForUser({ supabase: client, key: KEY }, T1, { categoryId: null });
    expect(unset.ok && unset.data.todo.categoryId).toBeNull();
  });
  it("남의 분야·없는 분야는 invalid_category", async () => {
    const store = setup();
    store.seed("categories", { id: CAT, user_id: OTHER, name_encrypted: "x" });
    todoRow(store, T1, "글");
    const client = fakeTablesClient(store, { sub: ME });
    expect(await editTodoForUser({ supabase: client, key: KEY }, T1, { categoryId: CAT })).toEqual({ ok: false, error: "invalid_category" });
  });
  it("빈 글·200자 넘는 글·바꿀 것 없음·모르는 키는 거절하고 DB를 부르지 않는다", async () => {
    const store = setup();
    todoRow(store, T1, "글");
    const client = fakeTablesClient(store, { sub: ME });
    const before = store.calls.length;
    expect(await editTodoForUser({ supabase: client, key: KEY }, T1, { text: "   " })).toEqual({ ok: false, error: "empty" });
    expect(await editTodoForUser({ supabase: client, key: KEY }, T1, { text: "가".repeat(201) })).toEqual({ ok: false, error: "too_long" });
    expect(await editTodoForUser({ supabase: client, key: KEY }, T1, {})).toEqual({ ok: false, error: "invalid_input" });
    expect(await editTodoForUser({ supabase: client, key: KEY }, T1, { text: "글", done: true })).toEqual({ ok: false, error: "invalid_input" });
    expect(await editTodoForUser({ supabase: client, key: KEY }, "not-uuid", { text: "글" })).toEqual({ ok: false, error: "invalid_input" });
    expect(store.calls.length).toBe(before);
  });
  it("남의 할 일·없는 할 일은 not_found, 로그인이 없으면 unauthenticated, 키가 없으면 config", async () => {
    const store = setup();
    store.seed("todos", { id: T2, user_id: OTHER, day: "2026-11-07", text_encrypted: encryptTodoText("남의", OTHER, KEY!), done: false });
    const client = fakeTablesClient(store, { sub: ME });
    expect(await editTodoForUser({ supabase: client, key: KEY }, T2, { text: "가로채기" })).toEqual({ ok: false, error: "not_found" });
    expect(await editTodoForUser({ supabase: client, key: KEY }, T3, { text: "없는" })).toEqual({ ok: false, error: "not_found" });
    expect(await editTodoForUser({ supabase: fakeTablesClient(store, { sub: null }), key: KEY }, T2, { text: "글" })).toEqual({ ok: false, error: "unauthenticated" });
    expect(await editTodoForUser({ supabase: client, key: null }, T2, { text: "글" })).toEqual({ ok: false, error: "config" });
  });
  it("DB 오류는 unavailable로 바꾸고 원문을 내지 않는다", async () => {
    const store = setup();
    todoRow(store, T1, "글");
    store.alwaysError = { code: "XX000", message: "secret db detail" };
    const client = fakeTablesClient(store, { sub: ME });
    const res = await editTodoForUser({ supabase: client, key: KEY }, T1, { text: "새 글" });
    expect(res).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("deleteTodoForUser", () => {
  it("내 할 일을 지우고, 그 작업 기록도 함께 지워진다", async () => {
    const store = setup();
    todoRow(store, T1, "글");
    store.seed("todo_notes", { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", user_id: ME, todo_id: T1, day: "2026-11-07", note_encrypted: "x" });
    const client = fakeTablesClient(store, { sub: ME });
    expect(await deleteTodoForUser({ supabase: client }, T1)).toEqual({ ok: true, data: { id: T1 } });
    expect(store.table("todos")).toHaveLength(0);
    expect(store.table("todo_notes")).toHaveLength(0);
  });
  it("남의 것은 not_found이고 남아 있다", async () => {
    const store = setup();
    store.seed("todos", { id: T2, user_id: OTHER, day: "2026-11-07", text_encrypted: "x", done: false });
    const client = fakeTablesClient(store, { sub: ME });
    expect(await deleteTodoForUser({ supabase: client }, T2)).toEqual({ ok: false, error: "not_found" });
    expect(store.table("todos")).toHaveLength(1);
    expect(await deleteTodoForUser({ supabase: client }, "x")).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("reorderTodosForUser", () => {
  it("보이는 순서대로 position 0,1,2를 매기고 같은 요청을 다시 보내도 같다", async () => {
    const store = setup();
    todoRow(store, T1, "a");
    todoRow(store, T2, "b");
    todoRow(store, T3, "c");
    const client = fakeTablesClient(store, { sub: ME });
    const order = [T3, T1, T2];
    expect(await reorderTodosForUser({ supabase: client }, order)).toEqual({ ok: true, data: { ids: order } });
    await reorderTodosForUser({ supabase: client }, order);
    const positions = Object.fromEntries(store.table("todos").map((r) => [r.id as string, r.position]));
    expect(positions).toEqual({ [T3]: 0, [T1]: 1, [T2]: 2 });
    const res = await listTodosForToday({ supabase: client, key: KEY, now: () => NOW });
    expect(res.ok && res.data.todos.map((t) => t.id)).toEqual(order);
  });
  it("중복·빈 목록·uuid 아님은 invalid_input, 남의 할 일이 끼면 not_found", async () => {
    const store = setup();
    todoRow(store, T1, "a");
    store.seed("todos", { id: T2, user_id: OTHER, day: "2026-11-07", text_encrypted: "x", done: false });
    const client = fakeTablesClient(store, { sub: ME });
    expect(await reorderTodosForUser({ supabase: client }, [T1, T1])).toEqual({ ok: false, error: "invalid_input" });
    expect(await reorderTodosForUser({ supabase: client }, [])).toEqual({ ok: false, error: "invalid_input" });
    expect(await reorderTodosForUser({ supabase: client }, ["x"])).toEqual({ ok: false, error: "invalid_input" });
    expect(await reorderTodosForUser({ supabase: client }, [T1, T2])).toEqual({ ok: false, error: "not_found" });
    expect(store.table("todos").find((r) => r.id === T2)?.position).toBeUndefined();
  });
});

describe("어제 못 끝낸 할 일 가져오기", () => {
  it("어제 못 끝낸 내 할 일만 보여 주고, 고른 것을 오늘로 복사한다(어제 것은 그대로)", async () => {
    const store = setup();
    todoRow(store, T1, "못 끝냄", { day: "2026-11-06" });
    todoRow(store, T2, "끝냄", { day: "2026-11-06", done: true });
    store.seed("categories", { id: CAT, user_id: ME, name_encrypted: encryptCategoryName("어학", ME, KEY!), archived_at: null });
    const withCat = todoRow(store, T3, "분야 있음", { day: "2026-11-06", category_id: CAT });
    const client = fakeTablesClient(store, { sub: ME });
    const deps = { supabase: client, key: KEY, now: () => NOW };
    const list = await listCarryOverCandidates(deps);
    expect(list.ok && list.data.todos.map((t) => t.id)).toEqual([T1, T3]);

    const NEW1 = "44444444-4444-4444-8444-444444444444";
    const NEW3 = "55555555-5555-4555-8555-555555555555";
    const res = await carryOverTodosForUser(deps, [
      { from: T1, id: NEW1 },
      { from: withCat.id as string, id: NEW3 },
    ]);
    expect(res.ok && res.data.todos.map((t) => [t.id, t.readable && t.text, t.categoryId])).toEqual([
      [NEW1, "못 끝냄", null],
      [NEW3, "분야 있음", CAT],
    ]);
    expect(store.table("todos").filter((r) => r.day === "2026-11-07")).toHaveLength(2);
    expect(store.table("todos").filter((r) => r.day === "2026-11-06")).toHaveLength(3);
    // 같은 요청을 다시 보내도 새로 만들지 않는다
    const again = await carryOverTodosForUser(deps, [{ from: T1, id: NEW1 }]);
    expect(again.ok).toBe(true);
    expect(store.table("todos").filter((r) => r.day === "2026-11-07")).toHaveLength(2);
  });
  it("어제 것이 아니거나 남의 것이면 not_found, 형식이 틀리면 invalid_input", async () => {
    const store = setup();
    todoRow(store, T1, "오늘 것"); // 오늘
    const client = fakeTablesClient(store, { sub: ME });
    const deps = { supabase: client, key: KEY, now: () => NOW };
    const NEW = "44444444-4444-4444-8444-444444444444";
    expect(await carryOverTodosForUser(deps, [{ from: T1, id: NEW }])).toEqual({ ok: false, error: "not_found" });
    expect(await carryOverTodosForUser(deps, [{ from: "x", id: NEW }])).toEqual({ ok: false, error: "invalid_input" });
    expect(await carryOverTodosForUser(deps, [])).toEqual({ ok: false, error: "invalid_input" });
  });
});
