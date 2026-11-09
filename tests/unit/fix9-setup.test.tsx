// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackHeader, BottomActions } from "../../components/back-header";
import { MeScreen } from "../../components/me-screen";
import { Onboarding, ONBOARDING_TEXT } from "../../components/onboarding";
import { Stepper } from "../../components/stepper";
import { PrimaryButton, SecondaryButton, TextButton } from "../../components/ui";
import { SIZE_TOKENS } from "../../lib/design-tokens";
import type { SettingsApi } from "../../lib/onboarding-api";
import { NOTIFY_ITEMS } from "../../lib/push/next";
import type { PushApi } from "../../lib/push/subscribe";
import type { NotifySettings, RatioItem, SettingsData } from "../../lib/settings/types";
import { FakeHistory } from "./fake-history";

/**
 * 고침9(J1): 처음 설정 · 내 정보 · 나누기 머리 — 발표 뒤 판 몫(PM 1·6, 명세 ⑩·⑬, Figma 정합 A1~A4).
 * - 머리 부품(BackHeader): 「‹」 이름 「이전」 · 누름 48(CSS 규칙과 토큰) · 포커스 순서 첫째 · 누르면 이전 단계. 아래 단추 줄에 「이전」 글 단추 없음
 * - 처음 설정 끝 「시작하기」 하나: 켠 알림이 있을 때만 허락 묻기(D-102⑤), 다 끄면 허락·구독 호출 0(악용), 허락 안 해도 들어감
 * - ⑬ 글: 예시·보조 줄·알림 미리 보기(글은 lib/push/next.ts 한 곳), 뺀 글 없음
 * - S8-a: 내 정보 카드 → 열기 · 저장 호출 인자 합 100(악용: 다이얼·칸·−/+ 섞기) · 닫힘 · 띠 갱신 · 서버 거절이면 열린 채 · 바꾸고 나가기 확인(「‹」·Esc·FakeHistory 뒤로 가기) · 「나가기」 저장 0
 */

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const NOTIFY: NotifySettings = { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 };
const CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function fakeApi(over: Partial<SettingsApi> = {}): SettingsApi {
  return {
    addCategory: vi.fn(),
    saveRatios: vi.fn(async (ratios: RatioItem[]) => ({ ok: true as const, data: { ratios } })),
    saveSettings: vi.fn(async () => ({ ok: true as const, data: { goal: null, goalReadable: true, onboardingDone: true, notify: NOTIFY } })),
    requestPermission: vi.fn(async () => "granted" as const),
    ...over,
  };
}
const push: PushApi = {
  permission: () => "default",
  supported: () => true,
  hasKey: () => true,
  subscribed: async () => false,
  enable: vi.fn(async () => "ok" as const),
  disable: async () => {},
};
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, a[href], [tabindex]:not([tabindex='-1'])";
const firstFocusable = (root: ParentNode) => root.querySelector<HTMLElement>(FOCUSABLE);

let history: FakeHistory;
beforeEach(() => {
  history = new FakeHistory(null).install();
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  history.flush();
  vi.restoreAllMocks();
});

