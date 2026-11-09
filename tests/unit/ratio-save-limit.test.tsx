// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeScreen } from "../../components/me-screen";
import { entriesToRatios, OTHER_RATIO_ID, type RatioEntry } from "../../components/ratio-editor";
import { buildStatusChart, fillTimeFor } from "../../lib/growth/status-chart";
import { readSettingsForUser, saveRatiosForUser } from "../../lib/settings/core";
import { checkRatios, RATIO_ITEMS_MAX } from "../../lib/settings/validation";
import type { SettingsApi } from "../../lib/onboarding-api";
import type { PushApi } from "../../lib/push/subscribe";
import type { NotifySettings, SettingsData } from "../../lib/settings/types";
import { encryptCategoryName, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/** 「합계」 줄은 없앴다(합은 늘 100, 정합 대조 B S1-3). 대신 보이는 숫자 칸 값의 합이 100인지 본다(칸이 하나 이상 있어야 한다) */
function expectFieldSum100() {
  const fields = [...document.querySelectorAll<HTMLInputElement>("input.ratio-field")];
  expect(fields.length).toBeGreaterThan(0);
  expect(fields.reduce((sum, f) => sum + Number(f.value), 0)).toBe(100);
  expect(document.body.textContent).not.toContain("합계");
}


/**
 * 분야 50개 + 기타 몫일 때 처음 정한 비율 저장(고침4 합치기, 있던 결함): 0% 줄은 저장 목록에서 뺀다.
 * 서버 검증(checkRatios·saveRatiosForUser)은 그대로이고, 상한 50은 지금도 지킨다.
 */

const KEY = parseTodoKey(Buffer.alloc(32, 5).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-11-07T03:00:00.000Z");
const IDS = Array.from({ length: 50 }, (_, i) => `c${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`);
const NOTIFY_OFF: NotifySettings = { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 };

const entries = (percents: number[], other: number): RatioEntry[] => [
  ...IDS.map((id, i) => ({ id, name: `분야${i + 1}`, percent: percents[i] ?? 0 })),
  { id: OTHER_RATIO_ID, name: "기타", percent: other },
];
/** 분야 50개 가운데 앞 셋만 몫이 있고 기타에도 몫이 있다: 기타 +, 마지막 분야 −, 다이얼로 기타 경계를 움직인 끝 모습 */
const LIKE_USER = entries([40, 30, 10], 20);

function store50() {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const id of IDS) store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName("분야", ME, KEY!), archived_at: null });
  return store;
}
const deps = (store: FakeStore) => ({ supabase: fakeTablesClient(store, { sub: ME }), key: KEY, now: () => NOW });

describe("entriesToRatios: 0% 줄은 싣지 않는다", () => {
  it("분야 50개 + 기타 > 0: 몫이 있는 줄만 가고(4항목), 서버 검증 함수가 받는다", () => {
    const ratios = entriesToRatios(LIKE_USER);
    expect(ratios).toEqual([
      { categoryId: IDS[0], percent: 40 },
      { categoryId: IDS[1], percent: 30 },
      { categoryId: IDS[2], percent: 10 },
      { categoryId: null, percent: 20 },
    ]);
    expect(checkRatios(ratios).ok).toBe(true);
    expect(ratios.length).toBeLessThanOrEqual(RATIO_ITEMS_MAX);
  });

  it("옛 방식(0% 분야도 모두 싣고 기타를 하나 더)이면 51항목이라 서버 검증이 거절했다 — 그 입력은 지금도 거절한다(상한 50은 그대로)", () => {
    const old = [...IDS.map((categoryId, i) => ({ categoryId, percent: [40, 30, 10][i] ?? 0 })), { categoryId: null, percent: 20 }];
    expect(old).toHaveLength(51);
    expect(checkRatios(old).ok).toBe(false);
  });

  it("기타 0%도 싣지 않는다(이전과 같다). 합 100이 한 분야면 한 항목이다", () => {
    expect(entriesToRatios(entries([100], 0))).toEqual([{ categoryId: IDS[0], percent: 100 }]);
    expect(entriesToRatios(entries([], 100))).toEqual([{ categoryId: null, percent: 100 }]);
  });
});

