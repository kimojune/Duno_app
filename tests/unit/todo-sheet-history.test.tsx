// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayRead } from "../../lib/today-types";
import { FakeHistory } from "./fake-history";
import { expectConfirmShape, LEAVE } from "./confirm-helpers";

/**
 * C-D2 뒤로 가기로 창 닫기 — history 칸에 표시가 남는 경우(고침 1/2의 1번, 고침 2/2의 1·3번).
 * 가짜 history가 칸마다 state·만든 문서를 갖고 back·forward·새로고침(새 문서)을 따라 한다(fake-history.ts).
 * 기대: 어느 경우든 창이 열려 있으면 첫 뒤로 가기에 창이 닫히고(글 남김), 그 사이 문서를 다시 불러오지 않으며
 * (popstate 없는 문서 간 이동 = 글 잃음), 앱 칸을 떠나는 것은 창이 닫힌 뒤다.
 * 받아들인 것: 새로고침·앞으로 가기·「닫기」 직후 다시 열기 뒤에는 창이 닫힌 뒤 앱을 떠나기까지 뒤로 가기를 한 번 더
 * 눌러야 할 수 있다(옛 창 칸이 하나 남는다). 글을 잃는 것보다 낫다(고침 2/2 지시).
 * 고침9 O-3(PM d-150 가, 23 133:2): 글을 적었거나 분야를 바꾼 창은 「닫기」·Esc·뒤로 가기가 먼저 확인(「저장하지 않고 나갈까요?」)을 띄운다.
 * 뒤로 가기는 확인을 띄우고 history.forward()로 창의 칸에 돌아간다(칸 index 그대로). 「계속 적기」 뒤 다시 뒤로 가기 → 같은 확인,
 * 「나가기」 → 창만 닫고(글은 남음 — C8) 창의 칸 하나를 거둔다. 빈 창은 지금처럼 바로 닫힌다(확인 없음).
 */

vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../lib/read-client", () => ({ fetchToday: vi.fn(() => new Promise(() => {})) }));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { SHEET_HISTORY_MARK, TodoScreen } from "../../components/todo-screen";

const DAY = { date: "2026-11-05", year: 2026, month: 11, dayOfMonth: 5, weekday: 4 };
const INITIAL: TodayRead = {
  todos: { ok: true, data: { day: DAY, todos: [] } },
  categories: { ok: true, data: { categories: [] } },
};
/** Next App Router가 첫 칸에 넣어 두는 내부 state를 흉내 낸다(보존돼야 한다) */
const NEXT_STATE = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "x" } };

const sheet = () => screen.queryByRole("form", { name: "할 일 적기" });
const openButton = () => screen.getByRole("button", { name: /^(할 일 적기|적던 글 이어 적기)$/ });
const todoInput = () => screen.getByRole("textbox", { name: "할 일 적기" }) as HTMLInputElement;
function open() {
  fireEvent.click(openButton());
}
function type(text: string) {
  fireEvent.change(todoInput(), { target: { value: text } });
}
function mount() {
  return render(<TodoScreen initial={INITIAL} />);
}
/** 새로고침: 지금 칸이 새 문서의 칸이 되고(state는 남음) 화면을 새로 그린다 */
function reload(history: FakeHistory) {
  cleanup();
  history.reload();
  mount();
}

const confirm = () => screen.queryByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });

/** 고침9 O-3: 바꾼 것이 있는 창의 「닫기」 → 확인 → 「나가기」 */
function closeWithConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(confirm(), "바꾼 것이 있으면 「닫기」는 확인").not.toBeNull();
  expect(sheet(), "확인이 떠도 창은 열린 채").not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "나가기" }));
  expect(confirm()).toBeNull();
}

/**
 * 고침9 O-3: 바꾼 것이 있는 창에서 뒤로 가기 → 확인이 뜨고 창의 칸으로 돌아온다(index 그대로) → 「계속 적기」 뒤 열린 채 →
 * 다시 뒤로 가기 → 같은 확인 → 「나가기」 → 창의 칸 하나만 거두고 닫힌다(앱 안)
 */
function backConfirmThenLeave(history: FakeHistory) {
  const at = history.index;
  history.userBack();
  history.flush(); // 확인을 띄우며 부른 forward()가 돈다
  expect(confirm(), "바꾼 것이 있으면 뒤로 가기는 확인").not.toBeNull();
  expect(sheet(), "확인이 떠도 창은 열린 채").not.toBeNull();
  expect(history.index, "창의 칸으로 돌아온다").toBe(at);
  fireEvent.click(screen.getByRole("button", { name: "계속 적기" }));
  expect(confirm()).toBeNull();
  expect(sheet(), "「계속 적기」 뒤 열린 채").not.toBeNull();
  history.userBack();
  history.flush();
  expect(confirm(), "다시 뒤로 가기 → 같은 확인").not.toBeNull();
  expect(history.index).toBe(at);
  fireEvent.click(screen.getByRole("button", { name: "나가기" }));
  history.flush(); // 「나가기」가 부른 back()
  expect(history.index, "창의 칸 하나만 거둔다").toBe(at - 1);
  expect(history.leftApp, "앱 밖으로 나가지 않는다").toBe(false);
}

