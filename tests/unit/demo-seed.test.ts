import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDemoPlan,
  DEMO_CATEGORIES,
  DEMO_GOAL_TEXT,
  DEMO_RATIO_OTHER,
  DEMO_RATIOS,
  DEMO_SHORT_CATEGORY_INDEX,
  DEMO_SHORT_MINUTES,
  DEMO_SPAN_DAYS,
  DemoSeedError,
  demoUuid,
  seedDemoData,
} from "../../lib/demo/seed";
import { decryptCategoryName, decryptTodoText, parseTodoKey, type TodoKey } from "../../lib/todos/crypto";
import { shortfallByGoal, sumRange } from "../../lib/growth/logic";
import { pickOfferCategory, pickOfferTodo } from "../../lib/offers/logic";
import { todoDayFor } from "../../lib/todos/day";
import { addDays, weekStartFor } from "../../lib/week";
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
  it("지난 3주(오늘 포함 21일) — 날짜마다 할 일 2~4개, 오늘 빼고 날마다 오늘 기록 하나", async () => {
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
    expect(logs.map((l) => l.target_day).sort()).toEqual(days.filter((d) => d !== TODAY)); // 오늘 줄은 없다(시연 2막, 창구 11-10)
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

  it("오늘 기록 없음(시연 2막, 창구 11-10): 오늘 날짜 기록이 없다 — 두 번 돌려도, 다른 사용자도 그렇다. 어제 줄은 있다", async () => {
    await seed();
    await seed();
    await seed(store, OTHER);
    expect(store.table("evening_logs").filter((l) => l.target_day === TODAY).length).toBe(0);
    expect(store.table("evening_logs").filter((l) => l.target_day === addDays(TODAY, -1) && l.user_id === USER).length).toBe(1);
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

  it("이번 주 목표: 이번 주 월요일, 분야마다 1시간 단위(TODAY가 월요일이라 모자란 분야 하나뿐)", async () => {
    await seed();
    const goals = store.table("weekly_goals");
    expect(goals.length).toBe(1);
    expect(goals[0].week_start).toBe("2026-11-09");
    const items = goals[0].items as { categoryId: string; minutes: number }[];
    expect(items.length).toBe(1);
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
    const tables = ["categories", "todos", "todo_notes", "evening_logs", "category_ratios", "category_ratio_history", "weekly_goals", "user_settings"];
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
    expect(retry.eveningLogs).toBe(DEMO_SPAN_DAYS); // 오늘 줄 없음(시연 2막)
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

describe("시연 2막(창구 11-10): 어느 날이든 모자란 분야 하나 · 카드 「오늘 할 일에 추가」", () => {
  // 월요일(주 경계) · 화~토(주 중간) · 일요일(주 끝) · 다음 월요일
  const DAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-15"];

  for (const today of DAYS) {
    it(`${today}: 목표 · 모자란 분야 하나 · 지난 날 할 일 · 오늘 그 분야 할 일 없음 · 저녁 기록 한 번이면 꽉`, async () => {
      const s = newStore();
      await seedDemoData({ supabase: fakeTablesClient(s, { sub: USER }), userId: USER, key, today, now: fixedNow });
      const shortId = demoUuid(USER, "category", DEMO_SHORT_CATEGORY_INDEX);
      expect(s.table("categories").some((c) => c.id === shortId)).toBe(true);

      // 1. 이번 주 목표가 그 주로 들어 있다
      const weekStart = weekStartFor(today);
      const goalRow = s.table("weekly_goals").find((g) => g.week_start === weekStart)!;
      expect(goalRow).toBeTruthy();
      const goalItems = (goalRow.items as { categoryId: string; minutes: number }[]).map((g) => ({ categoryId: g.categoryId, minutes: g.minutes }));
      for (const g of goalItems) expect(g.minutes % 60).toBe(0);

      // 2. 이번 주 지난 날 기록 합 → 모자란 분야 하나만, 몫 = DEMO_SHORT_MINUTES
      const logs = s.table("evening_logs").map((l) => ({
        id: l.id as string,
        targetDay: l.target_day as string,
        totalMinutes: l.total_minutes as number,
        items: l.items as { categoryId: string | null; minutes: number }[],
        saveMode: "edited" as const,
        savedAt: "x",
      }));
      expect(logs.some((l) => l.targetDay >= today)).toBe(false); // 오늘 이후 기록 없음
      const totals = sumRange(logs, weekStart, addDays(weekStart, 6));
      expect(shortfallByGoal(goalItems, totals)).toEqual([{ categoryId: shortId, minutes: DEMO_SHORT_MINUTES }]);
      expect(DEMO_SHORT_MINUTES).toBeGreaterThanOrEqual(60);
      expect(DEMO_SHORT_MINUTES).toBeLessThanOrEqual(120);
      // 카드가 건넬 분야 = 모자란 분야
      const ratios = s.table("category_ratios").map((r) => ({ categoryId: r.category_id as string | null, percent: r.percent as number }));
      expect(pickOfferCategory({ ratios, goalItems, totals })).toBe(shortId);
      // 오늘 저녁 기록 한 번(모자란 분야 몫)이면 목표가 꽉 찬다
      const tonight = { id: "n", targetDay: today, totalMinutes: DEMO_SHORT_MINUTES, items: [{ categoryId: shortId, minutes: DEMO_SHORT_MINUTES }], saveMode: "edited" as const, savedAt: "x" };
      expect(shortfallByGoal(goalItems, sumRange([...logs, tonight], weekStart, addDays(weekStart, 6)))).toEqual([]);

      // 3. 그 분야의 지난 날(7일 안) 끝내지 않은 할 일이 있고 오늘 그 분야 할 일은 없다 → 카드는 어제 것을 건넨다
      const mine = s.table("todos").filter((t) => t.category_id === shortId);
      expect(mine.some((t) => t.day === today)).toBe(false);
      const cand = mine
        .filter((t) => t.done === false && (t.day as string) < today && (t.day as string) >= addDays(today, -7))
        .map((t) => ({ id: t.id as string, day: t.day as string, createdAt: String(t.created_at ?? "") }));
      expect(cand.length).toBeGreaterThan(0);
      const picked = mine.find((t) => t.id === pickOfferTodo(cand, today))!;
      expect(picked.day).toBe(addDays(today, -1));
      expect(decryptTodoText(picked.text_encrypted, USER, key)).toEqual({ ok: true, text: "오픽 답변 스크립트 다듬기" });

      // 5. 그 분야의 끝낸 할 일에 작업 기록 글 두 개(풀린다, 다른 용도로는 안 풀린다)
      const notes = s.table("todo_notes");
      expect(notes.length).toBe(2);
      for (const n of notes) {
        expect(mine.find((t) => t.id === n.todo_id)!.done).toBe(true);
        expect(decryptTodoText(n.note_encrypted, USER, key, "todo_note").ok).toBe(true);
        expect(decryptTodoText(n.note_encrypted, USER, key).ok).toBe(false);
      }
    });
  }

  it("월요일은 이번 주 지난 날이 없어 목표가 모자란 분야 1시간 하나뿐(0/1시간)", async () => {
    const s = newStore();
    await seedDemoData({ supabase: fakeTablesClient(s, { sub: USER }), userId: USER, key, today: "2026-11-09", now: fixedNow });
    const items = s.table("weekly_goals")[0].items as { categoryId: string; minutes: number }[];
    expect(items).toEqual([{ categoryId: demoUuid(USER, "category", DEMO_SHORT_CATEGORY_INDEX), minutes: DEMO_SHORT_MINUTES }]);
  });

  it("새벽 4시 경계: 서울 월요일 03:59는 일요일 하루, 04:00부터 월요일 — 그 하루로 계획을 세워도 같은 규칙이 선다", () => {
    const sundayLate = todoDayFor(new Date("2026-11-08T18:59:00.000Z")); // 서울 11-09 03:59
    const mondayStart = todoDayFor(new Date("2026-11-08T19:00:00.000Z")); // 서울 11-09 04:00
    expect([sundayLate, mondayStart]).toEqual(["2026-11-08", "2026-11-09"]);
    for (const today of [sundayLate, mondayStart]) {
      const plan = buildDemoPlan(USER, today);
      expect(plan.weekStart).toBe(weekStartFor(today));
      expect(plan.eveningLogs.some((l) => l.targetDay >= today)).toBe(false);
      expect(plan.todos.some((t) => t.day === today && t.categoryIndex === DEMO_SHORT_CATEGORY_INDEX)).toBe(false);
    }
    expect(buildDemoPlan(USER, sundayLate).weeklyGoals.length).toBe(4);
    expect(buildDemoPlan(USER, mondayStart).weeklyGoals.length).toBe(1);
  });

  it("오늘이 어느 날이든(60일 훑기) 모자란 몫은 늘 하나, 오늘 그 분야 할 일은 없고 어제는 끝내지 않은 것이 있다", () => {
    for (let i = 0; i < 60; i += 1) {
      const today = addDays("2026-09-01", i);
      const plan = buildDemoPlan(USER, today);
      const totals = DEMO_CATEGORIES.map((_, c) =>
        plan.eveningLogs.filter((l) => l.targetDay >= plan.weekStart).reduce((sum, l) => sum + (l.items.find((it) => it.categoryIndex === c)?.minutes ?? 0), 0),
      );
      for (const g of plan.weeklyGoals) {
        const expected = g.categoryIndex === DEMO_SHORT_CATEGORY_INDEX ? DEMO_SHORT_MINUTES : 0;
        expect(g.minutes - totals[g.categoryIndex], today).toBe(expected);
      }
      expect(plan.todos.some((t) => t.day === today && t.categoryIndex === DEMO_SHORT_CATEGORY_INDEX), today).toBe(false);
      expect(plan.todos.some((t) => t.day === addDays(today, -1) && t.categoryIndex === DEMO_SHORT_CATEGORY_INDEX && !t.done), today).toBe(true);
    }
  });
});
