// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeScreen } from "../../components/me-screen";
import type { SettingsApi } from "../../lib/onboarding-api";
import type { PushApi } from "../../lib/push/subscribe";
import type { NotifySettings, SettingsData } from "../../lib/settings/types";

/** 「합계」 줄은 없앴다(합은 늘 100, 정합 대조 B S1-3). 대신 보이는 숫자 칸 값의 합이 100인지 본다(칸이 하나 이상 있어야 한다) */
function expectFieldSum100() {
  const fields = [...document.querySelectorAll<HTMLInputElement>("input.ratio-field")];
  expect(fields.length).toBeGreaterThan(0);
  expect(fields.reduce((sum, f) => sum + Number(f.value), 0)).toBe(100);
  expect(document.body.textContent).not.toContain("합계");
}


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
    subscribed: vi.fn(async () => (over.permission ? over.permission() === "granted" : false)),
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

  it("목표를 고쳐 저장한다(비우면 목표 없음) — 고침6: 첫 카드를 눌러 S8-b 「목표」에서 고치고 「저장」", async () => {
    const api = fakeApi();
    const onChanged = vi.fn();
    render(<MeScreen settings={settings()} categories={categories} api={api} push={fakePush()} onChanged={onChanged} />);
    await press("목표, 토익 900점, 고치기");
    const input = screen.getByRole("textbox", { name: "목표" }) as HTMLInputElement;
    expect(input.value).toBe("토익 900점");
    fireEvent.change(input, { target: { value: "  포트폴리오   완성 " } });
    await press("저장");
    expect(api.saveSettings).toHaveBeenCalledWith({ goal: "포트폴리오 완성" });
    expect(onChanged).toHaveBeenCalledWith({ goal: "포트폴리오 완성" });
    expect(screen.queryByRole("dialog", { name: "목표" })).toBeNull();
    expect(screen.getByRole("button", { name: "목표, 포트폴리오 완성, 고치기" })).toBeTruthy();
    await press("목표, 포트폴리오 완성, 고치기");
    fireEvent.change(screen.getByRole("textbox", { name: "목표" }), { target: { value: "  " } });
    await press("저장");
    expect(api.saveSettings).toHaveBeenLastCalledWith({ goal: null });
    expect(onChanged).toHaveBeenLastCalledWith({ goal: null });
    expect(screen.getByRole("button", { name: "목표, 목표 적기" }).textContent).toBe("목표목표 적기›");
  });

  it("목표가 100자를 넘으면 저장이 막힌다. 저장 실패는 안내만(S8-b는 닫히지 않는다)", async () => {
    const api = fakeApi({ saveSettings: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    render(<MeScreen settings={settings()} categories={categories} api={api} push={fakePush()} />);
    await press(/^목표, /);
    fireEvent.change(screen.getByRole("textbox", { name: "목표" }), { target: { value: "가".repeat(101) } });
    expect(screen.getByText("100자까지 적을 수 있어요. 지금 101자예요.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "목표" }), { target: { value: "토익 950점" } });
    await press("저장");
    expect(screen.getByText("저장하지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "목표" })).toBeTruthy();
  });

  it("읽을 수 없는 목표는 안내를 보인다", () => {
    render(<MeScreen settings={settings({ goal: null, goalReadable: false })} categories={categories} api={fakeApi()} push={fakePush()} />);
    expect(screen.getByText("목표를 읽을 수 없어요. 새로 적으면 바뀌어요.")).toBeTruthy();
  });

  it("처음 정한 비율을 −/+ 단추로 고쳐 저장한다. 합은 늘 100이다(줄여도 0이 되지 않고 기타로 간다, PM 확정 11-08)", async () => {
    const api = fakeApi();
    render(<MeScreen settings={settings()} categories={categories} api={api} push={fakePush()} />);
    expectFieldSum100();
    fireEvent.click(screen.getByRole("button", { name: "어학 5% 줄이기" })); // 60·40·0 → 55·45·0 (뒤 줄로)
    fireEvent.click(screen.getByRole("button", { name: "포트폴리오 5% 줄이기" })); // → 55·40·5 (뒤 줄 기타로)
    await press("비율 저장");
    expect(api.saveRatios).toHaveBeenCalledWith([{ categoryId: C1, percent: 55 }, { categoryId: C2, percent: 40 }, { categoryId: null, percent: 5 }]);
    for (let i = 0; i < 20; i++) {
      fireEvent.click(screen.getByRole("button", { name: "어학 5% 줄이기" }));
      fireEvent.click(screen.getByRole("button", { name: "포트폴리오 5% 줄이기" }));
    }
    expectFieldSum100();
    await press("비율 저장");
    expect(screen.queryByText("하나 이상은 0%보다 커야 해요.")).toBeNull();
    // 0%가 된 분야는 저장 목록에 싣지 않는다(저장 목록에 없는 분야는 0%로 읽는다, 고침4 합치기). 기타 100만 간다
    expect(api.saveRatios).toHaveBeenLastCalledWith([{ categoryId: null, percent: 100 }]);
  });

  it("저장값의 합이 100이 아니면 열 때 비율을 지켜 합 100의 정수로 맞추고, 그대로 저장하면 그 값이 간다", async () => {
    const api = fakeApi();
    render(<MeScreen settings={settings({ ratios: [{ categoryId: C1, percent: 30 }, { categoryId: C2, percent: 30 }] })} categories={categories} api={api} push={fakePush()} />);
    expectFieldSum100();
    expect((screen.getByLabelText("어학 비율(%)") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("포트폴리오 비율(%)") as HTMLInputElement).value).toBe("50");
    await press("비율 저장");
    expect(api.saveRatios).toHaveBeenCalledWith([{ categoryId: C1, percent: 50 }, { categoryId: C2, percent: 50 }]);
  });

  it("비율이 아직 없으면 고르게 나눈 값으로 열린다. 분야가 없으면 안내", () => {
    const { unmount } = render(<MeScreen settings={settings({ ratios: [] })} categories={categories} api={fakeApi()} push={fakePush()} />);
    expect((screen.getByLabelText("어학 비율(%)") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("포트폴리오 비율(%)") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("기타 비율(%)") as HTMLInputElement).value).toBe("0");
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

  it("허락은 했어도 이 기기에 실제 구독이 없으면 「받지 않아요」로 보인다 (B4)", async () => {
    const push = fakePush({ permission: vi.fn(() => "granted" as const), subscribed: vi.fn(async () => false) });
    await act(async () => {
      render(
        <MeScreen
          settings={settings({ notify: { eveningEnabled: true, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 } })}
          categories={categories}
          api={fakeApi()}
          push={push}
        />,
      );
    });
    expect(screen.getByText("이 기기에서는 알림을 받지 않아요")).toBeTruthy();
    // 저장하면 구독을 다시 시도한다
    await press("알림 설정 저장");
    expect(push.enable).toHaveBeenCalledTimes(1);
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
    expect(screen.getAllByText("인터넷에 연결되면 저장할 수 있어요.").length).toBeGreaterThan(0);
    for (const name of ["비율 저장", "알림 설정 저장"]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    // 목표는 S8-b의 「저장」이 막힌다(고침6)
    await press(/^목표, /);
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("분야 이름·목표는 글자 그대로 보인다", () => {
    const evil = '<img src=x onerror="window.__me=1">';
    render(<MeScreen settings={settings({ goal: evil })} categories={[{ id: C1, name: evil }]} api={fakeApi()} push={fakePush()} />);
    // 고침6: 목표는 첫 카드의 글(글 칸이 아니다)로 글자 그대로
    expect(document.querySelector(".me-goal-text")?.textContent).toBe(evil);
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("내 정보: 기타 비율 (고침 3바퀴, PM 답 d-69)", () => {
  it("분야 줄 뒤에 기타 줄이 있고, 저장된 기타 몫이 있으면 그 값으로 열린다. 저장하면 categoryId null로 간다", async () => {
    const api = fakeApi();
    render(
      <MeScreen
        settings={settings({ ratios: [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 30 }, { categoryId: null, percent: 10 }] })}
        categories={categories}
        api={api}
        push={fakePush()}
      />,
    );
    expectFieldSum100();
    expect(screen.getByRole("button", { name: "기타 5% 줄이기" })).toBeTruthy();
    expect((screen.getByLabelText("기타 비율(%)") as HTMLInputElement).value).toBe("10");
    fireEvent.click(screen.getByRole("button", { name: "기타 5% 늘리기" })); // 기타는 맨 끝 줄: 앞 줄(포트폴리오)에서 떼어 온다
    await press("비율 저장");
    expect(api.saveRatios).toHaveBeenCalledWith([
      { categoryId: C1, percent: 60 },
      { categoryId: C2, percent: 25 },
      { categoryId: null, percent: 15 },
    ]);
  });
  it("기타를 0%로 두면 저장 목록에 기타가 없다", async () => {
    const api = fakeApi();
    render(<MeScreen settings={settings()} categories={categories} api={api} push={fakePush()} />);
    await press("비율 저장");
    expect(api.saveRatios).toHaveBeenCalledWith([{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }]);
  });
});
