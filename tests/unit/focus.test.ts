import { describe, expect, it } from "vitest";
import { readEveningState } from "../../lib/evening/core";
import { endFocusForUser, readFocusState, startFocusForUser } from "../../lib/focus/core";
import { elapsedSecondsSoFar, isActive, minutesByCategory, remainingSeconds, sessionMinutes } from "../../lib/focus/logic";
import { oppositeFlags } from "../../lib/focus/opposite";
import type { FocusSession } from "../../lib/focus/types";
import { lessDoneByRatio } from "../../lib/growth/logic";
import { encryptCategoryName, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

const KEY = parseTodoKey(Buffer.alloc(32, 6).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const S1 = "51515151-5151-4151-8151-515151515151";
const S2 = "52525252-5252-4252-8252-525252525252";
const NOW = new Date("2026-11-07T03:00:00.000Z"); // 서울 12:00, 두노 하루 2026-11-07
const iso = (ms: number) => new Date(ms).toISOString();

describe("focus logic", () => {
  const start = NOW.getTime();
  it("지난 초는 정한 길이(30분)를 넘기지 않고 음수가 되지 않는다", () => {
    expect(elapsedSecondsSoFar(start, start + 5 * 60_000, 30)).toBe(300);
    expect(elapsedSecondsSoFar(start, start + 99 * 60_000, 30)).toBe(1800);
    expect(elapsedSecondsSoFar(start, start - 5000, 30)).toBe(0);
    expect(remainingSeconds(start, start + 5 * 60_000, 30)).toBe(1500);
    expect(remainingSeconds(start, start + 99 * 60_000, 30)).toBe(0);
  });
  const base = { startedAt: iso(start), plannedMinutes: 30 };
  it("세션 분: 끝낸 것은 진행한 초를 반올림, 5분 하고 끝내도 5분, 30초 미만은 0", () => {
    expect(sessionMinutes({ ...base, endedAt: "x", elapsedSeconds: 300 }, start)).toBe(5);
    expect(sessionMinutes({ ...base, endedAt: "x", elapsedSeconds: 29 }, start)).toBe(0);
    expect(sessionMinutes({ ...base, endedAt: "x", elapsedSeconds: 1800 }, start)).toBe(30);
  });
  it("끝내지 않은 세션은 지금까지(정한 길이까지)를 센다: 끝내기를 잊어도 30분이 지나면 30분", () => {
    expect(sessionMinutes({ ...base, endedAt: null, elapsedSeconds: null }, start + 12 * 60_000)).toBe(12);
    expect(sessionMinutes({ ...base, endedAt: null, elapsedSeconds: null }, start + 5 * 3600_000)).toBe(30);
    expect(sessionMinutes({ startedAt: "깨짐", plannedMinutes: 30, endedAt: null, elapsedSeconds: null }, start)).toBe(0);
  });
  it("진행 중: 끝내지 않았고 3시간 안", () => {
    expect(isActive({ startedAt: iso(start), endedAt: null }, start + 60_000)).toBe(true);
    expect(isActive({ startedAt: iso(start), endedAt: null }, start + 4 * 3600_000)).toBe(false);
    expect(isActive({ startedAt: iso(start), endedAt: "x" }, start)).toBe(false);
  });
  it("분야별 합: 같은 분야를 더하고 0분은 뺀다", () => {
    const s = (categoryId: string | null, sec: number): FocusSession => ({
      id: String(sec), startedAt: iso(start), day: "d", plannedMinutes: 30, endedAt: "x", elapsedSeconds: sec, todoId: null, categoryId, offerId: null, surface: "manual", oppositeByGoal: null, oppositeByRatio: null,
    });
    expect(minutesByCategory([s(C1, 600), s(C1, 300), s(null, 900), s(C2, 10)], start)).toEqual([
      { categoryId: C1, minutes: 15 },
      { categoryId: null, minutes: 15 },
    ]);
  });
});

describe("반대편 여부 (D-110)", () => {
  const ratios = [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }];
  it("주 초(쓴 시간 없음)는 비율이 있는 분야가 모두 반대편, 기타는 아님", () => {
    expect(lessDoneByRatio(ratios, []).map((c) => c.categoryId)).toEqual([C1, C2]);
    expect(oppositeFlags({ categoryId: C1, ratios, goalItems: null, totals: [] })).toEqual({ byGoal: null, byRatio: true });
    expect(oppositeFlags({ categoryId: null, ratios, goalItems: null, totals: [] })).toEqual({ byGoal: null, byRatio: false });
    expect(oppositeFlags({ categoryId: C3, ratios, goalItems: null, totals: [] })).toEqual({ byGoal: null, byRatio: false });
  });
  it("쓴 시간이 있으면 비율보다 덜 한 분야만 반대편", () => {
    const totals = [{ categoryId: C1, minutes: 100 }, { categoryId: C2, minutes: 0 }];
    expect(oppositeFlags({ categoryId: C1, ratios, goalItems: null, totals }).byRatio).toBe(false);
    expect(oppositeFlags({ categoryId: C2, ratios, goalItems: null, totals }).byRatio).toBe(true);
  });
  it("이번 주 목표가 있으면 목표 기준도 센다(목표에 들지 않은 분야는 아님)", () => {
    const goalItems = [{ categoryId: C2, minutes: 120 }];
    const totals = [{ categoryId: C2, minutes: 30 }, { categoryId: C1, minutes: 10 }];
    expect(oppositeFlags({ categoryId: C2, ratios, goalItems, totals })).toMatchObject({ byGoal: true });
    expect(oppositeFlags({ categoryId: C1, ratios, goalItems, totals })).toMatchObject({ byGoal: false });
    expect(oppositeFlags({ categoryId: C2, ratios, goalItems, totals: [{ categoryId: C2, minutes: 120 }] })).toMatchObject({ byGoal: false });
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
// DB 기본값 시각(now())을 시험의 시계와 맞춘다: 부를 때마다 그 시각으로 고정
const deps = (store: FakeStore, sub: string | null = ME, now = NOW) => {
  store.fixedNow = now;
  return { supabase: fakeTablesClient(store, { sub }), key: KEY, now: () => now };
};

describe("startFocusForUser", () => {
  it("시작하는 순간 한 행(먼저 한 기록)이 남고, 서버 시각·두노 하루·반대편 여부 둘이 서버에서 정해진다", async () => {
    const store = setup();
    const res = await startFocusForUser(deps(store), { id: S1, categoryId: C1, todoId: "11111111-1111-4111-8111-111111111111", surface: "timer_tab", clientStartedAt: "2026-11-07T03:00:01.000Z" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.session).toMatchObject({ id: S1, day: "2026-11-07", plannedMinutes: 30, categoryId: C1, offerId: null, surface: "timer_tab", endedAt: null, oppositeByRatio: true, oppositeByGoal: null });
    expect(res.data.serverNow).toBe(NOW.toISOString());
    const insert = store.calls.find((c) => c.table === "focus_sessions" && c.op === "insert");
    expect(Object.keys(insert!.payload as object)).not.toContain("started_at"); // DB 기본값(서버 시계)
    expect(store.table("focus_sessions")[0]).toMatchObject({ user_id: ME, client_started_at: "2026-11-07T03:00:01.000Z" });
  });
  it("같은 id를 다시 보내도 새 행이 없다(재시도)", async () => {
    const store = setup();
    await startFocusForUser(deps(store), { id: S1, categoryId: C1, surface: "manual" });
    const again = await startFocusForUser(deps(store), { id: S1, categoryId: C1, surface: "manual" });
    expect(again.ok).toBe(true);
    expect(store.table("focus_sessions")).toHaveLength(1);
  });
  it("이번 주에 이미 비율대로 쓴 분야는 반대편이 아니다(그 순간의 기록으로 정한다)", async () => {
    const store = setup();
    store.seed("evening_logs", { id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", user_id: ME, target_day: "2026-11-05", total_minutes: 100, items: [{ categoryId: C1, minutes: 100 }], save_mode: "edited", saved_at: "2026-11-05T14:00:00.000Z" });
    const a = await startFocusForUser(deps(store), { id: S1, categoryId: C1, surface: "manual" });
    const b = await startFocusForUser(deps(store), { id: S2, categoryId: C2, surface: "manual" });
    expect(a.ok && a.data.session.oppositeByRatio).toBe(false);
    expect(b.ok && b.data.session.oppositeByRatio).toBe(true);
  });
  it("분야 없이(기타) 켜도 남는다. 반대편은 아니다", async () => {
    const store = setup();
    const res = await startFocusForUser(deps(store), { id: S1, surface: "manual" });
    expect(res.ok && res.data.session).toMatchObject({ categoryId: null, todoId: null, oppositeByRatio: false });
  });
  it("남의 분야는 not_found이고 남지 않는다", async () => {
    const store = setup();
    expect(await startFocusForUser(deps(store), { id: S1, categoryId: C3, surface: "manual" })).toEqual({ ok: false, error: "not_found" });
    expect(store.table("focus_sessions")).toHaveLength(0);
  });
  it("모르는 키·surface·형식은 거절하고 DB를 부르지 않는다", async () => {
    const store = setup();
    const before = store.calls.length;
    expect(await startFocusForUser(deps(store), { id: S1, surface: "push" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await startFocusForUser(deps(store), { id: S1, surface: "manual", startedAt: "2020-01-01T00:00:00Z" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await startFocusForUser(deps(store), { id: S1, surface: "manual", oppositeByGoal: true })).toEqual({ ok: false, error: "invalid_input" });
    expect(await startFocusForUser(deps(store), { id: "x", surface: "manual" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await startFocusForUser(deps(store), { id: S1, surface: "manual", categoryId: "x" })).toEqual({ ok: false, error: "invalid_input" });
    expect(store.calls.length).toBe(before);
  });
  it("로그인이 없으면 unauthenticated, 키가 없으면 config", async () => {
    const store = setup();
    expect(await startFocusForUser(deps(store, null), { id: S1, surface: "manual" })).toEqual({ ok: false, error: "unauthenticated" });
    expect(await startFocusForUser({ ...deps(store), key: null }, { id: S1, surface: "manual" })).toEqual({ ok: false, error: "config" });
  });
});

describe("endFocusForUser", () => {
  it("끝낸 시각과 진행한 시간(초)을 서버가 정한다. 정한 길이를 넘기지 않는다", async () => {
    const store = setup();
    await startFocusForUser(deps(store), { id: S1, categoryId: C1, surface: "manual" });
    const res = await endFocusForUser(deps(store, ME, new Date(NOW.getTime() + 12 * 60_000 + 20_000)), S1);
    expect(res.ok && res.data.session).toMatchObject({ elapsedSeconds: 740, endedAt: "2026-11-07T03:12:20.000Z" });
    await startFocusForUser(deps(store), { id: S2, surface: "manual" });
    const long = await endFocusForUser(deps(store, ME, new Date(NOW.getTime() + 5 * 3600_000)), S2);
    expect(long.ok && long.data.session.elapsedSeconds).toBe(1800);
  });
  it("이미 끝난 것은 그대로 성공(값이 바뀌지 않는다), 남의 것·없는 것은 not_found", async () => {
    const store = setup();
    await startFocusForUser(deps(store), { id: S1, surface: "manual" });
    await endFocusForUser(deps(store, ME, new Date(NOW.getTime() + 60_000)), S1);
    const again = await endFocusForUser(deps(store, ME, new Date(NOW.getTime() + 600_000)), S1);
    expect(again.ok && again.data.session.elapsedSeconds).toBe(60);
    store.seed("focus_sessions", { id: S2, user_id: OTHER, started_at: NOW.toISOString(), day: "2026-11-07", planned_minutes: 30, surface: "manual", ended_at: null, elapsed_seconds: null });
    expect(await endFocusForUser(deps(store), S2)).toEqual({ ok: false, error: "not_found" });
    expect(await endFocusForUser(deps(store), "51515151-5151-4151-8151-51515151ffff")).toEqual({ ok: false, error: "not_found" });
    expect(await endFocusForUser(deps(store), "x")).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("readFocusState", () => {
  it("진행 중인 세션과 오늘 시작한 세션들", async () => {
    const store = setup();
    await startFocusForUser(deps(store), { id: S1, categoryId: C1, surface: "manual" });
    await endFocusForUser(deps(store, ME, new Date(NOW.getTime() + 300_000)), S1);
    await startFocusForUser(deps(store, ME, new Date(NOW.getTime() + 400_000)), { id: S2, categoryId: C2, surface: "timer_tab" });
    const state = await readFocusState(deps(store, ME, new Date(NOW.getTime() + 500_000)));
    expect(state.ok && state.data.today.map((s) => s.id)).toEqual([S1, S2]);
    expect(state.ok && state.data.active?.id).toBe(S2);
  });
  it("진행 중인 것이 없으면 active는 null, 3시간 넘게 끝내지 않은 것도 진행 중으로 안 본다", async () => {
    const store = setup();
    await startFocusForUser(deps(store), { id: S1, surface: "manual" });
    const later = await readFocusState(deps(store, ME, new Date(NOW.getTime() + 4 * 3600_000)));
    expect(later.ok && later.data.active).toBeNull();
    expect((await readFocusState(deps(setup()))).ok).toBe(true);
  });
  it("남의 세션은 안 보인다", async () => {
    const store = setup();
    store.seed("focus_sessions", { id: S2, user_id: OTHER, started_at: NOW.toISOString(), day: "2026-11-07", planned_minutes: 30, surface: "manual", ended_at: null, elapsed_seconds: null });
    const state = await readFocusState(deps(store));
    expect(state.ok && state.data.today).toEqual([]);
    expect(state.ok && state.data.active).toBeNull();
  });
});

describe("타이머 시간이 저녁 기록에 미리 채워진다", () => {
  it("저녁 기록 상태의 timerByCategory가 그날 세션 분이다", async () => {
    const store = setup();
    await startFocusForUser(deps(store), { id: S1, categoryId: C1, surface: "manual" });
    await endFocusForUser(deps(store, ME, new Date(NOW.getTime() + 25 * 60_000)), S1);
    const state = await readEveningState(deps(store, ME, new Date(NOW.getTime() + 3600_000)));
    expect(state.ok && state.data.timerByCategory).toEqual([{ categoryId: C1, minutes: 25 }]);
  });
});
