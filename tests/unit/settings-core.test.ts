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

describe("기타를 처음 정한 비율에 넣기 (고침 3바퀴, PM 답 d-69)", () => {
  it("검증: categoryId null(기타)도 비율이 될 수 있고, 기타만 있어도 합이 0보다 크면 된다. 기타 중복은 거절", () => {
    expect(checkRatios([{ categoryId: C1, percent: 60 }, { categoryId: null, percent: 40 }]).ok).toBe(true);
    expect(checkRatios([{ categoryId: null, percent: 10 }]).ok).toBe(true);
    expect(checkRatios([{ categoryId: null, percent: 0 }]).ok).toBe(false);
    expect(checkRatios([{ categoryId: null, percent: 10 }, { categoryId: null, percent: 20 }]).ok).toBe(false);
  });
  it("합으로 나눠 읽을 때 기타도 한 몫이고, 고르게 나누기는 기타 몫도 나눈다", () => {
    expect(normalizedShares([{ categoryId: C1, percent: 30 }, { categoryId: null, percent: 10 }])).toEqual([
      { categoryId: C1, share: 0.75 },
      { categoryId: null, share: 0.25 },
    ]);
    expect(evenRatios([C1, null]).map((r) => r.percent)).toEqual([50, 50]);
  });
  it("저장하면 기타 몫은 user_settings.ratio_other_percent에, 분야 몫은 category_ratios에 가고, 읽으면 기타가 맨 끝에 붙는다", async () => {
    const store = setup();
    const ratios = [{ categoryId: C1, percent: 50 }, { categoryId: C2, percent: 30 }, { categoryId: null, percent: 20 }];
    expect(await saveRatiosForUser(deps(store), ratios)).toEqual({ ok: true, data: { ratios } });
    expect(store.table("category_ratios").map((r) => [r.category_id, r.percent])).toEqual([[C1, 50], [C2, 30]]);
    expect(store.table("user_settings")[0]).toMatchObject({ user_id: ME, ratio_other_percent: 20 });
    const read = await readSettingsForUser(deps(store));
    expect(read.ok && read.data.ratios).toEqual(ratios);
  });
  it("기타만 있는 비율도 저장된다(분야 몫 행은 모두 지워진다)", async () => {
    const store = setup();
    await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 100 }]);
    await saveRatiosForUser(deps(store), [{ categoryId: null, percent: 100 }]);
    expect(store.table("category_ratios")).toHaveLength(0);
    const read = await readSettingsForUser(deps(store));
    expect(read.ok && read.data.ratios).toEqual([{ categoryId: null, percent: 100 }]);
  });
  it("기타 몫을 빼고 다시 저장하면 그 열이 비워진다", async () => {
    const store = setup();
    await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 80 }, { categoryId: null, percent: 20 }]);
    await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 80 }, { categoryId: null, percent: 0 }]);
    expect(store.table("user_settings")[0]).toMatchObject({ ratio_other_percent: null });
    const read = await readSettingsForUser(deps(store));
    expect(read.ok && read.data.ratios).toEqual([{ categoryId: C1, percent: 80 }]);
  });
  it("기타를 안 쓰면 user_settings를 건드리지 않는다(마이그레이션 전 DB에서도 저장이 된다)", async () => {
    const store = setup();
    await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }]);
    const writes = store.calls.filter((c) => c.table === "user_settings" && c.op !== "select");
    expect(writes).toEqual([]);
  });
  it("기타 몫 열을 읽지 못하면(적용 전) 기타 없음으로 읽고 나머지는 그대로 읽힌다", async () => {
    const store = setup();
    store.seed("category_ratios", { user_id: ME, category_id: C1, percent: 100 });
    const real = fakeTablesClient(store, { sub: ME });
    const supabase = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== "from") return Reflect.get(target, prop, receiver);
        return (table: string) => {
          const builder = target.from(table);
          if (table !== "user_settings") return builder;
          return new Proxy(builder, {
            get(b, p, r) {
              if (p === "select") {
                return (columns?: string) =>
                  columns === "ratio_other_percent"
                    ? Promise.resolve({ data: null, error: { code: "42703", message: "column does not exist" } })
                    : (b.select as (c?: string) => unknown)(columns);
              }
              return Reflect.get(b, p, r);
            },
          });
        };
      },
    });
    const read = await readSettingsForUser({ supabase: supabase as never, key: KEY, now: () => NOW });
    expect(read.ok && read.data.ratios).toEqual([{ categoryId: C1, percent: 100 }]);
  });
  it("열이 없는 DB에서 기타를 저장하려 하면 거절된다(짧은 코드, 앱은 되돌린다)", async () => {
    const store = setup();
    store.rules.user_settings.insertColumns = store.rules.user_settings.insertColumns!.filter((c) => c !== "ratio_other_percent");
    store.rules.user_settings.updateColumns = store.rules.user_settings.updateColumns!.filter((c) => c !== "ratio_other_percent");
    const res = await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 50 }, { categoryId: null, percent: 50 }]);
    expect(res.ok).toBe(false);
  });
});