describe("머리 부품 BackHeader · BottomActions (정합 A1·A2, PM 1-A)", () => {
  it("onBack이 있으면 「‹」 단추 하나: 화면 읽기 이름 「이전」, 글자는 꾸밈(aria-hidden), 머리의 첫 누름 요소. 누르면 onBack", () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<BackHeader onBack={onBack} title="오늘 기록" onClose={onClose} />);
    const back = screen.getByRole("button", { name: "이전" });
    expect(back.textContent).toBe("‹");
    expect(back.querySelector("[aria-hidden='true']")?.textContent).toBe("‹");
    expect(firstFocusable(container)).toBe(back);
    expect(container.querySelector(".screen-head-title")?.textContent).toBe("오늘 기록");
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("누름 48: .overlay-back 규칙이 --tap-min(48px)을 가로·세로로 쓴다. 닫기도 최소 폭 48", () => {
    expect(SIZE_TOKENS["--tap-min"]).toBe("48px");
    const rule = CSS.match(/\.overlay-back \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/inline-size:\s*var\(--tap-min\)/);
    expect(rule).toMatch(/block-size:\s*var\(--tap-min\)/);
    expect(CSS).toMatch(/\.screen-head-close \{[^}]*min-width:\s*var\(--tap-min\)/);
  });

  it("onBack이 없으면 「‹」가 없다. step은 「4단계 중 n단계」 + 진행 막대 넷(지난 단계까지 is-done, 화면 읽기에서 숨김)", () => {
    const { container } = render(<BackHeader step={{ n: 2, total: 4 }} />);
    expect(screen.queryByRole("button", { name: "이전" })).toBeNull();
    expect(screen.getByText("4단계 중 2단계")).toBeTruthy();
    const bars = container.querySelectorAll(".screen-head-bar");
    expect(bars).toHaveLength(4);
    expect([...bars].map((b) => b.classList.contains("is-done"))).toEqual([true, true, false, false]);
    expect(container.querySelector(".screen-head-progress")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("BottomActions는 자식 단추를 차례대로 쌓고, CSS는 폭 가득·아래 여백 36·sticky", () => {
    const { container } = render(
      <BottomActions>
        <button type="button">주</button>
        <button type="button">보조</button>
      </BottomActions>,
    );
    expect([...container.querySelectorAll(".bottom-actions > button")].map((b) => b.textContent)).toEqual(["주", "보조"]);
    const rule = CSS.match(/\.bottom-actions \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/calc\(36px \+ env\(safe-area-inset-bottom\)\)/);
    expect(CSS).toMatch(/\.bottom-actions > \.btn \{[^}]*width:\s*100%/);
  });

  it("Stepper(A3): 단위 글은 숫자 칸 테두리(.num-field) 안에 있고, −/+ 는 보이는 원(.step-btn-face) + 누름 틀", () => {
    render(<Stepper id="s" label="분" unit="분" value={30} max={59} step={5} onChange={vi.fn()} />);
    const input = screen.getByLabelText("분") as HTMLInputElement;
    const box = input.closest(".num-field")!;
    expect(box).not.toBeNull();
    expect(box.querySelector(".stepper-unit")?.textContent).toBe("분");
    expect(document.querySelectorAll(".stepper-unit")).toHaveLength(1); // 칸 밖 단위 글 없음
    const minus = screen.getByRole("button", { name: "분 5분 줄이기" });
    expect(minus.className).toContain("step-btn");
    expect(minus.querySelector(".step-btn-face")?.textContent).toBe("−");
    expect(CSS).toMatch(/\.step-btn-face \{[^}]*inline-size:\s*32px;[^}]*block-size:\s*32px/);
  });
});

function mountOnboarding(api: SettingsApi = fakeApi(), categories = [{ id: C1, name: "어학" }, { id: C2, name: "포트폴리오" }], onDone = vi.fn()) {
  render(<Onboarding api={api} categories={categories} initialGoal={null} initialRatios={[]} initialNotify={NOTIFY} onDone={onDone} />);
  return { api, onDone };
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const toStep4 = () => {
  click("다음");
  click("다음");
  click("다음");
};

describe("처음 설정 머리 「‹」 (PM 1-A)", () => {
  it("1단계에는 「‹」가 없고, 2~4단계는 「‹」가 화면의 첫 누름 요소. 누르면 바로 앞 단계(제목으로 포커스)", () => {
    mountOnboarding();
    const main = screen.getByRole("main");
    expect(screen.queryByRole("button", { name: "이전" })).toBeNull();
    for (const [n, heading] of [
      [2, "분야"],
      [3, "목표 비율"],
      [4, "알림"],
    ] as const) {
      click("다음");
      expect(screen.getByText(`4단계 중 ${n}단계`)).toBeTruthy();
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
      const backs = screen.getAllByRole("button", { name: "이전" });
      expect(backs).toHaveLength(1); // 아래 단추 줄의 「이전」 글 단추는 없다
      expect(firstFocusable(main)).toBe(backs[0]);
      expect(backs[0].closest(".screen-head")).not.toBeNull();
    }
    click("이전");
    expect(screen.getByText("4단계 중 3단계")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "목표 비율" }));
    click("이전");
    click("이전");
    expect(screen.getByText("4단계 중 1단계")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "이전" })).toBeNull();
  });

  it("아래 단추 줄(.bottom-actions)은 주 단추 하나(1단계만 「건너뛰기」가 위에)", () => {
    mountOnboarding();
    const names = () => [...document.querySelectorAll(".bottom-actions button")].map((b) => b.textContent);
    expect(names()).toEqual(["건너뛰기", "다음"]);
    click("다음");
    expect(names()).toEqual(["다음"]);
    click("다음");
    click("다음");
    expect(names()).toEqual(["시작하기"]);
    expect(document.querySelector(".bottom-actions .btn-primary")?.textContent).toBe("시작하기");
  });
});

