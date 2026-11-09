// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AfterSave, AfterSaveCard, AFTER_SAVE_FILL_MS, afterSaveAnnouncement } from "../../components/after-save";
import { barWidth, buildAfterSave } from "../../lib/growth/after-save";
import type { GrowthData } from "../../lib/growth/types";
import type { GrowthApi } from "../../lib/growth-api";

/** 오늘 기록 저장 직후 「이번 주」 카드(고침9 S5-3, 명세 ⑦-7 · Figma 49:142 목표 세운 주 / 59:2 목표 없는 주). 옛 AfterSaveShortfall 시험을 옮겨 새 계약으로 */

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const CATS = [
  { id: C1, name: "어학" },
  { id: C2, name: "포트폴리오" },
  { id: C3, name: "자격증" },
];

function growth(over: Partial<GrowthData> = {}): GrowthData {
  return {
    today: "2026-11-07",
    weekStart: "2026-11-02",
    lastWeekStart: "2026-10-26",
    lastMonthRange: { from: "2026-10-01", to: "2026-10-31" },
    categories: CATS,
    ratios: [],
    thisWeek: [],
    lastWeek: [],
    lastMonth: [],
    cumulative: [],
    loggedDaysThisWeek: 1,
    loggedDaysTotal: 1,
    goal: null,
    goalText: null,
    ...over,
  };
}
/** Figma 49:142: 목표 세운 주 — 어학 2시간(+1시간, 목표 5시간) · 포트폴리오 12시간(+2시간, 목표 6시간) */
const GOAL_WEEK = growth({
  thisWeek: [{ categoryId: C1, minutes: 120 }, { categoryId: C2, minutes: 720 }, { categoryId: null, minutes: 60 }],
  goal: { weekStart: "2026-11-02", items: [{ categoryId: C1, minutes: 300 }, { categoryId: C2, minutes: 360 }] },
});
/** Figma 59:2: 목표 없는 주 — 이번 주 10시간 중 어학 2시간(20%, 목표 30%) · 포트폴리오 6시간(60%, 목표 40%) */
const RATIO_WEEK = growth({
  ratios: [{ categoryId: C1, percent: 30 }, { categoryId: C2, percent: 40 }, { categoryId: C3, percent: 30 }],
  thisWeek: [{ categoryId: C1, minutes: 120 }, { categoryId: C2, minutes: 360 }, { categoryId: null, minutes: 120 }],
});
const DELTA = [{ categoryId: C2, minutes: 120 }, { categoryId: C1, minutes: 60 }];

const rows = () =>
  Array.from(document.querySelectorAll(".after-save-card .after-save-row")).map((li) => ({
    name: li.querySelector(".after-save-name")!.textContent,
    value: li.querySelector(".after-save-value")!.textContent,
    more: li.querySelector(".after-save-more")?.textContent ?? null,
  }));
const fill = (category: string, part: "before" | "added") =>
  document.querySelector<HTMLElement>(`.after-save-row[data-category="${category}"] .after-save-fill[data-part="${part}"]`);
