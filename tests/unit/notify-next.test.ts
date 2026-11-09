import { beforeEach, describe, expect, it, vi } from "vitest";
import { minutesSince, parseWindowMinutes } from "../../lib/push/due";
import { NOTIFY_ITEMS, pickNotifications } from "../../lib/push/next";
import type { NotifySettings } from "../../lib/settings/types";

const getDeps = vi.fn();
const readSettingsForUser = vi.fn();
vi.mock("../../lib/deps", () => ({ getDeps: (...a: unknown[]) => getDeps(...a) }));
vi.mock("../../lib/settings/core", () => ({ readSettingsForUser: (...a: unknown[]) => readSettingsForUser(...a) }));

import { GET } from "../../app/api/notify/next/route";

const at = (h: number, m = 0) => h * 60 + m;
const notify = (over: Partial<NotifySettings> = {}): NotifySettings => ({
  eveningEnabled: true,
  eveningMinute: at(19, 30),
  morningEnabled: true,
  morningMinute: at(10),
  ...over,
});
const kinds = (items: { kind: string }[]) => items.map((i) => i.kind);

describe("pickNotifications (지금 보낼 알림이 무엇인가)", () => {
  it("저녁 시각이 막 지났으면 저녁 알림, 아침 시각이 막 지났으면 아침 알림이다", () => {
    expect(kinds(pickNotifications({ notify: notify(), nowMinute: at(19, 31), windowMinutes: 15 }))).toEqual(["evening"]);
    expect(kinds(pickNotifications({ notify: notify(), nowMinute: at(10, 2), windowMinutes: 15 }))).toEqual(["morning"]);
  });
  it("시각 범위를 막지 않는다: 저녁 알림을 오전에, 아침 알림을 밤에 두어도 그 종류로 나온다", () => {
    const flipped = notify({ eveningMinute: at(9), morningMinute: at(21) });
    expect(kinds(pickNotifications({ notify: flipped, nowMinute: at(9, 1), windowMinutes: 15 }))).toEqual(["evening"]);
    expect(kinds(pickNotifications({ notify: flipped, nowMinute: at(21, 5), windowMinutes: 15 }))).toEqual(["morning"]);
  });
  it("신호가 늦게 닿아도(정한 시각에서 한참 지나도) 가장 최근에 지난 시각의 알림이다", () => {
    expect(kinds(pickNotifications({ notify: notify(), nowMinute: at(11, 40), windowMinutes: 15 }))).toEqual(["morning"]);
    expect(kinds(pickNotifications({ notify: notify(), nowMinute: at(2), windowMinutes: 15 }))).toEqual(["evening"]);
  });
  it("꺼 둔 알림은 고르지 않는다. 둘 다 꺼 뒀으면 빈 목록", () => {
    expect(kinds(pickNotifications({ notify: notify({ eveningEnabled: false }), nowMinute: at(19, 31), windowMinutes: 15 }))).toEqual(["morning"]);
    expect(pickNotifications({ notify: notify({ eveningEnabled: false, morningEnabled: false }), nowMinute: at(10, 1), windowMinutes: 15 })).toEqual([]);
  });
  it("두 시각이 같거나 창 안에서 겹치면 둘 다 나온다(가까운 쪽이 앞)", () => {
    const same = notify({ eveningMinute: at(10), morningMinute: at(10) });
    expect(pickNotifications({ notify: same, nowMinute: at(10, 3), windowMinutes: 15 })).toHaveLength(2);
    const near = notify({ eveningMinute: at(10, 10), morningMinute: at(10) });
    expect(kinds(pickNotifications({ notify: near, nowMinute: at(10, 12), windowMinutes: 15 }))).toEqual(["evening", "morning"]);
    expect(kinds(pickNotifications({ notify: near, nowMinute: at(10, 12), windowMinutes: 5 }))).toEqual(["evening"]);
  });
  it("자정을 넘는 경우도 맞는다", () => {
    const late = notify({ eveningMinute: at(23, 50) });
    expect(kinds(pickNotifications({ notify: late, nowMinute: at(0, 5), windowMinutes: 15 }))).toEqual(["evening"]);
  });
  it("알림 글: 저녁은 저녁 기록을 열고 아침은 처음 화면을 연다. 이름이 서로 다르고 재촉하지 않는다", () => {
    expect(NOTIFY_ITEMS.evening).toMatchObject({ title: "오늘 기록", body: "오늘 몇 시간 썼는지 적어 둘까요?", url: "/?open=evening", tag: "duno-evening" });
    expect(NOTIFY_ITEMS.morning).toMatchObject({ title: "오늘 먼저 할 일", url: "/", tag: "duno-morning" });
    expect(NOTIFY_ITEMS.evening.tag).not.toBe(NOTIFY_ITEMS.morning.tag);
    for (const i of Object.values(NOTIFY_ITEMS)) expect(`${i.title} ${i.body}`).not.toMatch(/빨리|꼭|안 하면|밀렸|부족|놓치/);
  });
});

describe("due 보조", () => {
  it("minutesSince: 정한 시각이 지난 지 몇 분인가", () => {
    expect(minutesSince(at(10), at(10, 7))).toBe(7);
    expect(minutesSince(at(23, 50), at(0, 5))).toBe(15);
    expect(minutesSince(at(10), at(9))).toBe(1380);
  });
  it("parseWindowMinutes: 1~120 정수만, 아니면 기본 15", () => {
    expect(parseWindowMinutes("30")).toBe(30);
    for (const bad of ["", undefined, "0", "121", "1.5", "abc", null]) expect(parseWindowMinutes(bad as string)).toBe(15);
  });
});

describe("GET /api/notify/next", () => {
  beforeEach(() => {
    getDeps.mockReset();
    readSettingsForUser.mockReset();
    getDeps.mockResolvedValue({ supabase: {}, key: null });
  });
  it("로그인한 사용자의 설정으로 알림 목록을 돌려주고 캐시하지 않는다(받는 인자 없음)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T10:31:00.000Z")); // 서울 19:31
    readSettingsForUser.mockResolvedValue({ ok: true, data: { goal: null, goalReadable: true, onboardingDone: true, notify: notify(), ratios: [] } });
    const res = await GET();
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(kinds(body.data.items)).toEqual(["evening"]);
    expect(readSettingsForUser).toHaveBeenCalledTimes(1);
  });
  it("세션이 없으면 401과 짧은 코드만", async () => {
    readSettingsForUser.mockResolvedValue({ ok: false, error: "unauthenticated" });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthenticated" });
  });
  it("서버 설정이 없으면 config, 예외는 unavailable(원문 없음)", async () => {
    getDeps.mockResolvedValue(null);
    expect((await GET()).status).toBe(500);
    getDeps.mockRejectedValue(new Error("boom secret"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });
});
