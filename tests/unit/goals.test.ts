import { describe, expect, it } from "vitest";
import { clearWeeklyGoalForUser, readWeeklyGoalItems, saveWeeklyGoalForUser } from "../../lib/goals/core";
import { checkGoalItems, goalProgress } from "../../lib/goals/validation";
import { endFocusForUser, startFocusForUser } from "../../lib/focus/core";
import { readGrowthForUser } from "../../lib/growth/core";
import { requestOfferForUser } from "../../lib/offers/core";
import { encryptCategoryName, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

const KEY = parseTodoKey(Buffer.alloc(32, 2).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const MORNING = new Date("2026-11-07T01:00:00.000Z"); // 서울 10:00, 토요일 → 그 주 월요일 2026-11-02

describe("goal validation", () => {
  it("분야 번호 uuid·중복 없음·1시간 단위·합 168시간 이하", () => {
    expect(checkGoalItems([{ categoryId: C1, minutes: 300 }, { categoryId: C2, minutes: 60 }]).ok).toBe(true);
    expect(checkGoalItems([]).ok).toBe(false);
    expect(checkGoalItems([{ categoryId: C1, minutes: 90 }]).ok).toBe(false); // 1시간 단위가 아니다
    expect(checkGoalItems([{ categoryId: C1, minutes: 0 }]).ok).toBe(false);
    expect(checkGoalItems([{ categoryId: C1, minutes: 60 }, { categoryId: C1, minutes: 60 }]).ok).toBe(false);
    expect(checkGoalItems([{ categoryId: "x", minutes: 60 }]).ok).toBe(false);
    expect(checkGoalItems([{ categoryId: C1, minutes: 100 * 60 }, { categoryId: C2, minutes: 69 * 60 }]).ok).toBe(false); // 169시간
    expect(checkGoalItems([{ categoryId: C1, minutes: 100 * 60 }, { categoryId: C2, minutes: 68 * 60 }]).ok).toBe(true); // 168시간
    expect(checkGoalItems([{ categoryId: C1, minutes: 60, extra: 1 }]).ok).toBe(false);
  });
  it("진행은 분야마다 목표를 넘기지 않게 센다", () => {
    const goal = [{ categoryId: C1, minutes: 300 }, { categoryId: C2, minutes: 600 }];
    expect(goalProgress(goal, [{ categoryId: C1, minutes: 480 }, { categoryId: C2, minutes: 60 }, { categoryId: C3, minutes: 999 }])).toEqual({ targetMinutes: 900, doneMinutes: 360 });
    expect(goalProgress(goal, [])).toEqual({ targetMinutes: 900, doneMinutes: 0 });
  });
});

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const [id, name] of [[C1, "어학"], [C2, "포트폴리오"]] as const) {
    store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName(name, ME, KEY!), archived_at: null });
  }
  store.seed("categories", { id: C3, user_id: OTHER, name_encrypted: "x", archived_at: null });
  store.seed("category_ratios", { user_id: ME, category_id: C1, percent: 60 });
  store.seed("category_ratios", { user_id: ME, category_id: C2, percent: 40 });
  return store;
}
const deps = (store: FakeStore, sub: string | null = ME, now = MORNING) => {
  store.fixedNow = now;
  return { supabase: fakeTablesClient(store, { sub }), key: KEY, now: () => now };
};

