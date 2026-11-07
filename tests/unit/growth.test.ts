import { describe, expect, it } from "vitest";
import type { EveningLog } from "../../lib/evening/types";
import { readGrowthForUser } from "../../lib/growth/core";
import {
  barPercents,
  countLoggedDays,
  minutesOf,
  shortfallByGoal,
  shortfallByRatio,
  shortfallFor,
  sumRange,
  totalOf,
} from "../../lib/growth/logic";
import { encryptCategoryName, parseTodoKey } from "../../lib/todos/crypto";
import { recordViewForUser } from "../../lib/views/core";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

const KEY = parseTodoKey(Buffer.alloc(32, 4).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const NOW = new Date("2026-11-07T03:00:00.000Z"); // 서울 12:00, 토요일, 두노 하루 2026-11-07

const log = (day: string, items: { categoryId: string | null; minutes: number }[], id = `${day}`): EveningLog => ({
  id,
  targetDay: day,
  totalMinutes: items.reduce((s, i) => s + i.minutes, 0),
  items,
  saveMode: "edited",
  savedAt: "x",
});

describe("growth logic", () => {
  const logs = [
    log("2026-10-20", [{ categoryId: C1, minutes: 60 }]),
    log("2026-11-02", [{ categoryId: C1, minutes: 30 }, { categoryId: null, minutes: 30 }]),
    log("2026-11-05", [{ categoryId: C1, minutes: 30 }, { categoryId: C2, minutes: 60 }]),
  ];
  it("기간 합은 둘 다 포함하는 날짜 범위로, 기타는 null로 센다", () => {
    const week = sumRange(logs, "2026-11-02", "2026-11-08");
    expect(minutesOf(week, C1)).toBe(60);
    expect(minutesOf(week, C2)).toBe(60);
    expect(minutesOf(week, null)).toBe(30);
    expect(minutesOf(week, C3)).toBe(0);
    expect(totalOf(week)).toBe(150);
    expect(totalOf(sumRange(logs))).toBe(210);
    expect(countLoggedDays(logs, "2026-11-02", "2026-11-08")).toBe(2);
    expect(countLoggedDays(logs)).toBe(3);
    expect(sumRange(logs, "2026-11-06", "2026-11-06")).toEqual([]);
  });

  it("처음 정한 비율보다 덜 한 분야만, 모자란 만큼 큰 순서로. 기타는 부족으로 잡지 않는다", () => {
    const ratios = [{ categoryId: C1, percent: 50 }, { categoryId: C2, percent: 30 }, { categoryId: C3, percent: 20 }];
    // 쓴 시간 전체 100분(기타 포함): 기대 C1 50 / C2 30 / C3 20
    const totals = [{ categoryId: C1, minutes: 20 }, { categoryId: C2, minutes: 30 }, { categoryId: null, minutes: 50 }];
    expect(shortfallByRatio(ratios, totals)).toEqual([
      { categoryId: C1, minutes: 30 },
      { categoryId: C3, minutes: 20 },
    ]);
  });
  it("모두 기타로 저장한 주에도 비율대로 채울 시간이 보인다", () => {
    const ratios = [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }];
    expect(shortfallByRatio(ratios, [{ categoryId: null, minutes: 100 }])).toEqual([
      { categoryId: C1, minutes: 60 },
      { categoryId: C2, minutes: 40 },
    ]);
  });
  it("쓴 시간이 없으면 빈 목록, 합이 100이 아니어도 합으로 나눠 읽고, 5분 미만 차이는 버린다", () => {
    expect(shortfallByRatio([{ categoryId: C1, percent: 50 }], [])).toEqual([]);
    expect(shortfallByRatio([{ categoryId: C1, percent: 30 }, { categoryId: C2, percent: 10 }], [{ categoryId: C1, minutes: 40 }, { categoryId: C2, minutes: 0 }])).toEqual([
      { categoryId: C2, minutes: 10 },
    ]);
    expect(shortfallByRatio([{ categoryId: C1, percent: 50 }, { categoryId: C2, percent: 50 }], [{ categoryId: C1, minutes: 48 }, { categoryId: C2, minutes: 52 }])).toEqual([]);
  });
  it("목표 기준 부족은 목표보다 덜 한 분야와 남은 시간", () => {
    const goal = [{ categoryId: C1, minutes: 300 }, { categoryId: C2, minutes: 60 }];
    const totals = [{ categoryId: C1, minutes: 120 }, { categoryId: C2, minutes: 90 }];
    expect(shortfallByGoal(goal, totals)).toEqual([{ categoryId: C1, minutes: 180 }]);
  });
  it("shortfallFor: 목표를 세운 주는 목표 기준, 아니면 비율 기준", () => {
    const ratios = [{ categoryId: C1, percent: 100 }];
    const totals = [{ categoryId: null, minutes: 60 }];
    expect(shortfallFor({ ratios, goalItems: null, totals }).basis).toBe("ratio");
    expect(shortfallFor({ ratios, goalItems: [], totals }).basis).toBe("ratio");
    const withGoal = shortfallFor({ ratios, goalItems: [{ categoryId: C2, minutes: 30 }], totals });
    expect(withGoal).toEqual({ basis: "goal", items: [{ categoryId: C2, minutes: 30 }] });
  });
  it("막대는 가장 큰 값이 100, 모두 0이면 0", () => {
    expect(barPercents([30, 60, 0])).toEqual([50, 100, 0]);
    expect(barPercents([0, 0])).toEqual([0, 0]);
    expect(barPercents([])).toEqual([]);
  });
});

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const [id, name] of [[C1, "어학"], [C2, "포트폴리오"]] as const) {
    store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName(name, ME, KEY!), archived_at: null });
  }
  store.seed("category_ratios", { user_id: ME, category_id: C1, percent: 60 });
  store.seed("category_ratios", { user_id: ME, category_id: C2, percent: 40 });
  const seedLog = (user: string, day: string, items: unknown[], total: number, saved: string, id: string) =>
    store.seed("evening_logs", { id, user_id: user, target_day: day, total_minutes: total, items, save_mode: "edited", saved_at: saved });
  return { store, seedLog };
}
const deps = (store: FakeStore, sub: string | null = ME, key = KEY) => ({ supabase: fakeTablesClient(store, { sub }), key, now: () => NOW });

