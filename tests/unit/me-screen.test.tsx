// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeScreen } from "../../components/me-screen";
import type { SettingsApi } from "../../lib/onboarding-api";
import type { PushApi } from "../../lib/push/subscribe";
import type { NotifySettings, SettingsData } from "../../lib/settings/types";

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const NOTIFY_OFF: NotifySettings = { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 };
const categories = [{ id: C1, name: "어학" }, { id: C2, name: "포트폴리오" }];

function settings(over: Partial<SettingsData> = {}): SettingsData {
  return { goal: "토익 900점", goalReadable: true, onboardingDone: true, notify: NOTIFY_OFF, ratios: [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }], ...over };
}
function fakeApi(over: Partial<SettingsApi> = {}): SettingsApi {
  return {
    addCategory: vi.fn(),
    saveRatios: vi.fn(async (ratios) => ({ ok: true as const, data: { ratios } })),
    saveSettings: vi.fn(async () => ({ ok: true as const, data: { goal: null, goalReadable: true, onboardingDone: true, notify: NOTIFY_OFF } })),
    requestPermission: vi.fn(),
    ...over,
  };
}
function fakePush(over: Partial<PushApi> = {}): PushApi {
  return {
    permission: vi.fn(() => "default" as const),
    supported: vi.fn(() => true),
    hasKey: vi.fn(() => true),
    enable: vi.fn(async () => "ok" as const),
    disable: vi.fn(async () => {}),
    ...over,
  };
}
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("내 정보 탭", () => {
  it("설정을 못 읽었으면 안내만 보인다", () => {
    render(<MeScreen settings={null} categories={categories} api={fakeApi()} push={fakePush()} />);
    expect(screen.getByText("내 정보를 불러오지 못했어요. 앱을 다시 열어 주세요.")).toBeTruthy();
  });

  it("목표를 고쳐 저장한다(비우면 목표 없음)", async () => {
    const api = fakeApi();
    const onChanged = vi.fn();
    render(<MeScreen settings={settings()} categories={categories} api={api} push={fakePush()} onChanged={onChanged} />);
    expect((screen.getByLabelText("목표 한 문장") as HTMLInputElement).value).toBe("토익 900점");
    fireEvent.change(screen.getByLabelText("목표 한 문장"), { target: { value: "  포트폴리오   완성 " } });
    await press("목표 저장");
    expect(api.saveSettings).toHaveBeenCalledWith({ goal: "포트폴리오 완성" });
    expect(screen.getByText("저장했어요")).toBeTruthy();
    expect(onChanged).toHaveBeenCalledWith({ goal: "포트폴리오 완성" });
    fireEvent.change(screen.getByLabelText("목표 한 문장"), { target: { value: "  " } });
    await press("목표 저장");
    expect(api.saveSettings).toHaveBeenLastCalledWith({ goal: null });
  });

  it("목표가 100자를 넘으면 저장이 막힌다. 저장 실패는 안내만", async () => {
    const api = fakeApi({ saveSettings: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    render(<MeScreen settings={settings()} categories={categories} api={api} push={fakePush()} />);
    fireEvent.change(screen.getByLabelText("목표 한 문장"), { target: { value: "가".repeat(101) } });
    expect(screen.getByText("100자까지 적을 수 있어요. 지금 101자예요.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "목표 저장" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("목표 한 문장"), { target: { value: "토익 950점" } });
    await press("목표 저장");
    expect(screen.getByText("저장하지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
  });

  it("읽을 수 없는 목표는 안내를 보인다", () => {
    render(<MeScreen settings={settings({ goal: null, goalReadable: false })} categories={categories} api={fakeApi()} push={fakePush()} />);
    expect(screen.getByText("목표를 읽을 수 없어요. 새로 적으면 바뀌어요.")).toBeTruthy();
  });

  it("처음 정한 비율을 −/+ 단추로 고쳐 저장한다. 합이 0이면 못 한다", async () => {
    const api = fakeApi();
    render(<MeScreen settings={settings()} categories={categories} api={api} push={fakePush()} />);
    expect(screen.getByText("합계 100%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "어학 5% 줄이기" }));
    fireEvent.click(screen.getByRole("button", { name: "포트폴리오 5% 늘리기" }));
    await press("비율 저장");
    expect(api.saveRatios).toHaveBeenCalledWith([{ categoryId: C1, percent: 55 }, { categoryId: C2, percent: 45 }]);
    for (let i = 0; i < 20; i++) {
      fireEvent.click(screen.getByRole("button", { name: "어학 5% 줄이기" }));
      fireEvent.click(screen.getByRole("button", { name: "포트폴리오 5% 줄이기" }));
    }
    await press("비율 저장");
    expect(screen.getByText("하나 이상은 0%보다 커야 해요.")).toBeTruthy();
    expect(api.saveRatios).toHaveBeenCalledTimes(1);
  });

  it("비율이 아직 없으면 고르게 나눈 값으로 열린다. 분야가 없으면 안내", () => {
    const { unmount } = render(<MeScreen settings={settings({ ratios: [] })} categories={categories} api={fakeApi()} push={fakePush()} />);
    expect(screen.getAllByText("50%")).toHaveLength(2);
    unmount();
    render(<MeScreen settings={settings({ ratios: [] })} categories={[]} api={fakeApi()} push={fakePush()} />);
    expect(screen.getByText("분야가 아직 없어요. 할 일을 적을 때 분야를 더해 보세요.")).toBeTruthy();
  });

  it("알림을 켜면 허락 → 구독을 한 뒤 설정을 저장한다", async () => {
    const api = fakeApi();
    const push = fakePush();
    const onChanged = vi.fn();
    render(<MeScreen settings={settings()} categories={categories} api={api} push={push} onChanged={onChanged} />);
    expect(screen.getByText("이 기기에서는 알림을 받지 않아요")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "오늘 기록 알림" }));
    fireEvent.change(screen.getByLabelText("오늘 기록 알림 시각"), { target: { value: String(21 * 60) } });
    await press("알림 설정 저장");
    expect(push.enable).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith({ notify: { eveningEnabled: true, eveningMinute: 1260, morningEnabled: false, morningMinute: 600 } });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText("이 기기에서 알림을 받아요")).toBeTruthy();
  });

  it("허락이 안 되거나 브라우저가 못 받거나 보내는 설정이 없으면 설정을 저장하지 않고 이유를 알린다", async () => {
    for (const [result, text] of [
      ["denied", "이 기기에서 알림이 허락되지 않았어요. 브라우저 설정에서 바꿀 수 있어요."],
      ["unsupported", "이 브라우저는 알림을 받을 수 없어요."],
      ["missing_key", "알림을 보내는 설정이 아직 없어요. 설정이 끝나면 켤 수 있어요."],
      ["failed", "알림을 켜지 못했어요. 다시 눌러 주세요."],
    ] as const) {
      cleanup();
      const api = fakeApi();
      render(<MeScreen settings={settings()} categories={categories} api={api} push={fakePush({ enable: vi.fn(async () => result) })} />);
      fireEvent.click(screen.getByRole("checkbox", { name: "아침 알림" }));
      await press("알림 설정 저장");
      expect(screen.getByText(text)).toBeTruthy();
      expect(api.saveSettings).not.toHaveBeenCalled();
    }
  });

  it("알림을 모두 끄면 구독을 거두고 설정을 저장한다", async () => {
    const api = fakeApi();
    const push = fakePush({ permission: vi.fn(() => "granted" as const) });
    render(
      <MeScreen
        settings={settings({ notify: { eveningEnabled: true, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 } })}
        categories={categories}
        api={api}
        push={push}
      />,
    );
    expect(screen.getByText("이 기기에서 알림을 받아요")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "오늘 기록 알림" }));
    await press("알림 설정 저장");
    expect(push.disable).toHaveBeenCalledTimes(1);
    expect(push.enable).not.toHaveBeenCalled();
    expect(api.saveSettings).toHaveBeenCalledWith({ notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 } });
  });

  it("이미 구독한 기기에서 시각만 바꾸면 다시 허락을 묻지 않는다", async () => {
    const api = fakeApi();
    const push = fakePush({ permission: vi.fn(() => "granted" as const) });
    render(
      <MeScreen
        settings={settings({ notify: { eveningEnabled: true, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 } })}
        categories={categories}
        api={api}
        push={push}
      />,
    );
    fireEvent.change(screen.getByLabelText("오늘 기록 알림 시각"), { target: { value: String(20 * 60) } });
    await press("알림 설정 저장");
    expect(push.enable).not.toHaveBeenCalled();
    expect(api.saveSettings).toHaveBeenCalledWith({ notify: expect.objectContaining({ eveningMinute: 1200 }) });
  });

  it("오프라인이면 저장 단추가 막히고 안내가 보인다", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    render(<MeScreen settings={settings()} categories={categories} api={fakeApi()} push={fakePush()} />);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("인터넷에 연결되면 저장할 수 있어요.")).toBeTruthy();
    for (const name of ["목표 저장", "비율 저장", "알림 설정 저장"]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("분야 이름·목표는 글자 그대로 보인다", () => {
    const evil = '<img src=x onerror="window.__me=1">';
    render(<MeScreen settings={settings({ goal: evil })} categories={[{ id: C1, name: evil }]} api={fakeApi()} push={fakePush()} />);
    expect((screen.getByLabelText("목표 한 문장") as HTMLInputElement).value).toBe(evil);
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
