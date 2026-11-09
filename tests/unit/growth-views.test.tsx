// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrowthData } from "../../lib/growth/types";
import type { GrowthApi } from "../../lib/growth-api";

vi.mock("../../app/views/actions", () => ({ recordView: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
// 조각 색을 정하는 곳(categoryColorValue) 호출을 가로챌 수 있게 감싼다(기본은 진짜 함수 그대로)
vi.mock("../../lib/category-color", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/category-color")>();
  return { ...real, categoryColorValue: vi.fn(real.categoryColorValue) };
});

import { categoryColorValue } from "../../lib/category-color";
import { goalProgress } from "../../lib/goals/validation";
import { EVENING_TEXT } from "../../components/evening-record";
import { GOAL_TEXT } from "../../components/goal";
import { GROWTH_TEXT, GrowthScreen } from "../../components/growth-screen";
import { STATUS_VIEWS } from "../../components/growth-views";

/**
 * 상태보기 두 뷰(원샷 v2 고침5, 명세 ③-S + ⑩ PM 8 · d-110): 처음 탭 규칙, 탭 꼴·키보드, 맨 위 목표 한 줄,
 * 이번 주 목표 뷰(「목표 n 중 n」, 줄 순서, 막대·눈금·빈 자리), 목표 비율 뷰(띠 두 줄 점선/실선, 원 실선, 목록, 기간),
 * 없앤 것(채울·쌓인 것·처음 정한 비율·저녁 기록·살구), 화면 읽기 요약, 기억한 값, 접근성, 사용자 글.
 */

const G1 = "a1a1a1a1-0000-4000-8000-000000000000";
const G2 = "a2a2a2a2-0000-4000-8000-000000000000";
const G3 = "a3a3a3a3-0000-4000-8000-000000000000";
const G4 = "a4a4a4a4-0000-4000-8000-000000000000";
const WEEK = "2026-11-02";

/**
 * 명세 ③-S 예와 같은 값(만든 순서 어학 · 포트폴리오 · 자격증 · 운동).
 * 이번 주 목표 15시간 중 12시간: 어학 2/5 · 포트폴리오 12/6 · 자격증 3/3 · 운동 1/1 · 기타 2.
 * 목표 비율 30 · 40 · 20 · 10 → 이번 주(20시간) 10 · 60 · 15 · 5 · 기타 10
 */
function spec(over: Partial<GrowthData> = {}): GrowthData {
  return {
    today: "2026-11-07",
    weekStart: WEEK,
    lastWeekStart: "2026-10-26",
    lastMonthRange: { from: "2026-10-01", to: "2026-10-31" },
    categories: [
      { id: G1, name: "어학" },
      { id: G2, name: "포트폴리오" },
      { id: G3, name: "자격증" },
      { id: G4, name: "운동" },
    ],
    ratios: [
      { categoryId: G1, percent: 30 },
      { categoryId: G2, percent: 40 },
      { categoryId: G3, percent: 20 },
      { categoryId: G4, percent: 10 },
    ],
    thisWeek: [
      { categoryId: G1, minutes: 120 },
      { categoryId: G2, minutes: 720 },
      { categoryId: G3, minutes: 180 },
      { categoryId: G4, minutes: 60 },
      { categoryId: null, minutes: 120 },
    ],
    lastWeek: [{ categoryId: G1, minutes: 60 }],
    lastMonth: [],
    cumulative: [
      { categoryId: G1, minutes: 1200 },
      { categoryId: G2, minutes: 600 },
      { categoryId: G3, minutes: 600 },
    ],
    loggedDaysThisWeek: 6,
    loggedDaysTotal: 20,
    goal: {
      weekStart: WEEK,
      items: [
        { categoryId: G1, minutes: 300 },
        { categoryId: G2, minutes: 360 },
        { categoryId: G3, minutes: 180 },
        { categoryId: G4, minutes: 60 },
      ],
    },
    goalText: "올해 안에 토익 900점 넘기기",
    ...over,
  };
}
const noGoal = (over: Partial<GrowthData> = {}) => spec({ goal: null, ...over });

type Pref = NonNullable<GrowthApi["viewPref"]>;
function fakeApi(d: GrowthData = spec(), viewPref?: Pref): GrowthApi {
  return {
    fetchGrowth: vi.fn(async () => ({ ok: true as const, data: d })),
    fetchCategoryPage: vi.fn(),
    recordView: vi.fn(async () => ({ ok: true })),
    ...(viewPref ? { viewPref } : {}),
  } as unknown as GrowthApi;
}
async function mount(api: GrowthApi, props: { onOpenCategory?: (id: string | null, name: string) => void; onOpenEvening?: () => void; onOpenGoal?: (d: GrowthData) => void } = {}) {
  const onOpenCategory = props.onOpenCategory ?? vi.fn();
  const view = render(
    <GrowthScreen api={api} active activation={1} entry="self" onOpenCategory={onOpenCategory} onOpenEvening={props.onOpenEvening ?? vi.fn()} onOpenGoal={props.onOpenGoal} />,
  );
  await screen.findByRole("tablist", {}, { timeout: 3000 });
  return { onOpenCategory, ...view };
}
const tab = (name: string) => screen.getByRole("tab", { name });
const selected = (name: string) => tab(name).getAttribute("aria-selected");
const chip = (name: string) => screen.getByRole("button", { name });
const pressed = (name: string) => chip(name).getAttribute("aria-pressed");
const items = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>(".growth-item"));
const names = (c: HTMLElement) => items(c).map((li) => li.querySelector(".growth-name")?.textContent);
const values = (c: HTMLElement) => items(c).map((li) => li.querySelector(".growth-row-value")?.textContent);
const summary = (c: HTMLElement) => c.querySelector(".growth-body > p.sr-only")?.textContent ?? "";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("처음 탭 규칙(명세 ③-S 뷰 고르기)", () => {
  it("이번 주 목표를 세운 주: 「이번 주 목표」 탭이 켜진 채 열리고 분야별 막대 카드가 보인다", async () => {
    const { container } = await mount(fakeApi(spec()));
    expect(selected("이번 주 목표")).toBe("true");
    expect(selected("목표 비율")).toBe("false");
    expect(container.querySelector(".growth-card-title")?.textContent).toBe("목표 15시간 중 12시간");
    expect(container.querySelectorAll(".growth-goal-bar").length).toBe(5);
    expect(container.querySelector(".growth-band")).toBeNull();
  });

  it("세우지 않은 주: 「목표 비율」 탭이 켜진 채 열리고 띠그래프 두 줄이 처음 보기다", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    expect(selected("목표 비율")).toBe("true");
    expect(selected("이번 주 목표")).toBe("false");
    expect(container.querySelectorAll(".growth-band")).toHaveLength(2);
    expect(container.querySelector(".growth-pie")).toBeNull();
    expect(chip("원그래프로 보기")).toBeTruthy();
  });

  it("목표 항목이 비어 있으면 세우지 않은 주로 본다", async () => {
    await mount(fakeApi(spec({ goal: { weekStart: WEEK, items: [] } })));
    expect(selected("목표 비율")).toBe("true");
  });

  it("이 주에 고른 탭을 기억했으면 그 탭으로, 지난 주에 고른 탭은 쓰지 않고 규칙대로 연다", async () => {
    const same = await mount(fakeApi(spec(), { load: async () => ({ period: "week", view: "band", tab: "ratio", tabWeek: WEEK }), save: vi.fn(async () => {}) }));
    expect(selected("목표 비율")).toBe("true");
    same.unmount();
    cleanup();
    await mount(fakeApi(spec(), { load: async () => ({ period: "week", view: "band", tab: "ratio", tabWeek: "2026-10-26" }), save: vi.fn(async () => {}) }));
    expect(selected("이번 주 목표")).toBe("true");
  });

  it("고침6 ①: 지난주에 「이번 주 목표」를 골라 두었어도, 이번 주 목표가 없으면 처음은 「목표 비율」 탭. 이번 주 안에 고른 「이번 주 목표」는 그 주 동안 기억한다", async () => {
    const lastWeek = await mount(fakeApi(noGoal(), { load: async () => ({ period: "week", view: "band", tab: "goal", tabWeek: "2026-10-26" }), save: vi.fn(async () => {}) }));
    expect(selected("목표 비율")).toBe("true");
    expect(lastWeek.container.querySelectorAll(".growth-band")).toHaveLength(2);
    expect(lastWeek.container.querySelector(".growth-goal-set")).toBeNull();
    lastWeek.unmount();
    cleanup();
    // 같은 주에 사용자가 고른 탭은 목표가 없어도 그 탭으로 연다(명세 「고른 탭은 그 주 동안 기억」)
    const sameWeek = await mount(fakeApi(noGoal(), { load: async () => ({ period: "week", view: "band", tab: "goal", tabWeek: WEEK }), save: vi.fn(async () => {}) }));
    expect(selected("이번 주 목표")).toBe("true");
    expect(sameWeek.container.querySelector(".growth-goal-set")).not.toBeNull();
  });
});

