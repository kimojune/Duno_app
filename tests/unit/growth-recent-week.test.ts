import { describe, expect, it } from "vitest";
import type { EveningLog } from "../../lib/evening/types";
import { computeGrowth } from "../../lib/growth/compute";
import { readGrowthForUser } from "../../lib/growth/core";
import { buildStatusChart } from "../../lib/growth/status-chart";
import { deriveGrowth } from "../../lib/local/derive";
import { emptyMirror } from "../../lib/local/reduce";
import type { Mirror } from "../../lib/local/types";
import { encryptCategoryName, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/**
 * 최근 1주(오늘 포함 지난 7일, 두노 하루 기준)의 계산과, 서버 경로·기기 먼저 저장 경로가 같은 값을 내는지.
 * 두 경로는 모두 computeGrowth(lib/growth/compute.ts)를 거친다. 아래는 같은 기록으로 둘을 실제로 돌려 견준다.
 */

const KEY = parseTodoKey(Buffer.alloc(32, 4).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";

const log = (day: string, items: { categoryId: string | null; minutes: number }[], id = day): EveningLog => ({
  id,
  targetDay: day,
  totalMinutes: items.reduce((s, i) => s + i.minutes, 0),
  items,
  saveMode: "edited",
  savedAt: "x",
});

// 날짜는 11-07(토) 기준: 최근 1주 = 11-01 ~ 11-07, 이번 주(달력) = 11-02 ~ 11-08
const LOGS: EveningLog[] = [
  log("2026-10-31", [{ categoryId: C1, minutes: 500 }]), // 최근 1주 밖(8일 전)
  log("2026-11-01", [{ categoryId: C1, minutes: 60 }]), // 최근 1주 첫날(6일 전). 지난 달력 주(일요일)
  log("2026-11-03", [{ categoryId: C2, minutes: 30 }, { categoryId: null, minutes: 15 }]),
  log("2026-11-07", [{ categoryId: C1, minutes: 90 }]),
];

describe("computeGrowth: 최근 1주", () => {
  const base = { logs: LOGS, categories: [{ id: C1, name: "어학" }, { id: C2, name: "포트폴리오" }], ratios: [], goalItems: null };
  it("오늘 포함 지난 7일(today-6 ~ today)을 더한다. 8일 전은 빠지고 6일 전은 든다", () => {
    const d = computeGrowth({ ...base, today: "2026-11-07" });
    expect(d.recentWeek).toEqual(expect.arrayContaining([{ categoryId: C1, minutes: 150 }, { categoryId: C2, minutes: 30 }, { categoryId: null, minutes: 15 }]));
    expect(d.recentWeek).toHaveLength(3);
    expect(d.loggedDaysRecentWeek).toBe(3);
    // 달력 주(thisWeek)와 다르다: 11-01(일)은 지난 주 것
    expect(d.thisWeek.find((t) => t.categoryId === C1)?.minutes).toBe(90);
  });
  it("오늘 이후 날짜의 기록은 세지 않는다", () => {
    const d = computeGrowth({ ...base, today: "2026-11-07", logs: [...LOGS, log("2026-11-08", [{ categoryId: C1, minutes: 999 }])] });
    expect(d.recentWeek.find((t) => t.categoryId === C1)?.minutes).toBe(150);
  });
  it("기록이 없으면 빈 목록과 0일", () => {
    const d = computeGrowth({ ...base, today: "2026-11-07", logs: [] });
    expect(d.recentWeek).toEqual([]);
    expect(d.loggedDaysRecentWeek).toBe(0);
  });
  it("총 시간은 지금의 쌓인 것(cumulative)이다", () => {
    const d = computeGrowth({ ...base, today: "2026-11-07" });
    expect(d.cumulative.find((t) => t.categoryId === C1)?.minutes).toBe(650);
  });
});

// ---- 서버 경로와 기기 먼저 저장 경로 ----
function serverStore() {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const [id, name] of [[C1, "어학"], [C2, "포트폴리오"]] as const) {
    store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName(name, ME, KEY!), archived_at: null });
  }
  store.seed("category_ratios", { user_id: ME, category_id: C1, percent: 60 });
  store.seed("category_ratios", { user_id: ME, category_id: C2, percent: 40 });
  LOGS.forEach((l, i) =>
    store.seed("evening_logs", {
      id: `00000000-0000-4000-8000-00000000000${i}`,
      user_id: ME,
      target_day: l.targetDay,
      total_minutes: l.totalMinutes,
      items: l.items,
      save_mode: "edited",
      saved_at: `${l.targetDay}T13:00:00.000Z`,
    }),
  );
  return store;
}

