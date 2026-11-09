// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_PAGE_TEXT, CategoryPage, categorySummary, ringSlicePath, SUMMARY_RING_TRACK } from "../../components/category-page";
import type { GrowthApi } from "../../lib/growth-api";
import { buildStatusChart } from "../../lib/growth/status-chart";
import type { GrowthData } from "../../lib/growth/types";
import type { EveningLog } from "../../lib/evening/types";
import { deriveCategoryDays } from "../../lib/local/derive";
import type { Mirror } from "../../lib/local/types";
import {
  CATEGORY_PAGE_TODO_LIMIT,
  categoryPageFromDay,
  dayBarPercent,
  longestDayMinutes,
  mergeCategoryMinutes,
  minutesInLog,
} from "../../lib/notes/category-minutes";
import type { CategoryPageData } from "../../lib/notes/types";

/**
 * 원샷 v2 고침8(23 명세 2~4): 분야 페이지 요약 카드(고리 · 세 줄)와 날짜별 시간 막대.
 * 고리 % = 상태보기 「총 시간」과 같은 계산(buildStatusChart 최대 나머지), 막대 길이 = 그날 분 ÷ 가장 긴 날 분, 화면 읽기 글.
 */

afterEach(cleanup);

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";

function growth(over: Partial<GrowthData> = {}): GrowthData {
  return {
    today: "2026-11-13",
    weekStart: "2026-11-10",
    lastWeekStart: "2026-11-03",
    lastMonthRange: { from: "2026-10-01", to: "2026-10-31" },
    categories: [
      { id: C1, name: "어학" },
      { id: C2, name: "글쓰기" },
    ],
    ratios: [
      { categoryId: C1, percent: 30 },
      { categoryId: C2, percent: 70 },
    ],
    thisWeek: [{ categoryId: C1, minutes: 120 }],
    lastWeek: [],
    lastMonth: [],
    // 어학 12시간 / 글쓰기 36시간 → 전체 중 어학 25%
    cumulative: [
      { categoryId: C1, minutes: 720 },
      { categoryId: C2, minutes: 2160 },
    ],
    loggedDaysThisWeek: 1,
    loggedDaysTotal: 10,
    streakWeeks: 0,
    goal: null,
    goalText: null,
    ...over,
  };
}

const EMPTY = growth({ thisWeek: [], cumulative: [] });

function api(data: CategoryPageData): GrowthApi {
  return {
    fetchGrowth: vi.fn(),
    fetchCategoryPage: vi.fn(async () => ({ ok: true as const, data })),
    recordView: vi.fn(async () => ({ ok: true })),
  } as unknown as GrowthApi;
}

async function mount(props: { data: CategoryPageData; growth: GrowthData; categoryId: string | null; name: string }) {
  const a = api(props.data);
  render(<CategoryPage api={a} categoryId={props.categoryId} name={props.name} growth={props.growth} onClose={() => {}} />);
  await act(async () => {});
  return a;
}

const visibleLines = () => [...document.querySelectorAll(".category-summary-lines p")].map((p) => p.textContent);