describe("탭 꼴과 키보드(role=tablist, 좌우·Home/End)", () => {
  it("탭 둘은 tablist 안의 tab이고, 켜진 탭이 패널(tabpanel)을 가리키며 패널 이름은 그 탭이다", async () => {
    const { container } = await mount(fakeApi(spec()));
    const list = screen.getByRole("tablist", { name: GROWTH_TEXT.tabsLabel });
    expect(within(list).getAllByRole("tab").map((t) => t.textContent)).toEqual(["이번 주 목표", "목표 비율"]);
    const panel = screen.getByRole("tabpanel");
    expect(tab("이번 주 목표").getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab("이번 주 목표").id);
    expect(screen.getByRole("tabpanel", { name: "이번 주 목표" })).toBe(panel);
    // 켜진 탭만 Tab 차례에 든다(꺼진 탭은 화살표로)
    expect(tab("이번 주 목표").getAttribute("tabindex")).toBe("0");
    expect(tab("목표 비율").getAttribute("tabindex")).toBe("-1");
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
  });

  it("오른쪽·왼쪽 화살표는 옆 탭을 고르고 포커스를 옮긴다(끝에서 돌아감). Home·End는 처음·끝 탭", async () => {
    await mount(fakeApi(spec()));
    tab("이번 주 목표").focus();
    fireEvent.keyDown(tab("이번 주 목표"), { key: "ArrowRight" });
    expect(selected("목표 비율")).toBe("true");
    expect(document.activeElement).toBe(tab("목표 비율"));
    expect(screen.getByRole("tabpanel", { name: "목표 비율" })).toBeTruthy();
    fireEvent.keyDown(tab("목표 비율"), { key: "ArrowRight" });
    expect(selected("이번 주 목표")).toBe("true");
    expect(document.activeElement).toBe(tab("이번 주 목표"));
    fireEvent.keyDown(tab("이번 주 목표"), { key: "ArrowLeft" });
    expect(selected("목표 비율")).toBe("true");
    fireEvent.keyDown(tab("목표 비율"), { key: "Home" });
    expect(selected("이번 주 목표")).toBe("true");
    expect(document.activeElement).toBe(tab("이번 주 목표"));
    fireEvent.keyDown(tab("이번 주 목표"), { key: "End" });
    expect(selected("목표 비율")).toBe("true");
    expect(document.activeElement).toBe(tab("목표 비율"));
    // 다른 키는 아무것도 바꾸지 않는다
    fireEvent.keyDown(tab("목표 비율"), { key: "ArrowDown" });
    expect(selected("목표 비율")).toBe("true");
  });

  it("탭을 고르면 그 탭과 그 주(월요일)를 기기에 적는다", async () => {
    const save = vi.fn(async () => {});
    await mount(fakeApi(spec(), { load: async () => undefined, save }));
    fireEvent.click(tab("목표 비율"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ period: "week", periodWeek: null, view: "band", tab: "ratio", tabWeek: WEEK }); // 탭만 골랐다: 기간은 고른 것이 아니다(periodWeek 없음)
  });
});

