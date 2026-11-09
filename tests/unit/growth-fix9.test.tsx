// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GrowthData } from "../../lib/growth/types";
import type { GrowthApi } from "../../lib/growth-api";

vi.mock("../../app/views/actions", () => ({ recordView: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));

import { GROWTH_TEXT, GrowthScreen } from "../../components/growth-screen";
import { PHOSPHOR_PATHS, TabBar } from "../../components/tab-bar";

/**
 * 원샷 v2 고침9 — 상태보기·아래 탭 Figma 정합(A5 · A6 · S6 공통 · S6-1 목표 없는 주 · S6 빈 상태).
 * 맨 위 순서(워드마크 → 목표 한 줄 → 탭, 큰 제목 없음·숨은 h1), 기간 칩 메뉴(열기·고르기·키보드·Esc·바깥·기억), 보기 단추 자리, 「›」,
 * 연속 기록 줄, 예시 막대 채움 없음, 빈 상태 꼴, 아래 탭 켜짐 꼴(CSS 출처 — 실제 칠해짐은 screens fix9).
 */

const G1 = "a1a1a1a1-0000-4000-8000-000000000000";
const G2 = "a2a2a2a2-0000-4000-8000-000000000000";
const WEEK = "2026-11-02";
function data(over: Partial<GrowthData> = {}): GrowthData {
  return {
    today: "2026-11-07",
    weekStart: WEEK,
    lastWeekStart: "2026-10-26",
    lastMonthRange: { from: "2026-10-01", to: "2026-10-31" },
    categories: [
      { id: G1, name: "어학" },
      { id: G2, name: "포트폴리오" },
    ],
    ratios: [
      { categoryId: G1, percent: 60 },
      { categoryId: G2, percent: 40 },
    ],
    thisWeek: [
      { categoryId: G1, minutes: 120 },
      { categoryId: G2, minutes: 60 },
    ],
    lastWeek: [],
    lastMonth: [],
    cumulative: [
      { categoryId: G1, minutes: 600 },
      { categoryId: G2, minutes: 600 },
    ],
    loggedDaysThisWeek: 2,
    loggedDaysTotal: 9,
    streakWeeks: 3,
    goal: { weekStart: WEEK, items: [{ categoryId: G1, minutes: 300 }] },
    goalText: "토익 900점 넘기기",
    ...over,
  };
}
type Pref = NonNullable<GrowthApi["viewPref"]>;
function api(d: GrowthData, viewPref?: Pref): GrowthApi {
  return { fetchGrowth: vi.fn(async () => ({ ok: true as const, data: d })), fetchCategoryPage: vi.fn(), recordView: vi.fn(async () => ({ ok: true })), ...(viewPref ? { viewPref } : {}) } as unknown as GrowthApi;
}
async function mount(d: GrowthData, viewPref?: Pref, props: { onOpenCategory?: (id: string | null, name: string) => void; onOpenEvening?: () => void } = {}) {
  const view = render(
    <div>
      <button type="button">바깥 단추</button>
      <GrowthScreen api={api(d, viewPref)} active activation={1} entry="self" onOpenCategory={props.onOpenCategory ?? vi.fn()} onOpenEvening={props.onOpenEvening ?? vi.fn()} onOpenGoal={vi.fn()} />
    </div>,
  );
  await screen.findByRole("tabpanel");
  return view;
}
const chip = () => screen.getByRole("button", { name: /^기간, / });
const ratioTab = () => fireEvent.click(screen.getByRole("tab", { name: "목표 비율" }));
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const rule = (selector: string) => {
  const i = css.indexOf(`${selector} {`);
  expect(i).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("A5 맨 위: 워드마크 → 목표 한 줄 → 탭, 큰 제목 「상태보기」 없음(숨은 h1만)", () => {
  it("순서와 숨은 제목", async () => {
    const { container } = await mount(data());
    const section = container.querySelector<HTMLElement>("section.growth")!;
    const head = section.firstElementChild as HTMLElement;
    expect(head.className).toBe("growth-head");
    const mark = within(head).getByRole("img", { name: "두노" });
    expect(mark.textContent).toBe("duno");
    const goal = section.querySelector<HTMLElement>(".growth-goal-line")!;
    const tabs = screen.getByRole("tablist");
    // 문서 순서: 머리(워드마크) → 목표 한 줄 → 탭 → 패널(카드)
    expect(head.nextElementSibling).toBe(goal);
    expect(goal.nextElementSibling).toBe(tabs);
    expect(tabs.nextElementSibling?.getAttribute("role")).toBe("tabpanel");
    // 제목은 숨은 h1 하나(페이지 제목 구조). 보이는 h1·h2 제목 「상태보기」나 카드 위 머리 줄 제목은 없다
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => [h.tagName, h.textContent, h.className])).toEqual([["H1", "상태보기", "sr-only"]]);
    expect(section.getAttribute("aria-labelledby")).toBe(headings[0].id);
    expect(container.querySelector(".today-title, .today-header")).toBeNull();
  });

  it("CSS: 머리 위·아래 12, 목표 한 줄은 아래 여백 없이 탭에 붙고, 탭은 화면 끝에서 끝, 탭 → 카드 20", () => {
    expect(rule(".growth-head")).toContain("padding: var(--space-3) var(--page-x)");
    expect(rule(".growth-goal-line")).toContain("padding: 0 var(--page-x);");
    expect(rule(".growth-tabs")).toContain("padding: 0;");
    expect(rule(".growth-tabs")).toContain("margin-bottom: calc(var(--space-4) + var(--space-1))");
  });
});

