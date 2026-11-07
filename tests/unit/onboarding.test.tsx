// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function mount(api: SettingsApi, categories = [{ id: C1, name: "어학" }, { id: C2, name: "포트폴리오" }], onDone = vi.fn()) {
  render(<Onboarding api={api} categories={categories} initialGoal={null} initialRatios={[]} initialNotify={NOTIFY} onDone={onDone} />);
  return onDone;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

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
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: /한 문장으로/ }));
    click("다음");
    expect(screen.getByText("4단계 중 2단계")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: /분야를 골라/ }));
    click("다음");
    expect(screen.getByText("4단계 중 3단계")).toBeTruthy();
    click("다음");
    expect(screen.getByText("4단계 중 4단계")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "알림을 받을까요?" })).toBeTruthy();
  });

  it("목표는 건너뛸 수 있고, 100자를 넘으면 다음으로 못 간다", () => {
    mount(fakeApi());
    fireEvent.change(screen.getByLabelText("목표"), { target: { value: "가".repeat(101) } });
    expect(screen.getByText("100자까지 적을 수 있어요. 지금 101자예요.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "다음" }) as HTMLButtonElement).disabled).toBe(true);
    click("건너뛰기");
    expect(screen.getByText("4단계 중 2단계")).toBeTruthy();
  });

  it("분야를 하나도 안 고르면 다음으로 못 가고 안내가 뜬다", () => {
    mount(fakeApi());
    click("다음");
    click("어학");
    click("포트폴리오"); // 둘 다 해제 (처음에는 이미 있는 분야가 모두 골라져 있다)
    click("다음");
    expect(screen.getByText("분야를 하나 이상 골라 주세요.")).toBeTruthy();
    expect(screen.getByText("4단계 중 2단계")).toBeTruthy();
  });

  it("예시 칩을 누르면 분야가 생기고 골라진다. 마감 있는 일 예시는 없다", async () => {
    const api = fakeApi();
    mount(api, []);
    click("다음");
    expect(screen.queryByRole("button", { name: /학교 과제|회사 업무/ })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "+ 어학" })));
    expect(api.addCategory).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), "어학");
    expect(screen.getByRole("button", { name: "어학", pressed: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ 어학" })).toBeNull(); // 이미 있으니 예시에서 빠진다
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

  it("비율은 고르게 나눈 값으로 시작하고 −/+ 5% 단추로 고치며, 합계가 숫자로 보인다", () => {
    mount(fakeApi());
    click("다음");
    click("다음");
    expect(screen.getByText("합계 100%")).toBeTruthy();
    expect(screen.getAllByText("50%")).toHaveLength(2);
    click("어학 5% 줄이기");
    click("포트폴리오 5% 늘리기");
    expect(screen.getByText("45%")).toBeTruthy();
    expect(screen.getByText("55%")).toBeTruthy();
    click("고르게 나누기");
    expect(screen.getAllByText("50%")).toHaveLength(2);
  });

  it("비율이 모두 0이면 다음으로 못 간다", () => {
    mount(fakeApi());
    click("다음");
    click("다음");
    for (let i = 0; i < 10; i++) {
      click("어학 5% 줄이기");
      click("포트폴리오 5% 줄이기");
    }
    expect(screen.getByText("합계 0%")).toBeTruthy();
    click("다음");
    expect(screen.getByText("하나 이상은 0%보다 커야 해요.")).toBeTruthy();
    expect(screen.getByText("4단계 중 3단계")).toBeTruthy();
  });

  it("끝에서 허락하면 비율과 설정(알림 둘 켜짐, 처음 설정 마침)을 저장하고 결과를 넘긴다", async () => {
    const api = fakeApi();
    const onDone = mount(api);
    fireEvent.change(screen.getByLabelText("목표"), { target: { value: "토익 900점" } });
    click("다음");
    click("다음");
    click("다음");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "허락하고 시작하기" })));
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "허락하고 시작하기" })));
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
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "허락하고 시작하기" })));
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "허락하고 시작하기" })));
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ completeOnboarding: true }));
    expect(onDone.mock.calls[0][0]).toMatchObject({ pushOutcome: "failed" });
  });

  it("「나중에 하고 시작하기」는 허락을 묻지 않고 알림을 끈 채 시작한다", async () => {
    const api = fakeApi();
    const onDone = mount(api);
    click("다음");
    click("다음");
    click("다음");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "나중에 하고 시작하기" })));
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "나중에 하고 시작하기" })));
    expect(screen.getByRole("alert").textContent).toContain("저장하지 못했어요");
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "나중에 하고 시작하기" })));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("비율 저장이 실패하면 처음 설정 마침은 저장하지 않는다", async () => {
    const api = fakeApi({ saveRatios: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    const onDone = mount(api);
    click("다음");
    click("다음");
    click("다음");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "나중에 하고 시작하기" })));
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("알림 시각을 바꿀 수 있고, 끈 알림은 시각을 못 고른다", async () => {
    const api = fakeApi();
    mount(api);
    click("다음");
    click("다음");
    click("다음");
    fireEvent.change(screen.getByLabelText("오늘 기록 알림 시각"), { target: { value: String(21 * 60) } });
    fireEvent.click(screen.getByRole("checkbox", { name: "아침 알림" }));
    expect((screen.getByLabelText("아침 알림 시각") as HTMLSelectElement).disabled).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "허락하고 시작하기" })));
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "허락하고 시작하기" })));
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