/** 창이 닫혀 있고 단추 글이 「적던 글 이어 적기」다(문서를 다시 불러오지 않았다). 같은 글인지는 부르는 쪽이 다시 열어 본다 */
function expectClosedWithText(history: FakeHistory) {
  expect(history.leftDocument, "문서를 다시 불러오지 않는다(글 잃음 없음)").toBe(0);
  expect(sheet(), "창이 닫힌다").toBeNull();
  expect(history.leftApp).toBe(false);
  expect(openButton().textContent).toBe("적던 글 이어 적기");
}

/**
 * 창이 열린 채 뒤로 가기(글이 있음): 확인 → 「계속 적기」 → 다시 확인 → 「나가기」로 창이 닫히고(글 남김, 문서 그대로 — 고침9 O-3), 그 뒤 뒤로 가기를 더 누르면 문서를 다시
 * 불러오지 않고(이 시험 안의 칸은 모두 지금 문서의 칸이거나 첫 칸) 결국 앱 칸을 떠난다. 다시 열면 같은 글.
 */
function expectBackClosesThenLeaves(history: FakeHistory, text: string) {
  expect(sheet()).not.toBeNull();
  backConfirmThenLeave(history);
  expectClosedWithText(history);
  for (let i = 0; i < 3 && !history.leftApp && history.leftDocument === 0; i += 1) {
    history.userBack();
    expect(sheet(), "창은 다시 열리지 않는다").toBeNull();
  }
  expect(history.leftApp || history.leftDocument > 0, "더 누르면 앱 칸을 떠난다").toBe(true);
  history.leftApp = false;
  history.leftDocument = 0;
  open();
  expect(todoInput().value).toBe(text);
}

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("C-D2 history 표시가 칸에 남는 경우", () => {
  it("ㄱ 창을 연 채 새로고침 → 다시 열고 「닫기」: 문서를 다시 불러오지 않고 창이 닫히며 글이 남는다", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    type("새로고침 전 글");
    reload(history); // 표시가 붙은 칸에서 새로고침(글은 기기에 두지 않아 사라진다, D6)
    expect(sheet()).toBeNull();
    open();
    type("새로고침 뒤 글");
    closeWithConfirm(); // 고침9 O-3: 글이 있으니 확인 → 「나가기」
    history.flush(); // 「나가기」의 back()이 돈다
    expectClosedWithText(history);
    open();
    expect(todoInput().value).toBe("새로고침 뒤 글");
  });

  it("ㄱ 창을 연 채 새로고침 → 다시 열고 뒤로 가기: 문서를 다시 불러오지 않고 첫 뒤로 가기에 창이 닫히며 글이 남는다", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    type("새로고침 전 글");
    reload(history);
    open();
    type("새로고침 뒤 글");
    backConfirmThenLeave(history); // 고침9 O-3: 첫 뒤로 가기는 확인, 「나가기」에 닫힘
    expectClosedWithText(history);
    open();
    expect(todoInput().value).toBe("새로고침 뒤 글");
  });

  it("ㄱ 같은 흐름에서 창이 열린 채의 뒤로 가기는 앱 칸을 떠나기 전에 창부터 닫는다", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    reload(history);
    open();
    type("새로고침 뒤 글");
    expectBackClosesThenLeaves(history, "새로고침 뒤 글");
  });

  it("ㄴ 뒤로 가기로 닫음 → 앞으로 가기로 표시 칸에 돌아옴 → 다시 열고 뒤로 가기: 같다", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    type("적던 글");
    backConfirmThenLeave(history); // 고침9 O-3
    expect(sheet()).toBeNull();
    history.userForward(); // 표시가 붙은 칸으로 돌아옴. 창은 저절로 열리지 않는다
    expect(sheet()).toBeNull();
    open();
    expectBackClosesThenLeaves(history, "적던 글");
  });

  for (const target of ["run", "call"] as const) {
    const when = target === "run" ? "돌 때 기준" : "부를 때 기준";
    it(`ㄷ 「닫기」 직후(back()의 popstate가 오기 전) 다시 열기: 늦게 온 popstate가 새 창을 닫지 않는다 (back 대상: ${when})`, () => {
      const history = new FakeHistory(NEXT_STATE, target).install();
      mount();
      open();
      type("이어 적을 글");
      closeWithConfirm(); // 고침9 O-3
      expect(history.back).toHaveBeenCalledTimes(1);
      open(); // back()이 아직 돌지 않았다
      history.flush(); // 이제야 back()의 popstate가 온다
      expect(sheet(), "늦게 온 popstate가 새로 연 창을 닫지 않는다").not.toBeNull();
      expectBackClosesThenLeaves(history, "이어 적을 글");
    });

    it(`겹침: 열기·닫기·열기·닫기가 첫 back()의 popstate 전에 겹쳐도 앱 칸을 떠나지 않는다 (back 대상: ${when})`, () => {
      const history = new FakeHistory(NEXT_STATE, target).install();
      mount();
      open();
      type("겹친 글");
      closeWithConfirm(); // 고침9 O-3
      open();
      closeWithConfirm();
      expect(history.back).toHaveBeenCalledTimes(2);
      history.flush();
      expect(history.leftApp, "둘째 back이 앱 칸을 떠나지 않는다").toBe(false);
      expectClosedWithText(history);
      // 그 뒤에도 열고 뒤로 가기는 창부터 닫는다
      open();
      expectBackClosesThenLeaves(history, "겹친 글");
    });
  }

  it("Next 내부 state는 보존되고, 표시는 열기마다 새 값이다(옛 표시를 복사하지 않는다)", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    const first = history.state as Record<string, unknown>;
    expect(first.__NA).toBe(true);
    expect(first.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual({ tree: "x" });
    expect(typeof first[SHEET_HISTORY_MARK]).toBe("string");
    history.userBack();
    expect(history.state).toEqual(NEXT_STATE); // 첫 칸은 그대로
    open();
    const second = history.state as Record<string, unknown>;
    expect(second.__NA).toBe(true);
    expect(second[SHEET_HISTORY_MARK]).not.toBe(first[SHEET_HISTORY_MARK]);
  });

  it("창을 열 때는 늘 새 칸을 쌓는다(옛 표시 칸에서도 replaceState로 그 칸을 바꿔 쓰지 않는다)", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    reload(history);
    const before = history.entries.length;
    open();
    expect(history.entries.length).toBe(before + 1);
    expect(history.replaceState).not.toHaveBeenCalled();
    const top = history.state as Record<string, unknown>;
    const below = history.entries[history.index - 1].state as Record<string, unknown>;
    expect(top[SHEET_HISTORY_MARK]).not.toBe(below[SHEET_HISTORY_MARK]); // 옛 표시는 옮겨 붙이지 않는다
    expect(top.__NA).toBe(true);
  });

  it("고침9 O-3: 빈 창은 「닫기」·뒤로 가기가 확인 없이 바로 닫힌다(칸 index·포커스 그대로)", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    expect(history.index).toBe(1);
    type("   "); // 띄어쓰기만은 바꾼 것이 아니다
    history.userBack();
    expect(confirm()).toBeNull();
    expect(sheet()).toBeNull();
    expect(history.index).toBe(0);
    expect(document.activeElement).toBe(openButton());
    open();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(confirm()).toBeNull();
    expect(sheet()).toBeNull();
    history.flush();
    expect(history.index).toBe(0);
    expect(history.leftApp).toBe(false);
  });

  it("고침9 O-3 · 고침10 B: 글이 있으면 뒤로 가기 → 확인(초점 제목, 위 「나가기」·아래 「계속 적기」) → 「계속 적기」 → 열린 채·글 그대로 → 확인이 뜬 채 뒤로 가기 = 「계속 적기」 → 다시 뒤로 가기 → 확인 → 「나가기」 → 닫힘·글 남음·앱 안", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    type("확인 볼 글");
    expect(history.index).toBe(1);
    history.userBack();
    history.flush();
    expect(confirm()).not.toBeNull();
    expectConfirmShape(confirm()!, LEAVE.top, LEAVE.bottom);
    expect(history.index).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "계속 적기" }));
    expect(todoInput().value).toBe("확인 볼 글");
    // 고침10 B: 확인이 뜬 채 안드로이드 뒤로 가기 = 아래 「계속 적기」(확인만 닫히고 창·글·칸 그대로)
    history.userBack();
    history.flush();
    expect(confirm()).not.toBeNull();
    history.userBack();
    history.flush();
    expect(confirm(), "확인이 뜬 채 뒤로 가기는 확인만 닫는다").toBeNull();
    expect(todoInput().value).toBe("확인 볼 글");
    expect(history.index).toBe(1);
    expect(history.leftApp).toBe(false);
    history.userBack();
    history.flush();
    expect(confirm()).not.toBeNull();
    expect(history.index).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "나가기" }));
    history.flush();
    expect(history.index).toBe(0);
    expectClosedWithText(history);
    expect(history.leftDocument).toBe(0);
    history.userBack();
    expect(history.leftApp, "창이 닫힌 뒤의 뒤로 가기는 앱을 떠난다").toBe(true);
  });

  it("「닫기」로 닫으면 back()으로 연 칸을 거두고, 그 popstate가 와도 창은 닫힌 채·앱은 그대로", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    history.flush();
    expect(history.index).toBe(0);
    expect(sheet()).toBeNull();
    expect(history.leftApp).toBe(false);
    history.userBack();
    expect(history.leftApp).toBe(true); // 창이 없으면 첫 뒤로 가기에 앱을 떠난다
  });
});