describe("요약 카드 값(categorySummary)", () => {
  it("고리 % = 상태보기 「총 시간」 계산(누적, 최대 나머지)과 같다 · 세 값", () => {
    const g = growth();
    const s = categorySummary(g, C1);
    expect(s).toMatchObject({ totalMinutes: 720, percent: 25, weekMinutes: 120, ratioPercent: 30, color: "var(--color-category-1)" });
    // 셋이 1:1:1이면 34 · 33 · 33 — 상태보기 줄과 같은 반올림(앞 분야가 나머지를 먼저 받는다)
    const three = growth({
      categories: [
        { id: C1, name: "어학" },
        { id: C2, name: "글쓰기" },
        { id: C3, name: "CS" },
      ],
      cumulative: [
        { categoryId: C1, minutes: 60 },
        { categoryId: C2, minutes: 60 },
        { categoryId: C3, minutes: 60 },
      ],
    });
    const chart = buildStatusChart({ categoryIds: [C1, C2, C3], ratios: three.ratios, totals: three.cumulative });
    const percents = [C1, C2, C3].map((id) => categorySummary(three, id).percent);
    expect(percents).toEqual([34, 33, 33]);
    expect(percents).toEqual([C1, C2, C3].map((id) => chart.rows.find((r) => r.categoryId === id)!.spentPercent));
    expect(categorySummary(three, C3).color).toBe("var(--color-category-3)");
  });

  it("목표 비율 줄: 비율 0인 분야 · 비율 미설정 · 기타는 null", () => {
    const g = growth({ ratios: [{ categoryId: C1, percent: 100 }, { categoryId: null, percent: 0 }] });
    expect(categorySummary(g, C1).ratioPercent).toBe(100);
    expect(categorySummary(g, C2).ratioPercent).toBeNull();
    expect(categorySummary(growth({ ratios: [] }), C1).ratioPercent).toBeNull();
    // 기타는 처음 정한 비율에 들어 있어도 줄이 없다(23 명세 4)
    expect(categorySummary(growth({ ratios: [{ categoryId: C1, percent: 50 }, { categoryId: null, percent: 50 }] }), null).ratioPercent).toBeNull();
    expect(categorySummary(g, null).color).toBe("var(--color-category-other)");
  });
});

describe("고리 그림", () => {
  it("12시에서 시계 방향: 25%는 3시에서 끝나고, 50% 넘으면 큰 호, 0은 없음, 100은 고리 전체", () => {
    const d25 = ringSlicePath(25)!;
    expect(d25.startsWith("M 0 -43.5 A 43.5 43.5 0 0 1 43.5 0 L 30.45 0")).toBe(true);
    expect(ringSlicePath(75)!).toContain("A 43.5 43.5 0 1 1 -43.5 0");
    expect(ringSlicePath(0)).toBeNull();
    expect(ringSlicePath(Number.NaN)).toBeNull();
    // 두께 = 반지름의 30%: 바깥 43.5, 안 30.45
    expect(ringSlicePath(100)!).toMatch(/^M 0 -43\.5 .* M 0 -30\.45 /);
  });
});

