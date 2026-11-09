import { describe, expect, it } from "vitest";
import { deriveToday, todoHasNotes } from "../../lib/local/derive";
import { emptyMirror } from "../../lib/local/reduce";
import type { MirrorTodo } from "../../lib/local/types";
import { listTodosForToday, listTodosWindow } from "../../lib/todos/core";
import { encryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/**
 * 고침9 PM 2-B: 할 일 줄 작업 기록 아이콘의 데이터 길.
 * 서버는 오늘 목록·기기 거울을 읽을 때 작업 기록이 있는 내 할 일에만 hasNotes: true를 싣는다(글은 읽지 않음, 새 입구 없음).
 * 기기는 그 할 일의 기록 목록을 알면 그것으로, 모르면 서버 표시로 정한다.
 */

const KEY = parseTodoKey(Buffer.alloc(32, 9).toString("base64"))!;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-07T03:00:00.000Z"); // 두노 하루 2026-11-07
const DAY = "2026-11-07";

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  const seedTodo = (id: string, user = ME) =>
    store.seed("todos", { id, user_id: user, day: DAY, text_encrypted: encryptTodoText("글", user, KEY), done: false, category_id: null });
  const seedNote = (id: string, todoId: string, user = ME) =>
    store.seed("todo_notes", { id, user_id: user, todo_id: todoId, day: DAY, note_encrypted: "x" });
  return { store, seedTodo, seedNote };
}

describe("서버: 오늘 목록·기기 거울의 hasNotes", () => {
  it("작업 기록이 있는 내 할 일에만 hasNotes: true, 없는 할 일은 싣지 않는다", async () => {
    const { store, seedTodo, seedNote } = setup();
    seedTodo(T1);
    seedTodo(T2);
    seedNote("aaaa1111-1111-4111-8111-111111111111", T1);
    seedNote("aaaa2222-2222-4222-8222-222222222222", T1);
    const deps = { supabase: fakeTablesClient(store, { sub: ME }), key: KEY, now: () => NOW };
    const res = await listTodosForToday(deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.todos).toHaveLength(2);
    const byId = new Map(res.data.todos.map((t) => [t.id, t]));
    expect(byId.get(T1)?.hasNotes).toBe(true);
    expect(byId.get(T2)).not.toHaveProperty("hasNotes");

    const window = await listTodosWindow(deps, "2026-11-01", DAY);
    expect(window.ok).toBe(true);
    if (!window.ok) return;
    expect(window.data.map((t) => [t.id, t.hasNotes === true])).toEqual([
      [T1, true],
      [T2, false],
    ]);
  });

  it("악용: 남이 내 할 일 번호로 남긴 기록(남의 행)은 내 아이콘을 켜지 않는다 — 내 기록만 읽는다", async () => {
    const { store, seedTodo, seedNote } = setup();
    seedTodo(T1);
    seedTodo(T3, OTHER);
    seedNote("aaaa3333-3333-4333-8333-333333333333", T1, OTHER);
    seedNote("aaaa4444-4444-4444-8444-444444444444", T3, OTHER);
    const res = await listTodosForToday({ supabase: fakeTablesClient(store, { sub: ME }), key: KEY, now: () => NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.todos.map((t) => t.id)).toEqual([T1]);
    expect(res.data.todos[0]).not.toHaveProperty("hasNotes");
  });

  it("작업 기록을 못 읽어도(표 오류) 목록 읽기는 성공하고 아이콘만 없다", async () => {
    const { store, seedTodo, seedNote } = setup();
    seedTodo(T1);
    seedNote("aaaa1111-1111-4111-8111-111111111111", T1);
    const client = fakeTablesClient(store, { sub: ME });
    const from = client.from.bind(client);
    // todo_notes 읽기만 실패시킨다
    (client as { from: (t: string) => unknown }).from = (table: string) => {
      if (table !== "todo_notes") return from(table);
      return {
        select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { code: "08006", message: "down" } }) }) }),
      };
    };
    const res = await listTodosForToday({ supabase: client, key: KEY, now: () => NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.todos.map((t) => t.id)).toEqual([T1]);
    expect(res.data.todos[0]).not.toHaveProperty("hasNotes");
  });
});

describe("기기: todoHasNotes · deriveToday", () => {
  const todo = (id: string, hasNotes?: boolean): MirrorTodo => ({
    id,
    day: DAY,
    text: "글",
    done: false,
    createdAt: "2026-11-07T01:00:00.000Z",
    categoryId: null,
    position: null,
    ...(hasNotes === undefined ? {} : { hasNotes }),
  });

  it("기록 목록을 알면 그것이 이기고, 모르면 서버 표시", () => {
    const m = { ...emptyMirror(), synced: true };
    expect(todoHasNotes(m, todo(T1, true))).toBe(true);
    expect(todoHasNotes(m, todo(T1))).toBe(false);
    const known = { ...m, notes: { [T1]: [] } };
    expect(todoHasNotes(known, todo(T1, true))).toBe(false); // 이 기기에서 다 지움
    const added = { ...m, notes: { [T1]: [{ id: "n", todoId: T1, day: DAY, createdAt: "x", readable: true as const, text: "기록" }] } };
    expect(todoHasNotes(added, todo(T1, false))).toBe(true); // 이 기기에서 새로 남김
  });

  it("오늘 화면의 할 일에 hasNotes를 싣는다(있는 것만)", () => {
    const m = { ...emptyMirror(), synced: true, todos: [todo(T1, true), todo(T2)] };
    const today = deriveToday(m, NOW.getTime());
    expect(today.todos.ok).toBe(true);
    if (!today.todos.ok) return;
    expect(today.todos.data.todos.map((t) => [t.id, t.hasNotes === true])).toEqual([
      [T1, true],
      [T2, false],
    ]);
  });
});
