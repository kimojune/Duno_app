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
 * 이번 주(달력 주 월~일, 두노 하루 기준) 값의 계산과, 서버 경로·기기 먼저 저장 경로가 같은 값을 내는지(상태보기 「이번 주」·놓친 분야·채울 시간이 이 값을 쓴다, PM 확정 11-09).
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

// 날짜는 11-07(토) 기준: 이번 주(달력) = 11-02(월) ~ 11-08(일)
const LOGS: EveningLog[] = [
  log("2026-10-31", [{ categoryId: C1, minutes: 500 }]), // 지난 주(토요일)
  log("2026-11-01", [{ categoryId: C1, minutes: 60 }]), // 지난 주 마지막 날(일요일)
  log("2026-11-03", [{ categoryId: C2, minutes: 30 }, { categoryId: null, minutes: 15 }]),
  log("2026-11-07", [{ categoryId: C1, minutes: 90 }]),
];

describe("computeGrowth: 이번 주(달력 주)", () => {
  const base = { logs: LOGS, categories: [{ id: C1, name: "어학" }, { id: C2, name: "포트폴리오" }], ratios: [], goalItems: null };
  it("월요일부터 일요일까지(11-02 ~ 11-08)만 더한다. 지난 주 일요일(11-01)·토요일(10-31)은 빠진다", () => {
    const d = computeGrowth({ ...base, today: "2026-11-07" });
    expect(d.thisWeek).toEqual(expect.arrayContaining([{ categoryId: C1, minutes: 90 }, { categoryId: C2, minutes: 30 }, { categoryId: null, minutes: 15 }]));
    expect(d.thisWeek).toHaveLength(3);
    expect(d.loggedDaysThisWeek).toBe(2);
  });
  it("다음 주 월요일(11-09)의 기록은 이번 주에 들지 않는다", () => {
    const d = computeGrowth({ ...base, today: "2026-11-07", logs: [...LOGS, log("2026-11-09", [{ categoryId: C1, minutes: 999 }])] });
    expect(d.thisWeek.find((t) => t.categoryId === C1)?.minutes).toBe(90);
  });
  it("기록이 없으면 빈 목록과 0일", () => {
    const d = computeGrowth({ ...base, today: "2026-11-07", logs: [] });
    expect(d.thisWeek).toEqual([]);
    expect(d.loggedDaysThisWeek).toBe(0);
  });
  it("쓰지 않는 「최근 1주」 값은 더 내지 않는다", () => {
    const d = computeGrowth({ ...base, today: "2026-11-07" }) as Record<string, unknown>;
    expect("recentWeek" in d).toBe(false);
    expect("loggedDaysRecentWeek" in d).toBe(false);
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

describe("서버 경로와 기기 먼저 저장 경로가 같은 이번 주 값을 낸다", () => {
  // 서울 시각 → 두노 하루: 새벽 4시에 하루가 넘어간다. 월요일 03:59는 아직 일요일(지난 주), 월요일 04:00부터 새 주
  const cases: { name: string; at: string; today: string; weekStart: string }[] = [
    { name: "낮(11-07 12:00)", at: "2026-11-07T03:00:00.000Z", today: "2026-11-07", weekStart: "2026-11-02" },
    { name: "월요일 새벽 4시 바로 전(11-09 03:59)", at: "2026-11-08T18:59:00.000Z", today: "2026-11-08", weekStart: "2026-11-02" },
    { name: "월요일 새벽 4시 정각(11-09 04:00)", at: "2026-11-08T19:00:00.000Z", today: "2026-11-09", weekStart: "2026-11-09" },
  ];
  for (const c of cases) {
    it(`${c.name}: 같은 기록이면 thisWeek·loggedDaysThisWeek·상태보기 그래프 값이 같다`, async () => {
      const at = new Date(c.at);
      const server = await readGrowthForUser({ supabase: fakeTablesClient(serverStore(), { sub: ME }), key: KEY, now: () => at });
      expect(server.ok).toBe(true);
      if (!server.ok) return;
      const device = deriveGrowth(deviceMirror(), at.getTime());
      expect(device.ok).toBe(true);
      if (!device.ok) return;
      expect(server.data.today).toBe(c.today);
      expect(device.data.today).toBe(c.today);
      expect(server.data.weekStart).toBe(c.weekStart);
      expect(device.data.weekStart).toBe(c.weekStart);
      expect(sortById(device.data.thisWeek)).toEqual(sortById(server.data.thisWeek));
      expect(device.data.loggedDaysThisWeek).toBe(server.data.loggedDaysThisWeek);
      // 화면이 만드는 그래프 값도 같다
      const chartOf = (d: typeof server.data) => buildStatusChart({ categoryIds: d.categories.map((x) => x.id), ratios: d.ratios, totals: d.thisWeek });
      expect(chartOf(device.data)).toEqual(chartOf(server.data));
    });
  }

  it("새벽 4시 경계: 월요일 03:59에는 아직 지난 주(11-02~11-08)라 일요일 11-08 기록이 들고, 04:00부터는 새 주라 이번 주가 비고 11-09 기록만 든다", async () => {
    const logs = [...LOGS, log("2026-11-08", [{ categoryId: C2, minutes: 45 }]), log("2026-11-09", [{ categoryId: C1, minutes: 20 }])];
    const lastMinute = deriveGrowth({ ...deviceMirror(), logs }, Date.parse("2026-11-08T18:59:00.000Z"));
    const firstMinute = deriveGrowth({ ...deviceMirror(), logs }, Date.parse("2026-11-08T19:00:00.000Z"));
    expect(lastMinute.ok && lastMinute.data.thisWeek.find((t) => t.categoryId === C2)?.minutes).toBe(75); // 11-03의 30 + 11-08의 45
    expect(lastMinute.ok && lastMinute.data.thisWeek.find((t) => t.categoryId === C1)?.minutes).toBe(90); // 11-09(다음 주)는 빠짐
    expect(firstMinute.ok && firstMinute.data.thisWeek).toEqual([{ categoryId: C1, minutes: 20 }]); // 새 주: 11-09만
    expect(firstMinute.ok && firstMinute.data.loggedDaysThisWeek).toBe(1);
  });
});