describe("분야 페이지 요약 카드(화면)", () => {
  it("고리(aria-hidden, 바탕 + 분야 색 조각 + 1px 윤곽) · 가운데 「25%」「전체 중」 · 세 줄 · 카드 글", async () => {
    await mount({ data: { categoryId: C1, days: [] }, growth: growth(), categoryId: C1, name: "어학" });
    const card = document.querySelector(".category-summary")!;
    expect(card.getAttribute("aria-label")).toBe("어학, 총 12시간, 전체 중 25%, 이번 주 2시간, 목표 비율 30%");
    expect(card.querySelector(".sr-only")!.textContent).toBe("어학, 총 12시간, 전체 중 25%, 이번 주 2시간, 목표 비율 30%");
    const ring = card.querySelector(".category-ring")!;
    expect(ring.getAttribute("aria-hidden")).toBe("true");
    expect((ring.querySelector(".category-ring-track") as SVGPathElement).style.fill).toBe(SUMMARY_RING_TRACK);
    const slice = ring.querySelector(".category-ring-slice") as SVGPathElement;
    expect(slice).not.toBeNull();
    expect(slice.style.fill).toBe("var(--color-category-1)");
    expect(slice.getAttribute("stroke")).toContain("--color-chart-outline");
    expect(slice.getAttribute("stroke-width")).toBe("1");
    expect(slice.getAttribute("d")).toBe(ringSlicePath(25));
    expect(ring.querySelector("svg")!.getAttribute("width")).toBe("88");
    expect(ring.querySelector(".category-ring-percent")!.textContent).toBe("25%");
    expect(ring.querySelector(".category-ring-caption")!.textContent).toBe("전체 중");
    expect(visibleLines()).toEqual(["총 12시간", "이번 주 2시간", "목표 비율 30%"]);
    expect(document.querySelector(".category-summary-lines")!.getAttribute("aria-hidden")).toBe("true");
    // 머리의 색 점도 분야 색(그림이라 읽지 않음)
    const dot = document.querySelector(".category-head-dot") as HTMLElement;
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    expect(dot.style.background).toBe("var(--color-category-1)");
  });

  it("시간 글자는 상태보기 꼴(「n시간 n분」)", async () => {
    await mount({ data: { categoryId: C1, days: [] }, growth: growth({ cumulative: [{ categoryId: C1, minutes: 754 }], thisWeek: [{ categoryId: C1, minutes: 95 }] }), categoryId: C1, name: "어학" });
    expect(visibleLines()).toEqual(["총 12시간 34분", "이번 주 1시간 35분", "목표 비율 30%"]);
    expect(document.querySelector(".category-ring-percent")!.textContent).toBe("100%");
  });

  it("0이면 바탕 고리만 + 「0%」 · 「총 0시간」 · 「이번 주 0시간」, 빈 글 「할 일 0개」", async () => {
    await mount({ data: { categoryId: C2, days: [] }, growth: EMPTY, categoryId: C2, name: "글쓰기" });
    expect(document.querySelector(".category-ring-track")).not.toBeNull();
    expect(document.querySelector(".category-ring-slice")).toBeNull();
    expect(document.querySelector(".category-ring-percent")!.textContent).toBe("0%");
    expect(visibleLines()).toEqual(["총 0시간", "이번 주 0시간", "목표 비율 70%"]);
    expect(screen.getByText("할 일 0개")).toBeTruthy();
    expect(CATEGORY_PAGE_TEXT.empty).toBe("할 일 0개");
    expect(document.querySelectorAll(".category-day")).toHaveLength(0);
  });

  it("기타 페이지: 같은 꼴, 「목표 비율」 줄 없음(카드 글에도 없음)", async () => {
    const g = growth({ cumulative: [{ categoryId: C1, minutes: 90 }, { categoryId: null, minutes: 30 }], thisWeek: [{ categoryId: null, minutes: 30 }] });
    await mount({ data: { categoryId: null, days: [{ day: "2026-11-13", minutes: 30, todos: [] }] }, growth: g, categoryId: null, name: "기타" });
    expect(visibleLines()).toEqual(["총 30분", "이번 주 30분"]);
    expect(document.querySelector(".category-summary")!.getAttribute("aria-label")).toBe("기타, 총 30분, 전체 중 25%, 이번 주 30분");
    expect((document.querySelector(".category-ring-slice") as SVGPathElement).style.fill).toBe("var(--color-category-other)");
    expect(document.querySelectorAll(".category-day")).toHaveLength(1);
  });

  it("기타 빈 상태: 요약 카드(0%) + 「할 일 0개」", async () => {
    await mount({ data: { categoryId: null, days: [] }, growth: EMPTY, categoryId: null, name: "기타" });
    expect(document.querySelector(".category-ring-percent")!.textContent).toBe("0%");
    expect(visibleLines()).toEqual(["총 0시간", "이번 주 0시간"]);
    expect(screen.getByText("할 일 0개")).toBeTruthy();
  });

  it("분야 이름 HTML은 글자 그대로(요소가 되지 않는다)", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const g = growth({ categories: [{ id: C1, name: evil }] });
    await mount({ data: { categoryId: C1, days: [{ day: "2026-11-13", minutes: 10, todos: [{ id: "t", text: evil, done: false, notes: [] }] }] }, growth: g, categoryId: C1, name: evil });
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(evil);
    expect(document.querySelector(".category-summary .sr-only")!.textContent!.startsWith(`${evil}, 총`)).toBe(true);
    expect(screen.getByText(evil, { selector: ".note-text" })).toBeTruthy();
  });
});