describe("처음 설정 ⑬ 글 · 이름표", () => {
  it("1단계: 이름표 「목표」, 칸 아래 「예: 포트폴리오 끝내고 토익 800점 넘기기」(칸 안 흐린 글 없음), 옛 힌트 없음", () => {
    mountOnboarding();
    expect(screen.getByRole("heading", { level: 1, name: "목표" })).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "목표" });
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("예: 포트폴리오 끝내고 토익 800점 넘기기");
    expect(input.getAttribute("placeholder")).toBeNull();
    expect(document.body.textContent).not.toContain("흐릿해도 괜찮아요");
  });

  it("2단계: 이름표 「분야」 + 아래 「시간을 나눠 쓸 곳 · 여러 개」, 「적고 넓게 시작해요…」 없음", () => {
    mountOnboarding();
    click("다음");
    const h = screen.getByRole("heading", { name: "분야" });
    expect(h.nextElementSibling?.textContent).toBe("시간을 나눠 쓸 곳 · 여러 개");
    expect(document.body.textContent).not.toContain("적고 넓게");
  });

  it("3단계: 이름표 「목표 비율」 옆 「분야마다 쓰고 싶은 몫 · 합 100%」(한 번만), 「대략이면 돼요…」·「합계」 없음, 줄은 흰 카드", () => {
    mountOnboarding();
    click("다음");
    click("다음");
    const h = screen.getByRole("heading", { name: "목표 비율" });
    expect(h.parentElement?.querySelector(".ratio-caption")?.textContent).toBe("분야마다 쓰고 싶은 몫 · 합 100%");
    expect(screen.getAllByText("분야마다 쓰고 싶은 몫 · 합 100%")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/대략이면|합계/);
    expect(document.querySelector("ul.ratio-list")?.classList.contains("card-box")).toBe(true);
  });

  it("4단계: 이름표 「알림」, 줄마다 시각 + 실제 알림 글 미리 보기(글은 lib/push/next.ts에서). 아침은 고른 첫 분야, 첫 분야를 풀면 다음 분야", () => {
    mountOnboarding();
    click("다음");
    click("포트폴리오"); // 풀었다가 다시 고르면 고른 차례가 어학 → 포트폴리오
    click("포트폴리오");
    click("다음");
    click("다음");
    expect(screen.getByRole("heading", { name: "알림" })).toBeTruthy();
    const evening = `오후 7:30 · “${NOTIFY_ITEMS.evening.body}”`;
    expect(evening).toBe("오후 7:30 · “오늘 몇 시간 썼는지 적어 둘까요?”");
    expect(screen.getByText(evening)).toBeTruthy();
    expect(screen.getByText(`오전 10:00 · “${NOTIFY_ITEMS.morning.title} · 어학”`)).toBeTruthy();
    expect(screen.getByText("오전 10:00 · “오늘 먼저 할 일 · 어학”")).toBeTruthy();
    // 미리 보기는 스위치의 설명(aria-describedby)
    const sw = screen.getByRole("checkbox", { name: "오늘 기록 알림" });
    expect(document.getElementById(sw.getAttribute("aria-describedby")!)?.textContent).toBe(evening);
    for (const gone of ["정한 시각에 알려 드려요", "저녁에 오늘 쓴 시간을 남기도록", "아침에 앱을 열도록", "알림을 받을까요"]) {
      expect(document.body.textContent).not.toContain(gone);
    }
    // 첫 분야(어학)를 풀면 아침 미리 보기는 포트폴리오
    click("이전");
    click("이전");
    click("어학");
    click("다음");
    click("다음");
    expect(screen.getByText("오전 10:00 · “오늘 먼저 할 일 · 포트폴리오”")).toBeTruthy();
  });

  it("고른 분야가 없을 때 아침 미리 보기의 분야 자리는 「분야」(22 판단)", () => {
    expect(ONBOARDING_TEXT.morningPreview(600, null)).toBe("오전 10:00 · “오늘 먼저 할 일 · 분야”");
  });
});