describe("맨 위 목표 한 줄(⑩ PM 8)", () => {
  it("목표 한 문장이 제목 아래·탭 위에 있고, 화면 읽기는 「목표, {문장}」이다. 이름표는 보이지 않는다", async () => {
    const { container } = await mount(fakeApi(spec()));
    const line = container.querySelector<HTMLElement>(".growth-goal-line");
    expect(line).not.toBeNull();
    expect(line!.textContent).toBe("목표, 올해 안에 토익 900점 넘기기");
    expect(line!.querySelector(".sr-only")?.textContent).toBe("목표, ");
    const title = screen.getByRole("heading", { level: 1, name: "상태보기" });
    const list = screen.getByRole("tablist");
    expect(title.compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("두 뷰 공통이다(탭을 바꿔도 그대로)", async () => {
    const { container } = await mount(fakeApi(spec()));
    fireEvent.click(tab("목표 비율"));
    expect(container.querySelector(".growth-goal-line")?.textContent).toBe("목표, 올해 안에 토익 900점 넘기기");
  });

  it("목표가 비었으면(null·빈 글) 줄을 두지 않고 탭이 위로 붙는다(빈 칸·안내 글 없음)", async () => {
    for (const goalText of [null, ""]) {
      const { container, unmount } = await mount(fakeApi(spec({ goalText })));
      expect(container.querySelector(".growth-goal-line")).toBeNull();
      expect(container.textContent).not.toContain("목표, ");
      // 탭 줄이 제목 머리 바로 다음 요소다
      expect(container.querySelector(".today-header")?.nextElementSibling?.getAttribute("role")).toBe("tablist");
      unmount();
      cleanup();
    }
  });

  it("목표 글은 사용자 글: 꺾쇠·스크립트 모양은 글자 그대로 보이고 img 요소가 생기지 않는다", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const { container } = await mount(fakeApi(spec({ goalText: evil })));
    expect(container.querySelector(".growth-goal-line")?.textContent).toBe(`목표, ${evil}`);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("목표 최대 길이(100자) 글도 자르지 않고 다 그린다(말줄임 없음)", async () => {
    const long = "가나다라마바사아자차".repeat(10);
    expect(long).toHaveLength(100);
    const { container } = await mount(fakeApi(spec({ goalText: long })));
    expect(container.querySelector(".growth-goal-line")?.textContent).toBe(`목표, ${long}`);
  });
});

describe("이번 주 목표 뷰(명세 ③-S ①, PM 8 · d-110)", () => {
  it("카드 머리 「목표 15시간 중 12시간」은 lib/goals goalProgress와 같은 값이다(숫자는 굵게)", async () => {
    const d = spec();
    const { container } = await mount(fakeApi(d));
    const p = goalProgress(d.goal!.items, d.thisWeek);
    expect(p).toEqual({ targetMinutes: 900, doneMinutes: 720 });
    const head = container.querySelector(".growth-card-title")!;
    expect(head.textContent).toBe("목표 15시간 중 12시간");
    expect(Array.from(head.querySelectorAll("strong")).map((s) => s.textContent)).toEqual(["15시간", "12시간"]);
  });

  it("분야 줄 순서 = 만든 순서, 기타 맨 끝(모자란 순이 아니다). 오른쪽 값은 「쓴 시간 · 남은 시간 더」, 닿았거나 넘으면 쓴 시간만", async () => {
    const { container } = await mount(fakeApi(spec()));
    expect(names(container)).toEqual(["어학", "포트폴리오", "자격증", "운동", "기타"]);
    expect(values(container)).toEqual(["2시간 · 3시간 더", "12시간", "3시간", "1시간", "2시간"]);
    expect(items(container).map((li) => li.querySelector(".growth-goal-of")?.textContent)).toEqual(["목표 5시간", "목표 6시간", "목표 3시간", "목표 1시간", "목표 없음"]);
    // 남은 시간이 있는 줄만 굵게(평가 말 「넘음」 없음)
    expect(items(container).map((li) => li.querySelector(".growth-row-value")?.classList.contains("is-left"))).toEqual([true, false, false, false, false]);
    expect(container.textContent).not.toContain("넘음");
  });

  it("만든 순서는 남은 시간과 상관없다: 가장 많이 남은 분야가 뒤에 있어도 앞으로 오지 않는다", async () => {
    const d = spec({ goal: { weekStart: WEEK, items: [{ categoryId: G4, minutes: 1200 }, { categoryId: G1, minutes: 60 }] } });
    const { container } = await mount(fakeApi(d));
    expect(names(container)).toEqual(["어학", "포트폴리오", "자격증", "운동", "기타"]);
  });

  it("막대: 축 = 가장 큰 값(포트폴리오 12시간), 채움 = 쓴 시간, 눈금 = 목표, 남은 시간이 있는 줄만 채움 끝→눈금 점선 빈 자리", async () => {
    const { container } = await mount(fakeApi(spec()));
    const bars = items(container).map((li) => li.querySelector<HTMLElement>(".growth-goal-bar")!);
    expect(bars).toHaveLength(5);
    const fill = (b: HTMLElement) => b.querySelector<HTMLElement>(".growth-goal-fill");
    const tick = (b: HTMLElement) => b.querySelector<HTMLElement>(".growth-goal-tick");
    const gap = (b: HTMLElement) => b.querySelector<HTMLElement>(".growth-goal-gap");
    // 채움 폭: 어학 120/720, 포트폴리오 720/720(축), 짧은 막대는 최소 6px
    expect(fill(bars[0])!.getAttribute("style")).toContain("max(6px, 16.667%)");
    expect(fill(bars[1])!.getAttribute("style")).toContain("max(6px, 100%)");
    // 눈금: 어학 목표 300/720, 기타는 목표가 없어 눈금 없음
    expect(tick(bars[0])!.getAttribute("style")).toContain("41.667%");
    expect(tick(bars[4])).toBeNull();
    // 빈 자리: 어학만(남은 3시간). 점선이고 채움 색이 없다(살구 채움 없음)
    expect(bars.map((b) => gap(b) !== null)).toEqual([true, false, false, false, false]);
    expect(gap(bars[0])!.style.borderStyle).toBe("dashed");
    expect(gap(bars[0])!.style.background).toBe("");
    expect(gap(bars[0])!.getAttribute("style")).toContain("58.333%"); // 오른쪽 끝 = 100 − 눈금 41.667
    // 막대는 그림이라 글로 읽지 않는다
    expect(bars.every((b) => b.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("채움은 분야 색 + 1px 윤곽(--color-chart-outline), 0분 분야도 목표가 있으면 한 줄(채움 없이 빈 자리만)", async () => {
    const d = spec({ thisWeek: [{ categoryId: G2, minutes: 720 }] });
    const { container } = await mount(fakeApi(d));
    expect(names(container)).toEqual(["어학", "포트폴리오", "자격증", "운동"]); // 기타는 쓴 시간이 없어 줄이 없다
    const bars = items(container).map((li) => li.querySelector<HTMLElement>(".growth-goal-bar")!);
    expect(bars.map((b) => b.querySelector(".growth-goal-fill") !== null)).toEqual([false, true, false, false]);
    expect(bars.map((b) => b.querySelector(".growth-goal-gap") !== null)).toEqual([true, false, true, true]);
    const fill = bars[1].querySelector<HTMLElement>(".growth-goal-fill")!;
    expect(fill.style.background).toBe("var(--color-category-2)");
    expect(fill.style.borderColor).toBe("var(--color-chart-outline, var(--color-text))");
  });

  it("목표도 쓴 시간도 없는 분야는 줄이 없다", async () => {
    const d = spec({ goal: { weekStart: WEEK, items: [{ categoryId: G1, minutes: 300 }] }, thisWeek: [{ categoryId: G1, minutes: 60 }] });
    const { container } = await mount(fakeApi(d));
    expect(names(container)).toEqual(["어학"]);
  });

  it("범례 「목표」 「빈 자리」. 칩·기간 고르기·보기 바꾸기 단추가 없다(기간은 이번 주만)", async () => {
    const { container } = await mount(fakeApi(spec()));
    expect(Array.from(container.querySelectorAll(".growth-legend-item")).map((el) => el.textContent)).toEqual(["목표", "빈 자리"]);
    expect(screen.queryByRole("group", { name: GROWTH_TEXT.periodGroup })).toBeNull();
    expect(screen.queryByRole("button", { name: "원그래프로 보기" })).toBeNull();
    expect(container.querySelector("[aria-pressed]")).toBeNull();
  });

  it("카드 앞 숨은 요약 하나: 명세 예와 같은 글, 줄 순서는 화면 줄 순서", async () => {
    const { container } = await mount(fakeApi(spec()));
    expect(summary(container)).toBe(
      "이번 주 목표 15시간 중 12시간. 어학 2시간, 목표 5시간, 3시간 더. 포트폴리오 12시간, 목표 6시간. 자격증 3시간, 목표 3시간. 운동 1시간, 목표 1시간. 기타 2시간.",
    );
    const sr = container.querySelector(".growth-body > p.sr-only")!;
    expect(sr.compareDocumentPosition(container.querySelector(".growth-card")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("분야 줄을 누르면 그 분야 페이지로 간다(기타는 null)", async () => {
    const onOpenCategory = vi.fn();
    const { container } = await mount(fakeApi(spec()), { onOpenCategory });
    fireEvent.click(within(items(container)[1]).getByRole("button"));
    expect(onOpenCategory).toHaveBeenCalledWith(G2, "포트폴리오");
    fireEvent.click(within(items(container)[4]).getByRole("button"));
    expect(onOpenCategory).toHaveBeenLastCalledWith(null, "기타");
  });

  it("목표를 세우지 않은 주에 이 탭을 고르면 카드 하나 안에 위→아래 이름표 「예시」 → 흐린 막대 둘 → 「분야마다 시간 · 1시간 단위」 → 「이번 주 목표 정하기」(카드 끝, 고침6 ②), 누르면 목표 창을 연다", async () => {
    const onOpenGoal = vi.fn();
    const d = noGoal();
    const { container } = await mount(fakeApi(d), { onOpenGoal });
    fireEvent.click(tab("이번 주 목표"));
    const panel = screen.getByRole("tabpanel", { name: "이번 주 목표" });
    // 누를 수 있는 것은 단추 하나뿐(예시 막대는 누를 수 없다)
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual([GOAL_TEXT.set]);
    expect(container.querySelector(".growth-card")).toBeNull();
    // 카드는 하나, 그 안에 넷이 이 순서로(이름표 < 막대 < 보조 줄 < 단추), 단추가 카드의 마지막 요소
    const cards = panel.querySelectorAll(".growth-goal-set");
    expect(cards).toHaveLength(1);
    const card = cards[0] as HTMLElement;
    const label = card.querySelector(".growth-example-label")!;
    const bars = Array.from(card.querySelectorAll(".growth-example-item .growth-goal-bar"));
    const hint = within(card).getByText("분야마다 시간 · 1시간 단위");
    const button = within(card).getByRole("button", { name: GOAL_TEXT.set });
    expect(label.textContent).toBe("예시");
    expect(bars).toHaveLength(2);
    const after = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(after(label, bars[0])).toBe(true);
    expect(after(bars[1], hint)).toBe(true);
    expect(after(hint, button)).toBe(true);
    expect(card.lastElementChild).toBe(button);
    const example = within(panel).getByRole("group", { name: "예시" });
    expect(card.contains(example)).toBe(true);
    const rows = Array.from(example.querySelectorAll<HTMLElement>(".growth-example-item"));
    expect(rows.map((li) => li.querySelector(".growth-name")?.textContent)).toEqual(["포트폴리오", "어학"]);
    expect(rows.map((li) => li.querySelector(".growth-goal-of")?.textContent)).toEqual(["목표 6시간", "목표 5시간"]);
    // 흐림(불투명 40%)은 막대에만 거는 CSS(PM d-125 — 예시 글은 흐리지 않는다). 줄마다 막대가 하나씩 있다
    expect(rows.map((li) => li.querySelectorAll(".growth-goal-bar").length)).toEqual([1, 1]);
    expect(example.querySelector("button, a, [tabindex]")).toBeNull();
    fireEvent.click(button);
    expect(onOpenGoal).toHaveBeenCalledWith(d);
  });

  it("예시는 고정 글이다: 실제 분야 이름·쓴 시간이 예시에 섞이지 않고, 화면 읽기 요약에도 예시가 들어가지 않는다", async () => {
    const d = noGoal({
      categories: [{ id: G1, name: "독서모임" }, { id: G2, name: "수영" }],
      ratios: [{ categoryId: G1, percent: 50 }, { categoryId: G2, percent: 50 }],
      thisWeek: [{ categoryId: G1, minutes: 420 }, { categoryId: G2, minutes: 90 }],
    });
    const { container } = await mount(fakeApi(d), { onOpenGoal: vi.fn() });
    fireEvent.click(tab("이번 주 목표"));
    const example = screen.getByRole("group", { name: "예시" });
    expect(example.textContent).toBe("예시포트폴리오목표 6시간어학목표 5시간");
    for (const real of ["독서모임", "수영", "7시간", "1시간 30분"]) expect(example.textContent).not.toContain(real);
    expect(container.querySelector(".growth-body > p.sr-only")).toBeNull(); // 이 상태에는 실제 요약이 없다
    fireEvent.click(tab("목표 비율"));
    expect(summary(container)).toBe("목표 비율과 견준 이번 주. 8시간 30분. 독서모임 82%, 목표 50%. 수영 18%, 목표 50%. 기타 0%.");
    expect(summary(container)).not.toContain("예시");
    expect(container.querySelector(".growth-example")).toBeNull();
    // 목표를 세운 주의 요약에도 예시가 없다
    cleanup();
    const { container: c2 } = await mount(fakeApi(spec()));
    expect(summary(c2)).toMatch(/^이번 주 목표 15시간 중 12시간\. /);
    expect(summary(c2)).not.toContain("예시");
    expect(c2.querySelector(".growth-example")).toBeNull();
  });

  it("목표를 세운 주에 기록이 없으면 「목표 15시간 중 0시간」, 막대는 모두 빈 칸, 「오늘 기록」 단추", async () => {
    const onOpenEvening = vi.fn();
    const { container } = await mount(fakeApi(spec({ thisWeek: [], loggedDaysThisWeek: 0 })), { onOpenEvening });
    expect(container.querySelector(".growth-card-title")?.textContent).toBe("목표 15시간 중 0시간");
    expect(items(container)).toHaveLength(4);
    expect(container.querySelector(".growth-goal-fill")).toBeNull();
    expect(container.querySelectorAll(".growth-goal-gap")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "오늘 기록" }));
    expect(onOpenEvening).toHaveBeenCalledTimes(1);
  });
});

describe("목표 비율 뷰(명세 ③-S ②, PM d-101 · d-102 · 8)", () => {
  it("카드 머리: 합계 「20시간」 · 기간 칩(이번 주 / 총 시간 / 비교) · 보기 바꾸기는 글 단추 하나(칩 아님)", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    expect(container.querySelector(".growth-card-total")?.textContent).toBe("20시간");
    const group = screen.getByRole("group", { name: GROWTH_TEXT.periodGroup });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["이번 주", "총 시간", "비교"]);
    expect(pressed("이번 주")).toBe("true");
    const toggle = chip("원그래프로 보기");
    expect(toggle.getAttribute("aria-pressed")).toBeNull();
    expect(group.contains(toggle)).toBe(false);
    expect(screen.queryByRole("button", { name: "최근 1주" })).toBeNull();
  });

  it("띠 두 줄: 위 「목표 비율」 칸마다 점선 윤곽, 아래 기간 「이번 주」 칸마다 실선 윤곽. 칸 안에 %", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    const captions = Array.from(container.querySelectorAll(".growth-band-line .growth-line-caption")).map((el) => el.textContent);
    expect(captions).toEqual(["목표 비율", "이번 주"]);
    const [ratioBand, spentBand] = Array.from(container.querySelectorAll<HTMLElement>(".growth-band"));
    const ratioSegs = Array.from(ratioBand.querySelectorAll<HTMLElement>(".growth-band-cell"));
    const spentSegs = Array.from(spentBand.querySelectorAll<HTMLElement>(".growth-band-cell"));
    expect(ratioSegs.length).toBe(4);
    expect(spentSegs.length).toBe(5);
    expect(ratioSegs.every((s) => s.style.borderStyle === "dashed")).toBe(true);
    expect(spentSegs.every((s) => s.style.borderStyle === "solid")).toBe(true);
    expect([...ratioSegs, ...spentSegs].every((s) => s.style.borderColor === "var(--color-chart-outline, var(--color-text))")).toBe(true);
    expect(ratioSegs.map((s) => s.textContent)).toEqual(["30%", "40%", "20%", "10%"]);
    expect(spentSegs.map((s) => s.textContent)).toEqual(["10%", "60%", "15%", "5%", "10%"]);
  });

  it("두 띠의 분야 순서가 같고(만든 순서), 기타는 아래 띠 끝. 같은 분야 = 같은 색(옅게 하지 않음)", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    const [ratioBand, spentBand] = Array.from(container.querySelectorAll<HTMLElement>(".growth-band"));
    const cats = (b: HTMLElement) => Array.from(b.querySelectorAll<HTMLElement>(".growth-band-cell")).map((s) => s.dataset.category);
    expect(cats(ratioBand)).toEqual([G1, G2, G3, G4]);
    expect(cats(spentBand)).toEqual([G1, G2, G3, G4, "other"]);
    const colors = (b: HTMLElement) => Array.from(b.querySelectorAll<HTMLElement>(".growth-band-cell")).map((s) => s.style.background);
    expect(colors(spentBand).slice(0, 4)).toEqual(colors(ratioBand));
    expect(colors(spentBand)[4]).toBe("var(--color-category-other)");
    expect(container.innerHTML).not.toContain("opacity");
  });

  it("범례 한 줄: 점선 칸 「목표 비율」 · 실선 칸 「이번 주」", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    const legend = Array.from(container.querySelectorAll<HTMLElement>(".growth-legend-item"));
    expect(legend.map((el) => el.textContent)).toEqual(["목표 비율", "이번 주"]);
    expect(legend.map((el) => el.querySelector<HTMLElement>(".growth-legend-box")!.style.borderStyle)).toEqual(["dashed", "solid"]);
  });

  it("띠 아래 목록: 만든 순서 · 기타 끝, 오른쪽 「10% / 목표 30%」(기타 「10%」), 굵은 줄 없음, 색 점은 1px 윤곽", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    expect(names(container)).toEqual(["어학", "포트폴리오", "자격증", "운동", "기타"]);
    expect(values(container)).toEqual(["10% / 목표 30%", "60% / 목표 40%", "15% / 목표 20%", "5% / 목표 10%", "10%"]);
    expect(container.querySelector(".growth-list strong, .growth-list b, .growth-list .is-left")).toBeNull();
    const dots = Array.from(container.querySelectorAll<HTMLElement>(".growth-dot"));
    expect(dots).toHaveLength(5);
    expect(dots.every((d) => d.style.boxShadow === "inset 0 0 0 1px var(--color-chart-outline, var(--color-text))")).toBe(true);
    expect(dots.every((d) => d.style.borderStyle === "")).toBe(true); // 테두리를 겹쳐 2px가 되지 않게
  });

  it("카드 앞 숨은 요약 하나(줄 순서 = 화면 줄 순서)", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    expect(summary(container)).toBe("목표 비율과 견준 이번 주. 20시간. 어학 10%, 목표 30%. 포트폴리오 60%, 목표 40%. 자격증 15%, 목표 20%. 운동 5%, 목표 10%. 기타 10%.");
  });

  it("「원그래프로 보기」: 원 둘 나란히(왼쪽 「목표 비율」 · 오른쪽 「이번 주」), 조각마다 실선 1px 윤곽(점선 없음), 튀어나옴 없음", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    fireEvent.click(chip("원그래프로 보기"));
    expect(container.querySelector(".growth-band")).toBeNull();
    const pies = Array.from(container.querySelectorAll<SVGSVGElement>("svg.growth-pie"));
    expect(pies).toHaveLength(2);
    expect(Array.from(container.querySelectorAll(".growth-pie-box .growth-line-caption")).map((el) => el.textContent)).toEqual(["목표 비율", "이번 주"]);
    const slices = Array.from(container.querySelectorAll<SVGPathElement>("path.growth-pie-slice"));
    expect(slices).toHaveLength(9);
    expect(slices.every((p) => p.getAttribute("stroke") === "var(--color-chart-outline, var(--color-text))" && p.getAttribute("stroke-width") === "1")).toBe(true);
    expect(slices.every((p) => !p.hasAttribute("stroke-dasharray") && !p.hasAttribute("transform"))).toBe(true);
    expect(pies.every((svg) => svg.getAttribute("viewBox") === pies[0].getAttribute("viewBox"))).toBe(true); // 같은 크기
    // 같은 목록이 아래에
    expect(values(container)).toEqual(["10% / 목표 30%", "60% / 목표 40%", "15% / 목표 20%", "5% / 목표 10%", "10%"]);
    // 다시 띠로
    fireEvent.click(chip("띠그래프로 보기"));
    expect(container.querySelectorAll(".growth-band")).toHaveLength(2);
    expect(container.querySelector("svg.growth-pie")).toBeNull();
  });

  it("원 조각마다 %를 적는다: 넓은 조각은 조각 안, 8% 미만(운동 5%)은 이끌 선으로 원 밖", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    fireEvent.click(chip("원그래프로 보기"));
    const [ratioPie, spentPie] = Array.from(container.querySelectorAll<SVGSVGElement>("svg.growth-pie"));
    expect(Array.from(ratioPie.querySelectorAll("text")).map((t) => t.textContent)).toEqual(["30%", "40%", "20%", "10%"]);
    expect(Array.from(spentPie.querySelectorAll("text")).map((t) => t.textContent)).toEqual(["10%", "60%", "15%", "5%", "10%"]);
    const labels = Array.from(spentPie.querySelectorAll(".growth-pie-label"));
    expect(labels.map((g) => g.classList.contains("is-outside"))).toEqual([false, false, false, true, false]);
    expect(labels[3].querySelector("line.growth-pie-leader")).not.toBeNull();
    expect(labels[0].querySelector("line")).toBeNull();
  });

  it("분야별 막대·「n시간 더」·시간 눈금이 없다(띠·원 모두)", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    for (const step of ["band", "pie"]) {
      if (step === "pie") fireEvent.click(chip("원그래프로 보기"));
      expect(container.querySelector(".growth-goal-bar, .growth-goal-tick")).toBeNull();
      expect(screen.getByRole("tabpanel").textContent).not.toMatch(/시간 더/);
    }
  });

  it("총 시간: 누적 값으로 띠·원, 아래 띠·오른쪽 원 이름표는 「총 시간」", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    fireEvent.click(chip("총 시간"));
    expect(pressed("총 시간")).toBe("true");
    expect(container.querySelector(".growth-card-total")?.textContent).toBe("40시간");
    expect(screen.getByText("오늘 기록 20일")).toBeTruthy();
    expect(Array.from(container.querySelectorAll(".growth-band-line .growth-line-caption")).map((el) => el.textContent)).toEqual(["목표 비율", "총 시간"]);
    expect(values(container)).toEqual(["50% / 목표 30%", "25% / 목표 40%", "25% / 목표 20%", "0% / 목표 10%", "0%"]);
    expect(summary(container)).toMatch(/^목표 비율과 견준 총 시간\. 40시간\. /);
    fireEvent.click(chip("원그래프로 보기"));
    expect(Array.from(container.querySelectorAll(".growth-pie-box .growth-line-caption")).map((el) => el.textContent)).toEqual(["목표 비율", "총 시간"]);
  });

  it("비교(D-093, 결정 대기): 꼴은 그대로 이번 주·지난주·지난달·총 시간 나란히, 보기 바꾸기 단추는 숨는다(「쌓인 것」 없음)", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    fireEvent.click(chip("비교"));
    expect(pressed("비교")).toBe("true");
    expect(screen.getByRole("heading", { name: "분야마다 나란히" })).toBeTruthy();
    const language = screen.getByRole("button", { name: /^어학/ });
    expect(within(language).getByText("이번 주").nextSibling?.textContent).toBe("2시간");
    expect(within(language).getByText("지난주").nextSibling?.textContent).toBe("1시간");
    expect(within(language).getByText("총 시간").nextSibling?.textContent).toBe("20시간");
    expect(container.textContent).not.toContain("쌓인 것");
    expect(screen.queryByRole("button", { name: "원그래프로 보기" })).toBeNull();
    fireEvent.click(chip("이번 주"));
    expect(chip("원그래프로 보기")).toBeTruthy();
  });

  it("보기 방식 목록(STATUS_VIEWS)은 띠그래프(처음)·원그래프 둘이고, 글 단추가 다음 보기로 돌린다", () => {
    expect(STATUS_VIEWS.map((v) => [v.id, GROWTH_TEXT[v.switchLabel]])).toEqual([
      ["band", "원그래프로 보기"],
      ["pie", "띠그래프로 보기"],
    ]);
  });
});

