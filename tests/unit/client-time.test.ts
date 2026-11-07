import { describe, expect, it } from "vitest";
import { saveEveningLogForUser } from "../../lib/evening/core";
import { endFocusForUser, readFocusState, startFocusForUser } from "../../lib/focus/core";
import { effectiveStartedAt } from "../../lib/focus/map";
import { clearWeeklyGoalForUser, saveWeeklyGoalForUser } from "../../lib/goals/core";
import { addNoteForUser } from "../../lib/notes/core";
import { encryptCategoryName, encryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { trustedClientTime } from "../../lib/todos/day";
import { carryOverTodosForUser } from "../../lib/todos/manage-core";
import { recordViewForUser } from "../../lib/views/core";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/**
 * 기기 먼저 저장(고침 3바퀴): 하루 경계(서울 새벽 4시)는 적은 때 기기에서 정해 함께 보내고, 서버는 범위(최근 72시간·미래 5분)만 검사한다.
 * 범위 안이면 기기가 보낸 때의 하루로 넣고, 범위 밖이면 서버 시계를 따른다.
 */

const KEY = parseTodoKey(Buffer.alloc(32, 7).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const N1 = "aaaa1111-1111-4111-8111-111111111111";
const S1 = "51515151-5151-4151-8151-515151515151";
const E1 = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
const V1 = "77777777-7777-4777-8777-777777777777";

// 서버 시계: 서울 2026-11-08 05:00(두노 하루 11-08, 일요일). 기기는 어제 밤에 적었다(서울 11-07 23:30 = 두노 하루 11-07)
const SERVER_NOW = new Date("2026-11-07T20:00:00.000Z");
const DEVICE_LATE_NIGHT = "2026-11-07T14:30:00.000Z"; // 서울 23:30, 서버 시계보다 5시간 전

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  store.fixedNow = SERVER_NOW;
  store.seed("categories", { id: C1, user_id: ME, name_encrypted: encryptCategoryName("어학", ME, KEY!), archived_at: null });
  store.rules.view_events = { insertColumns: ["id", "user_id", "screen", "entry", "day"], defaults: (_r, s) => ({ viewed_at: s.nextTimestamp() }) };
  const todo = (id: string, text: string, day: string, done = false) =>
    store.seed("todos", { id, user_id: ME, day, text_encrypted: encryptTodoText(text, ME, KEY!), done, category_id: null });
  return { store, todo };
}
const deps = (store: FakeStore, now = SERVER_NOW) => {
  store.fixedNow = now;
  return { supabase: fakeTablesClient(store, { sub: ME }), key: KEY, now: () => now };
};

describe("trustedClientTime", () => {
  it("최근 72시간·미래 5분 안이면 그 시각(ms), 밖이거나 이상하면 null", () => {
    const now = new Date("2026-11-07T00:00:00.000Z");
    expect(trustedClientTime(now, "2026-11-06T23:00:00.000Z")).toBe(Date.parse("2026-11-06T23:00:00.000Z"));
    expect(trustedClientTime(now, "2026-11-07T00:04:00.000Z")).not.toBeNull();
    expect(trustedClientTime(now, "2026-11-07T00:06:00.000Z")).toBeNull();
    expect(trustedClientTime(now, "2026-11-03T23:59:00.000Z")).toBeNull(); // 72시간 넘음
    for (const bad of [undefined, null, 5, "", "어제", "x".repeat(41)]) expect(trustedClientTime(now, bad)).toBeNull();
  });
});

describe("작업 기록의 날", () => {
  it("기기가 적은 때(writtenAt)가 믿을 수 있으면 그 때의 두노 하루, 아니면 서버 시계의 하루", async () => {
    const { store, todo } = setup();
    todo(T1, "이력서", "2026-11-07");
    const a = await addNoteForUser(deps(store), N1, T1, "어제 밤에 적음", DEVICE_LATE_NIGHT);
    expect(a.ok && a.data.note.day).toBe("2026-11-07");
    const b = await addNoteForUser(deps(store), "bbbb1111-1111-4111-8111-111111111111", T1, "시각 없음");
    expect(b.ok && b.data.note.day).toBe("2026-11-08");
    const c = await addNoteForUser(deps(store), "cccc1111-1111-4111-8111-111111111111", T1, "범위 밖", "2026-10-01T00:00:00.000Z");
    expect(c.ok && c.data.note.day).toBe("2026-11-08");
  });
});

describe("어제 것 가져오기의 「오늘」", () => {
  it("기기가 누른 때가 믿을 수 있으면 그 때의 하루를 오늘로 본다(서버는 이미 다음 날이어도)", async () => {
    const { store, todo } = setup();
    todo(T1, "어제 못 끝낸 일", "2026-11-06"); // 기기에게는 어제(11-06), 오늘은 11-07
    const res = await carryOverTodosForUser(deps(store), [{ from: T1, id: T2 }], DEVICE_LATE_NIGHT);
    expect(res.ok && res.data.day.date).toBe("2026-11-07");
    expect(store.table("todos").find((r) => r.id === T2)).toMatchObject({ day: "2026-11-07" });
  });
  it("시각이 없으면 서버 시계의 오늘(11-08)이라 어제(11-07)에서 찾는다: 11-06 것은 not_found", async () => {
    const { store, todo } = setup();
    todo(T1, "그제 일", "2026-11-06");
    expect(await carryOverTodosForUser(deps(store), [{ from: T1, id: T2 }])).toEqual({ ok: false, error: "not_found" });
  });
});

describe("저녁 기록의 「오늘」", () => {
  const input = (over: Record<string, unknown> = {}) => ({ id: E1, targetDay: "2026-11-07", totalMinutes: 30, items: [{ categoryId: null, minutes: 30 }], saveMode: "not_split", clientSavedAt: DEVICE_LATE_NIGHT, ...over });
  it("기기가 저장한 때의 하루까지 기록할 수 있다: 서버가 이미 다음 날이어도 기기의 오늘 기록이 들어간다", async () => {
    const { store } = setup();
    const res = await saveEveningLogForUser(deps(store), input({ targetDay: "2026-11-07" }));
    expect(res.ok).toBe(true);
    // 기기가 보기에 오늘(11-07)보다 앞날(11-08)은 아직 못 쓴다
    expect(await saveEveningLogForUser(deps(store), input({ id: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2", targetDay: "2026-11-08" }))).toEqual({ ok: false, error: "invalid_input" });
  });
  it("기기 시각이 범위 밖이면 서버 시계의 하루(11-08)를 따른다", async () => {
    const { store } = setup();
    const res = await saveEveningLogForUser(deps(store), input({ id: "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3", targetDay: "2026-11-08", clientSavedAt: "2026-10-01T00:00:00.000Z" }));
    expect(res.ok).toBe(true);
  });
});

describe("화면 본 것의 날", () => {
  it("기기가 본 때(clientAt)의 하루로 남고, 시각이 없으면 서버 시계의 하루", async () => {
    const { store } = setup();
    const d = { supabase: fakeTablesClient(store, { sub: ME }), now: () => SERVER_NOW };
    expect((await recordViewForUser(d, { id: V1, screen: "growth", entry: "self", clientAt: DEVICE_LATE_NIGHT })).ok).toBe(true);
    expect((await recordViewForUser(d, { id: "88888888-8888-4888-8888-888888888888", screen: "growth", entry: "self" })).ok).toBe(true);
    expect(store.table("view_events").map((r) => r.day)).toEqual(["2026-11-07", "2026-11-08"]);
  });
  it("모르는 키는 여전히 거절(strict)", async () => {
    const { store } = setup();
    const d = { supabase: fakeTablesClient(store, { sub: ME }), now: () => SERVER_NOW };
    expect(await recordViewForUser(d, { id: V1, screen: "growth", entry: "self", userId: "x" })).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("이번 주 목표의 주", () => {
  it("기기가 정한 때가 속한 주의 월요일로 저장하고 없앤다(서버가 월요일을 넘겨도 기기의 주를 따른다)", async () => {
    const { store } = setup();
    // 서버 11-08(일)은 11-02 주, 기기 시각 11-02(월) 새벽 3시 반(서울)은 두노 하루로 11-01 → 10-26 주
    const monday3am = "2026-11-01T18:30:00.000Z"; // 서울 11-02 03:30
    const now = new Date("2026-11-01T18:31:00.000Z");
    const res = await saveWeeklyGoalForUser(deps(store, now), [{ categoryId: C1, minutes: 120 }], monday3am);
    expect(res.ok && res.data.weekStart).toBe("2026-10-26");
    const none = await saveWeeklyGoalForUser(deps(store, now), [{ categoryId: C1, minutes: 60 }]);
    expect(none.ok && none.data.weekStart).toBe("2026-10-26");
    const cleared = await clearWeeklyGoalForUser(deps(store, now), monday3am);
    expect(cleared.ok && cleared.data.weekStart).toBe("2026-10-26");
  });
});

describe("타이머: 끊긴 채 켜고 끝낸 것이 나중에 올라가도 시각이 맞는다", () => {
  const startedAt = "2026-11-07T11:00:00.000Z"; // 서울 20:00
  const endedAt = "2026-11-07T11:12:30.000Z"; // 12분 30초 뒤
  const lateFlush = new Date("2026-11-07T12:00:00.000Z"); // 한 시간 뒤 연결되어 올라감

  it("시작: 하루는 기기가 누른 때의 하루, 시작 시각은 기기가 보낸 시각(client_started_at)을 따른다", async () => {
    const { store } = setup();
    const res = await startFocusForUser(deps(store, lateFlush), { id: S1, categoryId: C1, surface: "manual", clientStartedAt: startedAt });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.session.day).toBe("2026-11-07");
    expect(res.data.session.startedAt).toBe(startedAt); // 서버가 받은 12:00이 아니라 기기가 누른 11:00
    expect(store.table("focus_sessions")[0]).toMatchObject({ client_started_at: startedAt });
  });
  it("끝내기: 기기가 끝낸 때로 진행한 시간(750초)을 정하고, 끝낸 시각도 그 때다", async () => {
    const { store } = setup();
    await startFocusForUser(deps(store, lateFlush), { id: S1, categoryId: C1, surface: "manual", clientStartedAt: startedAt });
    const res = await endFocusForUser(deps(store, lateFlush), S1, endedAt);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.session.elapsedSeconds).toBe(750);
    expect(res.data.session.endedAt).toBe(endedAt);
  });
  it("끝낸 때가 시작보다 앞이거나 범위 밖이면 서버 시계로 센다(정한 길이를 넘기지 않는다)", async () => {
    const { store } = setup();
    await startFocusForUser(deps(store, lateFlush), { id: S1, categoryId: C1, surface: "manual", clientStartedAt: startedAt });
    const res = await endFocusForUser(deps(store, lateFlush), S1, "2026-11-07T10:00:00.000Z"); // 시작 전
    expect(res.ok && res.data.session.elapsedSeconds).toBe(30 * 60); // 11:00 → 12:00 = 60분이지만 30분 상한
  });
  it("끝낸 때를 안 보내면 예전과 같다(서버 시계): 기기 시작 시각이 있으면 그것으로 센다", async () => {
    const { store } = setup();
    await startFocusForUser(deps(store, lateFlush), { id: S1, categoryId: C1, surface: "manual", clientStartedAt: startedAt });
    const res = await endFocusForUser(deps(store, new Date("2026-11-07T11:05:00.000Z")), S1);
    expect(res.ok && res.data.session.elapsedSeconds).toBe(300);
  });
  it("읽기: 진행 중 판단과 시작 시각이 기기가 보낸 시작을 따른다", async () => {
    const { store } = setup();
    await startFocusForUser(deps(store, lateFlush), { id: S1, categoryId: C1, surface: "manual", clientStartedAt: startedAt });
    const state = await readFocusState(deps(store, new Date("2026-11-07T11:10:00.000Z")));
    expect(state.ok && state.data.active?.startedAt).toBe(startedAt);
  });
  it("effectiveStartedAt: 기기 시각이 서버가 받은 때보다 72시간보다 앞이거나 5분 넘게 뒤면 서버 시각을 쓴다", () => {
    const row = (client: string | null) => ({ started_at: "2026-11-07T12:00:00.000Z", client_started_at: client });
    expect(effectiveStartedAt(row("2026-11-07T11:00:00.000Z"))).toBe("2026-11-07T11:00:00.000Z");
    expect(effectiveStartedAt(row("2026-11-07T12:04:00.000Z"))).toBe("2026-11-07T12:04:00.000Z");
    expect(effectiveStartedAt(row("2026-11-07T12:06:00.000Z"))).toBe("2026-11-07T12:00:00.000Z");
    expect(effectiveStartedAt(row("2026-11-03T11:00:00.000Z"))).toBe("2026-11-07T12:00:00.000Z");
    expect(effectiveStartedAt(row(null))).toBe("2026-11-07T12:00:00.000Z");
    expect(effectiveStartedAt(row("이상한 값"))).toBe("2026-11-07T12:00:00.000Z");
  });
});
