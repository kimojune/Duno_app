// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadButton } from "./confirm-helpers";
import type { HomeRead } from "../../lib/home-types";
import type { GrowthData } from "../../lib/growth/types";
import type { GrowthApi } from "../../lib/growth-api";
import type { CategoryPageData } from "../../lib/notes/types";

const recordViewAction = vi.fn();
vi.mock("../../app/views/actions", () => ({ recordView: (...a: unknown[]) => recordViewAction(...a) }));
const saveEveningAction = vi.fn();
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: (...a: unknown[]) => saveEveningAction(...a) }));
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({
  requestOffer: vi.fn(async () => ({ ok: true, data: { offer: null, reason: "no_target" } })),
  dismissOffer: vi.fn(),
}));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({
  editTodo: vi.fn(),
  deleteTodo: vi.fn(),
  reorderTodos: vi.fn(),
  carryOverTodos: vi.fn(),
  addNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("../../lib/read-client", () => ({
  fetchToday: vi.fn(async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } })),
}));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { AppShell } from "../../components/app-shell";
import { CategoryPage } from "../../components/category-page";
import { GrowthScreen } from "../../components/growth-screen";
import { typeWheel } from "./time-wheel-helpers";
import { TabBar } from "../../components/tab-bar";

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";

function growth(over: Partial<GrowthData> = {}): GrowthData {
  const thisWeek = over.thisWeek ?? [
    { categoryId: C1, minutes: 30 },
    { categoryId: null, minutes: 150 },
  ];
  return {
    today: "2026-11-07",
    weekStart: "2026-11-02",
    lastWeekStart: "2026-10-26",
    lastMonthRange: { from: "2026-10-01", to: "2026-10-31" },
    categories: [
      { id: C1, name: "어학" },
      { id: C2, name: "포트폴리오" },
    ],
    ratios: [
      { categoryId: C1, percent: 60 },
      { categoryId: C2, percent: 40 },
    ],
    thisWeek,
    lastWeek: [{ categoryId: C1, minutes: 60 }],
    lastMonth: [{ categoryId: C2, minutes: 600 }],
    cumulative: [{ categoryId: C1, minutes: 900 }],
    loggedDaysThisWeek: 2,
    loggedDaysTotal: 10,
    streakWeeks: 0,
    goal: null,
    goalText: null,
    ...over,
  };
}
function fakeApi(data: GrowthData = growth(), over: Partial<GrowthApi> = {}): GrowthApi {
  return {
    fetchGrowth: vi.fn(async () => ({ ok: true as const, data })),
    fetchCategoryPage: vi.fn(async (categoryId: string | null) => ({ ok: true as const, data: { categoryId, days: [] } as CategoryPageData })),
    recordView: vi.fn(async () => ({ ok: true })),
    ...over,
  };
}
/** 목표 비율 뷰가 그려질 때까지 기다린다(고침9: 카드 위 머리 줄 「이번 주 내 시간이 …」이 없어져 탭 패널로 기다린다) */
const ratioPanel = () => screen.findByRole("tabpanel", { name: "목표 비율" });
async function mount(api: GrowthApi, props: Partial<React.ComponentProps<typeof GrowthScreen>> = {}) {
  const onOpenCategory = vi.fn();
  const view = render(<GrowthScreen api={api} active activation={1} entry="self" onOpenCategory={onOpenCategory} {...props} />);
  await ratioPanel();
  return { onOpenCategory, ...view };
}
/** 기간 칩 하나(고침9)를 열고 기간을 고른다 */
function pickPeriod(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /^기간, / }));
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}