describe("분야 50개 + 기타 저장은 서버 저장 함수(가짜 DB)를 통과하고, 빠진 분야는 0%로 읽힌다", () => {
  it("저장 → 다시 읽으면 몫이 있는 줄만 있고, 새 저장에서 0%로 줄인 분야의 옛 몫은 지워진다", async () => {
    const store = store50();
    // 먼저 옛 몫이 있던 분야 하나(IDS[3])를 만들어 둔다
    expect((await saveRatiosForUser(deps(store), [{ categoryId: IDS[3], percent: 100 }])).ok).toBe(true);
    const saved = await saveRatiosForUser(deps(store), entriesToRatios(LIKE_USER));
    expect(saved.ok).toBe(true);
    const read = await readSettingsForUser(deps(store));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.ratios.find((r) => r.categoryId === IDS[3])).toBeUndefined(); // 0%로 줄인 분야의 옛 몫은 없다
    expect(read.data.ratios.reduce((s, r) => s + r.percent, 0)).toBe(100);
    expect(read.data.ratios.find((r) => r.categoryId === null)?.percent).toBe(20);
  });

  it("상태보기: 저장 목록에 없는 분야는 0%로 그려지고, 놓친 분야·채울 시간에도 0% 분야는 들지 않는다", () => {
    const ratios = entriesToRatios(LIKE_USER);
    const chart = buildStatusChart({ categoryIds: IDS, ratios, totals: [{ categoryId: IDS[5], minutes: 120 }] });
    expect(chart.ratio).toHaveLength(51); // 분야 50 + 기타
    const byId = new Map(chart.ratio.map((p) => [p.categoryId, p.percent]));
    expect(byId.get(IDS[0])).toBe(40);
    expect(byId.get(IDS[3])).toBe(0);
    expect(byId.get(IDS[49])).toBe(0);
    expect(byId.get(null)).toBe(20);
    expect(chart.ratio.reduce((s, p) => s + p.percent, 0)).toBe(100);
    expect(chart.rows.find((r) => r.categoryId === IDS[3])?.ratioPercent).toBe(0);
    // 놓친 분야: 몫이 있는 분야만(IDS[5]는 몫이 없는데 많이 썼다 → 놓친 것이 아니다)
    expect(chart.missed.map((m) => m.categoryId).sort()).toEqual([IDS[0], IDS[1], IDS[2], null].sort());
    const fill = fillTimeFor({ categoryIds: IDS, ratios, goalItems: null, thisWeek: [{ categoryId: IDS[5], minutes: 120 }] });
    expect(fill.items.some((i) => i.categoryId === IDS[3] || i.categoryId === IDS[49])).toBe(false);
  });
});

describe("다시 열 때 저장 목록에 없는 분야는 0%로 보인다", () => {
  beforeEach(() => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("내 정보: 분야 50개 + 몫이 있는 넷으로 열면 나머지 분야 숫자 칸이 0이다(합 100)", () => {
    const settings: SettingsData = { goal: null, goalReadable: true, onboardingDone: true, notify: NOTIFY_OFF, ratios: entriesToRatios(LIKE_USER) };
    const api: SettingsApi = { addCategory: vi.fn(), saveRatios: vi.fn(), saveSettings: vi.fn(), requestPermission: vi.fn() };
    const push = { permission: vi.fn(() => "default" as const), supported: vi.fn(() => true), hasKey: vi.fn(() => true), subscribed: vi.fn(async () => false), enable: vi.fn(), disable: vi.fn() } as unknown as PushApi;
    render(<MeScreen settings={settings} categories={IDS.map((id, i) => ({ id, name: `분야${i + 1}` }))} api={api} push={push} />);
    const value = (name: string) => Number((screen.getByLabelText(`${name} 비율(%)`) as HTMLInputElement).value);
    expect([value("분야1"), value("분야2"), value("분야3"), value("기타")]).toEqual([40, 30, 10, 20]);
    expect(value("분야4")).toBe(0);
    expect(value("분야50")).toBe(0);
    expectFieldSum100();
  });
});
