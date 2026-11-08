// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { AfterSaveShortfall, GrowthScreen } from "../../components/growth-screen";
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
    goal: null,
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
async function mount(api: GrowthApi, props: Partial<React.ComponentProps<typeof GrowthScreen>> = {}) {
  const onOpenCategory = vi.fn();
  const view = render(<GrowthScreen api={api} active activation={1} entry="self" onOpenCategory={onOpenCategory} {...props} />);
  await screen.findByRole("heading", { name: "이번 주 내 시간이 어느 분야에 쓰였나" });
  return { onOpenCategory, ...view };
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
  it("맨 위는 이번 주 분야별 시간: 분야마다 한 줄(0분도), 기타도 한 줄, 숫자가 보인다", async () => {
    await mount(fakeApi());
    const items = screen.getAllByRole("listitem").filter((li) => li.className === "growth-item");
    // 고침 4바퀴 2단계: 분야 줄에 처음 정한 비율과의 차이 글이 더해졌다(전체 180분 → 어학 108분·포트폴리오 72분이 처음 정한 비율만큼)
    expect(items.map((li) => li.textContent)).toEqual([
      "어학30분처음 정한 비율보다 −1시간 18분",
      "포트폴리오0분처음 정한 비율보다 −1시간 12분",
      "기타2시간 30분처음 정한 비율보다 +2시간 30분",
    ]);
    expect(screen.getByText("저녁 기록 2일")).toBeTruthy();
  });

  it("「역량」·경고 말이 화면에 없다", async () => {
    await mount(fakeApi());
    expect(document.body.textContent).not.toMatch(/역량|부족|편향|쏠림|경고|밀렸/);
  });

  it("채울 시간: 처음 정한 비율보다 덜 한 분야를 숫자로, 기준 이름과 함께", async () => {
    await mount(fakeApi());
    expect(screen.getByRole("heading", { name: "채울 시간" })).toBeTruthy();
    expect(screen.getByText("처음 정한 비율 기준")).toBeTruthy();
    // 이번 주 전체 180분 → 어학 108분 중 30분 → 78분, 포트폴리오 72분
    expect(screen.getByText("어학 1시간 18분")).toBeTruthy();
    expect(screen.getByText("포트폴리오 1시간 12분")).toBeTruthy();
  });

  it("이번 주 목표가 있는 주는 목표 기준으로 보인다", async () => {
    await mount(fakeApi(growth({ goal: { weekStart: "2026-11-02", items: [{ categoryId: C2, minutes: 120 }] } })));
    expect(screen.getByText("이번 주 목표 기준")).toBeTruthy();
    expect(screen.getByText("포트폴리오 2시간")).toBeTruthy();
    expect(screen.queryByText("어학 1시간 18분")).toBeNull();
  });

  it("이번 주 기록이 없으면 안내만 (막대·부족은 0과 안내)", async () => {
    await mount(fakeApi(growth({ thisWeek: [], loggedDaysThisWeek: 0 })));
    expect(screen.getByText("아직 이번 주 저녁 기록이 없어요. 저녁 기록을 남기면 여기에 쌓여요.")).toBeTruthy();
    expect(screen.getByText("이번 주 저녁 기록이 쌓이면 채울 시간이 보여요.")).toBeTruthy();
    expect(screen.getAllByText("0분").length).toBe(3); // 분야 둘과 기타 모두 0분이 보인다
  });

  it("채울 시간이 없으면 그렇게 보인다", async () => {
    await mount(fakeApi(growth({ thisWeek: [{ categoryId: C1, minutes: 60 }, { categoryId: C2, minutes: 40 }] })));
    expect(screen.getByText("채울 시간이 없어요")).toBeTruthy();
  });

  it("비교: 분야마다 이번 주·지난주·지난달·쌓인 것을 나란히, 지난주 대비 바뀐 시간", async () => {
    await mount(fakeApi());
    fireEvent.click(screen.getByRole("button", { name: "비교" }));
    const group = screen.getByRole("heading", { name: "분야마다 나란히" });
    expect(group).toBeTruthy();
    const language = screen.getByRole("button", { name: /^어학/ });
    expect(within(language).getByText("이번 주").nextSibling?.textContent).toBe("30분");
    expect(within(language).getByText("지난주").nextSibling?.textContent).toBe("1시간");
    expect(within(language).getByText("쌓인 것").nextSibling?.textContent).toBe("15시간");
    expect(within(language).getByText("지난주보다 −30분")).toBeTruthy();
    const portfolio = screen.getByRole("button", { name: /^포트폴리오/ });
    expect(within(portfolio).getByText("지난달").nextSibling?.textContent).toBe("10시간");
  });

  it("분야 줄을 누르면 그 분야 페이지로(onOpenCategory), 기타는 null", async () => {
    const { onOpenCategory } = await mount(fakeApi());
    fireEvent.click(screen.getByRole("button", { name: /^어학/ }));
    fireEvent.click(screen.getByRole("button", { name: /^기타/ }));
    expect(onOpenCategory).toHaveBeenNthCalledWith(1, C1, "어학");
    expect(onOpenCategory).toHaveBeenNthCalledWith(2, null, "기타");
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
    expect(await screen.findByRole("heading", { name: "이번 주 내 시간이 어느 분야에 쓰였나" })).toBeTruthy();
    expect(api.recordView).toHaveBeenCalledTimes(1);
  });

  it("다시 읽다 실패해도 이미 보이는 값은 지우지 않는다", async () => {
    const fetchGrowth = vi.fn().mockResolvedValueOnce({ ok: true, data: growth() }).mockResolvedValue({ ok: false, error: "unavailable" });
    const api = fakeApi(growth(), { fetchGrowth });
    const { rerender, onOpenCategory } = await mount(api);
    rerender(<GrowthScreen api={api} active activation={2} entry="self" onOpenCategory={onOpenCategory} />);
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "이번 주 내 시간이 어느 분야에 쓰였나" })).toBeTruthy();
    expect(screen.queryByText("상태보기를 불러오지 못했어요.")).toBeNull();
  });

  it("분야 이름은 글자 그대로 보인다", async () => {
    const evil = '<img src=x onerror="window.__g=1">';
    await mount(fakeApi(growth({ categories: [{ id: C1, name: evil }] })));
    expect(screen.getByRole("button", { name: new RegExp("^" + evil.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("저장 직후 채울 시간 한 줄", () => {
  it("채울 시간이 있으면 한 줄로 얹고, 없으면 아무것도 안 그린다", async () => {
    const { rerender } = render(<AfterSaveShortfall api={fakeApi()} />);
    expect(await screen.findByText(/어학 1시간 18분 · 포트폴리오 1시간 12분/)).toBeTruthy();
    rerender(<AfterSaveShortfall api={fakeApi(growth({ thisWeek: [] }))} />);
    await act(async () => {});
    // 새 api라도 같은 컴포넌트가 다시 읽는다: 쓴 시간이 없으니 한 줄이 없다
    expect(screen.queryByText(/채울 시간/)).toBeNull();
  });
});

describe("분야 페이지 (G13-a)", () => {
  const page: CategoryPageData = {
    categoryId: C1,
    days: [
      {
        day: "2026-11-06",
        todos: [
          { id: "t1", text: "단어 외우기", done: true, notes: [{ id: "n1", todoId: "t1", day: "2026-11-06", createdAt: "x", readable: true, text: "단어 50개 외웠다" }] },
          { id: "t2", text: "듣기", done: false, notes: [] },
        ],
      },
      { day: "2026-11-05", todos: [{ id: "t3", text: null, done: false, notes: [{ id: "n2", todoId: "t3", day: "2026-11-05", createdAt: "x", readable: false, text: null }] }] },
    ],
  };
  const api = (data: CategoryPageData = page) => fakeApi(growth(), { fetchCategoryPage: vi.fn(async () => ({ ok: true as const, data })) });

  it("날짜별로 할 일과 작업 기록이 모이고, 끝낸 일은 「끝냄」, 기록이 없으면 그렇게 보인다", async () => {
    const a = api();
    render(<CategoryPage api={a} categoryId={C1} name="어학" onClose={vi.fn()} />);
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
    render(<CategoryPage api={a} categoryId={C1} name="어학" onClose={vi.fn()} />);
    await screen.findByText("단어 50개 외웠다");
    await waitFor(() => expect(a.recordView).toHaveBeenCalledTimes(1));
    expect(a.recordView).toHaveBeenCalledWith({ id: expect.any(String), screen: "category", entry: "self" });
  });

  it("할 일이 없으면 안내, 기타 페이지는 categoryId null로 읽는다", async () => {
    const a = api({ categoryId: null, days: [] });
    render(<CategoryPage api={a} categoryId={null} name="기타" onClose={vi.fn()} />);
    expect(await screen.findByText("이 분야에 적은 할 일이 아직 없어요.")).toBeTruthy();
    expect(a.fetchCategoryPage).toHaveBeenCalledWith(null);
  });

  it("읽기 실패는 안내와 다시 불러오기, Esc로 닫힌다", async () => {
    const fetchCategoryPage = vi.fn().mockResolvedValueOnce({ ok: false, error: "unavailable" }).mockResolvedValue({ ok: true, data: page });
    const onClose = vi.fn();
    render(<CategoryPage api={fakeApi(growth(), { fetchCategoryPage })} categoryId={C1} name="어학" onClose={onClose} />);
    expect(await screen.findByText("분야 페이지를 불러오지 못했어요.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" })));
    expect(await screen.findByText("단어 50개 외웠다")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("작업 기록 글은 글자 그대로 보인다", async () => {
    const evil = '<script>window.__c=1</script>';
    const a = api({ categoryId: C1, days: [{ day: "2026-11-06", todos: [{ id: "t", text: evil, done: false, notes: [] }] }] });
    render(<CategoryPage api={a} categoryId={C1} name="어학" onClose={vi.fn()} />);
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
    await screen.findByRole("heading", { name: "이번 주 내 시간이 어느 분야에 쓰였나" });
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
    await screen.findByRole("heading", { name: "이번 주 내 시간이 어느 분야에 쓰였나" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^어학/ })));
    const dialog = await screen.findByRole("dialog", { name: "어학" });
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("저녁 기록을 저장하고 한 줄을 누르면 상태보기가 입구 after_save로 열린다. 한 줄 아래에 채울 시간도 보인다", async () => {
    stubFetch();
    saveEveningAction.mockImplementation(async (input: { id: string; items: { categoryId: string | null; minutes: number }[] }) => ({
      ok: true,
      data: {
        log: { id: input.id, targetDay: "2026-11-07", totalMinutes: 60, items: input.items, saveMode: "not_split", savedAt: "x" },
        delta: [{ categoryId: null, minutes: 60 }],
      },
    }));
    render(<AppShell home={home} initialOpen="evening" />);
    const dialog = await screen.findByRole("dialog", { name: "오늘 몇 시간 썼어요?" });
    fireEvent.change(within(dialog).getByLabelText("시간"), { target: { value: "1" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "나누지 않고 저장" })));
    expect(saveEveningAction).toHaveBeenCalledWith(expect.objectContaining({ saveMode: "not_split", targetDay: "2026-11-07" }));
    expect(await screen.findByText("기타 +1시간")).toBeTruthy();
    expect(await screen.findByText(/어학 1시간 18분/)).toBeTruthy(); // 저장 직후 한 줄 아래의 채울 시간
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /오늘 바뀐 분야별 시간/ })));
    await screen.findByRole("heading", { name: "이번 주 내 시간이 어느 분야에 쓰였나" });
    expect(screen.queryByRole("dialog")).toBeNull(); // 저녁 기록 창은 닫혔다
    expect(screen.getByRole("button", { name: "상태보기" }).getAttribute("aria-current")).toBe("page");
    expect(recordViewAction.mock.calls.at(-1)?.[0]).toMatchObject({ screen: "growth", entry: "after_save" });
  });
});
