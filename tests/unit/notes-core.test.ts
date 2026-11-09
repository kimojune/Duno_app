import { describe, expect, it } from "vitest";
import { addNoteForUser, CATEGORY_PAGE_TODO_LIMIT, checkNoteText, deleteNoteForUser, listNotesForTodo, NOTE_MAX_LENGTH, readCategoryPage } from "../../lib/notes/core";
import { decryptTodoText, encryptCategoryName, encryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

const KEY = parseTodoKey(Buffer.alloc(32, 9).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const N1 = "aaaa1111-1111-4111-8111-111111111111";
const N2 = "aaaa2222-2222-4222-8222-222222222222";
const CAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-11-07T03:00:00.000Z");

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  store.seed("categories", { id: CAT, user_id: ME, name_encrypted: encryptCategoryName("어학", ME, KEY!), archived_at: null });
  const seedTodo = (id: string, text: string, day: string, categoryId: string | null, user = ME, done = false) =>
    store.seed("todos", { id, user_id: user, day, text_encrypted: encryptTodoText(text, user, KEY!), done, category_id: categoryId });
  return { store, seedTodo };
}

describe("checkNoteText", () => {
  it("앞뒤 공백을 지우고, 빈 글·긴 글·문자열 아님을 가린다. 줄바꿈은 둔다", () => {
    expect(checkNoteText("  첫 줄\n둘째 줄  ")).toEqual({ ok: true, text: "첫 줄\n둘째 줄" });
    expect(checkNoteText("   ")).toEqual({ ok: false, error: "empty" });
    expect(checkNoteText(3)).toEqual({ ok: false, error: "invalid_input" });
    expect(checkNoteText("가".repeat(NOTE_MAX_LENGTH))).toEqual({ ok: true, text: "가".repeat(NOTE_MAX_LENGTH) });
    expect(checkNoteText("가".repeat(NOTE_MAX_LENGTH + 1))).toEqual({ ok: false, error: "too_long" });
  });
});

describe("작업 기록 상한 글 왕복(A1)", () => {
  it("「가」×2000(상한)을 저장하고 다시 읽으면 읽을 수 있는 글로 돌아온다", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T1, "이력서", "2026-11-07", CAT);
    const client = fakeTablesClient(store, { sub: ME });
    const deps = { supabase: client, key: KEY, now: () => NOW };
    const big = "가".repeat(NOTE_MAX_LENGTH);
    const added = await addNoteForUser(deps, N1, T1, big);
    expect(added.ok && added.data.note.readable).toBe(true);
    // 저장된 암호문은 예전 풀기 상한(4096자)을 넘지만, DB 상한(16000자) 안이다
    const stored = String(store.table("todo_notes")[0].note_encrypted);
    expect(stored.length).toBeGreaterThan(4096);
    expect(stored.length).toBeLessThanOrEqual(16000);
    const listed = await listNotesForTodo(deps, T1);
    expect(listed.ok && listed.data.notes[0]).toMatchObject({ readable: true, text: big });
  });
  it("😀×2000(가장 긴 바이트)도 DB 상한 16000자 안이고 읽힌다", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T1, "이력서", "2026-11-07", CAT);
    const client = fakeTablesClient(store, { sub: ME });
    const deps = { supabase: client, key: KEY, now: () => NOW };
    const big = "😀".repeat(NOTE_MAX_LENGTH);
    await addNoteForUser(deps, N1, T1, big);
    expect(String(store.table("todo_notes")[0].note_encrypted).length).toBeLessThanOrEqual(16000);
    const listed = await listNotesForTodo(deps, T1);
    expect(listed.ok && listed.data.notes[0]).toMatchObject({ readable: true, text: big });
  });
});