function deviceMirror(): Mirror {
  return {
    ...emptyMirror(),
    synced: true,
    categories: [
      { id: C1, readable: true, name: "어학", createdAt: "2026-10-01T00:00:00.000Z" },
      { id: C2, readable: true, name: "포트폴리오", createdAt: "2026-10-02T00:00:00.000Z" },
    ],
    settings: {
      goal: null,
      goalReadable: true,
      onboardingDone: true,
      notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 },
      ratios: [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }],
    },
    logs: LOGS,
  };
}

const sortById = <T extends { categoryId: string | null }>(xs: T[]) => [...xs].sort((a, b) => String(a.categoryId).localeCompare(String(b.categoryId)));

describe("서버 경로와 기기 먼저 저장 경로가 같은 최근 1주 값을 낸다", () => {
  // 서울 시각 → 두노 하루: 11-08 03:59는 아직 11-07, 11-08 04:00부터 11-08(새벽 4시 경계)
  const cases: { name: string; at: string; today: string; recentFrom: string }[] = [
    { name: "낮(11-07 12:00)", at: "2026-11-07T03:00:00.000Z", today: "2026-11-07", recentFrom: "2026-11-01" },
    { name: "새벽 4시 바로 전(11-08 03:59)", at: "2026-11-07T18:59:00.000Z", today: "2026-11-07", recentFrom: "2026-11-01" },
    { name: "새벽 4시 정각(11-08 04:00)", at: "2026-11-07T19:00:00.000Z", today: "2026-11-08", recentFrom: "2026-11-02" },
  ];
  for (const c of cases) {
    it(`${c.name}: 같은 기록이면 recentWeek·loggedDaysRecentWeek·상태보기 그래프 값이 같다`, async () => {
      const at = new Date(c.at);
      const server = await readGrowthForUser({ supabase: fakeTablesClient(serverStore(), { sub: ME }), key: KEY, now: () => at });
      expect(server.ok).toBe(true);
      if (!server.ok) return;
      const device = deriveGrowth(deviceMirror(), at.getTime());
      expect(device.ok).toBe(true);
      if (!device.ok) return;
      expect(server.data.today).toBe(c.today);
      expect(device.data.today).toBe(c.today);
      expect(sortById(device.data.recentWeek)).toEqual(sortById(server.data.recentWeek));
      expect(device.data.loggedDaysRecentWeek).toBe(server.data.loggedDaysRecentWeek);
      // 화면이 만드는 그래프 값도 같다
      const chartOf = (d: typeof server.data) => buildStatusChart({ categoryIds: d.categories.map((x) => x.id), ratios: d.ratios, totals: d.recentWeek });
      expect(chartOf(device.data)).toEqual(chartOf(server.data));
    });
  }

  it("새벽 4시 경계: 03:59에는 11-01 기록이 최근 1주에 들고, 04:00부터는 빠지며 11-08 기록이 든다", async () => {
    const lastMinute = deriveGrowth(deviceMirror(), Date.parse("2026-11-07T18:59:00.000Z"));
    const firstMinute = deriveGrowth({ ...deviceMirror(), logs: [...LOGS, log("2026-11-08", [{ categoryId: C2, minutes: 45 }])] }, Date.parse("2026-11-07T19:00:00.000Z"));
    expect(lastMinute.ok && lastMinute.data.recentWeek.find((t) => t.categoryId === C1)?.minutes).toBe(150); // 11-01의 60 + 11-07의 90
    expect(firstMinute.ok && firstMinute.data.recentWeek.find((t) => t.categoryId === C1)?.minutes).toBe(90); // 11-01 빠짐
    expect(firstMinute.ok && firstMinute.data.recentWeek.find((t) => t.categoryId === C2)?.minutes).toBe(75); // 30 + 11-08의 45
  });
});