const tick = (category: string) => document.querySelector<HTMLElement>(`.after-save-row[data-category="${category}"] .after-save-tick`);
const status = () => Array.from(document.querySelectorAll('.after-save-card [role="status"]')).map((e) => e.textContent);

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
}
async function flushFrames() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("값(lib/growth/after-save buildAfterSave)", () => {
  it("목표 세운 주: 바뀐 분야만, 앞 칸 = 전 몫 · 뒤 칸 = 이번에 더한 몫(delta), 목표·남은 시간. 잣대 = 보이는 줄의 쓴 시간·목표 가운데 최대", () => {
    const view = buildAfterSave(DELTA, GOAL_WEEK);
    expect(view.basis).toBe("goal");
    expect(view.rows.map((r) => [r.categoryId, r.spent, r.before, r.added, r.goal, r.remaining])).toEqual([
      [C2, 720, 600, 120, 360, 0],
      [C1, 120, 60, 60, 300, 180],
    ]);
    expect(view.scale).toBe(720);
    expect(view.others).toBe(0);
  });
  it("목표 없는 주: 「이번 주 n% / 목표 n%」 — 상태보기 목표 비율 뷰와 같은 셈. 비율이 없으면 목표 %는 null", () => {
    const view = buildAfterSave(DELTA, RATIO_WEEK);
    expect(view.basis).toBe("ratio");
    expect(view.rows.map((r) => [r.categoryId, r.spentPercent, r.ratioPercent, r.goal])).toEqual([
      [C2, 60, 40, null],
      [C1, 20, 30, null],
    ]);
    expect(buildAfterSave(DELTA, { ...RATIO_WEEK, ratios: [] }).rows.map((r) => r.ratioPercent)).toEqual([null, null]);
  });
  it("많으면 바뀐 크기 큰 순(delta 순서) 넷 + 그 밖 n개. 0분 바뀜은 줄이 없다. 줄었으면 빗금 몫 없이 지금 값", () => {
    const delta = [
      { categoryId: C1, minutes: 90 },
      { categoryId: C2, minutes: -60 },
      { categoryId: C3, minutes: 45 },
      { categoryId: null, minutes: 30 },
      { categoryId: "x", minutes: 10 },
      { categoryId: "y", minutes: 5 },
      { categoryId: "z", minutes: 0 },
    ];
    const view = buildAfterSave(delta, growth({ thisWeek: [{ categoryId: C1, minutes: 90 }, { categoryId: C2, minutes: 30 }, { categoryId: C3, minutes: 45 }, { categoryId: null, minutes: 30 }] }));
    expect(view.rows.map((r) => r.categoryId)).toEqual([C1, C2, C3, null]);
    expect(view.others).toBe(2);
    expect(view.rows[1]).toMatchObject({ delta: -60, spent: 30, before: 30, added: 0 });
  });
  it("이번 주에 없는 날을 저장해 이번 주 값이 delta보다 작아도 빗금 몫은 이번 주 값을 넘지 않는다", () => {
    const view = buildAfterSave([{ categoryId: C1, minutes: 120 }], growth({ thisWeek: [{ categoryId: C1, minutes: 30 }] }));
    expect(view.rows[0]).toMatchObject({ spent: 30, before: 0, added: 30 });
    expect(barWidth(30, 0)).toBe(0);
    expect(barWidth(60, 720)).toBe(8.33);
    expect(barWidth(900, 720)).toBe(100);
  });
});

