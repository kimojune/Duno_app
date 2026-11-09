import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDemoPlan,
  DEMO_CATEGORIES,
  DEMO_GOAL_TEXT,
  DEMO_RATIO_OTHER,
  DEMO_RATIOS,
  DEMO_SPAN_DAYS,
  DemoSeedError,
  demoUuid,
  seedDemoData,
} from "../../lib/demo/seed";
import { decryptCategoryName, decryptTodoText, parseTodoKey, type TodoKey } from "../../lib/todos/crypto";
import { addDays } from "../../lib/week";
import { FakeStore, fakeTablesClient, v2Rules, type Row } from "./fake-tables";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-11-09"; // 월요일
const CIPHER = /^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$/;

function newStore(): FakeStore {
  const store = new FakeStore();
  store.rules = v2Rules();
  // 마이그레이션의 insert grant(분야·할 일)를 시험 규칙에 더한다: 이 열 밖을 보내면 42501
  store.rules.categories = { insertColumns: ["id", "user_id", "name_encrypted"], fks: [], limit: { count: 50, hint: "categories_limit" } };
  store.rules.todos = { ...store.rules.todos, insertColumns: ["id", "user_id", "day", "text_encrypted", "done", "category_id"] };
  return store;
}

let key: TodoKey;
let store: FakeStore;
const fixedNow = () => new Date("2026-11-09T03:00:00.000Z");

beforeEach(() => {
  key = parseTodoKey(randomBytes(32).toString("base64"))!;
  store = newStore();
});

async function seed(s = store, user = USER) {
  return seedDemoData({ supabase: fakeTablesClient(s, { sub: user }), userId: user, key, today: TODAY, now: fixedNow });
}

