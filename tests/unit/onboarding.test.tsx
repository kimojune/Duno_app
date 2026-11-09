// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddCategoryResult } from "../../lib/categories/types";
import type { HomeRead } from "../../lib/home-types";
import type { SettingsApi } from "../../lib/onboarding-api";
import type { NotifySettings } from "../../lib/settings/types";

vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({
  editTodo: vi.fn(),
  deleteTodo: vi.fn(),
  reorderTodos: vi.fn(),
  carryOverTodos: vi.fn(),
  addNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({
  requestOffer: vi.fn(async () => ({ ok: true, data: { offer: null, reason: "no_target" } })),
  dismissOffer: vi.fn(),
}));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../lib/read-client", () => ({
  fetchToday: vi.fn(async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } })),
}));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { AppShell, withCategories } from "../../components/app-shell";
import { Onboarding } from "../../components/onboarding";

/** 「합계」 줄은 없앴다(합은 늘 100, 정합 대조 B S1-3). 대신 보이는 숫자 칸 값의 합이 100인지 본다(칸이 하나 이상 있어야 한다) */
function expectFieldSum100() {
  const fields = [...document.querySelectorAll<HTMLInputElement>("input.ratio-field")];
  expect(fields.length).toBeGreaterThan(0);
  expect(fields.reduce((sum, f) => sum + Number(f.value), 0)).toBe(100);
  expect(document.body.textContent).not.toContain("합계");
}


const NOTIFY: NotifySettings = { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 };
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";

function fakeApi(over: Partial<SettingsApi> = {}): SettingsApi {
  return {
    addCategory: vi.fn(
      async (id: string, name: string): Promise<AddCategoryResult> => ({
        ok: true,
        data: { category: { id, readable: true, name, createdAt: "x" } },
      }),
    ),
    saveRatios: vi.fn(async (ratios) => ({ ok: true as const, data: { ratios } })),
    saveSettings: vi.fn(async () => ({
      ok: true as const,
      data: { goal: null, goalReadable: true, onboardingDone: true, notify: NOTIFY },
    })),
    requestPermission: vi.fn(async () => "granted" as const),
    ...over,
  };
}