describe("addNoteForUser", () => {
  it("암호화해 저장하고, 서버 하루를 붙이고, 평문을 DB에 보내지 않는다", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T1, "이력서", "2026-11-07", CAT);
    const client = fakeTablesClient(store, { sub: ME });
    const res = await addNoteForUser({ supabase: client, key: KEY, now: () => NOW }, N1, T1, "  오늘은 경력 항목을 고쳤다  ");
    expect(res.ok && res.data.note.readable && res.data.note.text).toBe("오늘은 경력 항목을 고쳤다");
    expect(res.ok && res.data.note.day).toBe("2026-11-07");
    const stored = store.table("todo_notes")[0];
    expect(String(stored.note_encrypted)).toMatch(/^v1:/);
    expect(JSON.stringify(store.calls)).not.toContain("경력 항목");
    expect(decryptTodoText(stored.note_encrypted, ME, KEY!, "todo_note")).toEqual({ ok: true, text: "오늘은 경력 항목을 고쳤다" });
    // 할 일 글 AAD로는 풀리지 않는다(용도가 다르다)
    expect(decryptTodoText(stored.note_encrypted, ME, KEY!).ok).toBe(false);
  });
  it("같은 id를 다시 보내도 한 행만 있다(재시도)", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T1, "이력서", "2026-11-07", CAT);
    const client = fakeTablesClient(store, { sub: ME });
    const deps = { supabase: client, key: KEY, now: () => NOW };
    await addNoteForUser(deps, N1, T1, "처음 글");
    const again = await addNoteForUser(deps, N1, T1, "다시 보낸 글");
    expect(again.ok && again.data.note.id).toBe(N1);
    expect(store.table("todo_notes")).toHaveLength(1);
  });
  it("없는 할 일·남의 할 일은 not_found, 형식 오류·빈 글은 DB를 부르지 않는다", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T2, "남의 할 일", "2026-11-07", null, OTHER);
    const client = fakeTablesClient(store, { sub: ME });
    const deps = { supabase: client, key: KEY, now: () => NOW };
    expect(await addNoteForUser(deps, N1, T3, "글")).toEqual({ ok: false, error: "not_found" });
    expect(await addNoteForUser(deps, N1, T2, "글")).toEqual({ ok: false, error: "not_found" });
    const before = store.calls.length;
    expect(await addNoteForUser(deps, "x", T1, "글")).toEqual({ ok: false, error: "invalid_input" });
    expect(await addNoteForUser(deps, N1, T1, " ")).toEqual({ ok: false, error: "empty" });
    expect(store.calls.length).toBe(before);
  });
  it("로그인이 없으면 unauthenticated, 키가 없으면 config", async () => {
    const { store } = setup();
    expect(await addNoteForUser({ supabase: fakeTablesClient(store, { sub: null }), key: KEY }, N1, T1, "글")).toEqual({ ok: false, error: "unauthenticated" });
    expect(await addNoteForUser({ supabase: fakeTablesClient(store, { sub: ME }), key: null }, N1, T1, "글")).toEqual({ ok: false, error: "config" });
  });
});

describe("listNotesForTodo · deleteNoteForUser", () => {
  it("그 할 일의 내 작업 기록만, 오래된 것이 위", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T1, "이력서", "2026-11-07", CAT);
    seedTodo(T3, "다른 할 일", "2026-11-07", CAT);
    const client = fakeTablesClient(store, { sub: ME });
    const deps = { supabase: client, key: KEY, now: () => NOW };
    await addNoteForUser(deps, N1, T1, "첫 기록");
    await addNoteForUser(deps, N2, T1, "둘째 기록");
    await addNoteForUser(deps, "aaaa3333-3333-4333-8333-333333333333", T3, "다른 기록");
    const res = await listNotesForTodo(deps, T1);
    expect(res.ok && res.data.notes.map((n) => n.readable && n.text)).toEqual(["첫 기록", "둘째 기록"]);
    expect(await listNotesForTodo(deps, "x")).toEqual({ ok: false, error: "invalid_input" });
  });
  it("지우기: 내 것은 지워지고, 남의 것·없는 것은 not_found", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T1, "이력서", "2026-11-07", CAT);
    store.seed("todo_notes", { id: N2, user_id: OTHER, todo_id: T1, day: "2026-11-07", note_encrypted: "x" });
    const client = fakeTablesClient(store, { sub: ME });
    const deps = { supabase: client, key: KEY, now: () => NOW };
    await addNoteForUser(deps, N1, T1, "지울 기록");
    expect(await deleteNoteForUser(deps, N1)).toEqual({ ok: true, data: { id: N1 } });
    expect(await deleteNoteForUser(deps, N1)).toEqual({ ok: false, error: "not_found" });
    expect(await deleteNoteForUser(deps, N2)).toEqual({ ok: false, error: "not_found" });
    expect(store.table("todo_notes")).toHaveLength(1);
  });
  it("풀 수 없는 글은 그 줄만 readable=false", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T1, "이력서", "2026-11-07", CAT);
    store.seed("todo_notes", { id: N1, user_id: ME, todo_id: T1, day: "2026-11-07", note_encrypted: "깨진 값" });
    const client = fakeTablesClient(store, { sub: ME });
    const res = await listNotesForTodo({ supabase: client, key: KEY }, T1);
    expect(res.ok && res.data.notes[0]).toMatchObject({ readable: false, text: null });
  });
});