describe("예시 데이터 모양", () => {
  it("지난 3주(오늘 포함 21일) — 날짜마다 할 일 2~4개, 지난날마다 오늘 기록 하나", async () => {
    const counts = await seed();
    const todos = store.table("todos");
    expect(todos.length).toBeGreaterThan(0);
    const days = [...new Set(todos.map((t) => t.day as string))].sort();
    expect(days[0]).toBe(addDays(TODAY, -DEMO_SPAN_DAYS));
    expect(days[days.length - 1]).toBe(TODAY);
    expect(days.length).toBe(DEMO_SPAN_DAYS + 1);
    expect(DEMO_SPAN_DAYS + 1).toBeGreaterThanOrEqual(14); // 2주 이상
    expect(DEMO_SPAN_DAYS + 1).toBeLessThanOrEqual(21); // 3주 이하
    for (const day of days) {
      const n = todos.filter((t) => t.day === day).length;
      expect(n, day).toBeGreaterThanOrEqual(2);
      expect(n, day).toBeLessThanOrEqual(4);
    }
    // 끝냄이 섞였다(둘 다 있다)
    expect(todos.some((t) => t.done === true)).toBe(true);
    expect(todos.some((t) => t.done === false)).toBe(true);
    // 오늘 할 일에 아직 안 끝낸 것이 있다(시연에서 할 일 탭이 비지 않게)
    expect(todos.some((t) => t.day === TODAY && t.done === false)).toBe(true);

    const logs = store.table("evening_logs");
    expect(logs.map((l) => l.target_day).sort()).toEqual(days.filter((d) => d !== TODAY));
    expect(counts).toMatchObject({ categories: 4, todos: todos.length, eveningLogs: logs.length, ratios: 4, ratioHistory: 1, weeklyGoals: 1, settings: 1 });
  });

  it("오늘 기록: 항목 합 = total, 항목마다 1분 이상, 분야 중복 없음, 기타(null)가 어디엔가 있다, 분야 번호는 내 분야", async () => {
    await seed();
    const logs = store.table("evening_logs");
    const myCategories = new Set(store.table("categories").map((c) => c.id));
    expect(logs.length).toBeGreaterThan(0);
    let sawOther = false;
    for (const log of logs) {
      const items = log.items as { categoryId: string | null; minutes: number }[];
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.reduce((s, i) => s + i.minutes, 0)).toBe(log.total_minutes);
      expect(log.total_minutes as number).toBeGreaterThan(0);
      expect(log.total_minutes as number).toBeLessThanOrEqual(1440);
      expect(new Set(items.map((i) => i.categoryId)).size).toBe(items.length);
      for (const i of items) {
        expect(i.minutes).toBeGreaterThanOrEqual(1);
        if (i.categoryId === null) sawOther = true;
        else expect(myCategories.has(i.categoryId)).toBe(true);
      }
      expect(log.save_mode).toBe("edited");
    }
    expect(sawOther).toBe(true);
  });

  it("목표 비율: 분야 몫 + 기타 몫 = 100, 비율 기록 한 줄도 합 100(기타 포함)", async () => {
    await seed();
    const ratios = store.table("category_ratios");
    expect(ratios.length).toBe(DEMO_CATEGORIES.length);
    const settings = store.table("user_settings")[0];
    expect(settings.ratio_other_percent).toBe(DEMO_RATIO_OTHER);
    expect(ratios.reduce((s, r) => s + (r.percent as number), 0) + (settings.ratio_other_percent as number)).toBe(100);
    const history = store.table("category_ratio_history");
    expect(history.length).toBe(1);
    const items = history[0].ratios as { category_id: string | null; percent: number }[];
    expect(items.reduce((s, i) => s + i.percent, 0)).toBe(100);
    expect(items.some((i) => i.category_id === null && i.percent === DEMO_RATIO_OTHER)).toBe(true);
    expect(DEMO_RATIOS.every((p) => p % 5 === 0)).toBe(true);
  });

  it("이번 주 목표: 이번 주 월요일, 분야마다 1시간 단위", async () => {
    await seed();
    const goals = store.table("weekly_goals");
    expect(goals.length).toBe(1);
    expect(goals[0].week_start).toBe("2026-11-09");
    const items = goals[0].items as { categoryId: string; minutes: number }[];
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.minutes % 60).toBe(0);
      expect(i.minutes).toBeGreaterThanOrEqual(60);
    }
  });

  it("분야는 만든 순서(created_at 오름차순)가 목록 순서와 같다", async () => {
    await seed();
    const cats = [...store.table("categories")].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    expect(cats.map((c) => decryptCategoryName(c.name_encrypted, USER, key))).toEqual(DEMO_CATEGORIES.map((name) => ({ ok: true, text: name })));
  });

  it("모든 행의 user_id = 그 사용자, 글은 암호문이고 같은 키·같은 AAD로 풀린다(다른 사용자 id로는 안 풀림)", async () => {
    await seed();
    const tables = ["categories", "todos", "evening_logs", "category_ratios", "category_ratio_history", "weekly_goals", "user_settings"];
    let total = 0;
    for (const t of tables) {
      const rows = store.table(t);
      expect(rows.length, t).toBeGreaterThan(0);
      for (const r of rows) expect(r.user_id, t).toBe(USER);
      total += rows.length;
    }
    expect(total).toBeGreaterThan(60);

    for (const todo of store.table("todos")) {
      expect(todo.text_encrypted).toMatch(CIPHER);
      const opened = decryptTodoText(todo.text_encrypted, USER, key);
      expect(opened.ok).toBe(true);
      expect((opened as { text: string }).text.length).toBeGreaterThan(1);
      expect(decryptTodoText(todo.text_encrypted, OTHER, key).ok).toBe(false);
    }
    const settings = store.table("user_settings")[0];
    expect(settings.goal_encrypted).toMatch(CIPHER);
    expect(decryptTodoText(settings.goal_encrypted, USER, key, "goal_text")).toEqual({ ok: true, text: DEMO_GOAL_TEXT });
    // 할 일 글 용도로는 안 풀린다(용도가 다른 AAD)
    expect(decryptTodoText(settings.goal_encrypted, USER, key).ok).toBe(false);
  });

  it("처음 설정 끝 표시가 들어간다(서버 시계), 이미 끝났으면 그 시각을 바꾸지 않는다", async () => {
    await seed();
    expect(store.table("user_settings")[0].onboarding_done_at).toBe(fixedNow().toISOString());

    const again = newStore();
    again.seed("user_settings", { user_id: USER, onboarding_done_at: "2026-10-01T00:00:00.000Z", goal_encrypted: null, ratio_other_percent: null });
    await seed(again);
    expect(again.table("user_settings")[0].onboarding_done_at).toBe("2026-10-01T00:00:00.000Z");
  });

  it("계획은 결정적이다: 같은 (사용자, 오늘)이면 같은 id, 다른 사용자면 다른 id", () => {
    const a = buildDemoPlan(USER, TODAY);
    const b = buildDemoPlan(USER, TODAY);
    const c = buildDemoPlan(OTHER, TODAY);
    expect(a.todos.map((t) => t.id)).toEqual(b.todos.map((t) => t.id));
    expect(a.todos.map((t) => t.id).some((id) => c.todos.some((t) => t.id === id))).toBe(false);
    expect(demoUuid(USER, "x", 1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("다시 넣어도 중복 없음", () => {
  it("두 번 넣으면 두 번째는 새 행이 0이고 표마다 행 수가 같다", async () => {
    const first = await seed();
    const sizes = Object.fromEntries(Object.keys(store.tables).map((t) => [t, store.table(t).length]));
    expect(first.todos).toBeGreaterThan(0);
    const second = await seed();
    expect(second.categories).toBe(0);
    expect(second.todos).toBe(0);
    expect(second.eveningLogs).toBe(0);
    expect(second.ratioHistory).toBe(0); // 직전과 같은 묶음이라 안 씀
    for (const [t, n] of Object.entries(sizes)) expect(store.table(t).length, t).toBe(n);
  });

  it("중간에 실패하면 DemoSeedError(단계 이름) · 처음 설정 끝 표시는 남지 않고 · 다시 돌리면 빠진 것만 채운다", async () => {
    store.rules.evening_logs = { ...store.rules.evening_logs, limit: { count: 0, hint: "evening_logs_limit" } };
    const error = await seed().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoSeedError);
    expect((error as DemoSeedError).step).toBe("evening_logs");
    expect((error as DemoSeedError).code).toBe("P0001");
    expect(store.table("user_settings").length).toBe(0);
    const todosAfterFail = store.table("todos").length;
    expect(todosAfterFail).toBeGreaterThan(0);

    store.rules.evening_logs = v2Rules().evening_logs;
    const retry = await seed();
    expect(retry.todos).toBe(0); // 이미 들어간 할 일은 건너뜀
    expect(store.table("todos").length).toBe(todosAfterFail);
    expect(retry.eveningLogs).toBe(DEMO_SPAN_DAYS);
    expect(store.table("user_settings")[0].onboarding_done_at).toBe(fixedNow().toISOString());
  });

  it("보내는 열은 마이그레이션 insert grant 안이다(created_at·saved_at·recorded_at을 앱이 보내지 않는다)", async () => {
    await seed();
    const sent = store.calls.filter((c) => c.op === "upsert" || c.op === "insert").flatMap((c) => (Array.isArray(c.payload) ? c.payload : [c.payload]) as Row[]);
    expect(sent.length).toBeGreaterThan(0);
    for (const row of sent) {
      for (const col of ["created_at", "saved_at", "recorded_at"]) expect(Object.keys(row)).not.toContain(col);
    }
  });
});