describe("날짜별 시간 막대(화면)", () => {
  const days: CategoryPageData["days"] = [
    { day: "2026-11-13", minutes: 90, todos: [{ id: "t1", text: "토익 단어 50개", done: true, notes: [{ id: "n1", todoId: "t1", day: "2026-11-13", createdAt: "x", readable: true, text: "단어장 Day 12까지 외움" }] }] },
    { day: "2026-11-12", minutes: 120, todos: [{ id: "t2", text: "토익 LC 한 회 풀기", done: false, notes: [] }] },
    { day: "2026-11-11", minutes: 0, todos: [{ id: "t3", text: "영어 면접 답변", done: false, notes: [] }] },
    { day: "2026-11-10", minutes: 30, todos: [] },
  ];

  it("최근 날 먼저 · 머리(날짜 · 시간) · 막대 길이 = 그날 ÷ 가장 긴 날 · 0이면 시간 글·막대 없음 · 시간만 있는 날은 카드 없음", async () => {
    await mount({ data: { categoryId: C1, days }, growth: growth(), categoryId: C1, name: "어학" });
    const sections = [...document.querySelectorAll(".category-day")];
    expect(sections.length).toBe(4);
    expect(sections.map((s) => s.querySelector(".category-day-date")!.textContent)).toEqual(["11월 13일 금요일", "11월 12일 목요일", "11월 11일 수요일", "11월 10일 화요일"]);
    expect(sections.map((s) => s.querySelector(".category-day-minutes")?.textContent ?? null)).toEqual(["1시간 30분", "2시간", null, "30분"]);
    const widths = sections.map((s) => (s.querySelector(".category-day-fill") as HTMLElement | null)?.style.inlineSize ?? null);
    expect(widths).toEqual(["75%", "100%", null, "25%"]);
    // 막대: 분야 색 + 1px 윤곽(chart-outline), 그림이라 읽지 않음
    const fill = sections[1].querySelector(".category-day-fill") as HTMLElement;
    expect(fill.style.background).toBe("var(--color-category-1)");
    expect(fill.classList.contains("chart-outline")).toBe(true);
    expect(sections[1].querySelector(".category-day-bar")!.getAttribute("aria-hidden")).toBe("true");
    // 카드: 할 일이 있는 날만
    expect(sections.map((s) => s.querySelector(".category-day-card") !== null)).toEqual([true, true, true, false]);
    expect(sections[0].querySelector(".category-day-card")!.textContent).toContain("단어장 Day 12까지 외움");
    expect(sections[0].querySelector(".done-tag")!.textContent).toBe("끝냄");
    expect(sections[1].querySelector(".category-day-card")!.textContent).toContain("작업 기록 없음");
  });

  it("화면 읽기: 날짜 머리 「11월 13일 금요일, 1시간 30분」, 0인 날은 날짜만", async () => {
    await mount({ data: { categoryId: C1, days }, growth: growth(), categoryId: C1, name: "어학" });
    expect(screen.getByRole("heading", { level: 3, name: "11월 13일 금요일, 1시간 30분" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "11월 10일 화요일, 30분" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "11월 11일 수요일" })).toBeTruthy();
  });

  it("모든 날이 0분이면 막대가 하나도 없다", async () => {
    await mount({ data: { categoryId: C1, days: days.map((d) => ({ ...d, minutes: 0 })) }, growth: growth(), categoryId: C1, name: "어학" });
    expect(document.querySelectorAll(".category-day").length).toBe(4);
    expect(document.querySelectorAll(".category-day-fill").length).toBe(0);
    expect(document.querySelectorAll(".category-day-minutes").length).toBe(0);
  });
});

function log(targetDay: string, savedAt: string, items: { categoryId: string | null; minutes: number }[], id = `${targetDay}-${savedAt}`): EveningLog {
  return { id, targetDay, totalMinutes: items.reduce((s, i) => s + i.minutes, 0), items, saveMode: "edited", savedAt };
}

