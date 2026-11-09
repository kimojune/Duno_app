// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeScreen } from "../../components/me-screen";
import { GOAL_MAX_LENGTH } from "../../lib/settings/validation";
import type { SettingsApi } from "../../lib/onboarding-api";
import type { PushApi } from "../../lib/push/subscribe";
import type { NotifySettings, SettingsData } from "../../lib/settings/types";
import { FakeHistory } from "./fake-history";

/**
 * 고침6 ③: 내 정보 첫 카드(이름표 「목표」(PM d-136) · 목표 한 문장 20 Bold · 「›」, 카드 전체가 단추 하나)와 S8-b 「목표」 겹침 화면.
 * - 카드 글·없앤 것(글 칸·「목표 한 문장」 라벨·「목표 저장」)·빈 목표 꼴
 * - S8-b: 열기·미리 채움·머리 「‹」(이름 「이전」)·이름표 「목표」·칸 아래 예시·단계 표시/건너뛰기 없음
 * - 저장: 내 정보가 쓰던 길 그대로(api.saveSettings({ goal }) — checkGoal 정리 결과, 길이 상한), 성공하면 닫히고 카드가 바뀜, 실패하면 열린 채 안내
 * - 바꾸고 「‹」·Esc·뒤로 가기 → 앱 공통 확인(「저장하지 않고 나갈까요?」 · 「계속 적기」/「나가기」, PM d-135), 안 바꿨으면 바로 닫힘, 포커스는 카드로
 * 악용: 상한+1자 거절(저장 호출 0)·상한 통과, HTML 글은 글자 그대로
 */

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const NOTIFY_OFF: NotifySettings = { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 };
const categories = [{ id: C1, name: "어학" }];

function settings(over: Partial<SettingsData> = {}): SettingsData {
  return { goal: "토익 900점 넘기기", goalReadable: true, onboardingDone: true, notify: NOTIFY_OFF, ratios: [{ categoryId: C1, percent: 100 }], ...over };
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
const push: PushApi = {
  permission: () => "default",
  supported: () => true,
  hasKey: () => true,
  subscribed: async () => false,
  enable: async () => "ok",
  disable: async () => {},
};

let history: FakeHistory;
beforeEach(() => {
  history = new FakeHistory(null).install();
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  history.flush();
  vi.restoreAllMocks();
});

function mount(s: SettingsData = settings(), api: SettingsApi = fakeApi(), onChanged = vi.fn()) {
  render(<MeScreen settings={s} categories={categories} api={api} push={push} onChanged={onChanged} />);
  return { api, onChanged };
}
const card = () => document.querySelector<HTMLButtonElement>(".me-goal-card")!;
const editor = () => screen.queryByRole("dialog", { name: "목표" });
const field = () => within(editor()!).getByRole("textbox", { name: "목표" }) as HTMLInputElement;
const confirmBox = () => screen.queryByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
const open = () => act(async () => fireEvent.click(card()));
const type = (value: string) => act(async () => fireEvent.change(field(), { target: { value } }));
const pressIn = (root: HTMLElement, name: string) => act(async () => fireEvent.click(within(root).getByRole("button", { name })));

describe("내 정보 첫 카드(고침6 ③)", () => {
  it("이름표 「목표」(PM d-136) + 목표 한 문장 + 「›」. 카드 전체가 단추 하나이고 화면 읽기 이름은 「목표, {문장}, 고치기」", () => {
    mount();
    const btn = screen.getByRole("button", { name: "목표, 토익 900점 넘기기, 고치기" });
    expect(btn).toBe(card());
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.querySelector(".me-goal-label")?.textContent).toBe("목표");
    expect(btn.querySelector(".me-goal-text")?.textContent).toBe("토익 900점 넘기기");
    expect(btn.querySelector(".me-goal-chevron")?.textContent).toBe("›");
    expect(btn.querySelector(".me-goal-chevron")?.getAttribute("aria-hidden")).toBe("true");
    // 카드 안에 다른 누름 요소가 없다(단추 하나)
    expect(btn.querySelectorAll("button, a, input")).toHaveLength(0);
    // 첫 카드다: 내 정보 본문의 첫 section 안
    expect(document.querySelector(".growth-body > section")?.contains(btn)).toBe(true);
  });

  it("없앤 것: 내 정보에 목표 글 칸·「목표 한 문장」 라벨·「목표 저장」 단추가 없다", () => {
    mount();
    // 남은 글 칸(비율 숫자 칸 등) 가운데 목표 칸은 없다
    expect(document.querySelector("#me-goal")).toBeNull();
    expect(screen.queryByRole("textbox", { name: /목표 한 문장|^목표$/ })).toBeNull();
    for (const box of screen.queryAllByRole("textbox") as HTMLInputElement[]) expect(box.value).not.toBe("토익 900점 넘기기");
    expect(screen.queryByLabelText("목표 한 문장")).toBeNull();
    expect(screen.queryByText("목표 한 문장")).toBeNull();
    expect(screen.queryByRole("button", { name: "목표 저장" })).toBeNull();
    expect(document.body.textContent).not.toContain("목표 저장");
  });

  it("목표가 비었으면 이름표 + 「목표 적기」 + 「›」", () => {
    mount(settings({ goal: null }));
    const btn = screen.getByRole("button", { name: "목표, 목표 적기" });
    expect(btn.querySelector(".me-goal-label")?.textContent).toBe("목표");
    expect(btn.querySelector(".me-goal-empty")?.textContent).toBe("목표 적기");
    expect(btn.querySelector(".me-goal-text")).toBeNull();
    expect(btn.querySelector(".me-goal-chevron")?.textContent).toBe("›");
  });
});