describe("AfterSaveCard 화면", () => {
  it("목표 세운 주(Figma 49:142): 「이번 주」 16 Bold · 줄마다 색 점 + 이름 · 「n시간 +n시간」(더한 몫 굵게) · 막대(앞 칸 · 빗금 칸 · 목표 눈금) · 「3시간 더」/「목표 6시간」", async () => {
    mockReducedMotion(false);
    render(<AfterSaveCard delta={DELTA} data={GOAL_WEEK} fallback={CATS} />);
    expect(screen.getByRole("heading", { name: "이번 주" }).className).toBe("after-save-week");
    expect(rows()).toEqual([
      { name: "포트폴리오", value: "12시간 +2시간", more: "목표 6시간" },
      { name: "어학", value: "2시간 +1시간", more: "3시간 더" },
    ]);
    expect(Array.from(document.querySelectorAll(".after-save-delta")).map((b) => [b.tagName, b.textContent])).toEqual([
      ["B", "+2시간"],
      ["B", "+1시간"],
    ]);
    // 색 점·막대 색 = 분야 색(분야 순서 — 다른 화면과 같은 번호)
    const dots = Array.from(document.querySelectorAll<HTMLElement>(".after-save-card .chip-dot")).map((d) => d.style.background);
    expect(dots).toEqual(["var(--color-category-2)", "var(--color-category-1)"]);
    await flushFrames();
    // 잣대 720분: 포트폴리오 600 + 120, 어학 60 + 60. 빗금 칸 폭 = delta 몫
    expect([fill(C2, "before")!.style.width, fill(C2, "added")!.style.width]).toEqual(["83.33%", "16.67%"]);
    expect([fill(C1, "before")!.style.width, fill(C1, "added")!.style.width]).toEqual(["8.33%", "8.33%"]);
    expect(fill(C1, "added")!.className).toBe("after-save-fill after-save-hatch");
    expect(fill(C1, "added")!.style.backgroundColor).toBe("var(--color-category-1)"); // 같은 색 위 빗금(옅게 하지 않음)
    expect(fill(C1, "before")!.className).toBe("after-save-fill");
    expect([tick(C2)!.style.insetInlineStart, tick(C1)!.style.insetInlineStart]).toEqual(["50%", "41.67%"]);
    // 막대 그림은 화면 읽기에서 숨기고 상태 알림 한 문장으로 읽는다
    expect(document.querySelector(".after-save-bar")!.getAttribute("aria-hidden")).toBe("true");
    expect(status()).toEqual(["저장했어요. 포트폴리오 2시간 더해서 이번 주 12시간. 목표 6시간. 어학 1시간 더해서 이번 주 2시간. 목표까지 3시간."]);
  });

  it("목표 없는 주(Figma 59:2): 막대 아래 「이번 주 20% / 목표 30%」, 목표 눈금 없음. 상태 알림도 %", async () => {
    render(<AfterSaveCard delta={DELTA} data={RATIO_WEEK} fallback={CATS} />);
    expect(rows()).toEqual([
      { name: "포트폴리오", value: "6시간 +2시간", more: "이번 주 60% / 목표 40%" },
      { name: "어학", value: "2시간 +1시간", more: "이번 주 20% / 목표 30%" },
    ]);
    expect(document.querySelectorAll(".after-save-tick")).toHaveLength(0);
    await flushFrames();
    expect([fill(C2, "before")!.style.width, fill(C2, "added")!.style.width]).toEqual(["66.67%", "33.33%"]);
    expect(status()).toEqual(["저장했어요. 포트폴리오 2시간 더해서 이번 주 6시간. 이번 주 60%, 목표 40%. 어학 1시간 더해서 이번 주 2시간. 이번 주 20%, 목표 30%."]);
  });

  it("명세 예 문장: 「저장했어요. 어학 1시간 더해서 이번 주 2시간. 목표까지 3시간.」", () => {
    expect(afterSaveAnnouncement([{ categoryId: C1, minutes: 60 }], GOAL_WEEK, CATS)).toBe("저장했어요. 어학 1시간 더해서 이번 주 2시간. 목표까지 3시간.");
  });

  it("많으면 큰 순 넷 + 「그 밖 2개」. 나누지 않고 저장하면 기타 한 줄", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `d${i}d${i}d${i}d${i}-0000-4000-8000-00000000000${i}`, name: `분야 ${i + 1}` }));
    const data = growth({ categories: six, thisWeek: six.map((c, i) => ({ categoryId: c.id, minutes: (6 - i) * 60 })) });
    render(<AfterSaveCard delta={six.map((c, i) => ({ categoryId: c.id, minutes: (6 - i) * 30 }))} data={data} fallback={six} />);
    expect(rows().map((r) => r.name)).toEqual(["분야 1", "분야 2", "분야 3", "분야 4"]);
    expect(screen.getByText("그 밖 2개").className).toBe("after-save-others");
    expect(status()[0]).toMatch(/그 밖 2개\.$/);
    cleanup();
    render(<AfterSaveCard delta={[{ categoryId: null, minutes: 90 }]} data={growth({ thisWeek: [{ categoryId: null, minutes: 90 }] })} fallback={CATS} />);
    expect(rows()).toEqual([{ name: "기타", value: "1시간 30분 +1시간 30분", more: "이번 주 100%" }]);
    expect(document.querySelector<HTMLElement>(".after-save-card .chip-dot")!.style.background).toBe("var(--color-category-other)");
  });

  it("막대는 0에서 400ms로 차오른다. 「동작 줄이기」면 처음부터 다 찬 폭에 움직임 없음", async () => {
    mockReducedMotion(false);
    render(<AfterSaveCard delta={DELTA} data={GOAL_WEEK} fallback={CATS} />);
    expect(fill(C1, "before")!.style.width).toBe("0%"); // 첫 그림
    expect(fill(C1, "before")!.style.transition).toBe(`width ${AFTER_SAVE_FILL_MS}ms ease-out`);
    await flushFrames();
    expect(fill(C1, "before")!.style.width).toBe("8.33%");
    cleanup();
    mockReducedMotion(true);
    render(<AfterSaveCard delta={DELTA} data={GOAL_WEEK} fallback={CATS} />);
    expect(fill(C1, "before")!.style.width).toBe("8.33%");
    expect(fill(C1, "before")!.style.transition).toBe("none");
  });

  it("빗금·윤곽·눈금은 CSS가 실제로 칠한다(먹남색 사선 빗금 · 1px 윤곽 · 2px 눈금)", () => {
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toMatch(/\.after-save-hatch \{ background-image: repeating-linear-gradient\(135deg, var\(--color-chart-outline\) 0 1px, transparent 1px 5px\); \}/);
    expect(css).toMatch(/\.after-save-fill \{[^}]*box-shadow: inset 0 0 0 1px var\(--color-chart-outline\);/);
    expect(css).toMatch(/\.after-save-tick \{[^}]*inline-size: 2px;[^}]*background: var\(--color-text\);/);
    expect(css).toMatch(/\.after-save-bar \{[^}]*block-size: 16px;[^}]*background: var\(--color-notice-bg\);/);
  });

  it("상태보기 데이터가 없으면(읽기 실패) 막대 없이 바뀐 분야·바뀐 시간만, 알림은 「저장했어요. 어학 +1시간.」 꼴. 바뀐 것이 없으면 「바뀐 시간이 없어요」", () => {
    render(<AfterSaveCard delta={[{ categoryId: C1, minutes: 60 }]} data={null} fallback={CATS} />);
    expect(document.querySelectorAll(".after-save-bar")).toHaveLength(0);
    expect(document.querySelector(".after-save-row .after-save-value")!.textContent).toBe("+1시간");
    expect(status()).toEqual(["저장했어요. 어학 +1시간."]);
    cleanup();
    render(<AfterSaveCard delta={[]} data={GOAL_WEEK} fallback={CATS} />);
    expect(screen.getByText("바뀐 시간이 없어요")).toBeTruthy();
    expect(status()).toEqual(["저장했어요. 바뀐 시간이 없어요."]);
  });

  it("악용: 분야 이름의 HTML은 글자 그대로(img 요소 없음). 정상 이름도 그대로", async () => {
    const evil = '<img src=x onerror="window.__as=1">';
    render(<AfterSaveCard delta={DELTA} data={{ ...GOAL_WEEK, categories: [{ id: C1, name: evil }, { id: C2, name: "포트폴리오" }] }} fallback={CATS} />);
    expect(rows().map((r) => r.name)).toEqual(["포트폴리오", evil]);
    expect(status()[0]).toContain(evil);
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect((window as unknown as { __as?: number }).__as).toBeUndefined();
  });
});

