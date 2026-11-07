import { describe, expect, it, vi } from "vitest";
import { readMirrorForUser } from "../../lib/mirror/core";
import { encryptCategoryName, encryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

const getDeps = vi.fn();
vi.mock("../../lib/deps", () => ({ getDeps: (...a: unknown[]) => getDeps(...a) }));

import { GET } from "../../app/mirror/route";

/** 서버 사본 받기(GET /mirror): 기기 거울이 필요로 하는 내 자료를 한 번에, 칸마다 따로 */

const KEY = parseTodoKey(Buffer.alloc(32, 3).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const NOW = new Date("2026-11-07T06:00:00.000Z"); // 서울 15:00, 두노 하루 11-07(토), 이 주의 월요일 11-02

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  store.fixedNow = NOW;
  store.seed("categories", { id: C1, user_id: ME, name_encrypted: encryptCategoryName("어학", ME, KEY!), archived_at: null });
  store.seed("category_ratios", { user_id: ME, category_id: C1, percent: 100 });
  const todo = (id: string, text: string, day: string, over: Record<string, unknown> = {}, user = ME) =>
    store.seed("todos", { id, user_id: user, day, text_encrypted: encryptTodoText(text, user, KEY!), done: false, category_id: null, position: null, ...over });
  return { store, todo };
}
const deps = (store: FakeStore, sub: string | null = ME, key = KEY) => ({ supabase: fakeTablesClient(store, { sub }), key, now: () => NOW });

describe("readMirrorForUser", () => {
  it("내 할 일(최근 8일)·분야·설정·저녁 기록·이번 주 목표·타이머 기록을 한 번에, 글은 풀어서 준다", async () => {
    const { store, todo } = setup();
    todo("t-today", "오늘 글", "2026-11-07", { category_id: C1, done: true, position: 2 });
    todo("t-yday", "어제 글", "2026-11-06");
    todo("t-old", "8일보다 오래된 글", "2026-10-29");
    todo("t-edge", "7일 전 글", "2026-10-31");
    todo("t-other", "남의 글", "2026-11-07", {}, OTHER);
    store.seed("evening_logs", { id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", user_id: ME, target_day: "2026-11-06", total_minutes: 60, items: [{ categoryId: C1, minutes: 60 }], save_mode: "edited", saved_at: "2026-11-06T13:00:00.000Z" });
    store.seed("weekly_goals", { user_id: ME, week_start: "2026-11-02", items: [{ categoryId: C1, minutes: 120 }] });
    store.seed("focus_sessions", { id: "51515151-5151-4151-8151-515151515151", user_id: ME, started_at: "2026-11-07T05:00:00.000Z", client_started_at: "2026-11-07T04:59:00.000Z", day: "2026-11-07", planned_minutes: 30, ended_at: "2026-11-07T05:10:00.000Z", elapsed_seconds: 600, todo_id: null, category_id: C1, offer_id: null, surface: "manual", opposite_by_goal: null, opposite_by_ratio: true });
    const res = await readMirrorForUser(deps(store));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const m = res.data;
    expect(m.serverNow).toBe(NOW.toISOString());
    expect(m.todos?.map((t) => t.id)).toEqual(["t-edge", "t-yday", "t-today"]); // 날짜 오름차순, 8일 안·내 것만
    expect(m.todos?.find((t) => t.id === "t-today")).toMatchObject({ text: "오늘 글", done: true, categoryId: C1, position: 2, day: "2026-11-07" });
    expect(m.categories).toEqual([expect.objectContaining({ id: C1, readable: true, name: "어학" })]);
    expect(m.settings?.ratios).toEqual([{ categoryId: C1, percent: 100 }]);
    expect(m.logs).toEqual([expect.objectContaining({ targetDay: "2026-11-06", totalMinutes: 60 })]);
    expect(m.goal).toEqual({ weekStart: "2026-11-02", items: [{ categoryId: C1, minutes: 120 }] });
    expect(m.sessions).toEqual([expect.objectContaining({ id: "51515151-5151-4151-8151-515151515151", day: "2026-11-07", elapsedSeconds: 600 })]);
  });
  it("목표가 없는 주는 goal.items가 null, 풀 수 없는 글은 text null로 싣는다", async () => {
    const { store } = setup();
    store.seed("todos", { id: "t-bad", user_id: ME, day: "2026-11-07", text_encrypted: "v1:AAAAAAAAAAAAAAAA:AAAA:AAAAAAAAAAAAAAAAAAAAAA", done: false, category_id: null });
    const res = await readMirrorForUser(deps(store));
    expect(res.ok && res.data.goal).toEqual({ weekStart: "2026-11-02", items: null });
    expect(res.ok && res.data.todos?.[0]).toMatchObject({ id: "t-bad", text: null });
  });
  it("한 칸이 실패해도 나머지는 주고 그 칸만 null(기기가 옛 값을 둔다)", async () => {
    const { store, todo } = setup();
    todo("t1", "글", "2026-11-07");
    const client = fakeTablesClient(store, { sub: ME });
    const failing = new Proxy(client, {
      get(target, prop, receiver) {
        if (prop !== "from") return Reflect.get(target, prop, receiver);
        return (table: string) => {
          if (table === "evening_logs") throw new Error("boom");
          return target.from(table);
        };
      },
    });
    const res = await readMirrorForUser({ supabase: failing as never, key: KEY, now: () => NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.logs).toBeNull();
    expect(res.data.todos?.map((t) => t.id)).toEqual(["t1"]);
  });
  it("로그인이 없으면 통째로 unauthenticated, 키가 없으면 config, DB 오류는 칸이 null(통째로 실패하지 않는다)", async () => {
    const { store } = setup();
    expect(await readMirrorForUser(deps(store, null))).toEqual({ ok: false, error: "unauthenticated" });
    expect(await readMirrorForUser(deps(store, ME, null))).toEqual({ ok: false, error: "config" });
    store.alwaysError = { code: "XX000", message: "secret" };
    const res = await readMirrorForUser(deps(store));
    expect(res.ok && [res.data.todos, res.data.logs, res.data.sessions, res.data.settings]).toEqual([null, null, null, null]);
    expect(JSON.stringify(res)).not.toContain("secret");
  });
});

describe("GET /mirror", () => {
  it("정상: 200, private no-store, 몸은 { ok: true, data }. 받는 인자 없음", async () => {
    const { store, todo } = setup();
    todo("t1", "글", "2026-11-07");
    getDeps.mockResolvedValue(deps(store));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.todos).toHaveLength(1);
  });
  it("세션이 없으면 401, 서버 설정이 없으면 500, 예외는 503(원문 없음)", async () => {
    const { store } = setup();
    getDeps.mockResolvedValue(deps(store, null));
    expect((await GET()).status).toBe(401);
    getDeps.mockResolvedValue(null);
    expect((await GET()).status).toBe(500);
    getDeps.mockRejectedValue(new Error("boom secret"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });
});
