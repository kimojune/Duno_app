// @vitest-environment jsdom
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
import { GROWTH_TEXT, GrowthScreen } from "../../components/growth-screen";
import { STATUS_VIEWS } from "../../components/growth-views";

/**
 * 상태보기의 기간 × 보기 방식(고침 4바퀴 C 2단계). 처음 상태, 보기 바꾸기, 총 시간, 놓친 분야 문장, 채울 시간의 기간 짝,
 * 기억한 값(기기 저장소) 읽기·쓰기·실패, 접근성(단추·누름 상태·글로 읽는 그래프), 분야 이름·분야 50개.
 */

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const C4 = "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4";

/** 한 주 쓴 사람: 분야 넷, 처음 정한 비율 40·30·20·10, 최근 1주는 어학 하나로 쏠림(600분) */
function data(over: Partial<GrowthData> = {}): GrowthData {
  return {
    today: "2026-11-07",
    weekStart: "2026-11-02",
    lastWeekStart: "2026-10-26",
    lastMonthRange: { from: "2026-10-01", to: "2026-10-31" },
    categories: [
      { id: C1, name: "어학" },
      { id: C2, name: "포트폴리오" },
      { id: C3, name: "CS 공부" },
      { id: C4, name: "글쓰기" },
    ],
    ratios: [
      { categoryId: C1, percent: 40 },
      { categoryId: C2, percent: 30 },
      { categoryId: C3, percent: 20 },
      { categoryId: C4, percent: 10 },
    ],
    thisWeek: [{ categoryId: C1, minutes: 600 }],
    recentWeek: [{ categoryId: C1, minutes: 600 }],
    lastWeek: [],
    lastMonth: [],
    cumulative: [
      { categoryId: C1, minutes: 1200 },
      { categoryId: C2, minutes: 600 },
      { categoryId: C3, minutes: 600 },
    ],
    loggedDaysThisWeek: 5,
    loggedDaysRecentWeek: 6,
    loggedDaysTotal: 20,
    goal: null,
    ...over,
  };
}