describe("처음 설정 끝 「시작하기」 하나 (PM 1 · D-102⑤)", () => {
  it("알림 둘 다 켬(기본) → 허락을 한 번 묻고, 허락되면 둘 다 켠 채 저장", async () => {
    const { api, onDone } = mountOnboarding();
    toStep4();
    expect((screen.getByRole("checkbox", { name: "오늘 기록 알림" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "아침 알림" }) as HTMLInputElement).checked).toBe(true);
    await act(async () => click("시작하기"));
    expect(api.requestPermission).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ notify: { eveningEnabled: true, eveningMinute: 1170, morningEnabled: true, morningMinute: 600 }, completeOnboarding: true }),
    );
    expect(onDone.mock.calls[0][0]).toMatchObject({ pushOutcome: "granted" });
  });

  it("악용: 알림을 다 끈 채 「시작하기」 → 허락 요청·구독(requestPermission) 호출 0, 알림은 꺼진 채 저장하고 들어감", async () => {
    const { api, onDone } = mountOnboarding();
    toStep4();
    fireEvent.click(screen.getByRole("checkbox", { name: "오늘 기록 알림" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "아침 알림" }));
    await act(async () => click("시작하기"));
    expect(api.requestPermission).toHaveBeenCalledTimes(0);
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ notify: expect.objectContaining({ eveningEnabled: false, morningEnabled: false }), completeOnboarding: true }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toMatchObject({ pushOutcome: null });
  });

  it("하나만 켜도 허락을 묻는다. 허락하지 않으면 「허락 안 함」 글을 보이고 알림은 꺼진 채 앱으로 들어간다", async () => {
    const api = fakeApi({ requestPermission: vi.fn(async () => "denied" as const) });
    const { onDone } = mountOnboarding(api);
    toStep4();
    fireEvent.click(screen.getByRole("checkbox", { name: "오늘 기록 알림" }));
    await act(async () => click("시작하기"));
    expect(api.requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe("알림이 허락되지 않았어요. 브라우저 설정에서 바꿀 수 있어요.");
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ notify: expect.objectContaining({ eveningEnabled: false, morningEnabled: false }) }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

// ---- S8-a ----
const CATS = [{ id: C1, name: "어학" }, { id: C2, name: "포트폴리오" }];
function meSettings(over: Partial<SettingsData> = {}): SettingsData {
  return { goal: "토익 900점", goalReadable: true, onboardingDone: true, notify: NOTIFY, ratios: [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }], ...over };
}
function mountMe(api: SettingsApi = fakeApi(), s: SettingsData = meSettings()) {
  const onChanged = vi.fn();
  render(<MeScreen settings={s} categories={CATS} api={api} push={push} onChanged={onChanged} />);
  return { api, onChanged };
}
const ratioCard = () => document.querySelector<HTMLButtonElement>(".me-ratio-card")!;
const dialog = () => screen.queryByRole("dialog", { name: "목표 비율" });
const confirmBox = () => screen.queryByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
const openS8a = () => act(async () => fireEvent.click(ratioCard()));
const inDialog = (name: string) => act(async () => fireEvent.click(within(dialog()!).getByRole("button", { name })));
const band = () => [...document.querySelectorAll<HTMLElement>(".me-ratio-cell")].map((c) => [c.dataset.ratioId, Number(c.style.flexGrow)]);
const fieldVal = (name: string) => Number((screen.getByLabelText(`${name} 비율(%)`) as HTMLInputElement).value);
const typeField = (name: string, value: string) => {
  const f = screen.getByLabelText(`${name} 비율(%)`);
  fireEvent.change(f, { target: { value } });
  fireEvent.blur(f);
};

describe("내 정보 「목표 비율」 줄 → S8-a (PM 6 · Figma 50:641 · 81:380)", () => {
  it("내 정보에서는 고치지 않는다: 카드 = 이름 + 띠(숫자 없음) + 「›」, 카드 전체가 단추 하나(화면 읽기 이름에 몫). 숫자 칸·「비율 저장」 없음", () => {
    mountMe();
    const card = screen.getByRole("button", { name: "목표 비율, 어학 60%, 포트폴리오 40%, 고치기" });
    expect(card).toBe(ratioCard());
    expect(card.querySelector(".me-card-title")?.textContent).toBe("목표 비율");
    expect(card.querySelector(".me-chevron")?.textContent).toBe("›");
    expect(card.querySelectorAll("button, input")).toHaveLength(0);
    expect(band()).toEqual([
      [C1, 60],
      [C2, 40],
    ]);
    expect(card.querySelector(".me-ratio-band")?.textContent).toBe(""); // 띠에 숫자 없음
    expect(card.querySelector(".me-ratio-band")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("input.ratio-field")).toBeNull();
    expect(screen.queryByRole("button", { name: "비율 저장" })).toBeNull();
    expect(CSS).toMatch(/\.me-ratio-band \{[^}]*block-size:\s*8px/);
    expect(CSS).toMatch(/\.me-ratio-cell \{[^}]*border:\s*1px solid/);
  });

  it("카드를 누르면 S8-a: 「‹」(첫 누름 요소) · 이름표 「목표 비율」(포커스) · 다이얼 · 분야 줄 흰 카드 · 「균등 배분」 · 주 단추 「저장」. 단계 글·이름표 옆 글·탭 없음", async () => {
    mountMe();
    await openS8a();
    const dlg = dialog()!;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const back = within(dlg).getByRole("button", { name: "이전" });
    expect(firstFocusable(dlg)).toBe(back);
    expect(document.activeElement).toBe(within(dlg).getByRole("heading", { name: "목표 비율" }));
    expect(dlg.querySelector("svg.dial")).not.toBeNull();
    expect(dlg.querySelector("ul.ratio-list.card-box")).not.toBeNull();
    expect(within(dlg).getByRole("button", { name: "균등 배분" })).toBeTruthy();
    expect(within(dlg).getByRole("button", { name: "저장" }).closest(".bottom-actions")).not.toBeNull();
    expect(dlg.textContent).not.toMatch(/단계|분야마다 쓰고 싶은 몫|대략이면|합계/);
    expect(dlg.querySelector("nav, [role='tablist']")).toBeNull();
    expect([fieldVal("어학"), fieldVal("포트폴리오"), fieldVal("기타")]).toEqual([60, 40, 0]);
  });

  it("악용: 다이얼 키·숫자 칸·−/+를 섞어 합을 깨려 해도 저장 인자 합은 100(정수, 0~100). 저장하면 닫히고 띠가 바뀐다", async () => {
    const { api, onChanged } = mountMe();
    await openS8a();
    fireEvent.keyDown(document.getElementById("ratio-dial-handle-end")!, { key: "PageUp" }); // 어학 +5
    typeField("포트폴리오", "90"); // 칸: 합을 넘기는 값
    typeField("기타", "abc"); // 이상한 글은 무시
    typeField("어학", "-20"); // 음수는 무시
    fireEvent.click(screen.getByRole("button", { name: "기타 5% 늘리기" }));
    await inDialog("저장");
    expect(api.saveRatios).toHaveBeenCalledTimes(1);
    const sent = (api.saveRatios as ReturnType<typeof vi.fn>).mock.calls[0][0] as RatioItem[];
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.reduce((s, r) => s + r.percent, 0)).toBe(100);
    expect(sent.every((r) => Number.isInteger(r.percent) && r.percent > 0 && r.percent <= 100)).toBe(true);
    expect(dialog()).toBeNull();
    expect(onChanged).toHaveBeenCalledWith({ ratios: sent });
    const byId = new Map(sent.map((r) => [r.categoryId ?? "other", r.percent]));
    expect(band()).toEqual([...byId.entries()]); // 띠 = 저장한 값(0% 칸 없음)
    expect(ratioCard().getAttribute("aria-label")).toContain(`포트폴리오 ${byId.get(C2)}%`);
    expect(screen.getByText("저장했어요")).toBeTruthy();
  });

  it("서버 거절 경로 그대로: 저장이 실패하면 S8-a는 열린 채 「저장하지 못했어요. 다시 눌러 주세요.」, 띠·onChanged 그대로", async () => {
    const api = fakeApi({ saveRatios: vi.fn(async () => ({ ok: false as const, error: "invalid_input" as const })) });
    const { onChanged } = mountMe(api);
    await openS8a();
    fireEvent.click(screen.getByRole("button", { name: "어학 5% 줄이기" }));
    await inDialog("저장");
    expect(api.saveRatios).toHaveBeenCalledWith([{ categoryId: C1, percent: 55 }, { categoryId: C2, percent: 45 }]);
    expect(dialog()).not.toBeNull();
    expect(within(dialog()!).getByRole("alert").textContent).toBe("저장하지 못했어요. 다시 눌러 주세요.");
    expect(onChanged).not.toHaveBeenCalled();
    expect(band()).toEqual([
      [C1, 60],
      [C2, 40],
    ]);
  });

  it("안 바꿨으면 「‹」·Esc는 확인 없이 닫힌다. 열 때 합 100으로 맞춘 것(30·30 → 50·50)은 바꾼 것이 아니다. 포커스는 카드로", async () => {
    mountMe(fakeApi(), meSettings({ ratios: [{ categoryId: C1, percent: 30 }, { categoryId: C2, percent: 30 }] }));
    ratioCard().focus();
    await openS8a();
    expect([fieldVal("어학"), fieldVal("포트폴리오")]).toEqual([50, 50]);
    await inDialog("이전");
    expect(confirmBox()).toBeNull();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(ratioCard());
    await openS8a();
    await act(async () => fireEvent.keyDown(within(dialog()!).getByRole("heading", { name: "목표 비율" }), { key: "Escape" }));
    expect(confirmBox()).toBeNull();
    expect(dialog()).toBeNull();
  });

  it("바꾸고 「‹」 → 확인(d-135 글 「저장하지 않고 나갈까요? / 계속 적기 / 나가기」, 처음 포커스 「계속 적기」). 「계속 적기」면 값 그대로, 「나가기」면 저장 호출 0으로 닫히고 띠 그대로", async () => {
    const { api } = mountMe();
    await openS8a();
    fireEvent.click(screen.getByRole("button", { name: "어학 5% 줄이기" }));
    await inDialog("이전");
    const box = confirmBox()!;
    expect(box.querySelector("h2")?.textContent).toBe("저장하지 않고 나갈까요?");
    expect(within(box).getAllByRole("button").map((b) => b.textContent)).toEqual(["계속 적기", "나가기"]);
    expect(document.activeElement).toBe(within(box).getByRole("button", { name: "계속 적기" }));
    await act(async () => fireEvent.click(within(box).getByRole("button", { name: "계속 적기" })));
    expect(confirmBox()).toBeNull();
    expect(fieldVal("어학")).toBe(55);
    await act(async () => fireEvent.keyDown(within(dialog()!).getByRole("button", { name: "이전" }), { key: "Escape" }));
    expect(confirmBox()).not.toBeNull(); // Esc도 같은 확인
    await act(async () => fireEvent.click(within(confirmBox()!).getByRole("button", { name: "나가기" })));
    expect(dialog()).toBeNull();
    expect(api.saveRatios).toHaveBeenCalledTimes(0);
    expect(band()).toEqual([
      [C1, 60],
      [C2, 40],
    ]);
  });

  it("뒤로 가기(FakeHistory): 안 바꿨으면 닫힘. 바꿨으면 확인을 띄우고 자기 칸으로(칸 index 1 그대로) — 「계속 적기」 뒤 다시 뒤로 가기 → 다시 확인. 「나가기」면 index 0, 앱은 나가지 않고 저장 0", async () => {
    const { api } = mountMe();
    await openS8a();
    expect(history.entries).toHaveLength(2);
    expect(history.index).toBe(1);
    await act(async () => history.userBack());
    expect(dialog()).toBeNull();
    history.flush();
    expect(history.index).toBe(0);

    await openS8a();
    expect(history.index).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "포트폴리오 5% 늘리기" }));
    await act(async () => history.userBack());
    expect(confirmBox()).not.toBeNull();
    history.flush();
    expect(history.index).toBe(1);
    expect(history.entries).toHaveLength(2);
    await act(async () => fireEvent.click(within(confirmBox()!).getByRole("button", { name: "계속 적기" })));
    history.flush();
    expect(history.index).toBe(1);
    await act(async () => history.userBack());
    expect(confirmBox()).not.toBeNull();
    history.flush();
    expect(history.index).toBe(1);
    await act(async () => fireEvent.click(within(confirmBox()!).getByRole("button", { name: "나가기" })));
    expect(dialog()).toBeNull();
    history.flush();
    expect(history.index).toBe(0);
    expect(history.leftApp).toBe(false);
    expect(api.saveRatios).toHaveBeenCalledTimes(0);
  });

  it("내 정보 알림 줄: 설명 글 둘이 없고 시각 값이 보인다(「시각」 고르기 — 접근 이름 「… 시각」)", () => {
    mountMe();
    expect(document.body.textContent).not.toMatch(/저녁에 오늘 쓴 시간을 남기도록|아침에 앱을 열도록/);
    expect((screen.getByLabelText("오늘 기록 알림 시각") as HTMLSelectElement).selectedOptions[0].textContent).toBe("오후 7:30");
    expect((screen.getByLabelText("아침 알림 시각") as HTMLSelectElement).selectedOptions[0].textContent).toBe("오전 10:00");
  });

  it("S8-b·S8-a·처음 설정이 같은 머리 부품(.screen-head 안 「‹」)을 쓴다", async () => {
    mountMe();
    await act(async () => fireEvent.click(document.querySelector(".me-goal-card")!));
    const goal = screen.getByRole("dialog", { name: "목표" });
    expect(within(goal).getByRole("button", { name: "이전" }).closest(".screen-head")).not.toBeNull();
    expect(within(goal).getByRole("button", { name: "저장" }).closest(".bottom-actions")).not.toBeNull();
  });
});

