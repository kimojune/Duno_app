// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddCategoryResult, CategoryItem } from "../../lib/categories/types";
import type { TodayRead } from "../../lib/today-types";
import type { TodoDay, TodoItem, TodoResult } from "../../lib/todos/types";
import { FakeHistory } from "./fake-history";

/**
 * 방향 C(디자인 명세 12절) 적는 창·분야 칩 시험. 상태 C1~C26 가운데 「코드」로 확인하는 칸, D-125 개발 항목 넷,
 * C-D2·C-D4·C-D6·D10·조합 중 엔터, 화면 쪽 악용 시나리오 1~5. 쓰기 Action과 다시 읽기는 가짜다.
 */

const addTodo = vi.fn();
const setTodoDone = vi.fn();
const addCategory = vi.fn();
const fetchToday = vi.fn();
const signOut = vi.fn();
vi.mock("../../app/todos/actions", () => ({
  addTodo: (...a: unknown[]) => addTodo(...a),
  setTodoDone: (...a: unknown[]) => setTodoDone(...a),
  addCategory: (...a: unknown[]) => addCategory(...a),
}));
vi.mock("../../lib/read-client", () => ({ fetchToday: (...a: unknown[]) => fetchToday(...a) }));
vi.mock("../../app/actions", () => ({ signOut: (...a: unknown[]) => signOut(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { CATEGORY_ADD_TIMEOUT_MS, SAVE_TIMEOUT_MS, TodoScreen } from "../../components/todo-screen";
import { TodoView, type TodoViewProps } from "../../components/todo-view";

const DAY: TodoDay = { date: "2026-11-05", year: 2026, month: 11, dayOfMonth: 5, weekday: 4 };
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const CAT_WORK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAT_GYM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAT_CS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * 화면에 보이는 글만 센다(화면 읽기용 안내 영역 .sr-only는 뺀다 — todo-offline.test.tsx와 같은 방식, 고침8 검토).
 * 실패·끊김 안내는 보이는 줄과 안내 영역이 같은 글을 담는데, 안내 영역은 announce(…, { again: true })가 비운 뒤 100ms 뒤에 채운다.
 * 그래서 시험이 빠르면 한 곳, 느리면(전체 시험이 몰려 도는 때) 두 곳에서 잡혀 getByText가 「여러 개」로 가끔 실패했다.
 * 보이는 줄은 정확히 하나여야 한다(개수를 단언한다). 「없다」도 보이는 줄 0개로 센다: 안내 영역은 앞서 알린 글을 늦게 채워 남겨 두므로
 * (그 내용은 liveText()로 따로 본다) 전체 queryByText(…).toBeNull()은 느린 실행에서만 걸렸다(todo-offline.test.tsx 131줄과 같은 방식).
 */
function visibleTexts(text: string): HTMLElement[] {
  return screen.queryAllByText(text).filter((el) => !el.closest(".sr-only"));
}
/** 보이는 줄이 정확히 하나일 때 그것 */
function oneVisible(text: string): HTMLElement {
  const found = visibleTexts(text);
  expect(found).toHaveLength(1);
  return found[0];
}
/** 보이는 줄이 정확히 하나가 될 때까지 기다린다(findByText 대신) */
async function findOneVisible(text: string): Promise<HTMLElement> {
  await waitFor(() => expect(visibleTexts(text)).toHaveLength(1));
  return visibleTexts(text)[0];
}
function cat(id: string, name: string): CategoryItem {
  return { id, readable: true, name, createdAt: "2026-11-01T00:00:00.000Z" };
}
const CATS = [cat(CAT_WORK, "취업 준비"), cat(CAT_GYM, "운동"), cat(CAT_CS, "CS 공부")];
function item(id: string, text: string, categoryId: string | null = null, done = false): TodoItem {
  return { id, readable: true, text, done, createdAt: "2026-11-05T01:00:00.000Z", categoryId };
}
function read(todos: TodoItem[], categories: CategoryItem[] | "error" = CATS): TodayRead {
  return {
    todos: { ok: true, data: { day: DAY, todos } },
    categories: categories === "error" ? { ok: false, error: "unavailable" } : { ok: true, data: { categories } },
  };
}
const ok = <T,>(data: T): TodoResult<T> => ({ ok: true, data });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const added = (id: string, name: string): AddCategoryResult => ({ ok: true, data: { category: cat(id, name) } });

function renderScreen(initial: TodayRead = read([])) {
  return render(<TodoScreen initial={initial} />);
}
const openButton = () => screen.getByRole("button", { name: /^(할 일 적기|적던 글 이어 적기)$/ });
const todoInput = () => screen.getByRole("textbox", { name: "할 일 적기" }) as HTMLInputElement;
const newCategoryInput = () => screen.getByRole("textbox", { name: "새 분야 이름" }) as HTMLInputElement;
const chip = (name: string) => within(chipGroup()).getByRole("button", { name });
const chipGroup = () => screen.getByRole("group", { name: "분야 (고르지 않으면 기타)" });
const addCategoryChip = () => screen.getByRole("button", { name: "+ 분야" });
const liveText = () => (document.querySelector(".sr-only[role=status]") as HTMLElement).textContent ?? "";
const catNotice = () => (document.querySelector(".cat-notice") as HTMLElement).textContent ?? "";

function open() {
  fireEvent.click(openButton());
}
function typeTodo(text: string) {
  fireEvent.change(todoInput(), { target: { value: text } });
}
function typeCategory(text: string) {
  fireEvent.change(newCategoryInput(), { target: { value: text } });
}
const pressAdd = () => fireEvent.click(screen.getByRole("button", { name: /^(더하기|더하는 중)$/ }));
const pressWrite = () => fireEvent.click(screen.getByRole("button", { name: "적기" }));
function setOnline(value: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
}
/** 안드로이드 뒤로 가기: 앞 칸으로 돌아가 popstate가 온다 */
function browserBack() {
  act(() => {
    window.history.replaceState(null, "");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
}

let pushState: ReturnType<typeof vi.spyOn>;
let back: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const m of [addTodo, setTodoDone, addCategory, fetchToday, signOut]) m.mockReset();
  fetchToday.mockResolvedValue(read([]));
  setOnline(true);
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState(null, "");
  pushState = vi.spyOn(window.history, "pushState");
  back = vi.spyOn(window.history, "back").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("C1 기본(창 닫힘)·C5 창 열림", () => {
  it("C1 단추 하나: 접근 이름이 보이는 글과 같고, 「+」 그림은 화면 읽기에서 숨는다", () => {
    renderScreen(read([item(ID_A, "첫 글")]));
    const button = openButton();
    expect(button.textContent).toBe("할 일 적기");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("form", { name: "할 일 적기" })).toBeNull();
  });

  it("C5 단추를 누르면 단추가 숨고 창이 열리며 포커스는 할 일 칸(같은 누름 안에서)", () => {
    renderScreen();
    open();
    expect(screen.queryByRole("button", { name: "할 일 적기" })).toBeNull(); // 둘 중 하나만 보인다
    expect(screen.getByRole("form", { name: "할 일 적기" })).toBeTruthy();
    expect(document.activeElement).toBe(todoInput());
  });

  it("C5 라벨이 칸 위에 있고(플레이스홀더 없음), 「닫기」의 접근 이름은 「적는 창 닫기」, 칩 묶음은 group", () => {
    renderScreen();
    open();
    const input = todoInput();
    expect(input.getAttribute("placeholder")).toBeNull();
    const label = document.querySelector("label[for=todo-input]")!;
    expect(label.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const close = screen.getByRole("button", { name: "적는 창 닫기" });
    expect(close.textContent).toBe("닫기");
    expect(chipGroup().getAttribute("aria-labelledby")).toBe("category-label");
    expect(within(chipGroup()).getAllByRole("button").map((b) => b.textContent)).toEqual(["취업 준비", "운동", "CS 공부", "+ 분야"]);
  });

  it("C5 창은 모달이 아니다: aria-modal·inert가 없고, 창을 연 채 목록 체크 칸을 누를 수 있다", async () => {
    renderScreen(read([item(ID_A, "목록 글")]));
    open();
    expect(document.querySelector("[aria-modal]")).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    setTodoDone.mockResolvedValue(ok({ id: ID_A, done: true }));
    fireEvent.click(screen.getByRole("checkbox", { name: "목록 글" }));
    await waitFor(() => expect(setTodoDone).toHaveBeenCalledWith(ID_A, true));
    expect(screen.getByRole("form", { name: "할 일 적기" })).toBeTruthy();
  });

  it("포커스 순서(DOM 순서, 고침 4바퀴): 로그아웃 → 목록 → 창(닫기 → 할 일 칸 → 적기 → 칩 → + 분야)", () => {
    renderScreen(read([item(ID_A, "목록 글")]));
    open();
    const order = [
      document.getElementById("logout-button")!,
      screen.getByRole("checkbox", { name: "목록 글" }),
      screen.getByRole("button", { name: "적는 창 닫기" }),
      todoInput(),
      screen.getByRole("button", { name: "적기" }),
      chip("취업 준비"),
      chip("운동"),
      chip("CS 공부"),
      addCategoryChip(),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}번째`).toBeTruthy();
    }
  });

  it("창 안에서 키보드가 닿는 것은 정확히 이 순서다: 닫기 → 할 일 칸 → 적기 → 칩들 → + 분야 (탭 순서를 바꾸는 tabindex 없음)", () => {
    renderScreen();
    open();
    const form = screen.getByRole("form", { name: "할 일 적기" });
    const focusables = [...form.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")].filter(
      (el) => !(el as HTMLButtonElement).disabled && el.getAttribute("tabindex") !== "-1",
    );
    expect(focusables.every((el) => el.getAttribute("tabindex") === null), "tabindex로 순서를 바꾸지 않는다").toBe(true);
    expect(focusables.map((el) => el.id || el.textContent)).toEqual(["sheet-close", "todo-input", "적기", "취업 준비", "운동", "CS 공부", "add-category-chip"]);
  });

  it("창 안 위에서 아래 구조: 머리(할 일 적기 라벨·닫기) → 글 칸 줄 → 도움말 → 분야 라벨 → 칩 줄 → 안내", () => {
    renderScreen();
    open();
    const form = screen.getByRole("form", { name: "할 일 적기" });
    const parts = [
      form.querySelector(".sheet-head")!,
      form.querySelector(".input-row")!,
      form.querySelector("#todo-help")!,
      form.querySelector("#category-label")!,
      chipGroup(),
      form.querySelector(".cat-notice")!,
    ];
    expect(parts.every(Boolean)).toBe(true);
    for (let i = 1; i < parts.length; i += 1) {
      expect(parts[i - 1].compareDocumentPosition(parts[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}번째`).toBeTruthy();
    }
    // 글 칸의 라벨은 머리에 있고, 칩 묶음의 이름은 분야 라벨이다
    expect(form.querySelector(".sheet-head label[for=todo-input]")!.textContent).toBe("할 일 적기");
    expect(document.getElementById("category-label")!.textContent).toBe("분야 (고르지 않으면 기타)");
    expect(chipGroup().getAttribute("aria-labelledby")).toBe("category-label");
  });

  it("새 분야 줄이 열려도 글 칸이 위, 새 분야 줄이 그 아래다", () => {
    renderScreen();
    open();
    fireEvent.click(addCategoryChip());
    const form = screen.getByRole("form", { name: "할 일 적기" });
    expect(todoInput().compareDocumentPosition(newCategoryInput()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(form.querySelector(".newcat")).not.toBeNull();
    expect(form.querySelector(".chip-row")).toBeNull();
  });
});

describe("C2·C3·C4 목록 상태와 칩 줄(C9·C10·C11)", () => {
  it("C2 불러오는 중에도 단추로 적을 수 있고, 창의 칩 줄은 C9(「+ 분야」 없음), 이때 적은 할 일은 기타", async () => {
    fetchToday.mockReturnValue(new Promise(() => {}));
    render(<TodoScreen />);
    expect(document.querySelector(".todo-skeleton")).toBeTruthy();
    open();
    expect(screen.getByText("분야를 불러오는 중").getAttribute("role")).toBe("status");
    expect(screen.queryByRole("button", { name: "+ 분야" })).toBeNull();
    addTodo.mockReturnValue(new Promise(() => {}));
    typeTodo("불러오는 중에 적은 글");
    pressWrite();
    expect(addTodo.mock.calls[0][2]).toBeNull();
  });

  it("C3 빈 목록의 둘째 줄이 창 닫힘·열림에 따라 바뀐다, 0개 중 0개", () => {
    renderScreen(read([]));
    expect(screen.getByText("0개 중 0개 끝냄", { exact: false })).toBeTruthy();
    expect(screen.getByText("아래 단추를 눌러 적어 보세요.")).toBeTruthy();
    open();
    expect(screen.getByText("아래 칸에 적어 보세요.")).toBeTruthy();
    expect(screen.queryByText("아래 단추를 눌러 적어 보세요.")).toBeNull();
  });

  it("C4 목록 실패(T9)에도 단추가 있고, 창의 칩 줄은 C10(「+ 분야」 없음, 「다시 불러오기」는 할 일과 분야를 함께)", async () => {
    renderScreen({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } });
    expect(screen.getByText("할 일을 불러오지 못했어요.").closest("[role=alert]")).toBeTruthy();
    open();
    const line = screen.getByText("분야를 불러오지 못했어요. 지금 적으면 기타로 들어가요.");
    expect(line.getAttribute("role")).toBe("status");
    expect(screen.queryByRole("button", { name: "+ 분야" })).toBeNull();
    fetchToday.mockResolvedValue(read([item(ID_A, "돌아온 글")]));
    fireEvent.click(within(line.parentElement!).getByRole("button", { name: "다시 불러오기" }));
    expect(await screen.findByText("돌아온 글")).toBeTruthy();
    expect(chip("운동")).toBeTruthy();
    expect(document.activeElement).toBe(todoInput()); // 사라진 단추의 포커스는 할 일 칸으로
  });

  it("C10 오프라인이면 「인터넷에 연결되면 분야를 불러올게요.」(다시 불러오기 없음)", () => {
    setOnline(false);
    renderScreen(read([], "error"));
    open();
    expect(screen.getByText("인터넷에 연결되면 분야를 불러올게요.")).toBeTruthy();
    expect(screen.queryByText("분야를 불러오지 못했어요. 지금 적으면 기타로 들어가요.")).toBeNull();
  });

  it("C10 로그인이 풀렸으면 T13 Notice가 앞선다(머리 아래 alert)", () => {
    renderScreen({ todos: { ok: false, error: "unauthenticated" }, categories: { ok: false, error: "unauthenticated" } });
    open();
    const alert = screen.getByText("로그인이 풀렸어요. 다시 로그인해 주세요.").closest("[role=alert]")!;
    const line = screen.getByText("분야를 불러오지 못했어요. 지금 적으면 기타로 들어가요.");
    expect(alert.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("C11 분야가 하나도 없으면 칩 줄에 「+ 분야」 하나(예시 칩 없음, D-132)", () => {
    renderScreen(read([], []));
    open();
    expect(within(chipGroup()).getAllByRole("button").map((b) => b.textContent)).toEqual(["+ 분야"]);
    expect(screen.getByText("분야 (고르지 않으면 기타)")).toBeTruthy();
  });
});

describe("C6 분야 고름·C7 적은 뒤 (D-125 ①)", () => {
  it("C6 고른 칩은 언제나 0개나 1개, 다시 누르면 풀림, aria-pressed와 체크 그림이 같다", () => {
    renderScreen();
    open();
    const pressedState = () =>
      within(chipGroup())
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-pressed"))
        .map((b) => {
          const pressed = b.getAttribute("aria-pressed") === "true";
          expect(pressed).toBe(b.querySelector(".chip-check") !== null); // 보이는 상태(체크 그림) = aria-pressed
          return pressed;
        });
    expect(pressedState().filter(Boolean)).toHaveLength(0);
    fireEvent.click(chip("운동"));
    expect(pressedState()).toEqual([false, true, false]);
    fireEvent.click(chip("취업 준비"));
    expect(pressedState()).toEqual([true, false, false]);
    fireEvent.click(chip("취업 준비"));
    expect(pressedState()).toEqual([false, false, false]);
    expect(addCategoryChip().hasAttribute("aria-pressed")).toBe(false); // 「+ 분야」는 고르는 칩이 아니다
  });

  it("C7 적은 뒤에도 창은 열린 채, 할 일 칸은 비고 포커스는 칸, 모든 칩 aria-pressed=false, 새 줄에 분야 표시", async () => {
    renderScreen(read([item(ID_A, "있던 글")]));
    open();
    const d = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValue(d.promise);
    fireEvent.click(chip("운동"));
    typeTodo("저녁에 30분 걷기");
    pressWrite();
    expect(addTodo.mock.calls[0]).toEqual([expect.any(String), "저녁에 30분 걷기", CAT_GYM]); // C-D6 분야 번호를 함께
    expect(screen.getByRole("form", { name: "할 일 적기" })).toBeTruthy();
    expect(todoInput().value).toBe("");
    expect(document.activeElement).toBe(todoInput());
    for (const b of within(chipGroup()).getAllByRole("button").filter((x) => x.hasAttribute("aria-pressed"))) {
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
    // C-D6: 저장 중 줄에도 분야 표시를 바로 그린다
    const newRow = screen.getByText("저녁에 30분 걷기").closest("li")!;
    expect(within(newRow).getByText("운동")).toBeTruthy();
    expect(newRow.querySelector(".category-tag .sr-only")?.textContent).toBe("분야 ");
    d.resolve(ok({ day: DAY, todo: item(addTodo.mock.calls[0][0], "저녁에 30분 걷기", CAT_GYM) }));
    await waitFor(() => expect(liveText()).toBe("할 일을 저장했어요"));
    expect(newRow.parentElement!.lastElementChild).toBe(newRow); // 목록 끝
  });

  it("목록 줄 체크 칸의 aria-describedby에 분야 표시가 있고, 저장 중이면 안내도 함께 잇는다", () => {
    renderScreen(read([item(ID_A, "분야 있는 글", CAT_WORK), item(ID_B, "기타 글")]));
    const withTag = screen.getByRole("checkbox", { name: "분야 있는 글" });
    const ids = withTag.getAttribute("aria-describedby")!.split(" ");
    expect(ids.map((i) => document.getElementById(i)?.textContent)).toEqual(["분야 취업 준비"]);
    expect(screen.getByRole("checkbox", { name: "기타 글" }).getAttribute("aria-describedby")).toBeNull(); // 기타는 붙이지 않는다
    open();
    fireEvent.click(chip("운동"));
    addTodo.mockReturnValue(new Promise(() => {}));
    typeTodo("저장 중인 글");
    pressWrite();
    const saving = screen.getByRole("checkbox", { name: "저장 중인 글" });
    const texts = saving.getAttribute("aria-describedby")!.split(" ").map((i) => document.getElementById(i)?.textContent);
    expect(texts).toEqual(["분야 운동", "저장하는 중"]);
  });

  it("C-D6 「다시」(T7)는 처음과 같은 분야 번호로 보낸다", async () => {
    renderScreen();
    open();
    addTodo.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    fireEvent.click(chip("취업 준비"));
    typeTodo("이력서 고치기");
    pressWrite();
    await findOneVisible("저장하지 못했어요.");
    addTodo.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "다시" }));
    expect(addTodo.mock.calls[1]).toEqual([addTodo.mock.calls[0][0], "이력서 고치기", CAT_WORK]);
  });
});

describe("C8 닫은 뒤 글이 남음 (D-125 ②)·C-D2 뒤로 가기", () => {
  async function fillAndClose(how: "button" | "esc" | "back") {
    renderScreen();
    open();
    fireEvent.click(chip("운동"));
    typeTodo("적다 만 글");
    if (how === "button") fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    else if (how === "esc") fireEvent.keyDown(todoInput(), { key: "Escape" });
    else browserBack();
  }

  for (const how of ["button", "esc", "back"] as const) {
    it(`C8 ${how}: 글·고른 분야가 남고 단추 글은 「적던 글 이어 적기」, 포커스는 단추, 다시 열면 같은 글·같은 고름`, async () => {
      await fillAndClose(how);
      expect(screen.queryByRole("form", { name: "할 일 적기" })).toBeNull();
      const button = screen.getByRole("button", { name: "적던 글 이어 적기" });
      expect(document.activeElement).toBe(button);
      fireEvent.click(button);
      expect(todoInput().value).toBe("적다 만 글");
      expect(chip("운동").getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(todoInput());
    });
  }

  it("C-D2 열 때 pushState 한 칸, 「닫기」·Esc로 닫으면 history.back()으로 거두고, 뒤로 가기로 닫으면 back을 부르지 않는다", () => {
    // back()이 실제로 한 칸 돌아가 popstate를 보내는 가짜 history(칸마다 state, fake-history.ts)
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    setOnline(true);
    const history = new FakeHistory().install();
    renderScreen();
    open();
    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(typeof (history.state as Record<string, unknown>).dunoTodoSheet).toBe("string"); // 열기마다 고유한 표시
    fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    expect(history.back).toHaveBeenCalledTimes(1);
    history.flush(); // back()이 한 칸 돌아간다
    expect(history.index).toBe(0);
    open();
    fireEvent.keyDown(todoInput(), { key: "Escape" });
    expect(history.pushState).toHaveBeenCalledTimes(2);
    expect(history.back).toHaveBeenCalledTimes(2);
    history.flush();
    open();
    history.userBack();
    expect(history.back).toHaveBeenCalledTimes(2); // 뒤로 가기는 이미 칸을 떠났다
    expect(screen.queryByRole("form", { name: "할 일 적기" })).toBeNull();
    expect(history.index).toBe(0);
    expect(history.leftApp).toBe(false);
  });

  it("C-D2 창을 연 채 다시 불러오기·새벽 4시가 와도 history가 두 칸 쌓이지 않는다", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-05T18:59:00Z")); // 서울 03:59
    renderScreen(read([item(ID_A, "어제 글")]));
    open();
    typeTodo("밤에 쓰던 글");
    fetchToday.mockResolvedValue({
      todos: { ok: true, data: { day: { date: "2026-11-06", year: 2026, month: 11, dayOfMonth: 6, weekday: 5 }, todos: [] } },
      categories: { ok: true, data: { categories: CATS } },
    });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.setSystemTime(new Date("2026-11-05T19:00:05Z"));
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    });
    expect(screen.getByText(/11월 6일 금요일/)).toBeTruthy();
    expect(fetchToday).toHaveBeenCalledTimes(2);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("form", { name: "할 일 적기" })).toBeTruthy(); // 창 상태 그대로(T15)
    expect(todoInput().value).toBe("밤에 쓰던 글");
  });

  it("닫을 때 포커스가 목록 체크 칸에 있었으면 그대로 둔다", () => {
    renderScreen(read([item(ID_A, "목록 글")]));
    open();
    const box = screen.getByRole("checkbox", { name: "목록 글" });
    box.focus();
    browserBack();
    expect(screen.queryByRole("form", { name: "할 일 적기" })).toBeNull();
    expect(document.activeElement).toBe(box);
  });

  it("분야만 골라 두면 단추 글은 「할 일 적기」 그대로(고름은 남는다), 새 분야 칸 글만 있어도 「적던 글 이어 적기」", () => {
    renderScreen();
    open();
    fireEvent.click(chip("운동"));
    fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    expect(openButton().textContent).toBe("할 일 적기");
    open();
    expect(chip("운동").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(addCategoryChip());
    typeCategory("자격증");
    fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    expect(openButton().textContent).toBe("적던 글 이어 적기");
    open();
    expect(document.activeElement).toBe(newCategoryInput()); // 새 분야 줄이 열려 있었으면 새 분야 칸
    expect(newCategoryInput().value).toBe("자격증");
  });
});

describe("C12~C20 분야 더하기", () => {
  function openNewCategory() {
    renderScreen();
    open();
    typeTodo("할 일 칸 글");
    fireEvent.click(addCategoryChip());
  }

  it("C12 「+ 분야」 → 칩 줄 자리가 새 분야 줄로, 포커스는 새 분야 칸, 할 일 칸 글 그대로, 엔터 = 「더하기」", () => {
    openNewCategory();
    expect(screen.queryByRole("group", { name: "분야 (고르지 않으면 기타)" })).toBeNull();
    expect(document.activeElement).toBe(newCategoryInput());
    expect(todoInput().value).toBe("할 일 칸 글");
    addCategory.mockReturnValue(new Promise(() => {}));
    typeCategory("자격증");
    fireEvent.keyDown(newCategoryInput(), { key: "Enter" });
    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(addCategory.mock.calls[0][1]).toBe("자격증");
    expect(addTodo).not.toHaveBeenCalled(); // 엔터가 「적기」로 가지 않는다
  });

  it("C13 더하는 중: 글이 「더하는 중」, aria-busy, LiveRegion, 연타해도 요청 하나(악용 3)", () => {
    openNewCategory();
    addCategory.mockReturnValue(new Promise(() => {}));
    typeCategory("자격증");
    pressAdd();
    pressAdd();
    pressAdd();
    expect(addCategory).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole("button", { name: "더하는 중" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(liveText()).toBe("분야를 더하는 중");
    expect(addCategory.mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/); // 화면이 만든 요청 ID
  });

  it("C14 더함: 새 칩이 「+ 분야」 바로 앞에 생기고 골라진 채, 포커스는 할 일 칸, LiveRegion, 칩 줄이 밀린다", async () => {
    openNewCategory();
    addCategory.mockImplementation(async (id: string) => added(id, "자격증"));
    typeCategory("  자격증 ");
    pressAdd();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "새 분야 이름" })).toBeNull());
    const names = within(chipGroup()).getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["취업 준비", "운동", "CS 공부", "자격증", "+ 분야"]);
    expect(chip("자격증").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(todoInput());
    expect(liveText()).toBe("분야를 더하고 골랐어요: 자격증");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
    expect(todoInput().value).toBe("할 일 칸 글");
  });

  it("C15 빈 이름: 요청이 나가지 않고 포커스가 새 분야 칸에 남는다", () => {
    openNewCategory();
    typeCategory("   ");
    pressAdd();
    expect(addCategory).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(newCategoryInput());
  });

  it("C16 15자부터 「15/20」, 넘으면 넘음 문구, maxlength 없음, 눌러도 보내지 않고 포커스가 칸에", () => {
    openNewCategory();
    const help = () => document.getElementById("newcat-help")!.textContent;
    typeCategory("가".repeat(14));
    expect(help()).toBe("");
    typeCategory("가".repeat(15));
    expect(help()).toBe("15/20");
    typeCategory("가".repeat(23));
    expect(help()).toBe("20자까지 적을 수 있어요. 지금 23자예요.");
    expect(newCategoryInput().getAttribute("maxlength")).toBeNull();
    expect(newCategoryInput().value).toBe("가".repeat(23)); // 몰래 자르지 않는다
    expect(newCategoryInput().getAttribute("aria-describedby")).toBe("newcat-help");
    pressAdd();
    expect(addCategory).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(newCategoryInput());
  });

  it("C17 화면이 먼저 아는 같은 이름(「cs 공부」=「CS 공부」): 요청 없이 그 칩을 고르고 한 줄 안내, 포커스는 할 일 칸", () => {
    openNewCategory();
    typeCategory("cs  공부");
    pressAdd();
    expect(addCategory).not.toHaveBeenCalled();
    expect(chip("CS 공부").getAttribute("aria-pressed")).toBe("true");
    expect(catNotice()).toBe("이미 있는 분야라서 골랐어요: CS 공부");
    expect(document.querySelector(".cat-notice")!.getAttribute("role")).toBe("status");
    expect(document.activeElement).toBe(todoInput());
    // 다음 동작(칩 누름)을 하면 사라진다
    fireEvent.click(chip("운동"));
    expect(catNotice()).toBe("");
  });

  it("C17 서버가 같은 이름으로 거절(다른 기기에서 만든 분야): 돌려받은 분야를 칩 끝에 더하고 고른다", async () => {
    openNewCategory();
    const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    addCategory.mockResolvedValue({ ok: false, error: "duplicate", existing: { id: other, name: "독서" } });
    typeCategory("독서");
    pressAdd();
    await waitFor(() => expect(catNotice()).toBe("이미 있는 분야라서 골랐어요: 독서"));
    expect(chip("독서").getAttribute("aria-pressed")).toBe("true");
    expect(within(chipGroup()).getAllByRole("button").map((b) => b.textContent).slice(-2)).toEqual(["독서", "+ 분야"]);
  });

  it("C18 「기타」(공백·조합형 포함): 분야를 만들지 않고 고름을 모두 풀며 한 줄 안내", () => {
    renderScreen();
    open();
    fireEvent.click(chip("운동"));
    fireEvent.click(addCategoryChip());
    typeCategory(" 기타 ".normalize("NFD"));
    pressAdd();
    expect(addCategory).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "새 분야 이름" })).toBeNull();
    expect(chip("운동").getAttribute("aria-pressed")).toBe("false");
    expect(catNotice()).toBe("기타는 더하지 않아도 돼요. 분야를 고르지 않으면 기타로 들어가요.");
    expect(document.activeElement).toBe(todoInput());
  });

  it("C19 실패: 이름이 남고 도움말(role=status), 다시 누르면 같은 요청 ID로 보내 분야는 하나", async () => {
    openNewCategory();
    addCategory.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    typeCategory("자격증");
    pressAdd();
    const help = await screen.findByText("분야를 더하지 못했어요. 다시 눌러 주세요.");
    expect(help.getAttribute("role")).toBe("status");
    expect(newCategoryInput().value).toBe("자격증");
    addCategory.mockImplementationOnce(async (id: string) => added(id, "자격증"));
    pressAdd();
    await waitFor(() => expect(chip("자격증")).toBeTruthy());
    expect(addCategory.mock.calls[1][0]).toBe(addCategory.mock.calls[0][0]); // 같은 요청 ID(C-D4)
    expect(within(chipGroup()).getAllByText("자격증")).toHaveLength(1);
  });

  it("C19a 더하다가 로그인 풀림: T13 Notice(alert), C19 문구 없음, 이름 그대로, 복사에 할 일 칸 글과 새 분야 이름", async () => {
    openNewCategory();
    addCategory.mockResolvedValue({ ok: false, error: "unauthenticated" });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    typeCategory("자격증");
    pressAdd();
    const alert = await screen.findByText(/로그인이 풀렸어요\. 다시 로그인하면 이 화면을 떠나서/);
    expect(alert.closest("[role=alert]")).toBeTruthy();
    expect(screen.queryByText("분야를 더하지 못했어요. 다시 눌러 주세요.")).toBeNull();
    expect(newCategoryInput().value).toBe("자격증");
    fireEvent.click(screen.getByRole("button", { name: "저장 안 된 글 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("할 일 칸 글\n자격증"));
  });

  it("T13(할 일 저장 401)의 복사에는 새 분야 칸 이름을 넣지 않는다(12-5)", async () => {
    renderScreen();
    open();
    fireEvent.click(addCategoryChip());
    typeCategory("자격증");
    addTodo.mockResolvedValue({ ok: false, error: "unauthenticated" });
    typeTodo("저장 못 한 글");
    pressWrite();
    await screen.findByText(/로그인이 풀렸어요/);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "저장 안 된 글 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("저장 못 한 글"));
  });

  it("C20 분야 50개: 「+ 분야」를 누르면 새 분야 줄 대신 한 줄 안내(비활성 아님), 요청 없음", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => cat(`0000${String(i).padStart(4, "0")}-0000-4000-8000-000000000000`, `분야 ${i}`));
    renderScreen(read([], fifty));
    open();
    const add = addCategoryChip();
    expect(add.hasAttribute("disabled")).toBe(false);
    expect(add.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(add);
    expect(screen.queryByRole("textbox", { name: "새 분야 이름" })).toBeNull();
    expect(catNotice()).toBe("분야는 50개까지 둘 수 있어요.");
  });

  it("C20 서버가 51번째를 거절하면 C19가 아니라 한도 문구(새 분야 칸 아래)", async () => {
    openNewCategory();
    addCategory.mockResolvedValue({ ok: false, error: "category_limit" });
    typeCategory("하나 더");
    pressAdd();
    expect(await screen.findByText("분야는 50개까지 둘 수 있어요.")).toBeTruthy();
    expect(screen.queryByText("분야를 더하지 못했어요. 다시 눌러 주세요.")).toBeNull();
    expect(newCategoryInput().value).toBe("하나 더");
  });
});

