// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayRead } from "../../lib/today-types";
import { FakeHistory } from "./fake-history";

/**
 * C-D2 뒤로 가기로 창 닫기 — history 칸에 표시가 남는 경우(고침 1/2의 1번).
 * 가짜 history가 칸마다 state를 갖고 back·forward·새로고침을 따라 한다(fake-history.ts).
 * 기대: 어느 경우든 창이 열려 있으면 첫 뒤로 가기에 창이 닫히고(글 남김), 그다음 뒤로 가기에서만 앱 칸을 떠난다.
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
function open() {
  fireEvent.click(openButton());
}
function type(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: text } });
}
function mount() {
  return render(<TodoScreen initial={INITIAL} />);
}
/** 새로고침: 칸과 state는 남고 문서(화면)만 새로 */
function reload() {
  cleanup();
  mount();
}

/** 창이 열린 채 뒤로 가기를 누르면 창이 닫히고(글 남김), 다음 뒤로 가기에서야 앱을 떠난다 */
function expectBackClosesThenLeaves(history: FakeHistory, text: string) {
  expect(sheet()).not.toBeNull();
  history.userBack();
  expect(sheet(), "첫 뒤로 가기에 창이 닫힌다").toBeNull();
  expect(history.leftApp).toBe(false);
  expect(openButton().textContent).toBe("적던 글 이어 적기"); // 글은 남는다
  history.userBack();
  expect(history.leftApp, "그다음 뒤로 가기에서 앱 칸을 떠난다").toBe(true);
  // 다시 열면 같은 글
  history.leftApp = false;
  open();
  expect((screen.getByRole("textbox", { name: "할 일 적기" }) as HTMLInputElement).value).toBe(text);
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
  it("ㄱ 창을 연 채 새로고침 → 다시 열고 뒤로 가기: 첫 뒤로 가기에 창이 닫히고, 그다음에 앱을 떠난다", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    type("새로고침 전 글");
    reload(); // 표시가 붙은 칸에서 새로고침(글은 기기에 두지 않아 사라진다, D6)
    expect(sheet()).toBeNull();
    open();
    type("새로고침 뒤 글");
    expectBackClosesThenLeaves(history, "새로고침 뒤 글");
  });

  it("ㄴ 뒤로 가기로 닫음 → 앞으로 가기로 표시 칸에 돌아옴 → 다시 열고 뒤로 가기: 같다", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    type("적던 글");
    history.userBack();
    expect(sheet()).toBeNull();
    history.userForward(); // 표시가 붙은 칸으로 돌아옴. 창은 저절로 열리지 않는다
    expect(sheet()).toBeNull();
    open();
    expectBackClosesThenLeaves(history, "적던 글");
  });

  for (const target of ["run", "call"] as const) {
    it(`ㄷ 「닫기」 직후(back()의 popstate가 오기 전) 다시 열기: 늦게 온 popstate가 새 창을 닫지 않는다 (back 대상: ${target === "run" ? "돌 때 기준" : "부를 때 기준"})`, () => {
      const history = new FakeHistory(NEXT_STATE, target).install();
      mount();
      open();
      type("이어 적을 글");
      fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
      expect(history.back).toHaveBeenCalledTimes(1);
      open(); // back()이 아직 돌지 않았다
      history.flush(); // 이제야 back()의 popstate가 온다
      expect(sheet(), "늦게 온 popstate가 새로 연 창을 닫지 않는다").not.toBeNull();
      expectBackClosesThenLeaves(history, "이어 적을 글");
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

  it("「닫기」로 닫으면 back()으로 연 칸을 거두고, 그 popstate가 와도 창은 닫힌 채·앱은 그대로", () => {
    const history = new FakeHistory(NEXT_STATE).install();
    mount();
    open();
    fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    history.flush();
    expect(history.index).toBe(0);
    expect(sheet()).toBeNull();
    expect(history.leftApp).toBe(false);
    history.userBack();
    expect(history.leftApp).toBe(true); // 창이 없으면 첫 뒤로 가기에 앱을 떠난다
  });
});
