import { describe, expect, it } from "vitest";
import { readSettingsForUser, saveRatiosForUser, saveSettingsForUser } from "../../lib/settings/core";
import { checkGoal, checkRatios, evenRatios, GOAL_MAX_LENGTH, normalizedShares } from "../../lib/settings/validation";
import { decryptTodoText, encryptCategoryName, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

const KEY = parseTodoKey(Buffer.alloc(32, 5).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const NOW = new Date("2026-11-07T03:00:00.000Z");

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const id of [C1, C2]) store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName("분야", ME, KEY!), archived_at: null });
  store.seed("categories", { id: C3, user_id: OTHER, name_encrypted: "x", archived_at: null });
  return store;
}
const deps = (store: FakeStore, sub: string | null = ME, key = KEY) => ({ supabase: fakeTablesClient(store, { sub }), key, now: () => NOW });

describe("검증 함수", () => {
  it("목표 글: 비면 null, 공백을 줄이고, 100자를 넘으면 too_long", () => {
    expect(checkGoal(null)).toEqual({ ok: true, goal: null });
    expect(checkGoal("   ")).toEqual({ ok: true, goal: null });
    expect(checkGoal("  토익   900점  ")).toEqual({ ok: true, goal: "토익 900점" });
    expect(checkGoal("가".repeat(GOAL_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(checkGoal("가".repeat(GOAL_MAX_LENGTH + 1))).toEqual({ ok: false, error: "too_long" });
    expect(checkGoal(5)).toEqual({ ok: false, error: "invalid_input" });
  });
  it("비율: uuid·중복 없음·0~100 정수·합이 0보다 커야 한다", () => {
    expect(checkRatios([{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }]).ok).toBe(true);
    expect(checkRatios([{ categoryId: C1, percent: 0 }]).ok).toBe(false); // 합 0
    expect(checkRatios([]).ok).toBe(false);
    expect(checkRatios([{ categoryId: "x", percent: 10 }]).ok).toBe(false);
    expect(checkRatios([{ categoryId: C1, percent: 101 }]).ok).toBe(false);
    expect(checkRatios([{ categoryId: C1, percent: 12.5 }]).ok).toBe(false);
    expect(checkRatios([{ categoryId: C1, percent: 10 }, { categoryId: C1, percent: 20 }]).ok).toBe(false);
    expect(checkRatios([{ categoryId: C1, percent: 10, extra: 1 }]).ok).toBe(false);
  });
  it("고르게 나누기는 5% 단위로 합이 100이다", () => {
    expect(evenRatios([C1, C2, C3]).map((r) => r.percent)).toEqual([35, 35, 30]);
    expect(evenRatios([C1, C2]).map((r) => r.percent)).toEqual([50, 50]);
    expect(evenRatios([C1]).map((r) => r.percent)).toEqual([100]);
    expect(evenRatios([])).toEqual([]);
    for (const n of [1, 2, 3, 4, 6, 7, 9, 13, 20]) {
      const ids = Array.from({ length: n }, (_, i) => `id${i}`);
      expect(evenRatios(ids).reduce((s, r) => s + r.percent, 0)).toBe(100);
    }
  });
  it("합이 100이 아니어도 합으로 나눠 읽는다", () => {
    const shares = normalizedShares([{ categoryId: C1, percent: 30 }, { categoryId: C2, percent: 10 }]);
    expect(shares).toEqual([{ categoryId: C1, share: 0.75 }, { categoryId: C2, share: 0.25 }]);
    expect(normalizedShares([{ categoryId: C1, percent: 0 }])).toEqual([]);
  });
});

describe("readSettingsForUser", () => {
  it("행이 없으면 처음 설정을 안 마친 기본값(알림은 꺼짐, 저녁 19:30·아침 10:00)", async () => {
    const res = await readSettingsForUser(deps(setup()));
    expect(res).toEqual({
      ok: true,
      data: {
        goal: null,
        goalReadable: true,
        onboardingDone: false,
        notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 },
        ratios: [],
      },
    });
  });
  it("로그인이 없으면 unauthenticated, 키가 없으면 config, DB 오류는 unavailable", async () => {
    const store = setup();
    expect(await readSettingsForUser(deps(store, null))).toEqual({ ok: false, error: "unauthenticated" });
    expect(await readSettingsForUser(deps(store, ME, null))).toEqual({ ok: false, error: "config" });
    store.alwaysError = { code: "XX000", message: "secret" };
    expect(await readSettingsForUser(deps(store))).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("saveSettingsForUser", () => {
  it("목표 글은 암호화해 저장하고 평문을 DB에 보내지 않는다", async () => {
    const store = setup();
    const res = await saveSettingsForUser(deps(store), { goal: "토익 900점" });
    expect(res.ok && res.data.goal).toBe("토익 900점");
    const stored = store.table("user_settings")[0];
    expect(String(stored.goal_encrypted)).toMatch(/^v1:/);
    expect(JSON.stringify(store.calls)).not.toContain("토익");
    expect(decryptTodoText(stored.goal_encrypted, ME, KEY!, "goal_text")).toEqual({ ok: true, text: "토익 900점" });
    expect(decryptTodoText(stored.goal_encrypted, ME, KEY!).ok).toBe(false); // 용도가 다르다
  });
  it("마친 시각은 서버 시계로 한 번만 정하고 다시 마쳐도 바뀌지 않는다", async () => {
    const store = setup();
    await saveSettingsForUser(deps(store), { completeOnboarding: true, goal: null });
    expect(store.table("user_settings")[0].onboarding_done_at).toBe(NOW.toISOString());
    const later = { ...deps(store), now: () => new Date("2026-11-09T00:00:00.000Z") };
    await saveSettingsForUser(later, { completeOnboarding: true });
    expect(store.table("user_settings")[0].onboarding_done_at).toBe(NOW.toISOString());
    const read = await readSettingsForUser(deps(store));
    expect(read.ok && read.data.onboardingDone).toBe(true);
  });
  it("알림 설정을 바꾸되 안 보낸 것은 그대로, 범위를 벗어나면 거절", async () => {
    const store = setup();
    await saveSettingsForUser(deps(store), { notify: { eveningEnabled: true, eveningMinute: 20 * 60 } });
    const row = store.table("user_settings")[0];
    expect(row).toMatchObject({ notify_evening_enabled: true, notify_evening_minute: 1200, notify_morning_enabled: false, notify_morning_minute: 600 });
    expect(await saveSettingsForUser(deps(store), { notify: { morningMinute: 1440 } })).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveSettingsForUser(deps(store), { notify: { evening: true } })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("모르는 키·바꿀 것 없음·긴 목표는 거절하고 DB를 부르지 않는다", async () => {
    const store = setup();
    const before = store.calls.length;
    expect(await saveSettingsForUser(deps(store), { userId: OTHER, goal: "x" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveSettingsForUser(deps(store), {})).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveSettingsForUser(deps(store), { goal: "가".repeat(101) })).toEqual({ ok: false, error: "too_long" });
    expect(store.calls.length).toBe(before);
  });
  it("남의 행은 건드리지 못한다(내 행만 만들어진다)", async () => {
    const store = setup();
    store.seed("user_settings", { user_id: OTHER, goal_encrypted: null, onboarding_done_at: null });
    await saveSettingsForUser(deps(store), { notify: { eveningEnabled: true } });
    expect(store.table("user_settings").find((r) => r.user_id === OTHER)?.notify_evening_enabled).toBeUndefined();
    expect(store.table("user_settings").find((r) => r.user_id === ME)?.notify_evening_enabled).toBe(true);
  });
});

describe("saveRatiosForUser", () => {
  it("비율을 저장하고, 다시 저장하면 받은 목록에 없는 분야의 비율은 지워진다", async () => {
    const store = setup();
    const first = await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }]);
    expect(first.ok).toBe(true);
    expect(store.table("category_ratios")).toHaveLength(2);
    await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 100 }]);
    expect(store.table("category_ratios").map((r) => [r.category_id, r.percent])).toEqual([[C1, 100]]);
    const read = await readSettingsForUser(deps(store));
    expect(read.ok && read.data.ratios).toEqual([{ categoryId: C1, percent: 100 }]);
  });
  it("같은 요청을 다시 보내도 결과가 같다", async () => {
    const store = setup();
    const ratios = [{ categoryId: C1, percent: 70 }, { categoryId: C2, percent: 30 }];
    await saveRatiosForUser(deps(store), ratios);
    await saveRatiosForUser(deps(store), ratios);
    expect(store.table("category_ratios")).toHaveLength(2);
  });
  it("남의 분야는 not_found, 형식 오류는 invalid_input", async () => {
    const store = setup();
    expect(await saveRatiosForUser(deps(store), [{ categoryId: C3, percent: 50 }])).toEqual({ ok: false, error: "not_found" });
    expect(await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 0 }])).toEqual({ ok: false, error: "invalid_input" });
    expect(store.table("category_ratios")).toHaveLength(0);
  });
  it("남의 비율 행은 지워지지 않는다", async () => {
    const store = setup();
    store.seed("category_ratios", { user_id: OTHER, category_id: C3, percent: 50 });
    await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 100 }]);
    expect(store.table("category_ratios").filter((r) => r.user_id === OTHER)).toHaveLength(1);
  });
});