describe("readGrowthForUser", () => {
  it("이번 주·지난주·지난달·누적으로 모으고, 같은 날 여러 번 저장했으면 가장 늦은 것만 센다", async () => {
    const { store, seedLog } = setup();
    seedLog(ME, "2026-11-03", [{ categoryId: C1, minutes: 100 }], 100, "2026-11-03T13:00:00.000Z", "11111111-1111-4111-8111-111111111111");
    seedLog(ME, "2026-11-03", [{ categoryId: C1, minutes: 40 }, { categoryId: null, minutes: 20 }], 60, "2026-11-03T14:00:00.000Z", "22222222-2222-4222-8222-222222222222"); // 더 늦다
    seedLog(ME, "2026-10-28", [{ categoryId: C2, minutes: 50 }], 50, "2026-10-28T13:00:00.000Z", "33333333-3333-4333-8333-333333333333"); // 지난주
    seedLog(ME, "2026-10-05", [{ categoryId: C2, minutes: 30 }], 30, "2026-10-05T13:00:00.000Z", "44444444-4444-4444-8444-444444444444"); // 지난달
    seedLog(ME, "2026-09-01", [{ categoryId: C1, minutes: 10 }], 10, "2026-09-01T13:00:00.000Z", "55555555-5555-4555-8555-555555555555"); // 누적만
    seedLog(OTHER, "2026-11-03", [{ categoryId: C1, minutes: 999 }], 999, "2026-11-03T13:00:00.000Z", "66666666-6666-4666-8666-666666666666");
    const res = await readGrowthForUser(deps(store));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.data;
    expect(d).toMatchObject({ today: "2026-11-07", weekStart: "2026-11-02", lastWeekStart: "2026-10-26", lastMonthRange: { from: "2026-10-01", to: "2026-10-31" } });
    expect(minutesOf(d.thisWeek, C1)).toBe(40);
    expect(minutesOf(d.thisWeek, null)).toBe(20);
    expect(minutesOf(d.lastWeek, C2)).toBe(50);
    expect(minutesOf(d.lastMonth, C2)).toBe(80); // 10-05(30) + 10-28(50)
    expect(totalOf(d.cumulative)).toBe(40 + 20 + 50 + 30 + 10);
    expect(d.loggedDaysThisWeek).toBe(1);
    expect(d.loggedDaysTotal).toBe(4);
    expect(d.categories.map((c) => c.name)).toEqual(["어학", "포트폴리오"]);
    expect(d.ratios).toEqual([{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }]);
    expect(d.goal).toBeNull();
  });
  it("기록이 없으면 모두 0이고 분야와 비율은 그대로 준다", async () => {
    const { store } = setup();
    const res = await readGrowthForUser(deps(store));
    expect(res.ok && res.data.thisWeek).toEqual([]);
    expect(res.ok && res.data.categories).toHaveLength(2);
  });
  it("로그인이 없으면 unauthenticated, 키가 없으면 config, DB 오류는 unavailable", async () => {
    const { store } = setup();
    expect(await readGrowthForUser(deps(store, null))).toEqual({ ok: false, error: "unauthenticated" });
    expect(await readGrowthForUser(deps(store, ME, null))).toEqual({ ok: false, error: "config" });
    store.alwaysError = { code: "XX000", message: "secret" };
    expect(await readGrowthForUser(deps(store))).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("recordViewForUser (화면 본 것)", () => {
  const ID = "77777777-7777-4777-8777-777777777777";
  const viewsDeps = (store: FakeStore, sub: string | null = ME) => ({ supabase: fakeTablesClient(store, { sub }), now: () => NOW });
  function withViews() {
    const store = setup().store;
    store.rules.view_events = { insertColumns: ["id", "user_id", "screen", "entry", "day"], defaults: (_r, s) => ({ viewed_at: s.nextTimestamp() }) };
    return store;
  }
  it("입구별로 한 행이 남고, 날짜는 서버 하루, 시각은 DB 기본값", async () => {
    const store = withViews();
    expect(await recordViewForUser(viewsDeps(store), { id: ID, screen: "growth", entry: "after_save" })).toEqual({ ok: true, data: { id: ID } });
    expect(store.table("view_events")[0]).toMatchObject({ user_id: ME, screen: "growth", entry: "after_save", day: "2026-11-07" });
    const insert = store.calls.find((c) => c.op === "insert");
    expect(Object.keys(insert!.payload as object)).not.toContain("viewed_at");
  });
  it("같은 id를 다시 보내도 한 번만 남는다", async () => {
    const store = withViews();
    await recordViewForUser(viewsDeps(store), { id: ID, screen: "category", entry: "self" });
    expect((await recordViewForUser(viewsDeps(store), { id: ID, screen: "category", entry: "self" })).ok).toBe(true);
    expect(store.table("view_events")).toHaveLength(1);
  });
  it("모르는 화면·입구·키는 거절하고 DB를 부르지 않는다", async () => {
    const store = withViews();
    const before = store.calls.length;
    expect(await recordViewForUser(viewsDeps(store), { id: ID, screen: "timer", entry: "self" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await recordViewForUser(viewsDeps(store), { id: ID, screen: "growth", entry: "push" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await recordViewForUser(viewsDeps(store), { id: ID, screen: "growth", entry: "self", userId: OTHER })).toEqual({ ok: false, error: "invalid_input" });
    expect(await recordViewForUser(viewsDeps(store), { id: "x", screen: "growth", entry: "self" })).toEqual({ ok: false, error: "invalid_input" });
    expect(store.calls.length).toBe(before);
  });
  it("로그인이 없으면 unauthenticated", async () => {
    const store = withViews();
    expect(await recordViewForUser(viewsDeps(store, null), { id: ID, screen: "growth", entry: "self" })).toEqual({ ok: false, error: "unauthenticated" });
  });
});

describe("기타를 비율에 넣은 경우 (고침 3바퀴, PM 답 d-69)", () => {
  const ratios = [{ categoryId: C1, percent: 50 }, { categoryId: null, percent: 50 }];
  it("기타도 비율보다 덜 쓴 만큼 부족으로 잡힌다", () => {
    expect(shortfallByRatio(ratios, [{ categoryId: C1, minutes: 100 }])).toEqual([{ categoryId: null, minutes: 50 }]);
    expect(shortfallByRatio(ratios, [{ categoryId: C1, minutes: 20 }, { categoryId: null, minutes: 80 }])).toEqual([{ categoryId: C1, minutes: 30 }]);
  });
  it("비율에 기타가 없으면 기타는 부족으로 잡히지 않는다(예전 그대로)", () => {
    expect(shortfallByRatio([{ categoryId: C1, percent: 100 }], [{ categoryId: C1, minutes: 20 }, { categoryId: null, minutes: 80 }])).toEqual([{ categoryId: C1, minutes: 80 }]);
  });
  it("주 초에는 비율이 있는 분야가 모두 덜 한 분야이고, 기타도 비율이 있으면 든다", async () => {
    const { lessDoneByRatio } = await import("../../lib/growth/logic");
    expect(lessDoneByRatio(ratios, []).map((c) => c.categoryId)).toEqual([C1, null]);
    expect(lessDoneByRatio([{ categoryId: C1, percent: 100 }], []).map((c) => c.categoryId)).toEqual([C1]);
  });
});