describe("날짜별 시간 계산(mergeCategoryMinutes, 서버·기기 공통)", () => {
  const todo = (id: string) => ({ id, text: id, done: false, notes: [] });

  it("날짜 = 할 일 있는 날 ∪ 이 분야 시간 있는 날, 최근 날 먼저, 다른 분야 분은 안 셈", () => {
    const merged = mergeCategoryMinutes(
      [
        { day: "2026-11-12", todos: [todo("a")] },
        { day: "2026-11-09", todos: [todo("b")] },
      ],
      [
        log("2026-11-13", "t1", [{ categoryId: C1, minutes: 30 }]),
        log("2026-11-12", "t1", [{ categoryId: C1, minutes: 60 }, { categoryId: C2, minutes: 500 }]),
        log("2026-11-10", "t1", [{ categoryId: C2, minutes: 90 }]), // 이 분야 0 → 날짜에 안 듦
      ],
      C1,
    );
    expect(merged.map((d) => [d.day, d.minutes, d.todos.length])).toEqual([
      ["2026-11-13", 30, 0],
      ["2026-11-12", 60, 1],
      ["2026-11-09", 0, 1],
    ]);
  });

  it("기타는 categoryId null의 분, fromDay 앞의 기록은 붙이지 않는다", () => {
    const logs = [log("2026-11-13", "t", [{ categoryId: null, minutes: 45 }, { categoryId: C1, minutes: 10 }]), log("2026-11-01", "t", [{ categoryId: null, minutes: 99 }])];
    expect(minutesInLog(logs[0], null)).toBe(45);
    expect(mergeCategoryMinutes([], logs, null).map((d) => d.day)).toEqual(["2026-11-13", "2026-11-01"]);
    expect(mergeCategoryMinutes([], logs, null, "2026-11-05").map((d) => d.day)).toEqual(["2026-11-13"]);
  });

  it("범위: 할 일을 상한까지 읽었을 때만 가장 오래된 할 일 날부터", () => {
    const days = [{ day: "2026-11-13" }, { day: "2026-10-02" }];
    expect(categoryPageFromDay(CATEGORY_PAGE_TODO_LIMIT - 1, days)).toBeNull();
    expect(categoryPageFromDay(CATEGORY_PAGE_TODO_LIMIT, days)).toBe("2026-10-02");
  });

  it("가장 긴 날 = 폭 전체(100), 비율, 0이면 0", () => {
    const longest = longestDayMinutes([{ minutes: 30 }, { minutes: 120 }, { minutes: 0 }]);
    expect(longest).toBe(120);
    expect(dayBarPercent(120, longest)).toBe(100);
    expect(dayBarPercent(30, longest)).toBe(25);
    expect(dayBarPercent(0, longest)).toBe(0);
    expect(dayBarPercent(10, 0)).toBe(0);
  });
});

describe("기기 먼저 저장(deriveCategoryDays): 기기 사본의 오늘 기록에서 같은 규칙", () => {
  const mirror = (logs: EveningLog[], synced = true): Mirror =>
    ({ synced, todos: [], categories: [], settings: null, logs, goals: {}, sessions: [], notes: {}, offers: {} }) as unknown as Mirror;

  it("그날 가장 늦은 기록(F6 기준)을 쓰고, 서버가 준 할 일 묶음은 그대로, 시간만 있는 날도 든다", () => {
    const serverDays: CategoryPageData["days"] = [{ day: "2026-11-12", minutes: 999, todos: [{ id: "a", text: "a", done: false, notes: [] }] }];
    const days = deriveCategoryDays(
      mirror([
        log("2026-11-12", "2026-11-12T10:00:00.000Z", [{ categoryId: C1, minutes: 30 }]),
        log("2026-11-12", "2026-11-12T12:00:00.000Z", [{ categoryId: C1, minutes: 75 }]), // 더 늦은 것
        log("2026-11-13", "2026-11-13T12:00:00.000Z", [{ categoryId: C1, minutes: 20 }]), // 아직 보내지 않은 기록
      ]),
      C1,
      serverDays,
    )!;
    expect(days.map((d) => [d.day, d.minutes, d.todos.map((t) => t.id)])).toEqual([
      ["2026-11-13", 20, []],
      ["2026-11-12", 75, ["a"]],
    ]);
  });

  it("기기 사본의 오늘 기록을 읽지 못하면(깨진 값) 서버와 같은 기준: 할 일 묶음 그대로, minutes 0", () => {
    const serverDays: CategoryPageData["days"] = [
      { day: "2026-11-12", minutes: 75, todos: [{ id: "a", text: "a", done: true, notes: [] }] },
      { day: "2026-11-11", minutes: 30, todos: [] },
    ];
    const broken = { ...mirror([]), logs: null } as unknown as Mirror;
    expect(deriveCategoryDays(broken, C1, serverDays)).toEqual([{ day: "2026-11-12", minutes: 0, todos: [{ id: "a", text: "a", done: true, notes: [] }] }]);
  });

  it("기기 사본을 아직 모르면 null(서버 값을 그대로 쓴다)", () => {
    expect(deriveCategoryDays(mirror([], false), C1, [])).toBeNull();
  });
});