describe("readCategoryPage (분야 페이지)", () => {
  it("그 분야의 할 일을 날짜별(최근이 위)로 모으고 작업 기록을 붙인다. 다른 분야·남의 것은 없다", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T1, "단어 외우기", "2026-11-06", CAT, ME, true);
    seedTodo(T2, "듣기 연습", "2026-11-07", CAT);
    seedTodo(T3, "분야 없는 일", "2026-11-07", null);
    seedTodo("44444444-4444-4444-8444-444444444444", "남의 어학", "2026-11-07", null, OTHER);
    const client = fakeTablesClient(store, { sub: ME });
    const deps = { supabase: client, key: KEY, now: () => NOW };
    await addNoteForUser(deps, N1, T1, "단어 50개 외웠다");
    const page = await readCategoryPage(deps, CAT);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.data.categoryId).toBe(CAT);
    expect(page.data.days.map((d) => d.day)).toEqual(["2026-11-07", "2026-11-06"]);
    expect(page.data.days[1].todos[0]).toMatchObject({ id: T1, text: "단어 외우기", done: true });
    expect(page.data.days[1].todos[0].notes.map((n) => n.readable && n.text)).toEqual(["단어 50개 외웠다"]);
    expect(page.data.days[0].todos.map((t) => t.id)).toEqual([T2]);
  });
  it("categoryId가 null이면 기타(분야 없는 내 할 일)", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T1, "분야 있는 일", "2026-11-07", CAT);
    seedTodo(T3, "분야 없는 일", "2026-11-07", null);
    seedTodo("44444444-4444-4444-8444-444444444444", "남의 분야 없는 일", "2026-11-07", null, OTHER);
    const client = fakeTablesClient(store, { sub: ME });
    const page = await readCategoryPage({ supabase: client, key: KEY }, null);
    expect(page.ok && page.data.days.flatMap((d) => d.todos.map((t) => t.id))).toEqual([T3]);
  });
  it("분야 번호가 uuid가 아니면 invalid_input", async () => {
    const { store } = setup();
    const client = fakeTablesClient(store, { sub: ME });
    expect(await readCategoryPage({ supabase: client, key: KEY }, "x")).toEqual({ ok: false, error: "invalid_input" });
    expect(await readCategoryPage({ supabase: client, key: KEY }, undefined)).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("readCategoryPage 날짜별 시간(고침8): 오늘 기록을 세션 user id로만 읽는다", () => {
  const OCAT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const seedLog = (store: FakeStore, user: string, targetDay: string, savedAt: string, items: { categoryId: string | null; minutes: number }[]) =>
    store.seed("evening_logs", { user_id: user, target_day: targetDay, total_minutes: items.reduce((s, i) => s + i.minutes, 0), items, save_mode: "edited", saved_at: savedAt, client_saved_at: null });

  it("정상: 그날 가장 늦은 기록의 이 분야 분, 시간만 있는 날도 날짜에 든다(최근 날 먼저)", async () => {
    const { store, seedTodo } = setup();
    seedTodo(T1, "단어", "2026-11-06", CAT);
    seedTodo(T2, "듣기", "2026-11-04", CAT);
    seedLog(store, ME, "2026-11-06", "2026-11-06T10:00:00.000Z", [{ categoryId: CAT, minutes: 30 }]);
    seedLog(store, ME, "2026-11-06", "2026-11-06T13:00:00.000Z", [{ categoryId: CAT, minutes: 90 }, { categoryId: null, minutes: 20 }]);
    seedLog(store, ME, "2026-11-05", "2026-11-05T13:00:00.000Z", [{ categoryId: CAT, minutes: 45 }]);
    const client = fakeTablesClient(store, { sub: ME });
    const page = await readCategoryPage({ supabase: client, key: KEY }, CAT);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.data.days.map((d) => [d.day, d.minutes, d.todos.map((t) => t.id)])).toEqual([
      ["2026-11-06", 90, [T1]],
      ["2026-11-05", 45, []],
      ["2026-11-04", 0, [T2]],
    ]);
    // 기타 페이지는 categoryId null의 분
    const other = await readCategoryPage({ supabase: client, key: KEY }, null);
    expect(other.ok && other.data.days.map((d) => [d.day, d.minutes])).toEqual([["2026-11-06", 20]]);
  });

  it("남의 오늘 기록 행은 RLS가 꺼져 있어도(앱 필터만으로) minutes에 섞이지 않고, 쿼리는 세션 user id로 거른다", async () => {
    const { store, seedTodo } = setup();
    store.rules.evening_logs = { ...store.rules.evening_logs, noUser: true }; // RLS 없이 앱 코드 필터만 남긴 상태
    seedTodo(T1, "단어", "2026-11-06", CAT);
    seedLog(store, ME, "2026-11-06", "2026-11-06T10:00:00.000Z", [{ categoryId: CAT, minutes: 30 }]);
    // 남의 기록: 같은 날 더 늦게 저장(가장 늦은 것을 빼앗으면 안 된다) + 내 분야 번호를 적은 행 + 다른 날
    seedLog(store, OTHER, "2026-11-06", "2026-11-06T23:00:00.000Z", [{ categoryId: CAT, minutes: 600 }]);
    seedLog(store, OTHER, "2026-11-03", "2026-11-03T23:00:00.000Z", [{ categoryId: CAT, minutes: 300 }]);
    const client = fakeTablesClient(store, { sub: ME });
    const page = await readCategoryPage({ supabase: client, key: KEY }, CAT);
    expect(page.ok && page.data.days.map((d) => [d.day, d.minutes])).toEqual([["2026-11-06", 30]]);
    const logCalls = store.calls.filter((c) => c.table === "evening_logs" && c.op === "select");
    expect(logCalls.length).toBe(1);
    expect(logCalls[0].filters).toContainEqual(["eq", "user_id", ME]);
    expect(logCalls[0].filters.some(([op, col, val]) => col === "user_id" && (op !== "eq" || val !== ME))).toBe(false);
  });

  it("남의 분야 번호: 지금과 같이 빈 결과(할 일 없음, 남의 기록 분 없음). 세션이 없으면 읽지 않는다", async () => {
    const { store, seedTodo } = setup();
    store.rules.evening_logs = { ...store.rules.evening_logs, noUser: true };
    store.seed("categories", { id: OCAT, user_id: OTHER, name_encrypted: encryptCategoryName("남의 분야", OTHER, KEY!), archived_at: null });
    seedTodo("55555555-5555-4555-8555-555555555555", "남의 할 일", "2026-11-06", OCAT, OTHER);
    seedLog(store, OTHER, "2026-11-06", "2026-11-06T23:00:00.000Z", [{ categoryId: OCAT, minutes: 240 }]);
    seedLog(store, ME, "2026-11-06", "2026-11-06T10:00:00.000Z", [{ categoryId: CAT, minutes: 30 }]);
    const page = await readCategoryPage({ supabase: fakeTablesClient(store, { sub: ME }), key: KEY }, OCAT);
    expect(page).toEqual({ ok: true, data: { categoryId: OCAT, days: [] } });
    const before = store.calls.length;
    const anon = await readCategoryPage({ supabase: fakeTablesClient(store, { sub: null }), key: KEY }, CAT);
    expect(anon.ok).toBe(false);
    expect(store.calls.slice(before).some((c) => c.table === "evening_logs")).toBe(false);
  });

  it("범위: 할 일을 상한(500)까지 읽으면 그 가장 오래된 날 앞의 기록은 읽지 않는다(gte 필터), 상한 밑이면 날짜 필터 없음", async () => {
    const { store, seedTodo } = setup();
    for (let i = 0; i < CATEGORY_PAGE_TODO_LIMIT; i += 1) seedTodo(`${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`, `일 ${i}`, "2026-11-06", CAT);
    seedLog(store, ME, "2026-11-06", "2026-11-06T10:00:00.000Z", [{ categoryId: CAT, minutes: 30 }]);
    seedLog(store, ME, "2026-11-01", "2026-11-01T10:00:00.000Z", [{ categoryId: CAT, minutes: 50 }]);
    const page = await readCategoryPage({ supabase: fakeTablesClient(store, { sub: ME }), key: KEY }, CAT);
    expect(page.ok && page.data.days.map((d) => [d.day, d.minutes])).toEqual([["2026-11-06", 30]]);
    const logCall = store.calls.filter((c) => c.table === "evening_logs").at(-1)!;
    expect(logCall.filters).toContainEqual(["gte", "target_day", "2026-11-06"]);

    const small = setup();
    small.seedTodo(T1, "단어", "2026-11-06", CAT);
    seedLog(small.store, ME, "2026-11-01", "2026-11-01T10:00:00.000Z", [{ categoryId: CAT, minutes: 50 }]);
    const page2 = await readCategoryPage({ supabase: fakeTablesClient(small.store, { sub: ME }), key: KEY }, CAT);
    expect(page2.ok && page2.data.days.map((d) => [d.day, d.minutes])).toEqual([["2026-11-06", 0], ["2026-11-01", 50]]);
    expect(small.store.calls.filter((c) => c.table === "evening_logs").at(-1)!.filters.some(([op]) => op === "gte")).toBe(false);
  });
});