describe("기록 없음 · 처음 쓰는 사람(분야 하나)", () => {
  it("목표 비율 뷰: 예시 값 — 목표 비율 띠 한 줄(점선, 칸에 %) + 「이번 주」 빈 띠 「0시간」 + 「오늘 기록」 단추. 안내 글(「오늘 기록」으로)도 남는다", async () => {
    const onOpenEvening = vi.fn();
    const d = noGoal({
      categories: [{ id: G1, name: "어학" }],
      ratios: [{ categoryId: G1, percent: 100 }],
      thisWeek: [],
      cumulative: [],
      loggedDaysThisWeek: 0,
      loggedDaysTotal: 0,
    });
    const { container } = await mount(fakeApi(d), { onOpenEvening });
    expect(screen.getByText(GROWTH_TEXT.empty)).toBeTruthy();
    expect(GROWTH_TEXT.empty).toBe("아직 이번 주 오늘 기록이 없어요. 오늘 기록을 남기면 여기에 쌓여요.");
    expect(screen.getByText("오늘 기록 0일")).toBeTruthy();
    const lines = Array.from(container.querySelectorAll<HTMLElement>(".growth-band-line"));
    expect(lines.map((l) => l.querySelector(".growth-line-caption")?.textContent)).toEqual(["목표 비율", "이번 주"]);
    const ratioSegs = Array.from(lines[0].querySelectorAll<HTMLElement>(".growth-band-cell"));
    expect(ratioSegs.map((s) => [s.textContent, s.style.borderStyle])).toEqual([["100%", "dashed"]]);
    const empty = lines[1].querySelector<HTMLElement>(".growth-band.is-empty")!;
    expect(empty.style.borderStyle).toBe("solid");
    expect(empty.textContent).toBe("0시간");
    expect(empty.querySelector(".growth-band-cell")).toBeNull();
    expect(container.querySelector(".growth-card-total")?.textContent).toBe("0시간");
    // 그림 아래 목록은 없다(띠 둘 + 단추). 고침7 ②: 보기 바꾸기 글 단추·칩 셋은 데이터 있는 판과 같은 자리에 있다
    expect(container.querySelector(".growth-list")).toBeNull();
    expect(chip("원그래프로 보기").closest(".growth-switch")).not.toBeNull();
    expect(within(screen.getByRole("group", { name: GROWTH_TEXT.periodGroup })).getAllByRole("button").map((b) => b.textContent)).toEqual(["이번 주", "총 시간", "비교"]);
    expect(pressed("이번 주")).toBe("true");
    expect(summary(container)).toBe("목표 비율과 견준 이번 주. 0시간. 어학 0%, 목표 100%. 기타 0%.");
    fireEvent.click(screen.getByRole("button", { name: "오늘 기록" }));
    expect(onOpenEvening).toHaveBeenCalledTimes(1);
    fireEvent.click(chip("총 시간"));
    expect(screen.getByText(GROWTH_TEXT.emptyTotal)).toBeTruthy();
    expect(container.querySelector(".growth-band.is-empty")?.textContent).toBe("0시간");
    expect(container.querySelector(".growth-band-line:last-child .growth-line-caption")?.textContent).toBe("총 시간");
  });

  it("목표 비율 뷰: 목표 비율도 없으면 띠 없이 단추만", async () => {
    const { container } = await mount(fakeApi(noGoal({ ratios: [], thisWeek: [], cumulative: [] })));
    expect(container.querySelector(".growth-band")).toBeNull();
    expect(container.querySelector(".growth-graph")).toBeNull();
    expect(screen.getByRole("button", { name: "오늘 기록" })).toBeTruthy();
  });

  it("기록이 있으면 「오늘 기록」 단추가 없다", async () => {
    await mount(fakeApi(noGoal()));
    expect(screen.queryByRole("button", { name: "오늘 기록" })).toBeNull();
  });
});