describe("AfterSave(상태보기 데이터 읽기 — 이미 있는 GrowthApi.fetchGrowth, 새 입구 없음)", () => {
  const api = (res: Awaited<ReturnType<GrowthApi["fetchGrowth"]>> | Promise<never>): GrowthApi => ({
    fetchGrowth: vi.fn(async () => res),
    fetchCategoryPage: vi.fn(),
    recordView: vi.fn(),
  });
  it("한 번 읽어 카드를 그린다. 읽는 동안 상태 알림은 비어 있다(다 읽은 뒤 한 번)", async () => {
    let resolve!: (v: { ok: true; data: GrowthData }) => void;
    const pending = new Promise<{ ok: true; data: GrowthData }>((r) => (resolve = r));
    const a: GrowthApi = { fetchGrowth: vi.fn(() => pending), fetchCategoryPage: vi.fn(), recordView: vi.fn() };
    render(<AfterSave api={a} delta={DELTA} fallback={CATS} />);
    expect(status()).toEqual([""]);
    await act(async () => resolve({ ok: true, data: GOAL_WEEK }));
    expect(rows().map((r) => r.more)).toEqual(["목표 6시간", "3시간 더"]);
    expect(a.fetchGrowth).toHaveBeenCalledTimes(1);
  });
  it("읽기가 실패하거나 던지면 바뀐 몫만 보인다(화면이 깨지지 않는다)", async () => {
    render(<AfterSave api={api({ ok: false, error: "unavailable" })} delta={DELTA} fallback={CATS} />);
    await act(async () => {});
    expect(rows().map((r) => r.value)).toEqual(["+2시간", "+1시간"]);
    cleanup();
    const thrower: GrowthApi = { fetchGrowth: vi.fn(async () => Promise.reject(new Error("x"))), fetchCategoryPage: vi.fn(), recordView: vi.fn() };
    render(<AfterSave api={thrower} delta={DELTA} fallback={CATS} />);
    await act(async () => {});
    expect(status()).toEqual(["저장했어요. 포트폴리오 +2시간. 어학 +1시간."]);
  });
});