describe("C13·C-D4 시간 제한과 늦은 응답", () => {
  async function renderFake() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderScreen();
    await act(async () => {});
    open();
    fireEvent.click(addCategoryChip());
  }

  it("15초(임시) 안에 답이 없으면 C19, 늦게 성공하면 C19를 거두고 칩을 더해 고른다(하나만)", async () => {
    await renderFake();
    const d = deferred<AddCategoryResult>();
    addCategory.mockReturnValueOnce(d.promise);
    typeCategory("자격증");
    pressAdd();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATEGORY_ADD_TIMEOUT_MS - 1);
    });
    expect(screen.queryByText("분야를 더하지 못했어요. 다시 눌러 주세요.")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("분야를 더하지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "더하기" })).toBeTruthy(); // 다시 누를 수 있다
    d.resolve(added(addCategory.mock.calls[0][0], "자격증"));
    await act(async () => {});
    expect(screen.queryByText("분야를 더하지 못했어요. 다시 눌러 주세요.")).toBeNull();
    expect(chip("자격증").getAttribute("aria-pressed")).toBe("true");
    expect(CATEGORY_ADD_TIMEOUT_MS).toBe(SAVE_TIMEOUT_MS);
  });

  it("「취소」 뒤 성공하면 칩이 생기고 골라진다(만든 것을 숨기지 않는다)", async () => {
    await renderFake();
    const d = deferred<AddCategoryResult>();
    addCategory.mockReturnValueOnce(d.promise);
    typeCategory("자격증");
    pressAdd();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(document.activeElement).toBe(addCategoryChip()); // 「취소」 → 「+ 분야」
    d.resolve(added(addCategory.mock.calls[0][0], "자격증"));
    await act(async () => {});
    expect(chip("자격증").getAttribute("aria-pressed")).toBe("true");
  });

  it("「취소」 뒤 실패하면 아무것도 띄우지 않는다", async () => {
    await renderFake();
    const d = deferred<AddCategoryResult>();
    addCategory.mockReturnValueOnce(d.promise);
    typeCategory("자격증");
    pressAdd();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    d.resolve({ ok: false, error: "unavailable" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATEGORY_ADD_TIMEOUT_MS + 100);
    });
    expect(screen.queryByText("분야를 더하지 못했어요. 다시 눌러 주세요.")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "새 분야 이름" })).toBeNull();
    expect(catNotice()).toBe("");
  });

  it("창을 닫고 응답이 오지 않아도 15초 뒤 「더하는 중」은 풀리고 알림은 띄우지 않는다", async () => {
    await renderFake();
    addCategory.mockReturnValueOnce(deferred<AddCategoryResult>().promise); // 끝내 답이 오지 않는다
    typeCategory("자격증");
    pressAdd();
    expect(screen.getByRole("button", { name: "더하는 중" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATEGORY_ADD_TIMEOUT_MS + 100);
    });
    open();
    expect(screen.queryByRole("button", { name: "더하는 중" })).toBeNull();
    expect(screen.getByRole("button", { name: "더하기" })).toBeTruthy();
    expect(screen.queryByText("분야를 더하지 못했어요. 다시 눌러 주세요.")).toBeNull();
  });

  it("창을 닫은 뒤 실패하면 아무것도 띄우지 않고, 창을 닫은 뒤 성공하면 조용히(알림 없이) 칩이 생긴다", async () => {
    await renderFake();
    const fail = deferred<AddCategoryResult>();
    addCategory.mockReturnValueOnce(fail.promise);
    typeCategory("자격증");
    pressAdd();
    fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    fail.resolve({ ok: false, error: "unavailable" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATEGORY_ADD_TIMEOUT_MS + 100);
    });
    open();
    expect(screen.queryByText("분야를 더하지 못했어요. 다시 눌러 주세요.")).toBeNull();
    expect(newCategoryInput().value).toBe("자격증"); // 닫아도 새 분야 칸 글은 남는다(12-5)

    const success = deferred<AddCategoryResult>();
    addCategory.mockReturnValueOnce(success.promise);
    pressAdd();
    fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    const liveBefore = liveText();
    success.resolve(added(addCategory.mock.calls[1][0], "자격증"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(liveText()).toBe(liveBefore); // 창이 닫혀 있으면 조용히
    open();
    expect(chip("자격증").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("C21 오프라인·C22·C23 긴 글과 이름·C24 칩 줄", () => {
  it("C21 오프라인에서 「적기」·「더하기」를 눌러도 글·이름·고름이 지워지지 않고 안내가 뜬다", () => {
    renderScreen();
    open();
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    fireEvent.click(chip("운동"));
    typeTodo("지하철에서 적은 글");
    pressWrite();
    expect(addTodo).not.toHaveBeenCalled();
    expect(todoInput().value).toBe("지하철에서 적은 글");
    expect(document.getElementById("todo-help")!.textContent).toBe("인터넷에 연결되면 적을 수 있어요. 적은 글은 그대로 있어요.");
    expect(chip("운동").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(addCategoryChip());
    typeCategory("자격증");
    pressAdd();
    expect(addCategory).not.toHaveBeenCalled();
    expect(screen.getByText("인터넷에 연결되면 분야를 더할 수 있어요. 적은 이름은 그대로 있어요.").getAttribute("role")).toBe("status");
    expect(newCategoryInput().value).toBe("자격증");
    expect(oneVisible("인터넷 연결이 끊겼어요. 연결되면 적고 끝냄 표시를 할 수 있어요.").closest("[role=status]")).toBeTruthy();
  });

  it("C22 분야 표시가 붙은 200자 할 일: 표시는 글 아래(DOM 순서), 줄바꿈 클래스", () => {
    const long = "가".repeat(100) + "나".repeat(100);
    renderScreen(read([item(ID_A, long, CAT_WORK)]));
    const rowEl = screen.getByText(long).closest("li")!;
    const text = rowEl.querySelector(".todo-text")!;
    const tag = rowEl.querySelector(".category-tag")!;
    expect(text.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rowEl.querySelector(".check-hit")!.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("C23 20자 이름: 칩의 접근 이름과 목록 분야 표시는 전체 이름(말줄임은 CSS만)", () => {
    const name = "토익스피킹레벨칠목표반복연습하기매일아침";
    expect([...name]).toHaveLength(20);
    const longId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    renderScreen(read([item(ID_A, "말하기 연습", longId)], [cat(longId, name)]));
    expect(screen.getByText(name, { selector: ".category-tag" })).toBeTruthy();
    open();
    expect(chip(name).textContent).toBe(name);
    expect(chip(name).querySelector(".chip-label")).toBeTruthy();
  });

  it("C24 키보드로 칩에 포커스가 가면 그 칩이 보이게 밀린다(inline nearest)", () => {
    renderScreen();
    open();
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    fireEvent.focus(chip("CS 공부"));
    expect(scroll).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
    expect(chipGroup().classList.contains("chip-row")).toBe(true);
  });

  it("풀 수 없는 분야 이름은 칩에 보이지 않고, 목록 분야 표시는 「읽을 수 없는 분야」", () => {
    const hidden = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    renderScreen({
      todos: { ok: true, data: { day: DAY, todos: [item(ID_A, "가려진 분야 글", hidden)] } },
      categories: { ok: true, data: { categories: [...CATS, { id: hidden, readable: false, name: null, createdAt: "2026-11-01T00:00:00.000Z" }] } },
    });
    expect(screen.getByText("읽을 수 없는 분야")).toBeTruthy();
    open();
    expect(within(chipGroup()).getAllByRole("button")).toHaveLength(4); // 셋 + 「+ 분야」
  });
});

describe("포커스가 갈 곳·Esc·조합 중 엔터", () => {
  it("Esc: 새 분야 칸에서는 새 분야 줄만 닫고(이름 버림) 포커스는 「+ 분야」, 그 밖에서는 창을 닫는다", () => {
    renderScreen();
    open();
    typeTodo("남길 글");
    fireEvent.click(addCategoryChip());
    typeCategory("버릴 이름");
    fireEvent.keyDown(newCategoryInput(), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "새 분야 이름" })).toBeNull();
    expect(document.activeElement).toBe(addCategoryChip());
    fireEvent.click(addCategoryChip());
    expect(newCategoryInput().value).toBe("");
    fireEvent.keyDown(todoInput(), { key: "Escape" });
    expect(screen.queryByRole("form", { name: "할 일 적기" })).toBeNull();
    open();
    expect(todoInput().value).toBe("남길 글");
  });

  it("한글 조합 중(isComposing·keyCode 229)의 엔터는 「적기」·「더하기」로 치지 않는다", () => {
    renderScreen();
    open();
    addTodo.mockReturnValue(new Promise(() => {}));
    typeTodo("조합 중인 글");
    fireEvent.keyDown(todoInput(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(todoInput(), { key: "Enter", keyCode: 229 });
    expect(addTodo).not.toHaveBeenCalled();
    fireEvent.keyDown(todoInput(), { key: "Enter" });
    expect(addTodo).toHaveBeenCalledTimes(1);
    fireEvent.click(addCategoryChip());
    addCategory.mockReturnValue(new Promise(() => {}));
    typeCategory("자격");
    fireEvent.keyDown(newCategoryInput(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(newCategoryInput(), { key: "Escape", isComposing: true }); // 조합 중 Esc도 줄을 닫지 않는다
    expect(addCategory).not.toHaveBeenCalled();
    expect(newCategoryInput().value).toBe("자격");
    fireEvent.keyDown(newCategoryInput(), { key: "Enter" });
    expect(addCategory).toHaveBeenCalledTimes(1);
  });
});

describe("D10 다시 불러오기는 창 상태를 건드리지 않는다", () => {
  it("할 일 칸 글·새 분야 칸 글·고른 분야·창 열림 그대로, 목록과 칩만 새로", async () => {
    renderScreen(read([item(ID_A, "처음 글")]));
    open();
    fireEvent.click(chip("운동"));
    typeTodo("쓰던 글");
    fireEvent.click(addCategoryChip());
    typeCategory("쓰던 이름");
    fetchToday.mockResolvedValue(read([item(ID_A, "처음 글"), item(ID_B, "다른 기기 글")], [...CATS, cat("99999999-9999-4999-8999-999999999999", "새 칩")]));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("다른 기기 글")).toBeTruthy();
    expect(todoInput().value).toBe("쓰던 글");
    expect(newCategoryInput().value).toBe("쓰던 이름");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(chip("운동").getAttribute("aria-pressed")).toBe("true");
    expect(chip("새 칩")).toBeTruthy();
  });

  it("고른 분야가 다시 불러온 목록에 없으면 고름만 푼다", async () => {
    renderScreen();
    open();
    fireEvent.click(chip("운동"));
    fetchToday.mockResolvedValue(read([], [cat(CAT_WORK, "취업 준비")]));
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(within(chipGroup()).queryByRole("button", { name: "운동" })).toBeNull());
    expect(chip("취업 준비").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("form", { name: "할 일 적기" })).toBeTruthy();
  });
});

describe("로그아웃 확인이 닫힌 창의 글도 센다 (D-125 ④, C-D9)", () => {
  it("창을 닫은 채 할 일 칸 글만 있어도 확인", () => {
    renderScreen();
    open();
    typeTodo("닫힌 창의 글");
    fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(screen.getByText("아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.").closest("[role=alert]")).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("창을 닫은 채 새 분야 칸 글만 있어도 확인, 둘 다 없으면 바로 로그아웃", () => {
    renderScreen();
    open();
    fireEvent.click(addCategoryChip());
    typeCategory("이름만");
    fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(screen.getByText("아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.")).toBeTruthy();
    fireEvent.click(within(screen.getByText("아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.").closest("[role=alert]") as HTMLElement).getByRole("button", { name: "취소" }));
    open();
    fireEvent.click(screen.getByRole("button", { name: "취소" })); // 새 분야 줄을 닫으면 이름은 버려진다
    fireEvent.click(screen.getByRole("button", { name: "적는 창 닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("악용 시나리오(화면 쪽)", () => {
  it("1: 꺾쇠·스크립트·따옴표가 든 분야 이름은 칩·분야 표시에 글자 그대로, 요소가 생기지 않는다", () => {
    const evil = `"><img src=x onerror="window.__c=1"><script>window.__d=1</script>`;
    const evilId = "12121212-1212-4212-8212-121212121212";
    renderScreen(read([item(ID_A, "글", evilId)], [cat(evilId, evil)]));
    expect(screen.getByText(evil, { selector: ".category-tag" })).toBeTruthy();
    open();
    expect(chip(evil).textContent).toBe(evil);
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("2: 서버가 남의 분야 번호를 거절(invalid_category)하면 T7 「저장하지 못했어요」", async () => {
    renderScreen();
    open();
    addTodo.mockResolvedValue({ ok: false, error: "invalid_category" });
    fireEvent.click(chip("운동"));
    typeTodo("남의 분야로 보내진 글");
    pressWrite();
    await findOneVisible("저장하지 못했어요.");
    expect(screen.getByText("남의 분야로 보내진 글")).toBeTruthy();
  });

  it("3: 「할 일 적기」·「적기」·「더하기」 연타 — 창 하나·history 한 칸, 적기 한 번, 더하기 요청 하나", () => {
    renderScreen();
    // 같은 렌더의 단추를 두 번 누른다. 첫 누름이 flushSync로 단추를 바로 떼어 내므로, 같은 DOM 노드에 click을 두 번 보내면
    // 둘째는 React 뿌리까지 올라가지 못해 시험이 비게 된다. 그래서 그 렌더의 onClick(React가 노드에 둔 props)을 한 act 안에서 두 번 부른다.
    const button = openButton();
    const reactProps = Object.entries(button).find(([k]) => k.startsWith("__reactProps$"))?.[1] as { onClick: () => void };
    expect(typeof reactProps?.onClick).toBe("function");
    const replaceState = vi.spyOn(window.history, "replaceState");
    let firstMark: unknown;
    act(() => {
      reactProps.onClick();
      firstMark = (window.history.state as Record<string, unknown>).dunoTodoSheet;
      reactProps.onClick();
    });
    expect(screen.getAllByRole("form", { name: "할 일 적기" })).toHaveLength(1);
    // 창 열기 가드(sheetOpenRef)가 둘째 누름을 무시한다: 칸을 더 쌓지도, 연 칸의 표시를 바꿔 쓰지도 않는다
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(replaceState).not.toHaveBeenCalled();
    expect((window.history.state as Record<string, unknown>).dunoTodoSheet).toBe(firstMark);
    addTodo.mockReturnValue(new Promise(() => {}));
    typeTodo("연타 글");
    pressWrite();
    pressWrite();
    pressWrite();
    expect(addTodo).toHaveBeenCalledTimes(1);
    fireEvent.click(addCategoryChip());
    addCategory.mockReturnValue(new Promise(() => {}));
    typeCategory("연타 분야");
    pressAdd();
    pressAdd();
    expect(addCategory).toHaveBeenCalledTimes(1);
  });

  it("4: 화면 코드가 기기 저장소(localStorage·sessionStorage·IndexedDB·Cache API)를 쓰지 않는다(정적 확인, D6)", () => {
    const roots = ["components", "lib", "app"].map((d) => path.resolve(__dirname, "../..", d));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(10); // 양성 대조: 실제로 파일을 읽었다
    // 실제 API 접근(이름 뒤 . 또는 [)만 센다. 「기기에 두지 않는다」는 설명 주석의 낱말은 세지 않는다
    // 고침 3바퀴(기기 먼저 저장, PM d-69 「클라이언트에서 저장」)가 이 규칙(D6)을 바꿨다: 기기 저장소(IndexedDB)는 한 모듈(lib/local/kv.ts)만 직접 만진다.
    // 화면 코드·서버 코드·그 밖의 모든 파일은 여전히 기기 저장소에 닿지 못한다(허용 목록이 한 파일이라 규칙이 약해지지 않는다)
    const offenders = files
      .filter((f) => /\b(localStorage|sessionStorage|indexedDB|caches)\s*[.[]/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(path.resolve(__dirname, "../.."), f).split(path.sep).join("/"));
    expect(offenders).toEqual(["lib/local/kv.ts"]);
  });

  it("4: 적고 분야를 더해도 Storage.setItem을 부르지 않는다", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderScreen();
    open();
    fireEvent.click(addCategoryChip());
    addCategory.mockImplementation(async (id: string) => added(id, "기기에 두지 않는 분야"));
    typeCategory("기기에 두지 않는 분야");
    pressAdd();
    await waitFor(() => expect(chip("기기에 두지 않는 분야")).toBeTruthy());
    addTodo.mockResolvedValue(ok({ day: DAY, todo: item(ID_A, "기기에 두지 않는 글") }));
    typeTodo("기기에 두지 않는 글");
    pressWrite();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("5: 창을 연 채 뒤로 가기를 여러 번 — 창은 한 번 닫히고, 그 뒤 popstate는 아무것도 하지 않으며 history를 더 쌓지 않는다", () => {
    renderScreen(read([item(ID_A, "글")]));
    open();
    typeTodo("남는 글");
    browserBack();
    browserBack();
    browserBack();
    expect(screen.queryByRole("form", { name: "할 일 적기" })).toBeNull();
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "적던 글 이어 적기" })).toBeTruthy();
    // 앞으로 가기로 창 칸에 돌아와도(state에 표시가 있음) 창을 열지 않고 아무 일도 없다
    act(() => {
      window.history.replaceState({ dunoTodoSheet: true }, "");
      window.dispatchEvent(new PopStateEvent("popstate", { state: { dunoTodoSheet: true } }));
    });
    expect(screen.queryByRole("form", { name: "할 일 적기" })).toBeNull();
  });
});

describe("낭독 영역(2-6·4.1.3): role=status는 안내 전부터 있고, 같은 요소의 글만 바뀐다", () => {
  it("칩 줄 아래 한 줄 안내(C17·C18): 창을 열 때부터 빈 role=status가 있고, 안내가 나오면 그 요소의 글이 바뀐다", () => {
    renderScreen();
    open();
    const region = document.querySelector(".cat-notice") as HTMLElement;
    expect(region).not.toBeNull();
    expect(region.getAttribute("role")).toBe("status");
    expect(region.textContent).toBe("");
    fireEvent.click(addCategoryChip());
    typeCategory("운동");
    pressAdd(); // C17(화면이 먼저 아는 같은 이름)
    expect(document.querySelector(".cat-notice")).toBe(region); // 같은 요소
    expect(region.textContent).toBe("이미 있는 분야라서 골랐어요: 운동");
    fireEvent.click(addCategoryChip());
    typeCategory("기타");
    pressAdd(); // C18
    expect(document.querySelector(".cat-notice")).toBe(region);
    expect(region.textContent).toBe("기타는 더하지 않아도 돼요. 분야를 고르지 않으면 기타로 들어가요.");
  });

  it("새 분야 칸 도움말(C19·C21): 새 분야 줄을 열 때부터 빈 role=status가 있고, 실패·오프라인 안내는 그 요소의 글만 바뀐다. 셈은 낭독 영역 밖", async () => {
    renderScreen();
    open();
    fireEvent.click(addCategoryChip());
    const region = document.querySelector("#newcat-help [role=status]") as HTMLElement;
    expect(region).not.toBeNull();
    expect(region.textContent).toBe("");
    typeCategory("가".repeat(15));
    expect(document.getElementById("newcat-help")!.textContent).toBe("15/20");
    expect(region.textContent).toBe(""); // 글자 셈은 낭독 영역에 넣지 않는다
    addCategory.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    typeCategory("자격증");
    pressAdd();
    await waitFor(() => expect(region.textContent).toBe("분야를 더하지 못했어요. 다시 눌러 주세요."));
    expect(document.querySelector("#newcat-help [role=status]")).toBe(region); // C19: 같은 요소
    setOnline(false);
    typeCategory("자격증 시험");
    expect(region.textContent).toBe("");
    pressAdd();
    expect(document.querySelector("#newcat-help [role=status]")).toBe(region); // C21: 같은 요소
    expect(region.textContent).toBe("인터넷에 연결되면 분야를 더할 수 있어요. 적은 이름은 그대로 있어요.");
  });

  it("빈 안내 자리를 display:none으로 숨기지 않는다(접근성 트리에서 빠지지 않게, 정적 확인)", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
    // 정규식 이스케이프에 기대지 않는다: 공백류를 모두 지운 뒤 단순 문자열로 찾는다
    const flat = [...css].filter((ch) => ch.trim() !== "").join("");
    expect(flat).toContain(".cat-notice{"); // 양성 대조: 규칙 자체는 읽혔다
    let at = flat.indexOf(".cat-notice:empty");
    while (at !== -1) {
      // 선택자 목록 안에 있어도 그 규칙 덩어리({ … })를 본다
      const open = flat.indexOf("{", at);
      const close = flat.indexOf("}", open);
      expect(flat.slice(open, close + 1)).not.toContain("display:none");
      at = flat.indexOf(".cat-notice:empty", close);
    }
  });
});

describe("C-D11 scroll-padding-bottom을 창 높이에 맞춰 다시 잰다(TodoView)", () => {
  const noop = () => {};
  const base: TodoViewProps = {
    day: DAY,
    list: "ready",
    rows: [],
    online: true,
    offlineHelp: false,
    sessionLost: false,
    hasUnsaved: false,
    logoutConfirm: false,
    live: "",
    sheetOpen: false,
    draft: "",
    resume: false,
    categories: "ready",
    chips: [],
    selectedCategoryId: null,
    categoryNotice: "",
    newCategoryOpen: false,
    newCategoryDraft: "",
    addingCategory: false,
    newCategoryHelp: null,
    onOpenSheet: noop,
    onCloseSheet: noop,
    onDraftChange: noop,
    onSubmit: noop,
    onToggleChip: noop,
    onOpenNewCategory: noop,
    onNewCategoryDraftChange: noop,
    onAddCategory: noop,
    onCancelNewCategory: noop,
    onToggle: noop,
    onRetry: noop,
    onRemove: noop,
    onReload: noop,
    onLogout: noop,
    onLogoutConfirm: noop,
    onLogoutCancel: noop,
    onCopy: noop,
    onRelogin: noop,
  };
  const clearance = () => document.documentElement.style.getPropertyValue("--bottom-clearance");

  it("닫힘은 88px + 탭 줄 높이(없으면 안전 영역), 열림은 창 높이 + 16px, 창 높이가 바뀌면(ResizeObserver) 다시 잰다", () => {
    let height = 213;
    vi.spyOn(HTMLFormElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ height }) as DOMRect);
    const callbacks: (() => void)[] = [];
    class FakeObserver {
      constructor(cb: () => void) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", FakeObserver);
    const { rerender, unmount } = render(<TodoView {...base} />);
    expect(clearance()).toBe("calc(88px + var(--tabbar-h, env(safe-area-inset-bottom)))");
    rerender(<TodoView {...base} sheetOpen />);
    expect(clearance()).toBe("calc(229px + env(safe-area-inset-bottom))");
    height = 301; // 새 분야 줄이 열려 창이 높아짐
    act(() => callbacks.forEach((cb) => cb()));
    expect(clearance()).toBe("calc(317px + env(safe-area-inset-bottom))");
    rerender(<TodoView {...base} />);
    expect(clearance()).toBe("calc(88px + var(--tabbar-h, env(safe-area-inset-bottom)))");
    unmount();
    expect(clearance()).toBe("");
    vi.unstubAllGlobals();
  });
});

describe("고침 5바퀴: 분야 칩 줄은 한 줄이고 넘치면 옆으로 넘긴다(두 줄 감싸기를 대신한다, 명세 ⑦-1)", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
  /** `선택자 { … }` 규칙 하나의 안쪽(주석 제외, 그 선택자만 단독으로 쓴 첫 규칙) */
  const rule = (selector: string) => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const chunk of stripped.split("}")) {
      const open = chunk.indexOf("{");
      if (open !== -1 && chunk.slice(0, open).trim() === selector) return chunk.slice(open + 1);
    }
    return "";
  };

  it("CSS: 한 줄(nowrap), 가로로 넘김(overflow-x auto), 세로로는 밀지 않음(overflow-y hidden), 높이 상한 없음(칩 하나 높이), 띠 24px", () => {
    const row = rule(".chip-row");
    expect(row, ".chip-row 규칙을 읽었다").toContain("display: flex");
    expect(row).toMatch(/flex-wrap:\s*nowrap/);
    expect(row, "두 줄 감싸기가 남지 않았다").not.toMatch(/flex-wrap:\s*wrap/);
    expect(row).toMatch(/overflow-x:\s*auto/);
    expect(row).toMatch(/overflow-y:\s*hidden/);
    expect(row, "옛 두 줄 높이 상한이 남지 않았다").not.toMatch(/max-height/);
    // 키보드로 옮긴 칩이 옅어지는 띠(24px) 밖으로 나오게
    expect(row).toMatch(/scroll-padding-inline:\s*24px/);
    // 넘친 쪽 끝 24px이 옅어진다(오른쪽만 · 왼쪽만 · 양쪽)
    const fadeEnd = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.chip-scroller\[data-more-end\]\s*>\s*\.chip-row\s*\{([^}]*)\}/);
    expect(fadeEnd, "오른쪽 띠 규칙이 있다").not.toBeNull();
    expect(fadeEnd![1]).toMatch(/(^|[^-])mask-image:\s*linear-gradient\(to right, black calc\(100% - 24px\), transparent\)/);
    // 「‹」「›」 누름 48 · 보이는 면 32
    expect(rule(".chip-nav")).toMatch(/inline-size:\s*var\(--tap-min\)/);
    expect(rule(".chip-nav")).toMatch(/block-size:\s*var\(--tap-min\)/);
    expect(rule(".chip-nav-face")).toMatch(/inline-size:\s*32px/);
    expect(rule(".chip-nav-face")).toMatch(/block-size:\s*32px/);
    // 칩은 줄 폭을 넘지 않고, 긴 이름은 칩 글에서 한 줄 말줄임(C23)
    expect(rule(".chip")).toMatch(/max-width:\s*100%/);
    expect(rule(".chip")).not.toContain("--chip-max-gap");
    expect(rule(".chip-label")).toContain("text-overflow: ellipsis");
    expect(rule(".chip-label")).toContain("white-space: nowrap");
  });

  it("구조: 칩 줄 바로 아래 자식이 칩 단추들뿐이고(넘김 단추는 칩 줄 밖), 「+ 분야」가 맨 끝이다", () => {
    renderScreen();
    open();
    expect(chipGroup().parentElement!.classList.contains("chip-scroller")).toBe(true);
    const kids = [...chipGroup().children];
    expect(kids.every((el) => el.tagName === "BUTTON" && el.classList.contains("chip"))).toBe(true);
    expect(kids.map((el) => el.textContent)).toEqual(["취업 준비", "운동", "CS 공부", "+ 분야"]);
    expect(kids[kids.length - 1].id).toBe("add-category-chip");
  });

  it("분야 50개(한도): 칩 50개와 「+ 분야」가 모두 그려지고 모두 키보드로 닿는다(숨김·tabindex -1 없음)", () => {
    const many = Array.from({ length: 50 }, (_, i) => cat(`${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`, `분야${i + 1}`));
    renderScreen(read([], many));
    open();
    const buttons = within(chipGroup()).getAllByRole("button");
    expect(buttons).toHaveLength(51);
    for (const el of buttons) {
      expect(el.getAttribute("tabindex")).toBeNull();
      expect((el as HTMLButtonElement).disabled).toBe(false);
      expect(el.hasAttribute("hidden")).toBe(false);
    }
    // 포커스를 받으면 그 칩이 줄 안에서 보이게 옆으로 넘어간다(block·inline nearest)
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    fireEvent.focus(buttons[49]);
    expect(scroll).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
  });

  it("악용: 꺾쇠·따옴표가 든 분야 이름은 글자 그대로 칩에 보이고 요소가 생기지 않는다", () => {
    const evil = `<img src=x onerror=alert(1)>"&amp;`;
    renderScreen(read([], [cat(CAT_WORK, evil), cat(CAT_GYM, "가".repeat(20))]));
    open();
    expect(chip(evil).textContent).toBe(evil);
    expect(chipGroup().querySelector("img")).toBeNull();
    expect(chip(evil).querySelector(".chip-label")!.textContent).toBe(evil);
    // 긴 이름(20자)도 전체 이름이 접근 이름이다(말줄임은 CSS로만)
    expect(chip("가".repeat(20)).textContent).toBe("가".repeat(20));
  });

  it("창을 열면 포커스는 글 칸이고(분야가 많아도), 분야 칩을 눌러도 포커스는 칩에 머문다(방향 C의 입력 방향 그대로)", () => {
    const many = Array.from({ length: 12 }, (_, i) => cat(`${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`, `분야${i + 1}`));
    renderScreen(read([], many));
    open();
    expect(document.activeElement).toBe(todoInput());
    // 칩을 누른 뒤에도 포커스는 그 칩에 머문다(글 칸으로 옮기지 않는다). 브라우저가 누른 단추에 주는 포커스를 그대로 흉내 낸다
    const second = chip("분야2");
    second.focus();
    fireEvent.click(second);
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(second);
    // 같은 칩을 다시 눌러 고름을 풀어도 포커스는 그 칩이다
    fireEvent.click(second);
    expect(second.getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(second);
  });
});

describe("고침 4바퀴: 목록 위 카드는 한 줄 줄(CSS)", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it(".entry-card가 감싸는 한 줄(flex-wrap), 단추는 오른쪽, 자리(.slot-card)는 한 줄 높이다", () => {
    const entry = /\.entry-card\s*\{([^}]*)\}/.exec(css)![1];
    expect(entry).toContain("display: flex");
    expect(entry).toMatch(/flex-wrap:\s*wrap/);
    expect(/\.entry-card\s*>\s*\.btn\s*\{[^}]*margin-left:\s*auto/.test(css)).toBe(true);
    // 자리(.slot-card)의 높이와 카드의 높이는 CSS 글자가 아니라 화면 사진 측정이 근거다:
    // tests/screens/screens.spec.ts 「카드 자리와 카드 높이」(자리 56 · 카드 84 · 글 200자 카드 280을 같은 크기에서 재어 상한으로 단언).
    // 자리에 min-height 규칙이 있다는 것만 여기서 본다(tests/unit/ui-polish.test.tsx도 같은 것을 본다).
    expect(/\.slot-card\s*\{[^}]*min-height:/.test(css)).toBe(true);
  });
});

describe("고침 4바퀴 시나리오 ① 처음 쓰는 사람: 분야가 하나", () => {
  it("칩은 그 분야 하나와 「+ 분야」뿐이고, 창을 열면 포커스는 글 칸, 탭은 글 칸 → 적기 → 칩 → + 분야다. 칩 줄은 한 줄 하나다", () => {
    renderScreen(read([], [cat(CAT_WORK, "취업 준비")]));
    open();
    expect(document.activeElement).toBe(todoInput());
    expect(within(chipGroup()).getAllByRole("button").map((b) => b.textContent)).toEqual(["취업 준비", "+ 분야"]);
    const form = screen.getByRole("form", { name: "할 일 적기" });
    const ids = [...form.querySelectorAll<HTMLElement>("button, input")].map((el) => el.id || el.textContent);
    expect(ids).toEqual(["sheet-close", "todo-input", "적기", "취업 준비", "add-category-chip"]);
    expect(chipGroup().classList.contains("chip-row")).toBe(true);
    // 고르고 적으면 그 분야가 붙는다(입력 방향은 그대로): 칩을 고르고 글을 쓰고 「적기」를 누르면 할 일 더하기 호출에 그 분야 번호가 실려 간다
    addTodo.mockReturnValue(new Promise(() => {}));
    fireEvent.click(chip("취업 준비"));
    expect(chip("취업 준비").getAttribute("aria-pressed")).toBe("true");
    typeTodo("이력서 첫 줄 고치기");
    pressWrite();
    expect(addTodo).toHaveBeenCalledTimes(1);
    expect(addTodo.mock.calls[0]).toEqual([expect.any(String), "이력서 첫 줄 고치기", CAT_WORK]);
  });
});