describe("없앤 것(⑩ PM 8 · 명세 ③-S 두 뷰 공통)", () => {
  /** 두 탭 × 세 기간 × 두 보기를 모두 돌며 상태보기 DOM을 모은다 */
  async function everyDom(d: GrowthData): Promise<string[]> {
    const { container } = await mount(fakeApi(d));
    const doms: string[] = [];
    fireEvent.click(tab("이번 주 목표"));
    doms.push(container.innerHTML);
    fireEvent.click(tab("목표 비율"));
    for (const period of ["이번 주", "총 시간", "비교"]) {
      fireEvent.click(chip(period));
      doms.push(container.innerHTML);
      // 원그래프도 본다(고침7: 기록 없음에도 보기 바꾸기 단추가 있다. 비교에는 없다)
      const toPie = screen.queryByRole("button", { name: "원그래프로 보기" });
      if (toPie) {
        fireEvent.click(toPie);
        doms.push(container.innerHTML);
        fireEvent.click(chip("띠그래프로 보기"));
      }
    }
    return doms;
  }

  it("「채울」·「쌓인 것」·「처음 정한 비율」·「저녁 기록」·「분야별 줄 막대」 글과 살구(--color-accent)가 상태보기 어디에도 없다", async () => {
    for (const d of [spec(), noGoal(), spec({ thisWeek: [], cumulative: [] })]) {
      const doms = await everyDom(d);
      expect(doms.length).toBe(6); // 목표 뷰 1 + 기간 셋 + 원그래프 둘(이번 주·총 시간 — 고침7부터 기록 없음도)
      for (const html of doms) {
        expect(html.length).toBeGreaterThan(200);
        for (const word of ["채울", "쌓인 것", "처음 정한 비율", "저녁 기록", "분야별 줄 막대", "--color-accent", "놓친"]) expect(html).not.toContain(word);
      }
      cleanup();
    }
  });

  it("모자란 분야 큰 글·숫자 줄이 없다: 목표 한 줄 다음 요소는 탭 줄이다", async () => {
    const { container } = await mount(fakeApi(spec()));
    expect(container.querySelector(".growth-goal-line")?.nextElementSibling?.getAttribute("role")).toBe("tablist");
    expect(container.querySelector(".growth-missed, .growth-short, .growth-total-number")).toBeNull();
  });
});

/**
 * 빈 상태 셋(고침7, PM 15:1x · 23 S6 빈 상태). spec()의 쌓인 시간(cumulative) = 어학 20시간 · 포트폴리오 10시간 · 자격증 10시간 = 40시간
 * → 총 시간 % 50 · 25 · 25 · 운동 0 · 기타 0, 목표 비율 30 · 40 · 20 · 10
 */