describe("A6 아래 탭: 켜진 탭 위 굵은 선 없음, 켜진 탭 = Bold + 글자색, 꺼진 탭 = 보조색", () => {
  it("aria-current는 그대로(지금 탭 하나만 page)", () => {
    render(<TabBar tabs={["growth", "todo", "timer", "me"]} current="growth" onSelect={() => {}} />);
    const buttons = within(screen.getByRole("navigation", { name: "화면 이동" })).getAllByRole("button");
    expect(buttons.map((b) => [b.textContent, b.getAttribute("aria-current")])).toEqual([
      ["상태보기", "page"],
      ["할 일", null],
      ["타이머", null],
      ["내 정보", null],
    ]);
    // 스킬 검토 O-6(PM d-150): 아이콘 24 + 글. 아이콘은 장식(aria-hidden)이라 탭 이름은 글 그대로
    for (const b of buttons) {
      const icon = b.querySelector<HTMLElement | SVGElement>(".tabbar-icon")!;
      expect(icon).not.toBeNull();
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(b.firstElementChild).toBe(icon); // 아이콘 위, 글 아래
      expect(b.querySelector(".tabbar-label")?.textContent).toBe(b.textContent);
    }
    expect(buttons.map((b) => screen.getByRole("button", { name: b.textContent! }))).toEqual(buttons);
    // 상태보기 = 브랜드 고리 SVG(선 1.5, currentColor — 켜짐 색을 따른다). 나머지 셋 = Phosphor Regular 경로(PM d-151 나 — 패키지 없음)
    const ring = buttons[0].querySelector("svg.tabbar-icon")!;
    expect(ring.getAttribute("data-icon")).toBe("ring");
    expect([ring.getAttribute("width"), ring.getAttribute("height"), ring.getAttribute("stroke"), ring.getAttribute("stroke-width")]).toEqual(["24", "24", "currentColor", "1.5"]);
    expect(ring.querySelectorAll("path")).toHaveLength(2); // 고리 + 나온 조각
    const expected = [
      ["list-checks", PHOSPHOR_PATHS["list-checks"]],
      ["timer", PHOSPHOR_PATHS.timer],
      ["user", PHOSPHOR_PATHS.user],
    ];
    buttons.slice(1).forEach((b, i) => {
      const svg = b.querySelector("svg.tabbar-icon")!;
      expect([svg.getAttribute("data-icon"), svg.getAttribute("width"), svg.getAttribute("viewBox"), svg.getAttribute("fill")]).toEqual([expected[i][0], "24", "0 0 256 256", "currentColor"]);
      expect(svg.querySelector("path")?.getAttribute("d")).toBe(expected[i][1]);
    });
    // 경로는 Phosphor 저장소 Regular 원본 그대로(앞머리로 대조 — 지어낸 경로가 아니다)
    expect(PHOSPHOR_PATHS["list-checks"].startsWith("M224,128a8,8,0,0,1-8,8H128")).toBe(true);
    expect(PHOSPHOR_PATHS.timer.startsWith("M128,40a96,96,0,1,0,96,96")).toBe(true);
    expect(PHOSPHOR_PATHS.user.startsWith("M230.92,212c-15.23-26.33")).toBe(true);
    // 파일 머리 MIT 고지
    const src = readFileSync(join(process.cwd(), "components/tab-bar.tsx"), "utf8");
    expect(src).toContain("MIT License");
    expect(src).toContain("Copyright (c) 2023 Phosphor Icons");
    expect(src).toContain("https://github.com/phosphor-icons/core");
  });

  it("CSS: 아이콘 24 · 글 12, 아이콘 → 글 세로 쌓기(탭 위 8 · 사이 4)", () => {
    const base = rule(".tabbar-btn");
    expect(base).toContain("flex-direction: column");
    expect(base).toContain("gap: var(--space-1)");
    expect(base).toContain("font: 400 12px/16px var(--font-family)");
    expect(base).toContain("padding: var(--space-2) var(--space-1)");
    expect(rule(".tabbar-icon")).toContain("inline-size: 24px; block-size: 24px");
  });

  it("CSS 출처: .tabbar-btn·켜진 탭 규칙에 위 선(border-top)이 없고, 켜진 탭은 --color-text + 700, 꺼진 탭은 --color-text-sub", () => {
    const base = rule(".tabbar-btn");
    expect(base).not.toMatch(/border-top/);
    expect(base).toContain("border: 0");
    expect(base).toContain("color: var(--color-text-sub)");
    expect(base).toContain("min-height: 64px");
    const on = rule('.tabbar-btn[aria-current="page"]');
    expect(on).toContain("color: var(--color-text)");
    expect(on).toContain("font-weight: 700");
    expect(on).not.toMatch(/border|box-shadow|--color-primary/);
    // 문서 어디에도 탭 단추 위 선 규칙이 남지 않는다
    expect(css).not.toMatch(/\.tabbar-btn[^{]*\{[^}]*border-top/);
  });
});

describe("스킬 검토 O-12 · O-10(PM d-150)", () => {
  it("O-12: 그래프(띠·원·막대·범례·예시·연속 기록 고리·워드마크 그림)는 화면 읽기에서 숨기고, 아래 목록 줄은 읽힌다(숨은 요약 하나는 그대로)", async () => {
    const hiddenOk = (el: Element) => el.closest("[aria-hidden='true']") !== null;
    const graphics = (c: HTMLElement) => Array.from(c.querySelectorAll(".growth-graph, .growth-band, svg, .growth-goal-bar, .growth-legend, .growth-chevron"));
    const check = (c: HTMLElement) => {
      const g = graphics(c);
      expect(g.length).toBeGreaterThan(3);
      for (const el of g) expect(hiddenOk(el), el.getAttribute("class") ?? el.tagName).toBe(true);
      const rows = Array.from(c.querySelectorAll<HTMLElement>(".growth-item > button"));
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(hiddenOk(r)).toBe(false);
      expect(c.querySelectorAll(".growth-body > p.sr-only")).toHaveLength(1);
    };
    const { container } = await mount(data());
    check(container); // 이번 주 목표 뷰(막대)
    ratioTab();
    check(container); // 목표 비율 뷰(띠)
    fireEvent.click(screen.getByRole("button", { name: "원그래프로 보기" }));
    check(container); // 원
  });

  it("O-10: 상태보기의 시간과 %가 놓이는 자리는 모두 고정폭 숫자(CSS 출처 — 실제 계산값은 screens fix9)", () => {
    // 「\n.growth-row-value」: 줄 머리에서 시작하는 규칙(「.growth-row .growth-row-value」 규칙과 가르려고)
    for (const sel of [".growth-card-title", ".growth-card-total", "\n.growth-row-value", ".growth-seg-label", ".growth-pie-text"]) expect(rule(sel)).toContain("font-variant-numeric: tabular-nums");
    const group = css.match(/\n([^\n{]*\.growth-goal-of[^{]*)\{ font-variant-numeric: tabular-nums; \}/);
    expect(group).not.toBeNull();
    for (const sel of [".growth-goal-of", ".growth-week-zero", ".growth-streak", ".growth-dl dd", ".growth-compare .todo-sub"]) expect(group![1]).toContain(sel);
  });
});

describe("S6 공통: 카드 위 머리 줄 없음 — 탭 바로 아래가 카드", () => {
  it("두 뷰 모두 패널의 첫 보이는 요소가 카드다", async () => {
    const { container } = await mount(data());
    const firstVisible = (panel: HTMLElement) => Array.from(panel.children).find((el) => !el.classList.contains("sr-only"));
    expect(firstVisible(screen.getByRole("tabpanel"))?.className).toBe("growth-card");
    ratioTab();
    expect(firstVisible(screen.getByRole("tabpanel"))?.className).toBe("growth-card");
    expect(container.textContent).not.toMatch(/이번 주 내 시간이 어느 분야에 쓰였나|분야마다 쌓인 시간|오늘 기록 \d+일/);
  });
});

describe("기간 칩 하나(메뉴 단추) — 열기·고르기·키보드·Esc·바깥·기억", () => {
  it("이번 주 목표 뷰에는 칩이 없다(기간은 이번 주만, 명세 ③-S)", async () => {
    await mount(data());
    expect(screen.queryByRole("button", { name: /^기간, / })).toBeNull();
  });

  it("누르면 열리고 지금 기간에 포커스, 고르면 닫히고 칩으로 포커스가 돌아오며 칩 글이 바뀐다", async () => {
    await mount(data({ goal: null }));
    const c = chip();
    expect(c.textContent).toBe("이번 주 ▾");
    fireEvent.click(c);
    const items = screen.getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.click(items[1]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(chip().textContent).toBe("총 시간 ▾");
    expect(chip().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(chip());
    expect(document.querySelector(".growth-card-total")?.textContent).toBe("20시간"); // 총 시간 = 쌓인 1200분
  });

  it("키보드: 칩에서 ↓ = 지금 항목, ↑ = 끝 항목으로 열림. 목록에서 ↓↑(끝에서 돌아감)·Home·End, Esc는 닫고 칩으로", async () => {
    await mount(data({ goal: null }));
    fireEvent.keyDown(chip(), { key: "ArrowDown" });
    let items = screen.getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(items[0]);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]); // 끝에서 돌아감
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(chip());
    expect(chip().textContent).toBe("이번 주 ▾"); // Esc는 고르지 않는다
    fireEvent.keyDown(chip(), { key: "ArrowUp" });
    items = screen.getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(items[2]);
    // Tab은 목록을 닫는다(포커스는 브라우저가 다음 자리로)
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("바깥을 누르면 닫히고(고르지 않음), 칩·목록 안을 누르는 것은 바깥이 아니다", async () => {
    await mount(data({ goal: null }));
    fireEvent.click(chip());
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "바깥 단추" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(chip().textContent).toBe("이번 주 ▾");
    // 칩을 다시 누르면 열리고, 열린 채 또 누르면 닫힌다
    fireEvent.click(chip());
    expect(chip().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(chip());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("고른 기간은 그 주(periodWeek)와 함께 기억하고, 다시 열면 그 기간으로 시작한다", async () => {
    let stored: unknown;
    const pref: Pref = { load: async () => stored, save: async (v) => void (stored = v) };
    const view = await mount(data({ goal: null }), pref);
    fireEvent.click(chip());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "비교" }));
    await waitFor(() => expect(stored).toEqual({ period: "compare", periodWeek: WEEK, view: "band", tab: null, tabWeek: null }));
    view.unmount();
    cleanup();
    await mount(data({ goal: null }), pref);
    expect(chip().getAttribute("aria-label")).toBe("기간, 비교");
    fireEvent.click(chip());
    expect(screen.getAllByRole("menuitemradio").map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  });

  it("고침7 빈 상태 규칙 그대로: 이번 주 0시간 + 쌓인 것 있음 → 칩이 「총 시간」으로 시작", async () => {
    await mount(data({ goal: null, thisWeek: [] }));
    expect(chip().textContent).toBe("총 시간 ▾");
    expect(screen.getByText(GROWTH_TEXT.weekZero)).toBeTruthy();
  });
});

describe("보기 단추 자리 · 목록 「›」 · 줄 사이 선", () => {
  it("「원그래프로 보기」는 합계·칩과 같은 머리 줄의 오른쪽 끝", async () => {
    const { container } = await mount(data({ goal: null }));
    const head = container.querySelector<HTMLElement>(".growth-card > .growth-card-head")!;
    const toggle = screen.getByRole("button", { name: "원그래프로 보기" });
    expect(Array.from(head.children).map((el) => el.className.split(" ")[0])).toEqual(["growth-card-total", "growth-period-menu", "btn"]);
    expect(head.lastElementChild).toBe(toggle);
    expect(rule(".btn.growth-switch")).toContain("min-height: var(--tap-min)");
    expect(rule(".btn.growth-switch")).toContain("margin-inline-start: auto");
  });

  it("두 뷰 목록 줄마다 끝에 「›」(숨김), 누르면 지금처럼 분야 페이지", async () => {
    const onOpenCategory = vi.fn();
    const { container } = await mount(data(), undefined, { onOpenCategory });
    const check = () => {
      const rows = Array.from(container.querySelectorAll<HTMLElement>(".growth-item > button"));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const last = row.lastElementChild!;
        expect(last.className).toBe("growth-chevron");
        expect(last.textContent).toBe("›");
        expect(last.getAttribute("aria-hidden")).toBe("true");
      }
      return rows;
    };
    const goalRows = check();
    expect(goalRows.length).toBe(2); // 어학(목표) · 포트폴리오(쓴 시간). 기타는 목표도 쓴 시간도 없어 줄이 없다
    fireEvent.click(goalRows[0]);
    expect(onOpenCategory).toHaveBeenLastCalledWith(G1, "어학");
    ratioTab();
    const ratioRows = check();
    fireEvent.click(ratioRows[ratioRows.length - 1]);
    expect(onOpenCategory).toHaveBeenLastCalledWith(null, "기타");
  });

  it("CSS: 목표 뷰·비율 뷰 줄 사이 선 없음(비교만), 비율 뷰는 범례 아래 선 하나", () => {
    expect(css).not.toMatch(/(^|\n)\.growth-item \{[^}]*border-bottom/);
    expect(rule(".growth-list.is-compare .growth-item")).toContain("border-bottom: 1px solid var(--color-divider)");
    expect(rule(".growth-graph + .growth-list")).toContain("border-top: 1px solid var(--color-divider)");
    expect(rule(".growth-chevron")).toContain("color: var(--color-text-sub)");
  });
});

describe("연속 기록 줄 「◯ n주 이어서 기록」(명세 ⑦-9)", () => {
  it("2주 이상이면 카드 아래 한 줄(두 뷰 공통): 보조색 고리 + 「3주」 Bold + 「 이어서 기록」", async () => {
    const { container } = await mount(data({ streakWeeks: 3 }));
    const line = () => container.querySelector<HTMLElement>(".growth-streak");
    const check = () => {
      const l = line()!;
      expect(l).not.toBeNull();
      expect(l.textContent).toBe("3주 이어서 기록");
      expect(l.querySelector("strong")?.textContent).toBe("3주");
      expect(l.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      // 카드 바로 아래
      expect(l.previousElementSibling?.classList.contains("growth-card")).toBe(true);
      // 알림·경고 없음(조용한 글)
      expect(l.getAttribute("role")).toBeNull();
      expect(l.closest("[aria-live]")).toBeNull();
    };
    check();
    ratioTab();
    check();
    expect(rule(".growth-streak")).toContain("color: var(--color-text-sub)");
    expect(rule(".growth-streak-count")).toContain("color: var(--color-text)");
  });

  it("1주·0주면 줄이 없다(끊기면 조용히 사라짐 — 「끊겼어요」 같은 글·경고 없음)", async () => {
    for (const n of [1, 0]) {
      const { container, unmount } = await mount(data({ streakWeeks: n }));
      expect(container.querySelector(".growth-streak")).toBeNull();
      expect(container.textContent).not.toMatch(/이어서 기록|끊겼|끊김/);
      unmount();
      cleanup();
    }
  });

  it("서버가 값을 주지 않은 옛 응답(streakWeeks 없음)도 줄 없이 그대로 그린다", async () => {
    const old = { ...data() } as Partial<GrowthData>;
    delete old.streakWeeks;
    const { container } = await mount(old as GrowthData);
    expect(container.querySelector(".growth-streak")).toBeNull();
    expect(container.querySelector(".growth-card")).not.toBeNull();
  });
});

describe("S6-1 목표 없는 주(Figma 50:741): 예시 막대 = 점선 막대 + 눈금만(채움 없음)", () => {
  it("채움이 없고, 점선 막대가 처음부터 눈금까지, 순서(예시 → 보조 줄 → 단추) 그대로", async () => {
    const { container } = await mount(data({ goal: null }), { load: async () => ({ tab: "goal", tabWeek: WEEK }), save: async () => {} });
    await screen.findByText(GROWTH_TEXT.goalSetHint);
    const example = screen.getByRole("group", { name: "예시" });
    const bars = Array.from(example.querySelectorAll<HTMLElement>(".growth-goal-bar"));
    expect(bars).toHaveLength(2);
    expect(example.querySelector(".growth-goal-fill")).toBeNull();
    for (const bar of bars) {
      const gap = bar.querySelector<HTMLElement>(".growth-goal-gap")!;
      expect(gap.style.insetInlineStart).toBe("0px");
      expect(gap.style.borderStyle).toBe("dashed");
      expect(bar.querySelector(".growth-goal-tick")).not.toBeNull();
      expect(bar.classList.contains("growth-example-bar")).toBe(true);
    }
    // 포트폴리오 목표 6시간 = 축 → 점선이 끝까지(오른쪽 0%), 어학 5시간 → 오른쪽 16.667% 남김
    expect(bars.map((b) => b.querySelector<HTMLElement>(".growth-goal-gap")!.style.insetInlineEnd)).toEqual(["0%", "16.667%"]);
    const card = container.querySelector<HTMLElement>(".growth-goal-set")!;
    expect(Array.from(card.children).map((el) => el.className)).toEqual(["growth-example", "growth-goal-hint", "btn btn-primary growth-goal-set-button"]);
    // 흐림은 모양에만(막대), 글은 보조색
    expect(rule(".growth-example-item .growth-goal-bar")).toContain("opacity: 0.4");
    expect(rule(".growth-example-item")).toContain("color: var(--color-text-sub)");
    expect(rule(".growth-example-item")).not.toContain("opacity");
    expect(rule(".growth-goal-bar.growth-example-bar")).toContain("block-size: 12px");
  });
});

describe("S6 빈 상태(Figma 50:598 · 111:79 · 121:240): 카드 밖 안내 글 없음 · 카드 안 끝 「오늘 기록」 · 빈 띠 연한 면 + 점선", () => {
  const none = (over: Partial<GrowthData> = {}) => data({ goal: null, thisWeek: [], cumulative: [], loggedDaysThisWeek: 0, loggedDaysTotal: 0, streakWeeks: 0, ...over });

  it("50:598: 머리(0시간 · 이번 주 ▾ · 원그래프로 보기) + 목표 비율 띠 + 빈 띠 「0시간」 + 카드 안 끝 폭 가득 「오늘 기록」, 카드 밖 글 없음", async () => {
    const onOpenEvening = vi.fn();
    const { container } = await mount(none(), undefined, { onOpenEvening });
    const card = container.querySelector<HTMLElement>(".growth-card")!;
    expect(card.querySelector(".growth-card-total")?.textContent).toBe("0시간");
    expect(chip().textContent).toBe("이번 주 ▾");
    const zero = card.querySelector<HTMLElement>(".growth-band.is-zero")!;
    expect(zero.textContent).toBe("0시간");
    const button = within(card).getByRole("button", { name: "오늘 기록" });
    expect(card.lastElementChild?.contains(button)).toBe(true);
    expect(button.querySelector(".growth-evening-face")?.textContent).toBe("오늘 기록");
    // 카드 밖(패널 안 카드 뒤)에는 아무 글도 없다
    expect(card.nextElementSibling).toBeNull();
    expect(container.textContent).not.toContain("아직 이번 주 오늘 기록이 없어요");
    fireEvent.click(button);
    expect(onOpenEvening).toHaveBeenCalledTimes(1);
  });

  it("111:79: 이번 주 0 + 지난 기록 → 「총 시간 ▾」 · 머리 아래 「이번 주 0시간」 · 카드 끝 「오늘 기록」 · 연속 기록 줄은 카드 아래", async () => {
    const { container } = await mount(data({ goal: null, thisWeek: [], streakWeeks: 3 }));
    const card = container.querySelector<HTMLElement>(".growth-card")!;
    expect(chip().textContent).toBe("총 시간 ▾");
    expect(card.querySelector(".growth-week-zero")?.textContent).toBe("이번 주 0시간");
    expect(card.lastElementChild?.querySelector(".growth-evening-button")?.textContent).toBe("오늘 기록");
    expect(card.nextElementSibling?.className).toBe("growth-streak");
  });

  it("CSS: 빈 띠 = --color-notice-bg 채움 + 1px 점선 --color-border-input, 「0시간」 12 Medium 보조색, 빈 상태 띠 높이 28 · 데이터 띠 36", () => {
    const zero = rule(".growth-band.is-zero");
    expect(zero).toContain("background: var(--color-notice-bg)");
    expect(zero).toContain("border: 1px dashed var(--color-border-input)");
    expect(rule(".growth-seg-label.growth-zero-label")).toContain("color: var(--color-text-sub)"); // 실제 칠해진 색은 screens fix9에서
    expect(rule(".growth-seg-label")).toContain("font: 500 12px/16px var(--font-family)");
    expect(rule(".growth-band")).toContain("block-size: 36px");
    expect(rule(".growth-graph.is-empty .growth-band")).toContain("block-size: 28px");
    // 「오늘 기록」 보조 단추: 보이는 면 높이 40 · 테두리 · 폭 가득, 누름 영역 48(.btn)
    const face = rule(".growth-evening-face");
    expect(face).toContain("min-height: 40px");
    expect(face).toContain("border: 1px solid var(--color-border-input)");
    expect(face).toContain("width: 100%");
    expect(rule(".btn.growth-evening-button")).toContain("width: 100%");
  });

  it("원 보기 빈 상태 둘(121:240 · 121:315): 오른쪽 빈 고리(또는 총 시간 원) + 아래 목록 + 카드 끝 「오늘 기록」, 원은 가운데 구멍", async () => {
    const { container, unmount } = await mount(none(), { load: async () => ({ view: "pie" }), save: async () => {} });
    await waitFor(() => expect(container.querySelector(".growth-pie-ring")).not.toBeNull());
    expect(container.querySelectorAll(".growth-item")).toHaveLength(3);
    expect(container.querySelector(".growth-card")!.lastElementChild?.querySelector(".growth-evening-button")).not.toBeNull();
    // 왼쪽 목표 비율 원에 구멍(카드 바탕 원 + 1px 윤곽)
    const hole = container.querySelector<SVGCircleElement>(".growth-pie-hole")!;
    expect(hole.getAttribute("fill")).toBe("var(--color-surface)");
    expect(Number(hole.getAttribute("r"))).toBeCloseTo(28, 5);
    unmount();
    cleanup();
    const second = await mount(data({ goal: null, thisWeek: [], streakWeeks: 3 }), { load: async () => ({ view: "pie" }), save: async () => {} });
    await waitFor(() => expect(second.container.querySelectorAll("svg.growth-pie")).toHaveLength(2));
    expect(chip().textContent).toBe("총 시간 ▾");
    expect(Array.from(second.container.querySelectorAll(".growth-pie-box .growth-line-caption")).map((el) => el.textContent)).toEqual(["목표 비율", "총 시간"]);
    expect(second.container.querySelectorAll(".growth-pie-hole")).toHaveLength(2);
    expect(second.container.querySelector(".growth-pie-ring")).toBeNull();
    await act(async () => {});
  });
});
