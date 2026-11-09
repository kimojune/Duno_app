import { describe, expect, it } from "vitest";
import type { EveningLog } from "../../lib/evening/types";
import { computeGrowth } from "../../lib/growth/compute";
import { readGrowthForUser } from "../../lib/growth/core";
import { STREAK_MIN_WEEKS, streakWeeks, visibleStreak } from "../../lib/growth/streak";
import { deriveGrowth } from "../../lib/local/derive";
import { emptyMirror } from "../../lib/local/reduce";
import type { Mirror } from "../../lib/local/types";
import { todoDayFor } from "../../lib/todos/day";
import { addDays } from "../../lib/week";
import { encryptCategoryName, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/**
 * 연속 기록(명세 ⑦-9, 원샷 v2 고침9): 오늘 기록이 하루라도 있는 주를 센다(월~일, 두노 하루 = 새벽 4시 경계). 2주 이상만 보이고 끊기면 조용히 사라진다.
 * 재료는 상태보기가 이미 읽는 자기 오늘 기록의 대상 날뿐이다(새 읽기 없음). 서버 경로와 기기 먼저 저장 경로가 같은 값을 낸다.
 */

// 2026-11-07(토) 기준: 이번 주 = 11-02(월) ~ 11-08(일), 지난주 = 10-26 ~ 11-01
const TODAY = "2026-11-07";

describe("streakWeeks: 주 세기(월~일)", () => {
  it("이번 주·지난주·그 앞 주에 하루씩 있으면 3", () => {
    expect(streakWeeks(TODAY, ["2026-11-03", "2026-10-29", "2026-10-20"])).toBe(3);
  });

  it("한 주에 하루라도 있으면 그 주를 센다(날 수는 상관없다)", () => {
    const daily = Array.from({ length: 7 }, (_, i) => addDays("2026-11-02", i)).filter((d) => d <= TODAY);
    expect(streakWeeks(TODAY, [...daily, "2026-10-26"])).toBe(2);
    expect(streakWeeks(TODAY, ["2026-11-02", "2026-11-01"])).toBe(2); // 이번 주 월요일 하루 + 지난주 일요일 하루
  });

  it("월~일 경계: 일요일(11-01)은 지난주, 월요일(11-02)은 이번 주", () => {
    // 11-01(일)과 10-26(월)은 같은 주(10-26 주) → 한 주. 이번 주가 비어 있으니 지난주부터 1
    expect(streakWeeks(TODAY, ["2026-11-01", "2026-10-26"])).toBe(1);
    // 11-02(월)와 11-01(일)은 다른 주 → 2
    expect(streakWeeks(TODAY, ["2026-11-02", "2026-11-01"])).toBe(2);
    // 11-08(일)은 이번 주의 끝: 오늘이 11-08이면 이번 주로 센다
    expect(streakWeeks("2026-11-08", ["2026-11-08", "2026-10-27"])).toBe(2);
  });

  it("이번 주에 아직 기록이 없으면 지난주부터 센다(월요일 아침에 연속이 바로 사라지지 않는다)", () => {
    expect(streakWeeks("2026-11-09", ["2026-11-05", "2026-10-29", "2026-10-22"])).toBe(3);
  });

  it("한 주를 통째로 비우면 끊긴다: 끊긴 뒤의 주만 센다", () => {
    // 이번 주 · (지난주 비움) · 그 앞 두 주 → 이번 주 하나만
    expect(streakWeeks(TODAY, ["2026-11-03", "2026-10-21", "2026-10-14"])).toBe(1);
    // 이번 주도 지난주도 비면 0(앞 주들이 이어져 있어도)
    expect(streakWeeks(TODAY, ["2026-10-21", "2026-10-14", "2026-10-07"])).toBe(0);
  });

  it("기록이 없으면 0, 오늘보다 뒤의 날·모양이 틀린 날은 세지 않는다, 같은 날이 여러 번 와도 한 번", () => {
    expect(streakWeeks(TODAY, [])).toBe(0);
    expect(streakWeeks(TODAY, ["2026-11-10", "2026-11-16"])).toBe(0); // 앞날
    expect(streakWeeks(TODAY, ["2026-11-03", "2026-02-30", "not-a-day", "", "2026-10-28"])).toBe(2);
    expect(streakWeeks(TODAY, ["2026-11-03", "2026-11-03", "2026-11-03"])).toBe(1);
  });

  it("해를 넘는 주(12-28 월 ~ 01-03 일)도 한 주로 센다", () => {
    expect(streakWeeks("2027-01-06", ["2027-01-05", "2027-01-02", "2026-12-28", "2026-12-23"])).toBe(3);
  });
});

describe("새벽 4시 하루 경계(lib/todos/day todoDayFor)", () => {
  // 서울 11-09(월) 03:59 = 두노 하루 11-08(일, 지난 주), 04:00 = 11-09(월, 새 주)
  const before = todoDayFor(new Date("2026-11-08T18:59:00.000Z"));
  const after = todoDayFor(new Date("2026-11-08T19:00:00.000Z"));
  it("월요일 03:59의 기록은 일요일 기록이라 그 주(11-02 주)에 든다", () => {
    expect(before).toBe("2026-11-08");
    expect(after).toBe("2026-11-09");
    // 오늘(11-08)에 일요일 기록 + 지난주 하나 → 2
    expect(streakWeeks(before, [before, "2026-10-28"])).toBe(2);
  });
  it("월요일 04:00부터는 새 주: 새 주에 아직 기록이 없어도 지난주까지의 연속은 그대로", () => {
    expect(streakWeeks(after, ["2026-11-08", "2026-10-28"])).toBe(2);
    expect(streakWeeks(after, [after, "2026-11-08", "2026-10-28"])).toBe(3);
  });
});

describe("visibleStreak: 2주 이상일 때만 보인다(끊기면 조용히 사라짐)", () => {
  it("0·1주는 숨기고(null), 2주부터 그 수", () => {
    expect(STREAK_MIN_WEEKS).toBe(2);
    expect(visibleStreak(0)).toBeNull();
    expect(visibleStreak(1)).toBeNull();
    expect(visibleStreak(2)).toBe(2);
    expect(visibleStreak(13)).toBe(13);
  });
  it("모양이 이상한 값(음수·소수·NaN·undefined)은 숨긴다", () => {
    for (const bad of [-3, 2.5, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) expect(visibleStreak(bad)).toBeNull();
  });
});

describe("악용: 아주 긴 기록 기간(자기 계정 수년 치)", () => {
  it("10년 매일(3,650날) + 같은 날 반복 20만 개도 선형으로 끝나고 값이 맞다(시간 상한·하한 둘 다 본다)", () => {
    const days = Array.from({ length: 3650 }, (_, i) => addDays(TODAY, -i));
    const noisy = [...days, ...Array.from({ length: 200_000 }, (_, i) => days[i % days.length])];
    const t0 = performance.now();
    const n = streakWeeks(TODAY, noisy);
    const ms = performance.now() - t0;
    // 3,650날 = 521주 + 3날. 이번 주(11-02~11-07)부터 거꾸로 모두 이어져 있다
    expect(n).toBe(Math.ceil((3650 + 1) / 7)); // 522
    expect(n).toBeGreaterThan(500); // 하한: 실제로 다 셌다(빈 결과로 빨리 끝난 게 아니다)
    expect(ms).toBeLessThan(2000); // 상한: 넉넉한 선형 시간
  });
  it("세는 길이는 모은 주 수를 넘지 않는다(주가 하나뿐이면 1에서 멈춘다)", () => {
    expect(streakWeeks(TODAY, Array.from({ length: 100_000 }, () => "2026-11-03"))).toBe(1);
  });
});

// ---- computeGrowth · 서버 경로 · 기기 먼저 저장 경로 ----
const KEY = parseTodoKey(Buffer.alloc(32, 4).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const log = (day: string, id = day): EveningLog => ({ id, targetDay: day, totalMinutes: 30, items: [{ categoryId: C1, minutes: 30 }], saveMode: "edited", savedAt: "x" });
// 내 기록: 이번 주(11-03) · 지난주(10-28) → 2주
const MINE = [log("2026-11-03"), log("2026-10-28")];

describe("computeGrowth.streakWeeks: 받은 기록(logs)의 대상 날로만 센다", () => {
  it("logs의 targetDay로 센 값과 같다", () => {
    const d = computeGrowth({ today: TODAY, logs: MINE, categories: [{ id: C1, name: "어학" }], ratios: [], goalItems: null });
    expect(d.streakWeeks).toBe(streakWeeks(TODAY, MINE.map((l) => l.targetDay)));
    expect(d.streakWeeks).toBe(2);
  });
});

describe("악용: 다른 사용자 기록을 섞으려는 시도(서버 경로)", () => {
  function store() {
    const s = new FakeStore();
    s.rules = v2Rules();
    s.seed("categories", { id: C1, user_id: ME, name_encrypted: encryptCategoryName("어학", ME, KEY!), archived_at: null });
    MINE.forEach((l, i) =>
      s.seed("evening_logs", { id: `00000000-0000-4000-8000-00000000000${i}`, user_id: ME, target_day: l.targetDay, total_minutes: 30, items: l.items, save_mode: "edited", saved_at: `${l.targetDay}T13:00:00.000Z` }),
    );
    // 다른 사용자: 지난 6주 내내 기록 → 섞이면 내 연속이 6주가 된다
    ["2026-10-21", "2026-10-14", "2026-10-07", "2026-09-30", "2026-09-23", "2026-09-16"].forEach((day, i) =>
      s.seed("evening_logs", { id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, user_id: OTHER, target_day: day, total_minutes: 30, items: [{ categoryId: null, minutes: 30 }], save_mode: "edited", saved_at: `${day}T13:00:00.000Z` }),
    );
    return s;
  }
  const AT = new Date("2026-11-07T03:00:00.000Z");

  it("내 세션으로 읽으면 내 기록만 센다(2주) — 다른 사용자 기록 6주는 섞이지 않는다", async () => {
    const res = await readGrowthForUser({ supabase: fakeTablesClient(store(), { sub: ME }), key: KEY, now: () => AT });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.streakWeeks).toBe(2);
  });

  it("다른 사용자 세션으로 읽으면 그 사람 기록만(이번 주·지난주가 비어 0) — 내 기록이 넘어가지 않는다", async () => {
    const res = await readGrowthForUser({ supabase: fakeTablesClient(store(), { sub: OTHER }), key: KEY, now: () => AT });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.streakWeeks).toBe(0);
  });

  it("기기 먼저 저장 경로도 같은 기록이면 같은 값(서버와 같은 함수)", async () => {
    const mirror: Mirror = {
      ...emptyMirror(),
      synced: true,
      categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-10-01T00:00:00.000Z" }],
      logs: MINE,
    };
    const device = deriveGrowth(mirror, AT.getTime());
    const server = await readGrowthForUser({ supabase: fakeTablesClient(store(), { sub: ME }), key: KEY, now: () => AT });
    expect(device.ok && server.ok).toBe(true);
    if (!device.ok || !server.ok) return;
    expect(device.data.streakWeeks).toBe(server.data.streakWeeks);
    expect(device.data.streakWeeks).toBe(2);
  });
});