describe("빈 상태 셋(고침7) — 목표 비율 뷰", () => {
  /** 경우 1: 이번 주 0시간 + 지난 기록 있음(목표 없는 주라 목표 비율 탭이 처음) */
  const weekZero = (over: Partial<GrowthData> = {}) => noGoal({ thisWeek: [], loggedDaysThisWeek: 0, ...over });
  /** 경우 2: 기록이 하나도 없음 */
  const noRecord = (over: Partial<GrowthData> = {}) => noGoal({ thisWeek: [], lastWeek: [], lastMonth: [], cumulative: [], loggedDaysThisWeek: 0, loggedDaysTotal: 0, ...over });
  const card = (c: HTMLElement) => c.querySelector<HTMLElement>(".growth-card")!;
  const after = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const periodChips = () => within(screen.getByRole("group", { name: GROWTH_TEXT.periodGroup })).getAllByRole("button").map((b) => b.textContent);

  it("경우 1: 처음 칩은 「총 시간」, 머리 = 합계 「40시간」 · 칩 셋 · 「원그래프로 보기」(데이터 있는 판과 같은 자리), 머리 바로 아래 「이번 주 0시간」", async () => {
    const save = vi.fn(async () => {});
    const { container } = await mount(fakeApi(weekZero(), { load: async () => undefined, save }));
    expect(selected("목표 비율")).toBe("true");
    expect(pressed("총 시간")).toBe("true");
    expect(pressed("이번 주")).toBe("false");
    expect(periodChips()).toEqual(["이번 주", "총 시간", "비교"]);
    expect(screen.getByRole("heading", { name: GROWTH_TEXT.totalHeading })).toBeTruthy();
    expect(screen.getByText("오늘 기록 20일")).toBeTruthy();
    const head = card(container).querySelector(".growth-card-head")!;
    expect(head.querySelector(".growth-card-total")?.textContent).toBe("40시간");
    const toggle = chip("원그래프로 보기");
    expect(toggle.closest(".growth-switch")?.parentElement).toBe(card(container));
    const note = card(container).querySelectorAll<HTMLElement>(".growth-week-zero");
    expect(note).toHaveLength(1);
    expect(note[0].textContent).toBe("이번 주 0시간");
    // 머리(합계·칩) → 보기 바꾸기 → 「이번 주 0시간」 → 그림 순서
    expect(after(head, toggle)).toBe(true);
    expect(after(toggle, note[0])).toBe(true);
    expect(after(note[0], card(container).querySelector(".growth-graph")!)).toBe(true);
    // 자동으로 고른 기간은 적지 않는다(사용자가 고른 것이 아니다)
    await act(async () => {});
    expect(save).not.toHaveBeenCalled();
  });

  it("경우 1: 띠 둘(위 「목표 비율」 점선 · 아래 「총 시간」 실선, 분야별 누적 %), 범례 「목표 비율 · 총 시간」, 목록 「50% / 목표 30%」 꼴 = 총 시간 계산 값", async () => {
    const { container } = await mount(fakeApi(weekZero()));
    const lines = Array.from(container.querySelectorAll<HTMLElement>(".growth-band-line"));
    expect(lines.map((l) => l.querySelector(".growth-line-caption")?.textContent)).toEqual(["목표 비율", "총 시간"]);
    const cells = (l: HTMLElement) => Array.from(l.querySelectorAll<HTMLElement>(".growth-band-cell"));
    expect(cells(lines[0]).map((c) => [c.textContent, c.style.borderStyle])).toEqual([
      ["30%", "dashed"],
      ["40%", "dashed"],
      ["20%", "dashed"],
      ["10%", "dashed"],
    ]);
    expect(cells(lines[1]).map((c) => [c.dataset.category, c.textContent, c.style.borderStyle])).toEqual([
      [G1, "50%", "solid"],
      [G2, "25%", "solid"],
      [G3, "25%", "solid"],
    ]);
    expect(container.querySelector(".growth-band.is-empty")).toBeNull();
    expect(Array.from(container.querySelectorAll(".growth-legend-item")).map((el) => el.textContent)).toEqual(["목표 비율", "총 시간"]);
    expect(names(container)).toEqual(["어학", "포트폴리오", "자격증", "운동", "기타"]);
    expect(values(container)).toEqual(["50% / 목표 30%", "25% / 목표 40%", "25% / 목표 20%", "0% / 목표 10%", "0%"]);
    // 같은 계산: 칩에서 「총 시간」을 직접 고른 판(이번 주 기록이 있는 사람)의 목록·띠·합계와 값이 같다
    const shown = { values: values(container), cells: cells(lines[1]).map((c) => c.textContent), total: container.querySelector(".growth-card-total")?.textContent };
    cleanup();
    const { container: c2 } = await mount(fakeApi(noGoal()));
    fireEvent.click(chip("총 시간"));
    const lines2 = Array.from(c2.querySelectorAll<HTMLElement>(".growth-band-line"));
    expect({ values: values(c2), cells: cells(lines2[1]).map((c) => c.textContent), total: c2.querySelector(".growth-card-total")?.textContent }).toEqual(shown);
    expect(c2.querySelector(".growth-week-zero")).toBeNull(); // 이번 주 기록이 있으면 「이번 주 0시간」 줄은 없다
  });

  it("경우 1: 카드 끝 보조 단추 「오늘 기록」(누르면 오늘 기록이 열린다, 오늘 기록 화면 제목과 같은 글), 기록 없음 안내 글은 없다", async () => {
    const onOpenEvening = vi.fn();
    const { container } = await mount(fakeApi(weekZero()), { onOpenEvening });
    const buttons = screen.getAllByRole("button", { name: "오늘 기록" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe(EVENING_TEXT.title);
    expect(card(container).lastElementChild?.contains(buttons[0])).toBe(true);
    expect(buttons[0].className).toContain("btn-secondary");
    fireEvent.click(buttons[0]);
    expect(onOpenEvening).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(GROWTH_TEXT.empty)).toBeNull();
    expect(screen.queryByText(GROWTH_TEXT.emptyTotal)).toBeNull();
  });

  it("경우 1 화면 읽기: 「목표 비율과 견준 총 시간. 40시간. 이번 주 0시간. …」(이번 주 0시간을 알린다)", async () => {
    const { container } = await mount(fakeApi(weekZero()));
    expect(summary(container)).toBe(
      "목표 비율과 견준 총 시간. 40시간. 이번 주 0시간. 어학 50%, 목표 30%. 포트폴리오 25%, 목표 40%. 자격증 25%, 목표 20%. 운동 0%, 목표 10%. 기타 0%.",
    );
    // 보이는 「이번 주 0시간」 줄은 요약이 읽으므로 두 번 읽지 않는다
    expect(container.querySelector(".growth-week-zero")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("경우 1 → 칩 「이번 주」: 경우 2 꼴(머리 「0시간」 · 빈 띠 「0시간」 · 안내 글 · 「오늘 기록」), 고른 기간과 그 주를 적는다", async () => {
    const save = vi.fn(async () => {});
    const { container } = await mount(fakeApi(weekZero(), { load: async () => undefined, save }));
    fireEvent.click(chip("이번 주"));
    expect(pressed("이번 주")).toBe("true");
    expect(container.querySelector(".growth-card-total")?.textContent).toBe("0시간");
    expect(container.querySelector(".growth-band.is-empty")?.textContent).toBe("0시간");
    expect(container.querySelector(".growth-week-zero")).toBeNull();
    expect(screen.getByText(GROWTH_TEXT.empty)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "오늘 기록" })).toHaveLength(1);
    expect(chip("원그래프로 보기")).toBeTruthy();
    await waitFor(() => expect(save).toHaveBeenCalledWith({ period: "week", periodWeek: WEEK, view: "band", tab: null, tabWeek: null }));
  });

  it("경우 1의 원그래프: 왼쪽 「목표 비율」 원 · 오른쪽 「총 시간」 원(누적 %, 조각마다 %), 빈 고리 없음", async () => {
    const { container } = await mount(fakeApi(weekZero()));
    fireEvent.click(chip("원그래프로 보기"));
    const boxes = Array.from(container.querySelectorAll<HTMLElement>(".growth-pie-box"));
    expect(boxes.map((b) => b.querySelector(".growth-line-caption")?.textContent)).toEqual(["목표 비율", "총 시간"]);
    expect(Array.from(boxes[1].querySelectorAll("path.growth-pie-slice")).map((p) => p.getAttribute("data-category"))).toEqual([G1, G2, G3]);
    expect(Array.from(boxes[1].querySelectorAll(".growth-pie-text")).map((t) => t.textContent)).toEqual(["50%", "25%", "25%"]);
    expect(container.querySelector(".growth-pie-ring")).toBeNull();
    expect(container.querySelector(".growth-week-zero")?.textContent).toBe("이번 주 0시간"); // 원 보기에서도 머리 아래 한 줄
    fireEvent.click(chip("띠그래프로 보기"));
    expect(container.querySelectorAll(".growth-band")).toHaveLength(2);
  });

  it("경우 2: 기록이 하나도 없어도 머리 = 「0시간」 · 칩 셋(이번 주 켜짐) · 「원그래프로 보기」, 칩 「총 시간」·「비교」를 고르면 0인 판", async () => {
    const { container } = await mount(fakeApi(noRecord()));
    expect(pressed("이번 주")).toBe("true");
    expect(periodChips()).toEqual(["이번 주", "총 시간", "비교"]);
    expect(container.querySelector(".growth-card-head .growth-card-total")?.textContent).toBe("0시간");
    expect(chip("원그래프로 보기").closest(".growth-switch")?.parentElement).toBe(card(container));
    expect(container.querySelector(".growth-week-zero")).toBeNull();
    expect(screen.getByText(GROWTH_TEXT.empty)).toBeTruthy();
    expect(summary(container)).toBe("목표 비율과 견준 이번 주. 0시간. 어학 0%, 목표 30%. 포트폴리오 0%, 목표 40%. 자격증 0%, 목표 20%. 운동 0%, 목표 10%. 기타 0%.");
    fireEvent.click(chip("총 시간"));
    expect(pressed("총 시간")).toBe("true");
    expect(container.querySelector(".growth-card-total")?.textContent).toBe("0시간");
    expect(container.querySelector(".growth-band.is-empty")?.textContent).toBe("0시간");
    expect(container.querySelector(".growth-week-zero")).toBeNull(); // 쌓인 것도 0이면 「이번 주 0시간」 줄은 없다
    expect(summary(container)).toMatch(/^목표 비율과 견준 총 시간\. 0시간\. 어학 0%/);
    fireEvent.click(chip("비교"));
    expect(pressed("비교")).toBe("true");
    expect(periodChips()).toEqual(["이번 주", "총 시간", "비교"]);
    const dds = Array.from(container.querySelectorAll(".growth-dl dd"));
    expect(dds.length).toBeGreaterThan(0);
    expect(dds.every((dd) => dd.textContent === "0분")).toBe(true);
  });

  it("경우 3: 빈 상태에서 「원그래프로 보기」 → 왼쪽 「목표 비율」 원 그대로 · 오른쪽 회색 빈 고리 1px + 가운데 「0시간」, 「띠그래프로 보기」로 다시 띠", async () => {
    const { container } = await mount(fakeApi(noRecord()));
    fireEvent.click(chip("원그래프로 보기"));
    const boxes = Array.from(container.querySelectorAll<HTMLElement>(".growth-pie-box"));
    expect(boxes.map((b) => b.querySelector(".growth-line-caption")?.textContent)).toEqual(["목표 비율", "이번 주"]);
    expect(Array.from(boxes[0].querySelectorAll(".growth-pie-text")).map((t) => t.textContent)).toEqual(["30%", "40%", "20%", "10%"]);
    expect(boxes[0].querySelectorAll("path.growth-pie-slice")).toHaveLength(4);
    const right = boxes[1].querySelector("svg.growth-pie")!;
    expect(right.querySelector("path")).toBeNull();
    const rings = right.querySelectorAll("circle");
    expect(rings).toHaveLength(1);
    expect(rings[0].getAttribute("class")).toBe("growth-pie-ring");
    expect(rings[0].getAttribute("stroke")).toBe("var(--color-border-input)");
    expect(rings[0].getAttribute("stroke-width")).toBe("1");
    expect(rings[0].getAttribute("fill")).toBe("none");
    expect(Number(rings[0].getAttribute("r"))).toBeGreaterThan(0);
    expect(right.querySelector("text")?.textContent).toBe("0시간");
    expect(right.querySelector("text")?.getAttribute("text-anchor")).toBe("middle");
    expect(container.querySelector(".growth-graph")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".growth-list")).toBeNull();
    expect(screen.getByRole("button", { name: "오늘 기록" })).toBeTruthy();
    expect(summary(container)).toMatch(/^목표 비율과 견준 이번 주\. 0시간\. /);
    fireEvent.click(chip("총 시간"));
    expect(container.querySelectorAll(".growth-pie-box")[1].querySelector(".growth-line-caption")?.textContent).toBe("총 시간");
    expect(container.querySelector(".growth-pie-ring")).not.toBeNull();
    fireEvent.click(chip("띠그래프로 보기"));
    expect(container.querySelector(".growth-pie")).toBeNull();
    expect(container.querySelector(".growth-band.is-empty")?.textContent).toBe("0시간");
  });

  it("빈 고리 색 --color-border-input은 있는 토큰이고 흰 카드 바탕에서 3:1을 넘는다(새 토큰 없음), 「이번 주 0시간」은 12 Medium 보조색", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const token = (name: string) => css.match(new RegExp(`${name}: (#[0-9A-Fa-f]{6});`))?.[1];
    const ring = token("--color-border-input");
    const surface = token("--color-surface");
    expect(ring).toBe("#7D8299");
    expect(surface).toBe("#FFFFFF");
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (lum(surface!) + 0.05) / (lum(ring!) + 0.05);
    expect(contrast).toBeGreaterThan(3);
    expect(contrast).toBeCloseTo(3.8, 1);
    expect(css).not.toContain("--color-border:");
    expect(css).toMatch(/\.growth-pie-ring \{ fill: none; stroke: var\(--color-border-input\); stroke-width: 1; \}/);
    expect(css).toMatch(/\.growth-week-zero \{[^}]*font: 500 12px\/16px var\(--font-family\);[^}]*color: var\(--color-text-sub\);/);
  });

  it("목표 비율이 없으면 띠·원 없이 머리(「0시간」 · 칩 셋)와 「오늘 기록」만 — 바꿀 그림이 없어 보기 바꾸기 단추는 두지 않는다", async () => {
    const { container } = await mount(fakeApi(noRecord({ ratios: [] })));
    expect(container.querySelector(".growth-graph")).toBeNull();
    expect(container.querySelector(".growth-card-total")?.textContent).toBe("0시간");
    expect(periodChips()).toEqual(["이번 주", "총 시간", "비교"]);
    expect(screen.queryByRole("button", { name: "원그래프로 보기" })).toBeNull();
    expect(screen.getByRole("button", { name: "오늘 기록" })).toBeTruthy();
    expect(summary(container)).toBe("목표 비율과 견준 이번 주. 0시간. 어학 0%. 포트폴리오 0%. 자격증 0%. 운동 0%. 기타 0%.");
  });

  it("처음 기간 규칙과 기억값: 자동 「총 시간」은 적지 않아 이번 주 첫 기록이 생기면 다음에 열 때 「이번 주」, 칩에서 고른 「총 시간」은 그 주 동안 그대로", async () => {
    let stored: unknown;
    const pref: Pref = { load: async () => stored, save: async (v) => void (stored = v) };
    // 이번 주 0 + 쌓인 것 있음 → 총 시간(자동). 보기만 원그래프로 바꾼다
    let view = await mount(fakeApi(weekZero(), pref));
    expect(pressed("총 시간")).toBe("true");
    fireEvent.click(chip("원그래프로 보기"));
    await waitFor(() => expect(stored).toEqual({ period: "week", periodWeek: null, view: "pie", tab: null, tabWeek: null }));
    view.unmount();
    cleanup();
    // 이번 주 첫 기록이 생긴 뒤 다시 열면 「이번 주」(보기 방식은 기억한 원그래프)
    view = await mount(fakeApi(noGoal(), pref));
    expect(pressed("이번 주")).toBe("true");
    expect(view.container.querySelectorAll("svg.growth-pie")).toHaveLength(2);
    // 칩에서 「총 시간」을 고르면 이번 주 기록이 있어도 그 주 동안 「총 시간」으로 연다
    fireEvent.click(chip("총 시간"));
    await waitFor(() => expect(stored).toMatchObject({ period: "total", periodWeek: WEEK }));
    view.unmount();
    cleanup();
    await mount(fakeApi(noGoal(), pref));
    expect(pressed("총 시간")).toBe("true");
    cleanup();
    // 다음 주가 되면(weekStart가 바뀜) 고른 기간은 쓰지 않고 규칙대로(이번 주 기록 있음 → 이번 주)
    await mount(fakeApi(noGoal({ weekStart: "2026-11-09" }), pref));
    expect(pressed("이번 주")).toBe("true");
    cleanup();
    // 모두 0이면 「이번 주」
    await mount(fakeApi(noRecord()));
    expect(pressed("이번 주")).toBe("true");
  });

  it("분야 이름이 HTML 모양이어도 글자 그대로(경우 1 띠·원·요약, 경우 3), img가 생기지 않는다", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const cats = [
      { id: G1, name: evil },
      { id: G2, name: "포트폴리오" },
      { id: G3, name: "자격증" },
      { id: G4, name: "운동" },
    ];
    const { container } = await mount(fakeApi(weekZero({ categories: cats })));
    expect(names(container)[0]).toBe(evil);
    expect(summary(container)).toContain(`${evil} 50%, 목표 30%.`);
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(chip("원그래프로 보기"));
    expect(container.querySelector("img")).toBeNull();
    expect(names(container)[0]).toBe(evil);
    cleanup();
    const { container: c2 } = await mount(fakeApi(noRecord({ categories: cats })));
    fireEvent.click(chip("원그래프로 보기"));
    expect(summary(c2)).toContain(`${evil} 0%, 목표 30%.`);
    expect(c2.querySelector("img")).toBeNull();
    // 정상 이름은 그대로 보인다(거절만 보는 시험이 아니다)
    expect(summary(c2)).toContain("포트폴리오 0%, 목표 40%.");
  });
});