function mount(api: SettingsApi, categories = [{ id: C1, name: "어학" }, { id: C2, name: "글쓰기" }], onDone = vi.fn()) {
  render(<Onboarding api={api} categories={categories} initialGoal={null} initialRatios={[]} initialNotify={NOTIFY} onDone={onDone} />);
  return onDone;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
/** 처음 정한 비율 목록의 숫자 칸 값들(분야 순서, 기타 맨 끝) */
const shares = (...names: string[]) => names.map((n) => Number((screen.getByLabelText(`${n} 비율(%)`) as HTMLInputElement).value));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("처음 설정 (7-1, ①)", () => {
  it("네 단계가 이어지고, 단계마다 제목으로 포커스가 간다", () => {
    mount(fakeApi());
    expect(screen.getByText("4단계 중 1단계")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "목표" }));
    click("다음");
    expect(screen.getByText("4단계 중 2단계")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "분야" }));
    click("다음");
    expect(screen.getByText("4단계 중 3단계")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "목표 비율" }));
    click("다음");
    expect(screen.getByText("4단계 중 4단계")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "알림" })).toBeTruthy();
  });

  it("목표는 건너뛸 수 있고, 100자를 넘으면 다음으로 못 간다", () => {
    mount(fakeApi());
    fireEvent.change(screen.getByRole("textbox", { name: "목표" }), { target: { value: "가".repeat(101) } });
    expect(screen.getByText("100자까지 적을 수 있어요. 지금 101자예요.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "다음" }) as HTMLButtonElement).disabled).toBe(true);
    click("건너뛰기");
    expect(screen.getByText("4단계 중 2단계")).toBeTruthy();
  });

  it("분야를 하나도 안 고르면 다음으로 못 가고 안내가 뜬다", () => {
    mount(fakeApi());
    click("다음");
    click("어학");
    click("글쓰기"); // 둘 다 해제 (처음에는 이미 있는 분야가 모두 골라져 있다)
    click("다음");
    expect(screen.getByText("분야를 하나 이상 골라 주세요.")).toBeTruthy();
    expect(screen.getByText("4단계 중 2단계")).toBeTruthy();
  });

  it("예시 칩을 누르면 분야가 생기고 골라진다. 마감 있는 일 예시는 없다", async () => {
    const api = fakeApi();
    mount(api, []);
    click("다음");
    expect(screen.queryByRole("button", { name: /학교 과제|회사 업무/ })).toBeNull();
    // 고침10 J(49:194): 안 고른 예시 칩 앞에 「+」가 없다 — 이름 + 색 점 10
    const examples = within(screen.getByRole("group", { name: "예시" }));
    expect(examples.queryByRole("button", { name: "+ 어학" })).toBeNull();
    expect(examples.getByRole("button", { name: "어학" }).querySelector(".chip-dot")).toBeTruthy();
    await act(async () => fireEvent.click(examples.getByRole("button", { name: "어학" })));
    expect(api.addCategory).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), "어학");
    expect(screen.getByRole("button", { name: "어학", pressed: true })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "예시" })).queryByRole("button", { name: "어학" })).toBeNull(); // 이미 있으니 예시에서 빠진다
    expect(screen.getByRole("button", { name: "어학", pressed: true }).querySelector(".chip-dot")).toBeTruthy(); // 고른 칩도 이름 + 색 점
  });

  it("새 분야를 적어 더하고, 같은 이름·기타는 막는다", async () => {
    const api = fakeApi();
    mount(api, [{ id: C1, name: "어학" }]);
    click("다음");
    fireEvent.change(screen.getByLabelText("새 분야 이름"), { target: { value: "  코딩   테스트 " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "더하기" })));
    expect(api.addCategory).toHaveBeenCalledWith(expect.any(String), "코딩 테스트");
    expect(screen.getByRole("button", { name: "코딩 테스트", pressed: true })).toBeTruthy();
    // 이미 있는 이름
    fireEvent.change(screen.getByLabelText("새 분야 이름"), { target: { value: "어학" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "더하기" })));
    expect(screen.getByText("이미 있는 분야라서 골랐어요: 어학")).toBeTruthy();
    expect(api.addCategory).toHaveBeenCalledTimes(1);
    // 기타
    fireEvent.change(screen.getByLabelText("새 분야 이름"), { target: { value: "기타" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "더하기" })));
    expect(screen.getByText(/기타는 더하지 않아도 돼요/)).toBeTruthy();
    expect(api.addCategory).toHaveBeenCalledTimes(1);
  });

  it("분야 더하기가 실패하면 안내를 보이고 이름은 그대로 둔다", async () => {
    const api = fakeApi({ addCategory: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    mount(api, []);
    click("다음");
    fireEvent.change(screen.getByLabelText("새 분야 이름"), { target: { value: "어학" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "더하기" })));
    expect(screen.getByText("분야를 더하지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect((screen.getByLabelText("새 분야 이름") as HTMLInputElement).value).toBe("어학");
  });

  it("비율은 고르게 나눈 값(합 100)으로 시작하고, −/+ 5% 단추로 고쳐도 합이 100으로 남는다(줄인 몫은 뒤 줄로, 늘린 몫은 이웃에서)", () => {
    mount(fakeApi());
    click("다음");
    click("다음");
    expectFieldSum100();
    expect(shares("어학", "글쓰기", "기타")).toEqual([50, 50, 0]);
    click("어학 5% 줄이기"); // 줄인 5%는 뒤 줄(글쓰기)로
    expect(shares("어학", "글쓰기", "기타")).toEqual([45, 55, 0]);
    click("글쓰기 5% 늘리기"); // 뒤 줄(기타)이 0이라 앞 줄(어학)에서
    expect(shares("어학", "글쓰기", "기타")).toEqual([40, 60, 0]);
    expectFieldSum100();
    click("균등 배분");
    expect(shares("어학", "글쓰기", "기타")).toEqual([50, 50, 0]);
  });

  it("합 100 고정: 분야를 모두 0%까지 줄여도 몫이 기타로 가서 합이 0이 되지 않고, 다음 단계로 간다(PM 확정 11-08)", () => {
    mount(fakeApi());
    click("다음");
    click("다음");
    for (let i = 0; i < 10; i++) click("어학 5% 줄이기");
    expect(shares("어학", "글쓰기", "기타")).toEqual([0, 100, 0]);
    expect((screen.getByRole("button", { name: "어학 5% 줄이기" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "글쓰기 5% 늘리기" }) as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 20; i++) click("글쓰기 5% 줄이기");
    expect(shares("어학", "글쓰기", "기타")).toEqual([0, 0, 100]);
    expectFieldSum100();
    click("다음");
    expect(screen.queryByText("하나 이상은 0%보다 커야 해요.")).toBeNull();
    expect(screen.getByText("4단계 중 4단계")).toBeTruthy();
  });

  it("끝에서 허락하면 비율과 설정(알림 둘 켜짐, 처음 설정 마침)을 저장하고 결과를 넘긴다", async () => {
    const api = fakeApi();
    const onDone = mount(api);
    fireEvent.change(screen.getByRole("textbox", { name: "목표" }), { target: { value: "토익 900점" } });
    click("다음");
    click("다음");
    click("다음");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    expect(api.requestPermission).toHaveBeenCalled();
    expect(api.saveRatios).toHaveBeenCalledWith([
      { categoryId: C1, percent: 50 },
      { categoryId: C2, percent: 50 },
    ]);
    expect(api.saveSettings).toHaveBeenCalledWith({
      goal: "토익 900점",
      notify: { eveningEnabled: true, eveningMinute: 1170, morningEnabled: true, morningMinute: 600 },
      completeOnboarding: true,
    });
    // 비율을 먼저, 처음 설정 마침을 나중에 저장한다(중간에 끊겨도 다시 처음 설정이 뜬다)
    const ratioOrder = (api.saveRatios as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const settingsOrder = (api.saveSettings as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(ratioOrder).toBeLessThan(settingsOrder);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toMatchObject({ goal: "토익 900점" });
  });

  it("허락이 안 되면 알림은 꺼진 채 시작하고 안내가 보인다", async () => {
    const api = fakeApi({ requestPermission: vi.fn(async () => "denied" as const) });
    const onDone = mount(api);
    click("다음");
    click("다음");
    click("다음");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ notify: expect.objectContaining({ eveningEnabled: false, morningEnabled: false }) }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("알림 켜기 결과(키 없음·구독 실패)를 끝에 알리고, 알림은 꺼진 채 처음 설정은 저장·완료한다 (B4)", async () => {
    for (const outcome of ["missing_key", "failed", "unsupported"] as const) {
      cleanup();
      const api = fakeApi({ requestPermission: vi.fn(async () => outcome) });
      const onDone = mount(api);
      click("다음");
      click("다음");
      click("다음");
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ notify: expect.objectContaining({ eveningEnabled: false, morningEnabled: false }), completeOnboarding: true }),
      );
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone.mock.calls[0][0]).toMatchObject({ pushOutcome: outcome });
    }
  });

  it("알림 켜기가 던져도 처음 설정은 저장하고 끝낸다 (A3)", async () => {
    const api = fakeApi({
      requestPermission: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const onDone = mount(api);
    click("다음");
    click("다음");
    click("다음");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ completeOnboarding: true }));
    expect(onDone.mock.calls[0][0]).toMatchObject({ pushOutcome: "failed" });
  });

  it("알림 둘을 다 끄고 「시작하기」를 누르면 허락을 묻지 않고 알림을 끈 채 시작한다(「나중에 하고 시작하기」는 없어졌다 — PM 1)", async () => {
    const api = fakeApi();
    const onDone = mount(api);
    click("다음");
    click("다음");
    click("다음");
    expect(screen.queryByRole("button", { name: "나중에 하고 시작하기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "허락하고 시작하기" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "오늘 기록 알림" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "아침 알림" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    expect(api.requestPermission).not.toHaveBeenCalled();
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ notify: expect.objectContaining({ eveningEnabled: false, morningEnabled: false }), completeOnboarding: true }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("저장이 실패하면 안내를 보이고 끝내지 않는다. 다시 누르면 다시 저장한다", async () => {
    const saveSettings = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unavailable" })
      .mockResolvedValue({ ok: true, data: { goal: null, goalReadable: true, onboardingDone: true, notify: NOTIFY } });
    const api = fakeApi({ saveSettings });
    const onDone = mount(api);
    click("다음");
    click("다음");
    click("다음");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    expect(screen.getByRole("alert").textContent).toContain("저장하지 못했어요");
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("비율 저장이 실패하면 처음 설정 마침은 저장하지 않는다", async () => {
    const api = fakeApi({ saveRatios: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    const onDone = mount(api);
    click("다음");
    click("다음");
    click("다음");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("알림 시각을 바꿀 수 있고, 끈 알림은 시각을 못 고른다(PM d-157 ① 되살림)", async () => {
    const api = fakeApi();
    mount(api);
    click("다음");
    click("다음");
    click("다음");
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("오늘 기록 알림 시각"), { target: { value: String(21 * 60) } });
    fireEvent.click(screen.getByRole("checkbox", { name: "아침 알림" }));
    expect((screen.getByLabelText("아침 알림 시각") as HTMLSelectElement).disabled).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    expect(api.requestPermission).toHaveBeenCalledTimes(1); // 저녁이 켜져 있어 묻는다
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ notify: { eveningEnabled: true, eveningMinute: 1260, morningEnabled: false, morningMinute: 600 } }),
    );
  });

  it("분야 이름은 글자 그대로 보인다(꺾쇠가 요소가 되지 않는다)", () => {
    mount(fakeApi(), [{ id: C1, name: '<img src=x onerror="window.__o=1">' }]);
    click("다음");
    expect(screen.getByRole("button", { name: '<img src=x onerror="window.__o=1">' })).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("AppShell의 처음 설정 관문", () => {
  const unavailable = { ok: false, error: "unavailable" } as const;
  const today = {
    todos: { ok: true, data: { day: { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 }, todos: [] } },
    categories: { ok: true, data: { categories: [{ id: C1, readable: true, name: "어학", createdAt: "x" }] } },
  } as HomeRead["today"];
  const settings = (onboardingDone: boolean) =>
    ({ ok: true, data: { goal: null, goalReadable: true, onboardingDone, notify: NOTIFY, ratios: [] } }) as HomeRead["settings"];

  it("처음 설정을 안 마쳤으면 처음 설정이 먼저 보인다", () => {
    render(<AppShell home={{ today, settings: settings(false) }} />);
    expect(screen.getByText("4단계 중 1단계")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "할 일 적기" })).toBeNull();
  });
  it("마쳤으면 바로 할 일 화면", () => {
    render(<AppShell home={{ today, settings: settings(true) }} />);
    expect(screen.getByRole("button", { name: "할 일 적기" })).toBeTruthy();
    expect(screen.queryByText(/단계 중/)).toBeNull();
  });
  it("설정을 못 읽었을 때는 처음 설정을 강요하지 않는다", () => {
    render(<AppShell home={{ today, settings: unavailable }} />);
    expect(screen.getByRole("button", { name: "할 일 적기" })).toBeTruthy();
  });
  it("처음 설정을 끝낼 때 알림이 안 켜졌으면 첫 화면에 안내 상자가 남고, 닫을 수 있다 (B4)", async () => {
    const { saveRatios, saveSettings } = await import("../../app/settings/actions");
    vi.mocked(saveRatios).mockResolvedValue({ ok: true, data: { ratios: [{ categoryId: C1, percent: 100 }] } });
    vi.mocked(saveSettings).mockResolvedValue({ ok: true, data: { goal: null, goalReadable: true, onboardingDone: true, notify: NOTIFY } });
    render(<AppShell home={{ today, settings: settings(false) }} />);
    click("다음");
    click("다음");
    click("다음");
    // jsdom에는 푸시 지원이 없어 「받을 수 없음」 결과가 나온다
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    expect(screen.getByRole("button", { name: "할 일 적기" })).toBeTruthy();
    expect(screen.getByText("이 브라우저는 알림을 받을 수 없어요.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByText("이 브라우저는 알림을 받을 수 없어요.")).toBeNull();
  });
  it("withCategories: 처음 설정에서 더한 분야를 칩 목록 끝에 끼우고, 이미 있는 분야와 읽기 실패는 그대로 둔다", () => {
    const merged = withCategories(today, [{ id: C2, name: "새 분야" }, { id: C1, name: "어학" }]);
    expect(merged.categories.ok && merged.categories.data.categories.map((c) => c.id)).toEqual([C1, C2]);
    expect(withCategories({ ...today, categories: unavailable }, [{ id: C2, name: "x" }]).categories).toEqual(unavailable);
  });
});

describe("처음 설정: 예시 칩 이름과 기타 비율 (고침 3바퀴, PM 답 d-69)", () => {
  it("분야 예시 칩은 마감 없는 이름이다: 「글쓰기」가 있고 「포트폴리오」는 없다", () => {
    mount(fakeApi(), []);
    click("다음");
    const examples = within(screen.getByRole("group", { name: "예시" }));
    expect(examples.getByRole("button", { name: "글쓰기" })).toBeTruthy();
    expect(examples.queryByRole("button", { name: "포트폴리오" })).toBeNull();
    expect(examples.queryAllByRole("button").every((b) => !/^\+/.test(b.textContent ?? ""))).toBe(true); // 안 고른 칩 앞 「+」 없음
  });
  it("비율 단계에는 고른 분야 줄 뒤에 기타 줄이 있고 처음에는 0%다(분야끼리 균등 배분, 합 100)", () => {
    mount(fakeApi());
    click("다음");
    click("다음");
    expect(screen.getByRole("button", { name: "기타 5% 늘리기" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "기타 5% 줄이기" }) as HTMLButtonElement).disabled).toBe(true);
    expectFieldSum100();
    expect(shares("어학", "글쓰기", "기타")).toEqual([50, 50, 0]); // 기타만 0%
  });
  it("기타를 올리면 앞 줄에서 떼어 오고(합 100 그대로), 저장 목록에 categoryId null로 실린다. 「균등 배분」은 기타를 0%로 돌린다", async () => {
    const api = fakeApi();
    mount(api);
    click("다음");
    click("다음");
    click("기타 5% 늘리기");
    click("기타 5% 늘리기");
    expect(shares("어학", "글쓰기", "기타")).toEqual([50, 40, 10]); // 기타는 맨 끝 줄이라 앞 줄(글쓰기)에서
    expectFieldSum100();
    click("균등 배분");
    expect(shares("어학", "글쓰기", "기타")).toEqual([50, 50, 0]);
    click("기타 5% 늘리기");
    click("다음");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    expect(api.saveRatios).toHaveBeenCalledWith([
      { categoryId: C1, percent: 50 },
      { categoryId: C2, percent: 45 },
      { categoryId: null, percent: 5 },
    ]);
  });
  it("기타를 올리지 않으면 저장 목록에 기타가 없다(기타를 안 쓰는 사용자의 저장은 예전 그대로)", async () => {
    const api = fakeApi();
    mount(api);
    click("다음");
    click("다음");
    click("다음");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "시작하기" })));
    const saved = (api.saveRatios as ReturnType<typeof vi.fn>).mock.calls[0][0] as { categoryId: string | null }[];
    expect(saved.some((r) => r.categoryId === null)).toBe(false);
  });
});