describe("saveWeeklyGoalForUser", () => {
  it("이번 주(월요일) 목표를 저장하고, 같은 요청을 다시 보내면 바뀐다(행은 하나)", async () => {
    const store = setup();
    const first = await saveWeeklyGoalForUser(deps(store), [{ categoryId: C1, minutes: 300 }]);
    expect(first).toEqual({ ok: true, data: { weekStart: "2026-11-02", items: [{ categoryId: C1, minutes: 300 }] } });
    await saveWeeklyGoalForUser(deps(store), [{ categoryId: C1, minutes: 300 }, { categoryId: C2, minutes: 120 }]);
    expect(store.table("weekly_goals")).toHaveLength(1);
    expect(store.table("weekly_goals")[0]).toMatchObject({ user_id: ME, week_start: "2026-11-02" });
    const read = await readWeeklyGoalItems({ supabase: deps(store).supabase, weekStart: "2026-11-02" });
    expect(read).toEqual({ ok: true, data: [{ categoryId: C1, minutes: 300 }, { categoryId: C2, minutes: 120 }] });
  });
  it("주는 서버 시계로 정한다(받지 않는다). 일요일도 같은 주", async () => {
    const store = setup();
    const sunday = new Date("2026-11-08T05:00:00.000Z"); // 서울 일요일 14:00
    const res = await saveWeeklyGoalForUser(deps(store, ME, sunday), [{ categoryId: C1, minutes: 60 }]);
    expect(res.ok && res.data.weekStart).toBe("2026-11-02");
    const mondayEarly = new Date("2026-11-08T19:30:00.000Z"); // 서울 월요일 04:30 → 새 주
    const next = await saveWeeklyGoalForUser(deps(store, ME, mondayEarly), [{ categoryId: C1, minutes: 60 }]);
    expect(next.ok && next.data.weekStart).toBe("2026-11-09");
  });
  it("남의 분야는 not_found, 형식이 틀리면 invalid_input이고 DB를 부르지 않는다", async () => {
    const store = setup();
    expect(await saveWeeklyGoalForUser(deps(store), [{ categoryId: C3, minutes: 60 }])).toEqual({ ok: false, error: "not_found" });
    const before = store.calls.length;
    expect(await saveWeeklyGoalForUser(deps(store), [{ categoryId: C1, minutes: 45 }])).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveWeeklyGoalForUser(deps(store), { weekStart: "2020-01-06", items: [] })).toEqual({ ok: false, error: "invalid_input" });
    expect(store.calls.length).toBe(before);
    expect(store.table("weekly_goals")).toHaveLength(0);
  });
  it("로그인이 없으면 unauthenticated, DB 오류는 unavailable", async () => {
    const store = setup();
    expect(await saveWeeklyGoalForUser(deps(store, null), [{ categoryId: C1, minutes: 60 }])).toEqual({ ok: false, error: "unauthenticated" });
    store.alwaysError = { code: "XX000", message: "secret" };
    expect(await saveWeeklyGoalForUser(deps(store), [{ categoryId: C1, minutes: 60 }])).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("clearWeeklyGoalForUser · readWeeklyGoalItems", () => {
  it("목표를 없애면 목표가 없는 주(null)가 된다. 없는 것을 없애도 성공. 남의 목표는 안 보이고 안 지워진다", async () => {
    const store = setup();
    store.seed("weekly_goals", { user_id: OTHER, week_start: "2026-11-02", items: [{ categoryId: C3, minutes: 60 }] });
    await saveWeeklyGoalForUser(deps(store), [{ categoryId: C1, minutes: 60 }]);
    expect(await clearWeeklyGoalForUser(deps(store))).toEqual({ ok: true, data: { weekStart: "2026-11-02" } });
    expect(await clearWeeklyGoalForUser(deps(store))).toEqual({ ok: true, data: { weekStart: "2026-11-02" } });
    const read = await readWeeklyGoalItems({ supabase: deps(store).supabase, weekStart: "2026-11-02" });
    expect(read).toEqual({ ok: true, data: null });
    expect(store.table("weekly_goals").filter((r) => r.user_id === OTHER)).toHaveLength(1);
  });
  it("손으로 넣은 이상한 items는 목표 없음으로 읽는다", async () => {
    const store = setup();
    store.seed("weekly_goals", { user_id: ME, week_start: "2026-11-02", items: "깨짐" });
    expect(await readWeeklyGoalItems({ supabase: deps(store).supabase, weekStart: "2026-11-02" })).toEqual({ ok: true, data: null });
  });
});

describe("이번 주 목표가 다른 기능에 닿는다", () => {
  it("상태보기가 이번 주 목표를 준다(목표 기준 채울 시간의 재료)", async () => {
    const store = setup();
    await saveWeeklyGoalForUser(deps(store), [{ categoryId: C2, minutes: 120 }]);
    const res = await readGrowthForUser(deps(store));
    expect(res.ok && res.data.goal).toEqual({ weekStart: "2026-11-02", items: [{ categoryId: C2, minutes: 120 }] });
  });
  it("먼저 할 일은 목표 안에서 건넨다(비율이 큰 분야가 목표 밖이면 건네지 않는다)", async () => {
    const store = setup();
    await saveWeeklyGoalForUser(deps(store), [{ categoryId: C2, minutes: 120 }]);
    const res = await requestOfferForUser(deps(store), { surface: "card" });
    expect(res.ok && res.data.offer?.categoryId).toBe(C2); // 비율은 어학(C1)이 크지만 목표에 든 포트폴리오를 건넨다
  });
  it("먼저 한 기록에 이번 주 목표 기준 반대편 여부가 남는다(목표 없는 주는 null)", async () => {
    const store = setup();
    const S1 = "51515151-5151-4151-8151-515151515151";
    const S2 = "52525252-5252-4252-8252-525252525252";
    const none = await startFocusForUser(deps(store), { id: S1, categoryId: C2, surface: "manual" });
    expect(none.ok && none.data.session.oppositeByGoal).toBeNull();
    await endFocusForUser(deps(store), S1); // 진행 중인 타이머가 있으면 새로 켜지 않는다(B3): 앞의 것을 끝내고 켠다
    await saveWeeklyGoalForUser(deps(store), [{ categoryId: C2, minutes: 120 }]);
    const inGoal = await startFocusForUser(deps(store), { id: S2, categoryId: C2, surface: "manual" });
    expect(inGoal.ok && inGoal.data.session).toMatchObject({ oppositeByGoal: true, oppositeByRatio: true });
    await endFocusForUser(deps(store), S2);
    const outside = await startFocusForUser(deps(store), { id: "53535353-5353-4353-8353-535353535353", categoryId: C1, surface: "manual" });
    expect(outside.ok && outside.data.session).toMatchObject({ oppositeByGoal: false, oppositeByRatio: true });
  });
});