describe("기억한 기간·보기 방식(목표 비율 뷰)", () => {
  it("기억한 값이 있으면 그 기간·보기로 처음부터 그린다(처음 값을 거치지 않는다)", async () => {
    const load = vi.fn(async () => ({ period: "total", periodWeek: WEEK, view: "pie" }));
    const { container } = await mount(fakeApi(noGoal(), { load, save: vi.fn(async () => {}) }));
    expect(pressed("총 시간")).toBe("true");
    expect(container.querySelectorAll("svg.growth-pie")).toHaveLength(2);
    expect(chip("띠그래프로 보기")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("옛 판에서 기억한 「분야별 줄 막대」(rows)는 띠그래프로 연다", async () => {
    const { container } = await mount(fakeApi(noGoal(), { load: async () => ({ period: "week", view: "rows" }), save: vi.fn(async () => {}) }));
    expect(container.querySelectorAll(".growth-band")).toHaveLength(2);
  });

  it("고를 때마다 기기에 적는다(탭·기간·보기 방식을 함께)", async () => {
    const save = vi.fn(async () => {});
    await mount(fakeApi(noGoal(), { load: async () => undefined, save }));
    expect(save).not.toHaveBeenCalled(); // 읽기만으로는 적지 않는다
    fireEvent.click(chip("총 시간"));
    fireEvent.click(chip("원그래프로 보기"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenNthCalledWith(1, { period: "total", periodWeek: WEEK, view: "band", tab: null, tabWeek: null });
    expect(save).toHaveBeenNthCalledWith(2, { period: "total", periodWeek: WEEK, view: "pie", tab: null, tabWeek: null });
  });

  it("다시 열면 그대로(고른 값을 적은 저장소에서 새 화면이 읽는다)", async () => {
    let stored: unknown;
    const pref: Pref = { load: async () => stored, save: async (v) => void (stored = v) };
    const first = await mount(fakeApi(spec(), pref));
    fireEvent.click(tab("목표 비율"));
    fireEvent.click(chip("총 시간"));
    fireEvent.click(chip("원그래프로 보기"));
    await waitFor(() => expect(stored).toEqual({ period: "total", periodWeek: WEEK, view: "pie", tab: "ratio", tabWeek: WEEK }));
    first.unmount();
    cleanup();
    await mount(fakeApi(spec(), pref));
    expect(selected("목표 비율")).toBe("true");
    expect(pressed("총 시간")).toBe("true");
    expect(chip("띠그래프로 보기")).toBeTruthy();
  });

  it("읽기가 실패해도(던지거나 모양이 이상해도) 처음 값으로 돈다", async () => {
    for (const load of [async () => Promise.reject(new Error("blocked")), async () => ({ period: "decade", view: 3, tab: "x" }), async () => "이상한 글", async () => undefined]) {
      const { unmount, container } = await mount(fakeApi(noGoal(), { load, save: async () => {} }));
      expect(selected("목표 비율")).toBe("true");
      expect(pressed("이번 주")).toBe("true");
      expect(container.querySelectorAll(".growth-band")).toHaveLength(2);
      unmount();
      cleanup();
    }
  });

  it("쓰기가 실패해도 화면은 그대로 바뀐다", async () => {
    const { container } = await mount(fakeApi(noGoal(), { load: async () => undefined, save: async () => Promise.reject(new Error("full")) }));
    fireEvent.click(chip("원그래프로 보기"));
    await act(async () => {});
    expect(container.querySelectorAll("svg.growth-pie")).toHaveLength(2);
  });

  it("기억한 값이 오지 않아도(멈춤) 잠시 뒤 처음 값으로 그리고, 늦게 온 값이 사용자가 고른 것을 덮지 않는다", async () => {
    let release: (v: unknown) => void = () => {};
    const load = vi.fn(() => new Promise<unknown>((resolve) => (release = resolve)));
    const { container } = render(<GrowthScreen api={fakeApi(noGoal(), { load, save: async () => {} })} active activation={1} entry="self" onOpenCategory={vi.fn()} />);
    await screen.findByRole("tablist", {}, { timeout: 3000 });
    expect(pressed("이번 주")).toBe("true");
    fireEvent.click(chip("원그래프로 보기"));
    await act(async () => release({ period: "total", periodWeek: WEEK, view: "band", tab: "goal", tabWeek: WEEK }));
    expect(container.querySelectorAll("svg.growth-pie")).toHaveLength(2);
    expect(pressed("이번 주")).toBe("true");
    expect(selected("목표 비율")).toBe("true");
  });

  it("기억하는 길이 없는 구현(viewPref 없음)은 기다리지 않고 처음 값으로 돈다", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    expect(pressed("이번 주")).toBe("true");
    expect(container.querySelectorAll(".growth-band")).toHaveLength(2);
  });
});

describe("기억한 값이 늦게 올 때(기다리는 시간 800ms 넘김)", () => {
  it("처음 값으로 이미 그렸고 사용자가 아직 안 골랐으면 늦게 온 값은 무시한다(읽고 있는 화면이 바뀌지 않는다)", async () => {
    let release: (v: unknown) => void = () => {};
    const load = vi.fn(() => new Promise<unknown>((resolve) => (release = resolve)));
    const { container } = render(<GrowthScreen api={fakeApi(noGoal(), { load, save: async () => {} })} active activation={1} entry="self" onOpenCategory={vi.fn()} />);
    await screen.findByRole("tablist", {}, { timeout: 3000 });
    expect(pressed("이번 주")).toBe("true");
    await act(async () => release({ period: "total", periodWeek: WEEK, view: "pie" }));
    expect(pressed("이번 주")).toBe("true"); // 바뀌지 않는다
    expect(container.querySelector(".growth-band")).not.toBeNull();
    expect(container.querySelector(".growth-pie")).toBeNull();
  });
  it("기다리는 시간 안에 오면 처음부터 그 값으로 그린다(위 시험과 대비)", async () => {
    const load = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { period: "total", periodWeek: WEEK, view: "pie" };
    });
    const { container } = await mount(fakeApi(noGoal(), { load, save: async () => {} }));
    expect(pressed("총 시간")).toBe("true");
    expect(container.querySelectorAll("svg.growth-pie")).toHaveLength(2);
  });
});

describe("색: 한 군데(categoryColorValue)에서만 정한다", () => {
  it("그 함수가 낸 색이 막대 채움·띠·원·색점에 그대로 쓰이고, 분야 자리(만든 순서)와 기타(null)가 넘어간다", async () => {
    const real = await vi.importActual<typeof import("../../lib/category-color")>("../../lib/category-color");
    vi.mocked(categoryColorValue).mockImplementation(() => "rgb(1, 2, 3)");
    try {
      const { container } = await mount(fakeApi(spec()));
      const colorsOf = (selector: string, prop: "background" | "fill") =>
        Array.from(container.querySelectorAll<HTMLElement | SVGElement>(selector)).map((el) => (el as HTMLElement).style[prop]);
      expect(colorsOf(".growth-goal-fill", "background")).toEqual(Array(5).fill("rgb(1, 2, 3)"));
      fireEvent.click(tab("목표 비율"));
      expect(colorsOf(".growth-band-cell", "background")).toEqual(Array(9).fill("rgb(1, 2, 3)"));
      expect(colorsOf(".growth-dot", "background")).toEqual(Array(5).fill("rgb(1, 2, 3)"));
      fireEvent.click(chip("원그래프로 보기"));
      expect(colorsOf("svg.growth-pie path", "fill")).toEqual(Array(9).fill("rgb(1, 2, 3)"));
      const calls = vi.mocked(categoryColorValue).mock.calls.map(([order]) => order);
      expect(calls).toContain(0);
      expect(calls).toContain(3);
      expect(calls).toContain(null);
      expect(calls.filter((order) => order !== null && (order < 0 || order > 3))).toEqual([]);
    } finally {
      vi.mocked(categoryColorValue).mockImplementation(real.categoryColorValue);
    }
  });

  it("분야 8개 + 기타, 9번째부터 색을 돌려 쓴다(9번째 분야 = 1번 색)", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const d = spec({
      categories: ids.map((id, i) => ({ id, name: `분야 ${i + 1}` })),
      goal: { weekStart: WEEK, items: ids.map((id) => ({ categoryId: id, minutes: 60 })) },
      thisWeek: [...ids.map((id) => ({ categoryId: id, minutes: 30 })), { categoryId: null, minutes: 30 }],
      ratios: ids.map((id) => ({ categoryId: id, percent: 10 })),
    });
    const { container } = await mount(fakeApi(d));
    const fills = Array.from(container.querySelectorAll<HTMLElement>(".growth-goal-fill")).map((el) => el.style.background);
    expect(fills).toHaveLength(10);
    expect(fills[0]).toBe("var(--color-category-1)");
    expect(fills[7]).toBe("var(--color-category-8)");
    expect(fills[8]).toBe("var(--color-category-1)");
    expect(fills[9]).toBe("var(--color-category-other)");
    expect(names(container).at(-1)).toBe("기타");
  });
});

describe("접근성", () => {
  it("기간 고르기는 이름 있는 묶음 안의 실제 단추이고 누름 상태(aria-pressed)로 지금 값을 알린다", async () => {
    await mount(fakeApi(noGoal()));
    const buttons = within(screen.getByRole("group", { name: GROWTH_TEXT.periodGroup })).getAllByRole("button");
    expect(buttons.length).toBe(3);
    expect(buttons.every((b) => b.tagName === "BUTTON" && b.getAttribute("aria-pressed") !== null)).toBe(true);
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("키보드 차례: 켜진 탭 → 기간 셋 → 보기 바꾸기 → 분야 줄, 건너뛰는 단추나 tabindex가 없다", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.getAttribute("tabindex") !== "-1");
    expect(buttons.map((b) => b.querySelector(".growth-name")?.textContent ?? b.textContent)).toEqual([
      "목표 비율",
      "이번 주",
      "총 시간",
      "비교",
      "원그래프로 보기",
      "어학",
      "포트폴리오",
      "자격증",
      "운동",
      "기타",
    ]);
    expect(buttons.slice(1).every((b) => !b.disabled && !b.hasAttribute("tabindex"))).toBe(true);
  });

  it("그림은 글로 읽히지 않게 숨기고(aria-hidden) 색점도 장식이다. 숨은 요약이 같은 내용을 준다", async () => {
    const { container } = await mount(fakeApi(noGoal()));
    expect(container.querySelector(".growth-graph")?.getAttribute("aria-hidden")).toBe("true");
    expect(Array.from(container.querySelectorAll(".growth-dot")).every((el) => el.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(summary(container).length).toBeGreaterThan(20);
  });
});

describe("분야 이름은 사용자 입력이다", () => {
  it("꺾쇠·스크립트 모양 이름은 글자 그대로 보이고 요약에도 글자로만 들어간다", async () => {
    const evil = '<img src=x onerror="window.__g=1">';
    const { container } = await mount(fakeApi(spec({ categories: [{ id: G1, name: evil }], ratios: [{ categoryId: G1, percent: 100 }] })));
    expect(summary(container)).toContain(`${evil} 2시간, 목표 5시간, 3시간 더.`);
    fireEvent.click(tab("목표 비율"));
    expect(summary(container)).toContain(`${evil} `);
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("분야 50개(아주 긴 이름 포함)도 줄·조각이 모두 그려지고 예외가 없다", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const many = spec({
      categories: ids.map((id, i) => ({ id, name: i === 0 ? "아".repeat(300) : `분야 ${i + 1}` })),
      ratios: ids.map((id) => ({ categoryId: id, percent: 2 })),
      thisWeek: ids.map((id, i) => ({ categoryId: id, minutes: 5 * ((i % 7) + 1) })),
      goal: { weekStart: WEEK, items: ids.slice(0, 20).map((id) => ({ categoryId: id, minutes: 60 })) },
    });
    const { container } = await mount(fakeApi(many));
    expect(items(container)).toHaveLength(50);
    fireEvent.click(tab("목표 비율"));
    expect(items(container)).toHaveLength(51); // 분야 50 + 기타
    const segs = Array.from(container.querySelectorAll<HTMLElement>(".growth-band-cell"));
    expect(segs.length).toBeGreaterThan(40);
    expect(segs.every((el) => el.style.background !== "")).toBe(true);
    fireEvent.click(chip("원그래프로 보기"));
    expect(container.querySelectorAll("svg.growth-pie path").length).toBeGreaterThan(40);
  });
});

describe("모양 규칙(CSS 출처 값, app/globals.css) — 실제 칠해짐은 screens 360px에서", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  const rule = (selector: string) => {
    const i = css.indexOf(`${selector} {`);
    expect(i).toBeGreaterThanOrEqual(0);
    return css.slice(i, css.indexOf("}", i));
  };
  it("목표 한 줄: --font-goal-line(대체값 20/28 Bold), 글자색, 낱말 단위 감쌈(keep-all), 말줄임 없음", () => {
    const r = rule(".growth-goal-line");
    expect(r).toContain("font: var(--font-goal-line, 700 20px/28px var(--font-family))");
    expect(r).toContain("color: var(--color-text)");
    expect(r).toContain("word-break: keep-all");
    expect(r).not.toMatch(/ellipsis|nowrap|line-clamp/);
  });
  it("탭: 높이 48·폭 반, 켜진 탭 3px 글자색 밑줄 + Bold, 꺼진 탭 보조색", () => {
    expect(rule(".growth-tab")).toMatch(/flex: 1 1 50%[\s\S]*min-height: var\(--tap-min\)[\s\S]*color: var\(--color-text-sub\)/);
    expect(rule('.growth-tab[aria-selected="true"]')).toContain("border-bottom: 3px solid var(--color-text)");
    expect(rule('.growth-tab[aria-selected="true"]')).toContain("font-weight: 700");
  });
  it("카드 16 · 기간 칩 999 대체값, 분야 줄은 넘치면 다음 줄로(flex-wrap), 상태보기 규칙에 말줄임·살구 없음", () => {
    expect(rule(".growth-card")).toContain("var(--radius-card, 16px)");
    expect(rule(".growth-period-face")).toContain("var(--radius-pill, 999px)");
    expect(rule(".growth-row")).toContain("flex-wrap: wrap");
    const growth = css.slice(css.indexOf(".growth-body {"), css.indexOf(".growth-dl dd"));
    expect(growth.length).toBeGreaterThan(1000);
    expect(growth).not.toMatch(/ellipsis|--color-accent/);
  });
  it("띠 칸이 28px보다 좁으면 칸 안 숫자를 숨긴다(컨테이너 쿼리 — 테두리 없는 바깥 칸의 바깥 폭 28 기준). 실제 27·29px 칸에서 숨음/보임은 screens에서 잰다", () => {
    expect(rule(".growth-band-slot")).toContain("container-type: inline-size");
    expect(rule(".growth-band-cell")).not.toContain("container-type"); // 테두리 있는 칸은 쿼리 대상이 아니다(안쪽 폭은 테두리·첫 칸 여부로 달라진다)
    expect(css).toMatch(/@container \(max-width: 27\.98px\) \{ \.growth-seg-label \{ display: none; \} \}/);
  });
});