describe("스킬 검토 공통 몫(명세 ⑭ O-1 · O-2 · O-7 · O-11, PM d-150)", () => {
  it("O-7: busy면 단추가 막히고(disabled) aria-busy, 흐림 0.45 규칙. busy가 아니면 막히지 않는다", () => {
    const onClick = vi.fn();
    render(
      <>
        <PrimaryButton busy onClick={onClick}>
          저장 중
        </PrimaryButton>
        <SecondaryButton busy>보조</SecondaryButton>
        <TextButton busy>글</TextButton>
        <PrimaryButton>저장</PrimaryButton>
      </>,
    );
    for (const name of ["저장 중", "보조", "글"]) {
      const b = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.getAttribute("aria-busy")).toBe("true");
    }
    fireEvent.click(screen.getByRole("button", { name: "저장 중" }));
    expect(onClick).not.toHaveBeenCalled();
    const idle = screen.getByRole("button", { name: "저장" }) as HTMLButtonElement;
    expect(idle.disabled).toBe(false);
    expect(idle.getAttribute("aria-busy")).toBeNull();
    expect(CSS).toMatch(/\.btn\[aria-busy="true"\] \{[^}]*opacity:\s*0\.45/);
  });

  it("O-7: S8-a 저장 응답 전까지 주 단추가 「저장 중」 + 막힘, 두 번 눌러도 저장 호출은 한 번", async () => {
    let resolve: (v: { ok: true; data: { ratios: RatioItem[] } }) => void = () => {};
    const api = fakeApi({ saveRatios: vi.fn(() => new Promise((r) => (resolve = r))) });
    mountMe(api);
    await openS8a();
    const save = within(dialog()!).getByRole("button", { name: "저장" });
    await act(async () => fireEvent.click(save));
    const busy = within(dialog()!).getByRole("button", { name: "저장 중" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    await act(async () => fireEvent.click(busy));
    expect(api.saveRatios).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true, data: { ratios: [] } }));
    expect(dialog()).toBeNull();
  });

  it("O-1: −/+ 누름 틀 44×44(보이는 원 32 그대로), 목표 비율 줄 간격 48. O-2: 글 단추 누름 높이 44(.text-tap) — 머리 「닫기」·「균등 배분」·「건너뛰기」", async () => {
    expect(CSS).toMatch(/\.step-btn \{ inline-size: 44px; block-size: 44px; \}/);
    expect(CSS).toMatch(/\.ratio-row \{ min-height: 48px;/);
    expect(CSS).toMatch(/\.btn\.text-tap, \.text-tap \{[^}]*min-height:\s*44px/);
    render(<BackHeader title="오늘 기록" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "닫기" }).classList.contains("text-tap")).toBe(true);
    cleanup();
    mountOnboarding();
    expect(screen.getByRole("button", { name: "건너뛰기" }).classList.contains("text-tap")).toBe(true);
    click("다음");
    click("다음");
    expect(screen.getByRole("button", { name: "균등 배분" }).classList.contains("text-tap")).toBe(true);
  });

  it("O-11: 겹친 창·시트·확인 창은 불투명도로 서서히 나타난다(자리 움직임 없음 — 동작 줄이기에도 같다)", () => {
    expect(CSS).toMatch(/@keyframes duno-fade-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/);
    expect(CSS).toMatch(/\.detail, \.evening-todo-sheet, \.close-confirm, \.close-confirm-backdrop, \.evening-todo-backdrop \{ animation: duno-fade-in 160ms ease-out; \}/);
    expect(CSS).not.toMatch(/@keyframes duno-overlay-in/); // 자리를 옮기는 나타남은 두지 않는다
  });
});