describe("S8-b 「목표」(고침6 ③)", () => {
  it("카드를 누르면 열린다: 「‹」(이름 「이전」) · 이름표 「목표」(포커스) · 칸 라벨 「목표」 · 지금 목표로 미리 채움 · 칸 아래 예시 · 주 단추 「저장」. 단계 표시·건너뛰기 없음", async () => {
    mount();
    await open();
    const dlg = editor()!;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const back = within(dlg).getByRole("button", { name: "이전" });
    expect(back.textContent).toBe("‹");
    const title = within(dlg).getByRole("heading", { name: "목표" });
    expect(document.activeElement).toBe(title);
    expect(field().value).toBe("토익 900점 넘기기");
    expect(dlg.querySelector("label[for='goal-sentence-input']")?.textContent).toBe("목표");
    const help = dlg.querySelector("#goal-sentence-help")!;
    expect(help.textContent).toBe("예: 포트폴리오 끝내고 토익 800점 넘기기");
    expect(field().getAttribute("aria-describedby")).toBe("goal-sentence-help");
    expect(field().compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // 칸 아래
    expect(field().getAttribute("placeholder")).toBeNull(); // 예시는 칸 안 흐린 글이 아니다(UI-06)
    const save = within(dlg).getByRole("button", { name: "저장" });
    expect(save.className).toContain("btn-primary");
    // 머리 「‹」 → 이름표 → 칸 → 저장 순
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(field().compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dlg.textContent).not.toMatch(/단계/);
    expect(within(dlg).queryByRole("button", { name: "건너뛰기" })).toBeNull();
    expect(within(dlg).queryByRole("button", { name: "다음" })).toBeNull();
  });

  it("저장: 내 정보가 쓰던 길(api.saveSettings) 그대로 — 앞뒤·겹친 띄어쓰기는 checkGoal 정리 결과로. 성공하면 닫히고 카드가 새 값, onChanged, 포커스는 카드로", async () => {
    const { api, onChanged } = mount();
    card().focus();
    await open();
    await type("  포트폴리오   끝내기 ");
    await pressIn(editor()!, "저장");
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith({ goal: "포트폴리오 끝내기" });
    expect(onChanged).toHaveBeenCalledWith({ goal: "포트폴리오 끝내기" });
    expect(editor()).toBeNull();
    expect(card().getAttribute("aria-label")).toBe("목표, 포트폴리오 끝내기, 고치기");
    expect(card().querySelector(".me-goal-text")?.textContent).toBe("포트폴리오 끝내기");
    expect(document.activeElement).toBe(card());
    history.flush();
    expect(history.index).toBe(0); // 쌓은 칸을 거뒀다
  });

  it("비우고 저장하면 목표 없음(goal: null) — 카드는 「목표 적기」", async () => {
    const { api, onChanged } = mount();
    await open();
    await type("   ");
    await pressIn(editor()!, "저장");
    expect(api.saveSettings).toHaveBeenCalledWith({ goal: null });
    expect(onChanged).toHaveBeenCalledWith({ goal: null });
    expect(screen.getByRole("button", { name: "목표, 목표 적기" })).toBe(card());
  });

  it("Enter로도 저장한다(한글 조합 중 Enter는 저장하지 않는다)", async () => {
    const { api } = mount();
    await open();
    await type("토익 950점");
    await act(async () => fireEvent.keyDown(field(), { key: "Enter", keyCode: 229 }));
    expect(api.saveSettings).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(field(), { key: "Enter" }));
    expect(api.saveSettings).toHaveBeenCalledWith({ goal: "토익 950점" });
  });

  it(`악용: 상한+1자(${GOAL_MAX_LENGTH + 1}자)는 저장 호출 0 + 안내, 상한(${GOAL_MAX_LENGTH}자)은 통과`, async () => {
    const { api } = mount();
    await open();
    await type("가".repeat(GOAL_MAX_LENGTH + 1));
    const save = within(editor()!).getByRole("button", { name: "저장" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(editor()!.querySelector("#goal-sentence-help")?.textContent).toBe(`${GOAL_MAX_LENGTH}자까지 적을 수 있어요. 지금 ${GOAL_MAX_LENGTH + 1}자예요.`);
    await act(async () => fireEvent.click(save));
    await act(async () => fireEvent.keyDown(field(), { key: "Enter" }));
    expect(api.saveSettings).not.toHaveBeenCalled();
    // 바꾼 채 「‹」 → 확인 → 「계속 적기」: 저장 호출 0, 열린 채
    await pressIn(editor()!, "이전");
    await pressIn(confirmBox()!, "계속 적기");
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(editor()).not.toBeNull();
    await type("가".repeat(GOAL_MAX_LENGTH));
    await pressIn(editor()!, "저장");
    expect(api.saveSettings).toHaveBeenCalledWith({ goal: "가".repeat(GOAL_MAX_LENGTH) });
  });

  it("저장이 실패하면 닫지 않고 「저장하지 못했어요. 다시 눌러 주세요.」, 카드는 옛 값", async () => {
    const api = fakeApi({ saveSettings: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    const { onChanged } = mount(settings(), api);
    await open();
    await type("새 목표");
    await pressIn(editor()!, "저장");
    expect(editor()).not.toBeNull();
    expect(within(editor()!).getByRole("alert").textContent).toBe("저장하지 못했어요. 다시 눌러 주세요.");
    expect(field().value).toBe("새 목표");
    expect(onChanged).not.toHaveBeenCalled();
    expect(card().querySelector(".me-goal-text")?.textContent).toBe("토익 900점 넘기기");
  });

  it("안 바꿨으면 「‹」·Esc는 확인 없이 바로 닫히고 포커스는 카드로", async () => {
    const { api } = mount();
    card().focus();
    await open();
    await pressIn(editor()!, "이전");
    expect(confirmBox()).toBeNull();
    expect(editor()).toBeNull();
    expect(document.activeElement).toBe(card());
    await open();
    await act(async () => fireEvent.keyDown(field(), { key: "Escape" }));
    expect(confirmBox()).toBeNull();
    expect(editor()).toBeNull();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it("바꾸고 「‹」 → 앱 공통 확인(alertdialog, PM d-135 글, 처음 포커스 「계속 적기」). 「나가기」면 저장 호출 0으로 닫힘, 포커스는 카드로", async () => {
    const { api } = mount();
    card().focus();
    await open();
    await type("바꾼 목표");
    await pressIn(editor()!, "이전");
    const box = confirmBox()!;
    expect(box).not.toBeNull();
    expect(box.getAttribute("aria-modal")).toBe("true");
    const buttons = within(box).getAllByRole("button");
    expect(box.querySelector("h2")?.textContent).toBe("저장하지 않고 나갈까요?");
    expect(buttons.map((b) => b.textContent)).toEqual(["계속 적기", "나가기"]);
    expect(buttons[0].className).toContain("btn-primary");
    expect(document.activeElement).toBe(buttons[0]);
    await pressIn(box, "나가기");
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
    expect(card().querySelector(".me-goal-text")?.textContent).toBe("토익 900점 넘기기");
    expect(document.activeElement).toBe(card());
  });

  it("바꾸고 「‹」 → 확인의 「계속 적기」면 확인만 닫히고 S8-b는 열린 채(값 그대로, 저장 호출 0, 포커스는 「‹」). 그 뒤 「저장」이면 저장 호출 1(같은 인자)로 닫힘", async () => {
    const { api } = mount();
    await open();
    await type(" 바꾼  목표 ");
    within(editor()!).getByRole("button", { name: "이전" }).focus();
    await pressIn(editor()!, "이전");
    await pressIn(confirmBox()!, "계속 적기");
    expect(confirmBox()).toBeNull();
    expect(editor()).not.toBeNull();
    expect(field().value).toBe(" 바꾼  목표 ");
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(within(editor()!).getByRole("button", { name: "이전" }));
    await pressIn(editor()!, "저장");
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith({ goal: "바꾼 목표" });
    expect(editor()).toBeNull();
    expect(card().querySelector(".me-goal-text")?.textContent).toBe("바꾼 목표");
  });

  it("바꾸고 Esc → 같은 확인. 확인에서 Esc는 확인만 닫는다(값 그대로, 포커스는 「‹」로)", async () => {
    mount();
    await open();
    await type("바꾼 목표");
    within(editor()!).getByRole("button", { name: "이전" }).focus();
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }));
    expect(confirmBox()).not.toBeNull();
    await act(async () => fireEvent.keyDown(confirmBox()!, { key: "Escape" }));
    expect(confirmBox()).toBeNull();
    expect(editor()).not.toBeNull();
    expect(field().value).toBe("바꾼 목표");
    expect(document.activeElement).toBe(within(editor()!).getByRole("button", { name: "이전" }));
  });

  it("뒤로 가기(FakeHistory): 바꾼 것이 없으면 바로 닫힘. 바꿨으면 확인을 띄우고 자기 칸으로 돌아감 — 확인을 닫고(Esc·「계속 적기」) 다시 뒤로 가기 → 다시 확인. 저장 실패면 열린 채, 다시 뒤로 가기 → 다시 확인, 「나가기」면 닫히고 앱은 나가지 않는다", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "unavailable" as const }));
    mount(settings(), fakeApi({ saveSettings: save }));
    await open();
    expect(history.entries).toHaveLength(2);
    expect(history.index).toBe(1);
    // 안 바꿈 → 뒤로 가기는 바로 닫는다
    await act(async () => history.userBack());
    expect(editor()).toBeNull();
    expect(confirmBox()).toBeNull();
    history.flush();
    expect(history.index).toBe(0);

    await open();
    expect(history.index).toBe(1);
    await type("바꾼 목표");
    await act(async () => history.userBack());
    expect(confirmBox()).not.toBeNull();
    history.flush();
    expect(history.index).toBe(1); // 자기 칸으로 돌아갔다(새 칸을 쌓지 않음)
    expect(history.entries).toHaveLength(2);
    // 확인을 닫고(Esc) 다시 뒤로 가기 → 같은 확인
    await act(async () => fireEvent.keyDown(confirmBox()!, { key: "Escape" }));
    expect(confirmBox()).toBeNull();
    await act(async () => history.userBack());
    expect(confirmBox()).not.toBeNull();
    history.flush();
    expect(history.index).toBe(1);
    // 「계속 적기」 → S8-b의 「저장」 → 실패: 열린 채, 안내
    await pressIn(confirmBox()!, "계속 적기");
    expect(confirmBox()).toBeNull();
    history.flush();
    expect(history.index).toBe(1);
    await pressIn(editor()!, "저장");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ goal: "바꾼 목표" });
    expect(editor()).not.toBeNull();
    expect(within(editor()!).getByRole("alert").textContent).toBe("저장하지 못했어요. 다시 눌러 주세요.");
    // 다시 뒤로 가기 → 다시 확인 → 「나가기」
    await act(async () => history.userBack());
    expect(confirmBox()).not.toBeNull();
    history.flush();
    expect(history.index).toBe(1);
    await pressIn(confirmBox()!, "나가기");
    expect(editor()).toBeNull();
    history.flush();
    expect(history.index).toBe(0);
    expect(history.leftApp).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("악용: 목표에 HTML을 넣어도 카드·S8-b 칸에 글자 그대로, img 요소 없음", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    mount(settings({ goal: evil }));
    expect(card().querySelector(".me-goal-text")?.textContent).toBe(evil);
    expect(card().getAttribute("aria-label")).toBe(`목표, ${evil}, 고치기`);
    await open();
    expect(field().value).toBe(evil);
    expect(document.querySelector("img")).toBeNull();
  });
});