type Pref = NonNullable<GrowthApi["viewPref"]>;
function fakeApi(d: GrowthData = data(), viewPref?: Pref): GrowthApi {
  return {
    fetchGrowth: vi.fn(async () => ({ ok: true as const, data: d })),
    fetchCategoryPage: vi.fn(),
    recordView: vi.fn(async () => ({ ok: true })),
    ...(viewPref ? { viewPref } : {}),
  } as unknown as GrowthApi;
}
async function mount(api: GrowthApi, onOpenCategory = vi.fn()) {
  const view = render(<GrowthScreen api={api} active activation={1} entry="self" onOpenCategory={onOpenCategory} onOpenEvening={vi.fn()} />);
  await screen.findByRole("group", { name: GROWTH_TEXT.periodGroup });
  return { onOpenCategory, ...view };
}
const chip = (name: string) => screen.getByRole("button", { name });
const pressed = (name: string) => chip(name).getAttribute("aria-pressed");
const graph = () => screen.queryByRole("img");
const graphLabel = () => graph()?.getAttribute("aria-label") ?? "";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("처음 상태: 최근 1주 · 띠그래프", () => {
  it("기간 「최근 1주」와 보기 「띠그래프」가 눌린 상태로 시작하고, 띠 두 줄(처음 정한 비율 위, 쓴 시간 바로 아래)이 있다", async () => {
    const { container } = await mount(fakeApi());
    expect(pressed("최근 1주")).toBe("true");
    expect(pressed("총 시간")).toBe("false");
    expect(pressed("띠그래프")).toBe("true");
    expect(pressed("원그래프")).toBe("false");
    const captions = Array.from(container.querySelectorAll(".growth-band-line .growth-line-caption")).map((el) => el.textContent);
    expect(captions).toEqual(["처음 정한 비율", "쓴 시간"]);
    expect(container.querySelectorAll(".growth-band")).toHaveLength(2);
    expect(container.querySelector(".growth-pie")).toBeNull();
    // 쓴 시간 줄은 어학 100%뿐(0% 조각은 그리지 않는다), 처음 정한 비율 줄은 네 조각
    const [ratioBand, spentBand] = Array.from(container.querySelectorAll(".growth-band"));
    expect(ratioBand.querySelectorAll(".growth-band-seg")).toHaveLength(4);
    expect(spentBand.querySelectorAll(".growth-band-seg")).toHaveLength(1);
  });

  it("쓴 시간 합계가 큰 숫자로 보인다(최근 1주 값, 달력 이번 주 값이 아니다)", async () => {
    await mount(fakeApi(data({ thisWeek: [{ categoryId: C1, minutes: 60 }], recentWeek: [{ categoryId: C1, minutes: 600 }] })));
    expect(screen.getByText("쓴 시간 합계")).toBeTruthy();
    expect(document.querySelector(".growth-total-number")?.textContent).toBe("10시간");
    expect(screen.getByText("저녁 기록 6일")).toBeTruthy(); // loggedDaysRecentWeek
  });

  it("그래프는 글로도 읽힌다: 그림 둘레에 두 줄의 내용이 aria-label로 있고 안쪽 그림은 숨김", async () => {
    const { container } = await mount(fakeApi());
    expect(graph()).not.toBeNull();
    expect(graphLabel()).toBe("처음 정한 비율 어학 40%, 포트폴리오 30%, CS 공부 20%, 글쓰기 10%. 쓴 시간 어학 100%");
    expect(container.querySelector(".growth-graph-art")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("분야 줄 목록(색점·이름·쓴 시간·차이)이 그래프 아래에 있고 누르면 분야 페이지로 간다", async () => {
    const { onOpenCategory } = await mount(fakeApi());
    const items = screen.getAllByRole("listitem").filter((li) => li.className === "growth-item");
    expect(items.map((li) => li.textContent)).toEqual([
      "어학10시간처음 정한 비율보다 +6시간", // 처음 정한 비율 40% = 240분, 쓴 600분
      "포트폴리오0분처음 정한 비율보다 −3시간",
      "CS 공부0분처음 정한 비율보다 −2시간",
      "글쓰기0분처음 정한 비율보다 −1시간",
      "기타0분처음 정한 비율보다 +0분",
    ]);
    fireEvent.click(within(items[1]).getByRole("button"));
    expect(onOpenCategory).toHaveBeenCalledWith(C2, "포트폴리오");
  });
});

describe("보기 방식 바꾸기", () => {
  it("「원그래프」를 누르면 원 둘로 바뀌고 누름 상태가 따라 바뀐다(두 원: 처음 정한 비율 / 쓴 시간)", async () => {
    const { container } = await mount(fakeApi());
    fireEvent.click(chip("원그래프"));
    expect(pressed("원그래프")).toBe("true");
    expect(pressed("띠그래프")).toBe("false");
    expect(container.querySelectorAll("svg.growth-pie")).toHaveLength(2);
    expect(container.querySelector(".growth-band")).toBeNull();
    expect(Array.from(container.querySelectorAll(".growth-pie-box .growth-line-caption")).map((el) => el.textContent)).toEqual(["처음 정한 비율", "쓴 시간"]);
    // 원도 같은 글을 준다. 쓴 시간 원은 어학 100%(온 원, 조각 하나)
    expect(graphLabel()).toContain("쓴 시간 어학 100%");
    const [ratioPie, spentPie] = Array.from(container.querySelectorAll("svg.growth-pie"));
    expect(ratioPie.querySelectorAll("path")).toHaveLength(4);
    expect(spentPie.querySelectorAll("path")).toHaveLength(1);
  });

  it("다시 「띠그래프」를 누르면 돌아온다", async () => {
    const { container } = await mount(fakeApi());
    fireEvent.click(chip("원그래프"));
    fireEvent.click(chip("띠그래프"));
    expect(container.querySelector(".growth-band")).not.toBeNull();
    expect(container.querySelector("svg.growth-pie")).toBeNull();
  });

  it("「분야별 줄 막대」: 분야마다 얇은 막대와 처음 정한 비율 눈금과 차이 글(0분도, 기타도)", async () => {
    const { container } = await mount(fakeApi());
    fireEvent.click(chip("분야별 줄 막대"));
    expect(graph()).toBeNull(); // 그림 보기가 아니다
    expect(container.querySelectorAll(".growth-item")).toHaveLength(5);
    expect(container.querySelectorAll(".growth-bar")).toHaveLength(5);
    expect(container.querySelectorAll(".growth-tick")).toHaveLength(5);
    const fills = Array.from(container.querySelectorAll<HTMLElement>(".growth-bar-fill")).map((el) => el.style.inlineSize);
    expect(fills).toEqual(["100%", "0%", "0%", "0%", "0%"]);
  });

  it("보기 방식은 목록(STATUS_VIEWS)을 따른다: 목록의 보기마다 고르는 단추가 있고 글이 있다", async () => {
    await mount(fakeApi());
    expect(STATUS_VIEWS.map((v) => v.id)).toEqual(["band", "pie", "rows"]);
    const group = screen.getByRole("group", { name: GROWTH_TEXT.viewGroup });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(STATUS_VIEWS.map((v) => GROWTH_TEXT[v.label]));
  });

  it("조각 색은 한 군데(categoryColorValue)에서만 정한다: 그 함수가 낸 색이 띠·원·줄 막대·색점에 그대로 쓰인다(동작 시험)", async () => {
    const real = await vi.importActual<typeof import("../../lib/category-color")>("../../lib/category-color");
    vi.mocked(categoryColorValue).mockImplementation(() => "rgb(1, 2, 3)");
    try {
      const { container } = await mount(fakeApi());
      const colorsOf = (selector: string, prop: "background" | "fill") =>
        Array.from(container.querySelectorAll<HTMLElement | SVGElement>(selector)).map((el) => (el as HTMLElement).style[prop]);
      // 띠그래프: 띠 조각(처음 정한 비율 4 + 쓴 시간 1)과 분야 줄의 색점(분야 4 + 기타)
      expect(colorsOf(".growth-band-seg", "background")).toEqual(Array(5).fill("rgb(1, 2, 3)"));
      expect(colorsOf(".growth-dot", "background")).toEqual(Array(5).fill("rgb(1, 2, 3)"));
      fireEvent.click(chip("원그래프"));
      expect(colorsOf("svg.growth-pie path", "fill")).toEqual(Array(5).fill("rgb(1, 2, 3)"));
      expect(colorsOf(".growth-dot", "background")).toEqual(Array(5).fill("rgb(1, 2, 3)"));
      fireEvent.click(chip("분야별 줄 막대"));
      expect(colorsOf(".growth-bar-fill", "background")).toEqual(Array(5).fill("rgb(1, 2, 3)"));
      // 분야 자리(받은 분야 순서, 0부터)와 기타(null)가 함수에 넘어간다
      const calls = vi.mocked(categoryColorValue).mock.calls.map(([order]) => order);
      expect(calls).toContain(0);
      expect(calls).toContain(3); // 분야 넷의 마지막 자리
      expect(calls).toContain(null);
      expect(calls.filter((order) => order !== null && order > 3)).toEqual([]); // 기타에 분야 자리를 주지 않는다
    } finally {
      vi.mocked(categoryColorValue).mockImplementation(real.categoryColorValue);
    }
  });
});

describe("총 시간", () => {
  it("기간을 총 시간으로 바꾸면 누적 값으로 세 보기가 다 된다", async () => {
    const { container } = await mount(fakeApi());
    fireEvent.click(chip("총 시간"));
    expect(pressed("총 시간")).toBe("true");
    expect(screen.getByRole("heading", { name: GROWTH_TEXT.totalHeading })).toBeTruthy();
    expect(screen.getByText("저녁 기록 20일")).toBeTruthy();
    expect(document.querySelector(".growth-total-number")?.textContent).toBe("40시간"); // 1200 + 600 + 600분
    // 띠: 쓴 시간 줄 = 어학 50 · 포트폴리오 25 · CS 공부 25
    expect(graphLabel()).toContain("쓴 시간 어학 50%, 포트폴리오 25%, CS 공부 25%");
    fireEvent.click(chip("원그래프"));
    expect(container.querySelectorAll("svg.growth-pie")).toHaveLength(2);
    expect(graphLabel()).toContain("쓴 시간 어학 50%, 포트폴리오 25%, CS 공부 25%");
    fireEvent.click(chip("분야별 줄 막대"));
    expect(container.querySelectorAll(".growth-bar")).toHaveLength(5);
  });

  it("총 시간에는 채울 시간(주 단위)이 없다. 최근 1주에는 있다", async () => {
    await mount(fakeApi());
    expect(screen.getByRole("heading", { name: "채울 시간" })).toBeTruthy();
    fireEvent.click(chip("총 시간"));
    expect(screen.queryByRole("heading", { name: "채울 시간" })).toBeNull();
  });

  it("기록이 하나도 없으면 안내와 단추, 큰 숫자·놓친 분야 문장은 없다", async () => {
    await mount(fakeApi(data({ recentWeek: [], cumulative: [], loggedDaysRecentWeek: 0, loggedDaysTotal: 0 })));
    fireEvent.click(chip("총 시간"));
    expect(screen.getByText(GROWTH_TEXT.emptyTotal)).toBeTruthy();
    expect(screen.queryByText("쓴 시간 합계")).toBeNull();
    expect(document.querySelector(".growth-missed")).toBeNull();
  });
});

describe("놓친 분야 문장과 채울 시간", () => {
  it("한 주 쓴 사람(처음 정한 비율 40·30·20·10, 어학 하나로 쏠림): 가장 덜 쓴 분야 하나를 사실로, 채울 시간은 차이 큰 순", async () => {
    await mount(fakeApi());
    // 최근 1주 600분: 포트폴리오 180분 · CS 공부 120분 · 글쓰기 60분을 덜 썼다
    expect(screen.getByText("「포트폴리오」 시간을 채울 수 있어요")).toBeTruthy();
    expect(document.querySelectorAll(".growth-missed")).toHaveLength(1);
    expect(screen.getByText("처음 정한 비율 기준")).toBeTruthy();
    expect(within(document.querySelector(".growth-short") as HTMLElement).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "포트폴리오 3시간",
      "CS 공부 2시간",
      "글쓰기 1시간",
    ]);
  });

  it("문장에 탓하거나 재촉하는 말이 없다", async () => {
    await mount(fakeApi());
    expect(document.body.textContent).not.toMatch(/역량|부족|편향|쏠림|경고|밀렸|늦|빨리|왜|못/);
  });

  it("쓴 시간이 0이면 문장이 나오지 않는다", async () => {
    await mount(fakeApi(data({ recentWeek: [], thisWeek: [], loggedDaysRecentWeek: 0 })));
    expect(document.querySelector(".growth-missed")).toBeNull();
    expect(screen.getByText(GROWTH_TEXT.shortfallWait)).toBeTruthy();
  });

  it("처음 정한 비율이 없으면 문장이 나오지 않는다(쓴 시간이 있어도)", async () => {
    await mount(fakeApi(data({ ratios: [] })));
    expect(document.querySelector(".growth-missed")).toBeNull();
    expect(screen.getByText(GROWTH_TEXT.shortfallEmpty)).toBeTruthy();
  });

  it("처음 정한 비율대로 쓰면 문장이 나오지 않는다", async () => {
    await mount(
      fakeApi(
        data({
          recentWeek: [
            { categoryId: C1, minutes: 240 },
            { categoryId: C2, minutes: 180 },
            { categoryId: C3, minutes: 120 },
            { categoryId: C4, minutes: 60 },
          ],
        }),
      ),
    );
    expect(document.querySelector(".growth-missed")).toBeNull();
    expect(screen.getByText(GROWTH_TEXT.shortfallEmpty)).toBeTruthy();
  });

  it("채울 시간의 기간 짝(임시값): 목표가 없으면 최근 1주에, 목표가 있으면 달력 이번 주에 쓴 시간과 견준다", async () => {
    const week = data({ thisWeek: [{ categoryId: C2, minutes: 60 }], recentWeek: [{ categoryId: C1, minutes: 600 }] });
    const { unmount } = await mount(fakeApi(week));
    expect(screen.getByText("처음 정한 비율 기준")).toBeTruthy();
    expect(screen.getByText("포트폴리오 3시간")).toBeTruthy(); // 최근 1주 600분의 30% = 180분 − 0
    unmount();
    cleanup();
    await mount(fakeApi({ ...week, goal: { weekStart: "2026-11-02", items: [{ categoryId: C2, minutes: 180 }] } }));
    expect(screen.getByText("이번 주 목표 기준")).toBeTruthy();
    expect(screen.getByText("포트폴리오 2시간")).toBeTruthy(); // 목표 180분 − 이번 주 60분
  });
});

describe("처음 쓰는 사람(기록 0일, 분야 하나)", () => {
  it("빈 안내와 「저녁 기록 남기기」, 그래프는 빈 줄, 큰 숫자·문장은 없다", async () => {
    const d = data({
      categories: [{ id: C1, name: "어학" }],
      ratios: [{ categoryId: C1, percent: 100 }],
      thisWeek: [],
      recentWeek: [],
      cumulative: [],
      loggedDaysThisWeek: 0,
      loggedDaysRecentWeek: 0,
      loggedDaysTotal: 0,
    });
    const { container } = await mount(fakeApi(d));
    expect(screen.getByText(GROWTH_TEXT.empty)).toBeTruthy();
    expect(screen.getByRole("button", { name: "저녁 기록 남기기" })).toBeTruthy();
    expect(screen.getByText("저녁 기록 0일")).toBeTruthy();
    expect(graphLabel()).toBe("처음 정한 비율 어학 100%. 쓴 시간 없음");
    expect(container.querySelector(".growth-band.is-empty")).not.toBeNull();
    expect(screen.queryByText("쓴 시간 합계")).toBeNull();
    expect(container.querySelector(".growth-missed")).toBeNull();
    fireEvent.click(chip("원그래프"));
    expect(container.querySelector(".growth-pie-empty")).not.toBeNull();
  });
});

describe("비교 보기는 그대로 남아 있다(D-093, 결정 대기)", () => {
  it("「비교」를 고르면 이번 주·지난주·지난달·쌓인 것이 나란히 보이고 보기 방식 고르기는 숨는다", async () => {
    await mount(fakeApi(data({ lastWeek: [{ categoryId: C1, minutes: 60 }], thisWeek: [{ categoryId: C1, minutes: 30 }] })));
    fireEvent.click(chip("비교"));
    expect(pressed("비교")).toBe("true");
    expect(screen.getByRole("heading", { name: "분야마다 나란히" })).toBeTruthy();
    const language = screen.getByRole("button", { name: /^어학/ });
    expect(within(language).getByText("이번 주").nextSibling?.textContent).toBe("30분");
    expect(within(language).getByText("지난주").nextSibling?.textContent).toBe("1시간");
    expect(within(language).getByText("쌓인 것").nextSibling?.textContent).toBe("20시간");
    expect(screen.queryByRole("group", { name: GROWTH_TEXT.viewGroup })).toBeNull();
    fireEvent.click(chip("최근 1주"));
    expect(screen.getByRole("group", { name: GROWTH_TEXT.viewGroup })).toBeTruthy();
  });
});

describe("기억한 기간·보기 방식", () => {
  it("기억한 값이 있으면 그 기간·보기로 처음부터 그린다(처음 값을 거치지 않는다)", async () => {
    const load = vi.fn(async () => ({ period: "total", view: "pie" }));
    const { container } = await mount(fakeApi(data(), { load, save: vi.fn(async () => {}) }));
    expect(pressed("총 시간")).toBe("true");
    expect(pressed("원그래프")).toBe("true");
    expect(container.querySelectorAll("svg.growth-pie")).toHaveLength(2);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("고를 때마다 기기에 적는다(기간과 보기 방식을 함께)", async () => {
    const save = vi.fn(async () => {});
    await mount(fakeApi(data(), { load: async () => undefined, save }));
    expect(save).not.toHaveBeenCalled(); // 읽기만으로는 적지 않는다
    fireEvent.click(chip("총 시간"));
    fireEvent.click(chip("분야별 줄 막대"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenNthCalledWith(1, { period: "total", view: "band" });
    expect(save).toHaveBeenNthCalledWith(2, { period: "total", view: "rows" });
  });

  it("다시 열면 그대로(고른 값을 적은 저장소에서 새 화면이 읽는다)", async () => {
    let stored: unknown;
    const pref: Pref = { load: async () => stored, save: async (v) => void (stored = v) };
    const first = await mount(fakeApi(data(), pref));
    fireEvent.click(chip("총 시간"));
    fireEvent.click(chip("원그래프"));
    await waitFor(() => expect(stored).toEqual({ period: "total", view: "pie" }));
    first.unmount();
    cleanup();
    await mount(fakeApi(data(), pref));
    expect(pressed("총 시간")).toBe("true");
    expect(pressed("원그래프")).toBe("true");
  });

  it("읽기가 실패해도(던지거나 모양이 이상해도) 처음 값으로 돈다", async () => {
    for (const load of [async () => Promise.reject(new Error("blocked")), async () => ({ period: "decade", view: 3 }), async () => "이상한 글", async () => undefined]) {
      const { unmount } = await mount(fakeApi(data(), { load, save: async () => {} }));
      expect(pressed("최근 1주")).toBe("true");
      expect(pressed("띠그래프")).toBe("true");
      unmount();
      cleanup();
    }
  });

  it("쓰기가 실패해도 화면은 그대로 바뀐다", async () => {
    await mount(fakeApi(data(), { load: async () => undefined, save: async () => Promise.reject(new Error("full")) }));
    fireEvent.click(chip("원그래프"));
    await act(async () => {});
    expect(pressed("원그래프")).toBe("true");
  });

  it("기억한 값이 오지 않아도(멈춤) 잠시 뒤 처음 값으로 그리고, 늦게 온 값이 사용자가 고른 것을 덮지 않는다", async () => {
    let release: (v: unknown) => void = () => {};
    const load = vi.fn(() => new Promise<unknown>((resolve) => (release = resolve)));
    render(<GrowthScreen api={fakeApi(data(), { load, save: async () => {} })} active activation={1} entry="self" onOpenCategory={vi.fn()} />);
    await screen.findByRole("group", { name: GROWTH_TEXT.periodGroup }, { timeout: 3000 });
    expect(pressed("최근 1주")).toBe("true");
    fireEvent.click(chip("원그래프"));
    await act(async () => release({ period: "total", view: "rows" }));
    expect(pressed("원그래프")).toBe("true");
    expect(pressed("최근 1주")).toBe("true");
  });

  it("기억하는 길이 없는 구현(viewPref 없음)은 기다리지 않고 처음 값으로 돈다", async () => {
    await mount(fakeApi());
    expect(pressed("최근 1주")).toBe("true");
  });
});

describe("기억한 값이 늦게 올 때(기다리는 시간 800ms 넘김)", () => {
  it("처음 값으로 이미 그렸고 사용자가 아직 안 골랐으면 늦게 온 값은 무시한다(읽고 있는 화면이 바뀌지 않는다). 다음에 열 때 반영된다", async () => {
    let release: (v: unknown) => void = () => {};
    const load = vi.fn(() => new Promise<unknown>((resolve) => (release = resolve)));
    const { container } = render(<GrowthScreen api={fakeApi(data(), { load, save: async () => {} })} active activation={1} entry="self" onOpenCategory={vi.fn()} />);
    await screen.findByRole("group", { name: GROWTH_TEXT.periodGroup }, { timeout: 3000 });
    expect(pressed("최근 1주")).toBe("true");
    expect(pressed("띠그래프")).toBe("true");
    await act(async () => release({ period: "total", view: "rows" }));
    expect(pressed("최근 1주")).toBe("true"); // 바뀌지 않는다
    expect(pressed("띠그래프")).toBe("true");
    expect(container.querySelector(".growth-band")).not.toBeNull();
    expect(container.querySelector(".growth-bar")).toBeNull();
  });
  it("기다리는 시간 안에 오면 처음부터 그 값으로 그린다(위 시험과 대비)", async () => {
    const load = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { period: "total", view: "rows" };
    });
    await mount(fakeApi(data(), { load, save: async () => {} }));
    expect(pressed("총 시간")).toBe("true");
    expect(pressed("분야별 줄 막대")).toBe("true");
  });
});

describe("목표가 있는 주의 기준(임시, 결정 대기: 임시값.md ③-1)", () => {
  it("놓친 분야 문장은 처음 정한 비율·최근 1주 기준 그대로이고, 채울 시간은 목표·이번 주 기준이라 분야가 다를 수 있다", async () => {
    await mount(fakeApi(data({ goal: { weekStart: "2026-11-02", items: [{ categoryId: C4, minutes: 120 }] } })));
    // 채울 시간: 목표 기준 — 글쓰기 목표 120분을 이번 주(0분)와 견줌
    expect(screen.getByText("이번 주 목표 기준")).toBeTruthy();
    expect(within(document.querySelector(".growth-short") as HTMLElement).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["글쓰기 2시간"]);
    // 놓친 분야 문장: 목표를 안 보고 처음 정한 비율·최근 1주 기준 — 가장 덜 쓴 포트폴리오
    expect(screen.getByText("「포트폴리오」 시간을 채울 수 있어요")).toBeTruthy();
    expect(screen.queryByText("「글쓰기」 시간을 채울 수 있어요")).toBeNull();
  });
});

describe("접근성", () => {
  it("기간·보기 방식 고르기는 이름 있는 묶음 안의 실제 단추이고 누름 상태(aria-pressed)로 지금 값을 알린다", async () => {
    await mount(fakeApi());
    for (const name of [GROWTH_TEXT.periodGroup, GROWTH_TEXT.viewGroup]) {
      const group = screen.getByRole("group", { name });
      const buttons = within(group).getAllByRole("button");
      expect(buttons.every((b) => b.tagName === "BUTTON" && b.getAttribute("aria-pressed") !== null)).toBe(true);
      expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    }
  });

  it("키보드: 단추에 포커스가 가고 눌러 바꿀 수 있다(tabindex를 막지 않는다)", async () => {
    await mount(fakeApi());
    const pie = chip("원그래프");
    pie.focus();
    expect(document.activeElement).toBe(pie);
    expect(pie.getAttribute("tabindex")).toBeNull();
    fireEvent.click(pie);
    expect(pressed("원그래프")).toBe("true");
  });

  it("키보드 차례: 기간 셋 → 보기 방식 셋 → 분야 줄 순서로 문서 차례대로 이어지고, 건너뛰는 단추나 tabindex가 없다(Enter·Space는 진짜 브라우저 시험 screens의 growth-recent에서)", async () => {
    const { container } = await mount(fakeApi());
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".growth-body button"));
    expect(buttons.slice(0, 6).map((b) => b.textContent)).toEqual(["최근 1주", "총 시간", "비교", "띠그래프", "원그래프", "분야별 줄 막대"]);
    expect(buttons.slice(6, 11).map((b) => b.querySelector(".growth-name")?.textContent)).toEqual(["어학", "포트폴리오", "CS 공부", "글쓰기", "기타"]);
    expect(buttons.every((b) => !b.disabled && !b.hasAttribute("tabindex"))).toBe(true);
  });

  it("그림 요소는 글로 읽히지 않게 숨기고(aria-hidden) 색점도 장식이다", async () => {
    const { container } = await mount(fakeApi());
    expect(container.querySelector(".growth-graph-art")?.getAttribute("aria-hidden")).toBe("true");
    expect(Array.from(container.querySelectorAll(".growth-dot")).every((el) => el.getAttribute("aria-hidden") === "true")).toBe(true);
    fireEvent.click(chip("분야별 줄 막대"));
    expect(Array.from(container.querySelectorAll(".growth-bar")).every((el) => el.getAttribute("aria-hidden") === "true")).toBe(true);
  });
});

describe("분야 이름은 사용자 입력이다", () => {
  it("꺾쇠·스크립트 모양 이름은 글자 그대로 보이고 그림 글(aria-label)에도 글자로만 들어간다", async () => {
    const evil = '<img src=x onerror="window.__g=1">';
    const { container } = await mount(fakeApi(data({ categories: [{ id: C1, name: evil }], ratios: [{ categoryId: C1, percent: 100 }] })));
    expect(screen.getByRole("button", { name: new RegExp("^" + evil.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeTruthy();
    expect(graphLabel()).toContain(`${evil} 100%`);
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("분야 50개(아주 긴 이름 포함)도 줄·조각이 모두 그려지고 예외가 없다", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const names = ids.map((_, i) => (i === 0 ? "아".repeat(300) : `분야 ${i + 1}`));
    const many = data({
      categories: ids.map((id, i) => ({ id, name: names[i] })),
      ratios: ids.map((id) => ({ categoryId: id, percent: 2 })),
      recentWeek: ids.map((id, i) => ({ categoryId: id, minutes: 5 * ((i % 7) + 1) })),
    });
    const { container } = await mount(fakeApi(many));
    expect(container.querySelectorAll(".growth-item")).toHaveLength(51); // 분야 50 + 기타
    const segs = Array.from(container.querySelectorAll<HTMLElement>(".growth-band-seg"));
    expect(segs.length).toBeGreaterThan(40);
    expect(segs.every((el) => el.style.background !== "")).toBe(true); // 9번째 분야부터도 색이 돌려 쓰인다
    fireEvent.click(chip("원그래프"));
    expect(container.querySelectorAll("svg.growth-pie path").length).toBeGreaterThan(40);
    fireEvent.click(chip("분야별 줄 막대"));
    expect(container.querySelectorAll(".growth-bar")).toHaveLength(51);
  });
});