beforeEach(() => {
  recordViewAction.mockReset();
  recordViewAction.mockResolvedValue({ ok: true });
  saveEveningAction.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("상태보기 (7-4, ③)", () => {
  it("목표가 없는 주는 목표 비율 뷰: 분야마다 한 줄(0분도), 기타도 한 줄, 이번 주 몫(%)과 목표 비율이 숫자로 보인다", async () => {
    await mount(fakeApi());
    expect(screen.getByRole("tab", { name: "목표 비율" }).getAttribute("aria-selected")).toBe("true");
    const items = screen.getAllByRole("listitem").filter((li) => li.className === "growth-item");
    // 고침5: 분야 줄 = 이번 주 몫 / 목표 비율(전체 180분 → 어학 30분 17%, 기타 150분 83%). 기타는 목표 비율에 없어 %만
    // 고침9: 줄마다 끝에 「›」(화면 읽기에는 숨김) — 줄 단추 이름은 분야 이름과 값 그대로
    expect(items.map((li) => li.textContent)).toEqual(["어학17% / 목표 60%›", "포트폴리오0% / 목표 40%›", "기타83%›"]);
    expect(items.map((li) => li.querySelector("button")?.lastElementChild?.getAttribute("aria-hidden"))).toEqual(["true", "true", "true"]);
    expect(screen.getByRole("button", { name: /^어학\s?17% \/ 목표 60%$/ })).toBeTruthy(); // 「›」는 이름에 들지 않는다
    expect(document.querySelector(".growth-card-total")?.textContent).toBe("3시간");
    // 고침9: 카드 위 머리 줄 「오늘 기록 n일」은 없앴다(탭 바로 아래가 카드)
    expect(screen.queryByText(/오늘 기록 \d+일/)).toBeNull();
  });

  it("「역량」·경고 말이 화면에 없다", async () => {
    await mount(fakeApi());
    expect(document.body.textContent).not.toMatch(/역량|부족|편향|쏠림|경고|밀렸/);
  });

  it("「채울 시간」 카드·기준 이름·놓친 분야 문장이 없다(PM 8, 고침5에서 없앰)", async () => {
    await mount(fakeApi());
    expect(screen.queryByRole("heading", { name: "채울 시간" })).toBeNull();
    for (const gone of ["처음 정한 비율 기준", "이번 주 목표 기준", "어학 1시간 18분", "시간을 채울 수 있어요"]) expect(screen.queryByText(new RegExp(gone))).toBeNull();
    expect(document.body.textContent).not.toContain("채울");
    expect(document.querySelectorAll(".growth-item").length).toBe(3); // 화면은 그려져 있다
  });

  it("이번 주 목표가 있는 주는 이번 주 목표 뷰로 열린다: 「목표 2시간 중 0시간」, 분야마다 쓴 시간과 남은 시간", async () => {
    render(<GrowthScreen api={fakeApi(growth({ goal: { weekStart: "2026-11-02", items: [{ categoryId: C2, minutes: 120 }] } }))} active activation={1} entry="self" onOpenCategory={vi.fn()} />);
    await screen.findByRole("tablist");
    expect(screen.getByRole("tab", { name: "이번 주 목표" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".growth-card-title")?.textContent).toBe("목표 2시간 중 0시간");
    const items = Array.from(document.querySelectorAll(".growth-item"));
    expect(items.map((li) => li.querySelector(".growth-name")?.textContent)).toEqual(["어학", "포트폴리오", "기타"]);
    // 고침9(Figma 51:107): 쓴 시간 0은 「0시간」(머리 「목표 2시간 중 0시간」과 같은 규칙)
    expect(items.map((li) => li.querySelector(".growth-row-value")?.textContent)).toEqual(["30분", "0시간 · 2시간 더", "2시간 30분"]);
    expect(items.map((li) => li.querySelector(".growth-goal-of")?.textContent)).toEqual(["목표 없음", "목표 2시간", "목표 없음"]);
  });

  it("기록이 하나도 없으면 목표 비율 띠 + 빈 띠 「0시간」 + 카드 안 「오늘 기록」, 머리는 「0시간」 · 기간 칩 「이번 주」 · 「원그래프로 보기」(고침7 ② · 고침9)", async () => {
    // 고침7: 쌓인 시간이 있으면 「총 시간」으로 시작하므로(경우 1, growth-views 시험) 여기는 쌓인 시간도 0인 사람(경우 2)
    await mount(fakeApi(growth({ thisWeek: [], cumulative: [], loggedDaysThisWeek: 0, loggedDaysTotal: 0 })), { onOpenEvening: vi.fn() });
    // 고침9(⑬ 20, PM d-143 가): 카드 밖 안내 글은 없앴다. 「오늘 기록」은 카드 안 끝
    expect(document.body.textContent).not.toContain("아직 이번 주 오늘 기록이 없어요");
    expect(document.querySelector(".growth-card .growth-evening-button")?.textContent).toBe("오늘 기록");
    expect(document.querySelector(".growth-band.is-empty")?.textContent).toBe("0시간");
    expect(document.querySelector(".growth-card-total")?.textContent).toBe("0시간");
    const chip = screen.getByRole("button", { name: "기간, 이번 주" });
    expect(chip.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(chip);
    expect(screen.getAllByRole("menuitemradio").map((b) => b.textContent)).toEqual(["이번 주", "총 시간"]);
    expect(screen.getByRole("button", { name: "원그래프로 보기" })).toBeTruthy();
    expect(Array.from(document.querySelectorAll(".growth-band-cell")).map((el) => el.textContent)).toEqual(["60%", "40%"]);
    expect(document.body.textContent).not.toContain("채울");
  });

  it("목표에 닿았거나 넘은 분야는 쓴 시간만(「n시간 더」 없음, 「넘음」 같은 평가 말 없음)", async () => {
    render(
      <GrowthScreen
        api={fakeApi(growth({ thisWeek: [{ categoryId: C1, minutes: 60 }, { categoryId: C2, minutes: 90 }], goal: { weekStart: "2026-11-02", items: [{ categoryId: C2, minutes: 60 }] } }))}
        active
        activation={1}
        entry="self"
        onOpenCategory={vi.fn()}
      />,
    );
    await screen.findByRole("tablist");
    const values = Array.from(document.querySelectorAll(".growth-row-value")).map((el) => el.textContent);
    expect(values).toEqual(["1시간", "1시간 30분"]);
    expect(document.body.textContent).not.toMatch(/더|넘음/);
  });

  it("고침10 H(d-171): 기간 칩에 「비교」가 없다 — 이번 주 · 총 시간 둘, 비교 목록 꼴(.is-compare)도 없다", async () => {
    await mount(fakeApi());
    fireEvent.click(screen.getByRole("button", { name: /^기간, / }));
    expect(screen.getAllByRole("menuitemradio").map((b) => b.textContent)).toEqual(["이번 주", "총 시간"]);
    expect(screen.queryByRole("menuitemradio", { name: "비교" })).toBeNull();
    expect(document.querySelector(".growth-list.is-compare")).toBeNull();
    expect(document.querySelector(".growth-compare")).toBeNull();
  });

  it("분야 줄을 누르면 그 분야 페이지로(onOpenCategory), 기타는 null", async () => {
    const { onOpenCategory } = await mount(fakeApi());
    fireEvent.click(screen.getByRole("button", { name: /^어학/ }));
    fireEvent.click(screen.getByRole("button", { name: /^기타/ }));
    // 고침8: 지금 그린 GrowthData를 같이 넘긴다(분야 페이지 요약 카드가 새 서버 호출 없이 쓴다)
    expect(onOpenCategory).toHaveBeenNthCalledWith(1, C1, "어학", growth());
    expect(onOpenCategory).toHaveBeenNthCalledWith(2, null, "기타", growth());
  });

  it("그려진 뒤에 본 것을 입구와 함께 한 번 남긴다", async () => {
    const api = fakeApi();
    await mount(api, { entry: "after_save" });
    await waitFor(() => expect(api.recordView).toHaveBeenCalledTimes(1));
    expect(api.recordView).toHaveBeenCalledWith({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), screen: "growth", entry: "after_save" });
  });

  it("탭을 열 때마다(activation) 다시 읽고 다시 남기지만, 같은 열기에서는 한 번", async () => {
    const api = fakeApi();
    const { rerender, onOpenCategory } = await mount(api);
    rerender(<GrowthScreen api={api} active activation={1} entry="self" onOpenCategory={onOpenCategory} />);
    expect(api.recordView).toHaveBeenCalledTimes(1);
    rerender(<GrowthScreen api={api} active={false} activation={1} entry="self" onOpenCategory={onOpenCategory} />);
    rerender(<GrowthScreen api={api} active activation={2} entry="self" onOpenCategory={onOpenCategory} />);
    await act(async () => {});
    expect(api.fetchGrowth).toHaveBeenCalledTimes(2);
    expect(api.recordView).toHaveBeenCalledTimes(2);
  });

  it("보이지 않는 탭은 읽지도 남기지도 않는다", async () => {
    const api = fakeApi();
    render(<GrowthScreen api={api} active={false} activation={0} entry="self" onOpenCategory={vi.fn()} />);
    await act(async () => {});
    expect(api.fetchGrowth).not.toHaveBeenCalled();
    expect(api.recordView).not.toHaveBeenCalled();
  });

  it("읽기가 실패하면 안내와 다시 불러오기, 본 것은 남기지 않는다", async () => {
    const fetchGrowth = vi.fn().mockResolvedValueOnce({ ok: false, error: "unavailable" }).mockResolvedValue({ ok: true, data: growth() });
    const api = fakeApi(growth(), { fetchGrowth });
    render(<GrowthScreen api={api} active activation={1} entry="self" onOpenCategory={vi.fn()} />);
    expect(await screen.findByText("상태보기를 불러오지 못했어요.")).toBeTruthy();
    expect(api.recordView).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" })));
    expect(await ratioPanel()).toBeTruthy();
    expect(api.recordView).toHaveBeenCalledTimes(1);
  });

  it("다시 읽다 실패해도 이미 보이는 값은 지우지 않는다", async () => {
    const fetchGrowth = vi.fn().mockResolvedValueOnce({ ok: true, data: growth() }).mockResolvedValue({ ok: false, error: "unavailable" });
    const api = fakeApi(growth(), { fetchGrowth });
    const { rerender, onOpenCategory } = await mount(api);
    rerender(<GrowthScreen api={api} active activation={2} entry="self" onOpenCategory={onOpenCategory} />);
    await act(async () => {});
    expect(screen.getByRole("tabpanel", { name: "목표 비율" })).toBeTruthy();
    expect(document.querySelectorAll(".growth-item")).toHaveLength(3);
    expect(screen.queryByText("상태보기를 불러오지 못했어요.")).toBeNull();
  });

  it("분야 이름은 글자 그대로 보인다", async () => {
    const evil = '<img src=x onerror="window.__g=1">';
    await mount(fakeApi(growth({ categories: [{ id: C1, name: evil }] })));
    expect(screen.getByRole("button", { name: new RegExp("^" + evil.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

// 저장 직후 「이번 주」 카드(옛 AfterSaveShortfall)의 시험은 고침9에서 tests/unit/after-save.test.tsx로 옮겼다(카드가 components/after-save.tsx로 옮겨 감)

describe("분야 페이지 (G13-a)", () => {
  const page: CategoryPageData = {
    categoryId: C1,
    days: [
      {
        day: "2026-11-06",
        minutes: 0,
        todos: [
          { id: "t1", text: "단어 외우기", done: true, notes: [{ id: "n1", todoId: "t1", day: "2026-11-06", createdAt: "x", readable: true, text: "단어 50개 외웠다" }] },
          { id: "t2", text: "듣기", done: false, notes: [] },
        ],
      },
      { day: "2026-11-05", minutes: 0, todos: [{ id: "t3", text: null, done: false, notes: [{ id: "n2", todoId: "t3", day: "2026-11-05", createdAt: "x", readable: false, text: null }] }] },
    ],
  };
  const api = (data: CategoryPageData = page) => fakeApi(growth(), { fetchCategoryPage: vi.fn(async () => ({ ok: true as const, data })) });

  it("날짜별로 할 일과 작업 기록이 모이고, 끝낸 일은 「끝냄」, 기록이 없으면 그렇게 보인다", async () => {
    const a = api();
    render(<CategoryPage api={a} categoryId={C1} name="어학" growth={growth()} onClose={vi.fn()} />);
    expect(await screen.findByText("단어 50개 외웠다")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "어학" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "11월 6일 금요일" })).toBeTruthy();
    expect(screen.getByText("끝냄")).toBeTruthy();
    expect(screen.getByText("작업 기록 없음")).toBeTruthy();
    expect(screen.getByText("읽을 수 없는 할 일")).toBeTruthy();
    expect(screen.getByText("읽을 수 없는 글")).toBeTruthy();
    expect(a.fetchCategoryPage).toHaveBeenCalledWith(C1);
  });

  it("그려지면 본 것을 스스로 연 것(self)으로 한 번 남긴다", async () => {
    const a = api();
    render(<CategoryPage api={a} categoryId={C1} name="어학" growth={growth()} onClose={vi.fn()} />);
    await screen.findByText("단어 50개 외웠다");
    await waitFor(() => expect(a.recordView).toHaveBeenCalledTimes(1));
    expect(a.recordView).toHaveBeenCalledWith({ id: expect.any(String), screen: "category", entry: "self" });
  });

  it("할 일이 없으면 안내, 기타 페이지는 categoryId null로 읽는다", async () => {
    const a = api({ categoryId: null, days: [] });
    render(<CategoryPage api={a} categoryId={null} name="기타" growth={growth()} onClose={vi.fn()} />);
    // 빈 글은 「할 일 0개」(명세 ⑬ 24, PM 「143 가」 — 예전 「이 분야에 적은 할 일이 아직 없어요.」)
    expect(await screen.findByText("할 일 0개")).toBeTruthy();
    expect(screen.queryByText("이 분야에 적은 할 일이 아직 없어요.")).toBeNull();
    expect(a.fetchCategoryPage).toHaveBeenCalledWith(null);
  });

  it("읽기 실패는 안내와 다시 불러오기, Esc로 닫힌다", async () => {
    const fetchCategoryPage = vi.fn().mockResolvedValueOnce({ ok: false, error: "unavailable" }).mockResolvedValue({ ok: true, data: page });
    const onClose = vi.fn();
    render(<CategoryPage api={fakeApi(growth(), { fetchCategoryPage })} categoryId={C1} name="어학" growth={growth()} onClose={onClose} />);
    expect(await screen.findByText("분야 페이지를 불러오지 못했어요.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" })));
    expect(await screen.findByText("단어 50개 외웠다")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("작업 기록 글은 글자 그대로 보인다", async () => {
    const evil = '<script>window.__c=1</script>';
    const a = api({ categoryId: C1, days: [{ day: "2026-11-06", minutes: 0, todos: [{ id: "t", text: evil, done: false, notes: [] }] }] });
    render(<CategoryPage api={a} categoryId={C1} name="어학" growth={growth()} onClose={vi.fn()} />);
    expect(await screen.findByText(evil)).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });
});

describe("아래 탭", () => {
  it("지금 탭에 aria-current=page, 눌러서 옮긴다", () => {
    const onSelect = vi.fn();
    render(<TabBar tabs={["growth", "todo"]} current="todo" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "할 일" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "상태보기" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "상태보기" }));
    expect(onSelect).toHaveBeenCalledWith("growth");
    expect(screen.getByRole("navigation", { name: "화면 이동" })).toBeTruthy();
  });
});

describe("AppShell의 탭", () => {
  const unavailable = { ok: false, error: "unavailable" } as const;
  const home: HomeRead = {
    today: {
      todos: { ok: true, data: { day: { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 }, todos: [] } },
      categories: { ok: true, data: { categories: [{ id: C1, readable: true, name: "어학", createdAt: "x" }] } },
    },
    settings: unavailable,
  };

  function stubFetch() {
    const fetchMock = vi.fn(async (url: string) => {
      const body = url.startsWith("/growth")
        ? { ok: true, data: growth() }
        : url.startsWith("/todos/yesterday")
          ? { ok: true, data: { todos: [] } }
          : url.startsWith("/evening")
          ? {
              ok: true,
              data: { today: "2026-11-07", day: "2026-11-07", existing: null, doneCategoryIds: [], timerByCategory: [], categories: [{ id: C1, name: "어학" }] },
            }
        : url.startsWith("/category")
            ? { ok: true, data: { categoryId: C1, days: [] } }
            : { ok: false, error: "unavailable" };
      return { json: async () => body } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("처음에는 할 일 탭이 보이고 상태보기는 숨겨져 있어 읽지 않는다", async () => {
    const fetchMock = stubFetch();
    render(<AppShell home={home} />);
    expect(screen.getByRole("button", { name: "할 일" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "할 일 적기" })).toBeTruthy();
    await act(async () => {});
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/growth"))).toBe(false);
    expect(recordViewAction).not.toHaveBeenCalled();
  });

  it("상태보기 탭을 누르면 읽고, 그려진 뒤 본 것을 self로 남기고, 할 일 탭은 지우지 않고 숨긴다", async () => {
    const fetchMock = stubFetch();
    const { container } = render(<AppShell home={home} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "상태보기" })));
    await ratioPanel();
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/growth"))).toBe(true);
    await waitFor(() => expect(recordViewAction).toHaveBeenCalledTimes(1));
    expect(recordViewAction.mock.calls[0][0]).toMatchObject({ screen: "growth", entry: "self" });
    // 지금 탭(상태보기)은 보이고, 나머지 탭은 숨겨져 있되 할 일 탭은 지워지지 않고 살아 있다(탭이 몇 개든 같다)
    const hidden = Array.from(container.querySelectorAll("div[hidden]"));
    expect(hidden.length).toBeGreaterThanOrEqual(2);
    expect(hidden.some((el) => el.querySelector(".todo-app") !== null)).toBe(true);
    expect(hidden.every((el) => el.querySelector(".growth") === null)).toBe(true);
  });

  it("상태보기에서 분야를 누르면 분야 페이지가 열리고 닫을 수 있다", async () => {
    stubFetch();
    render(<AppShell home={home} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "상태보기" })));
    await ratioPanel();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^어학/ })));
    const dialog = await screen.findByRole("dialog", { name: "어학" });
    expect(within(dialog).queryByRole("button", { name: "닫기" }), "고침10 A: 오른쪽 위 글 「닫기」 없음").toBeNull();
    expectHeadButton(dialog, "back");
    fireEvent.click(within(dialog).getByRole("button", { name: "이전" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("오늘 기록을 저장하면 같은 창이 저장 뒤 판(「이번 주」 카드 — 상태보기 데이터로 막대·%)이 되고, 「상태보기에서 보기」를 누르면 상태보기가 입구 after_save로 열린다(고침9 S5-3)", async () => {
    stubFetch();
    saveEveningAction.mockImplementation(async (input: { id: string; items: { categoryId: string | null; minutes: number }[] }) => ({
      ok: true,
      data: {
        log: { id: input.id, targetDay: "2026-11-07", totalMinutes: 60, items: input.items, saveMode: "not_split", savedAt: "x" },
        delta: [{ categoryId: null, minutes: 60 }],
      },
    }));
    render(<AppShell home={home} initialOpen="evening" />);
    const dialog = await screen.findByRole("dialog", { name: "오늘 기록" });
    await screen.findByRole("button", { name: "분야마다 나누기" });
    typeWheel("시간", 1);
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "나누지 않고 저장" })));
    expect(saveEveningAction).toHaveBeenCalledWith(expect.objectContaining({ saveMode: "not_split", targetDay: "2026-11-07", totalMinutes: 60 }));
    // 저장 뒤 다시 읽은 상태보기(GET /growth — 이미 있는 길): 이번 주 기타 2시간 30분(30분 어학과 함께 180분 중 83%), 처음 정한 비율에 기타 몫 없음 → 0%
    expect(await screen.findByText("이번 주 83% / 목표 0%")).toBeTruthy();
    const row = document.querySelector(".after-save-card .after-save-row")!;
    expect(row.querySelector(".after-save-name")!.textContent).toBe("기타");
    expect(row.querySelector(".after-save-value")!.textContent).toBe("2시간 30분 +1시간");
    expect(document.querySelectorAll(".after-save-card .after-save-row")).toHaveLength(1); // 바뀐 분야만(어학은 안 바뀜)
    expect(Array.from(document.querySelectorAll('.after-save-card [role="status"]')).map((e) => e.textContent)).toEqual([
      "저장했어요. 기타 1시간 더해서 이번 주 2시간 30분. 이번 주 83%, 목표 0%.",
    ]);
    expect(document.body.textContent).not.toContain("채울");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "상태보기에서 보기" })));
    await ratioPanel();
    expect(screen.queryByRole("dialog")).toBeNull(); // 저녁 기록 창은 닫혔다
    expect(screen.getByRole("tab", { name: "목표 비율" }).getAttribute("aria-selected")).toBe("true"); // 목표 없는 주 → 「목표 비율」 탭(고침9, 흐름도 135:2)
    expect(screen.getByRole("button", { name: "상태보기" }).getAttribute("aria-current")).toBe("page");
    expect(recordViewAction.mock.calls.at(-1)?.[0]).toMatchObject({ screen: "growth", entry: "after_save" });
  });
});
