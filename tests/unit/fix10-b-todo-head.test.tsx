// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManageApi } from "../../lib/manage-api";
import type { TodayRead } from "../../lib/today-types";
import type { TodoDay, TodoItem } from "../../lib/todos/types";

vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../lib/read-client", () => ({
  fetchToday: vi.fn(async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } })),
}));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { TodoScreen } from "../../components/todo-screen";

/** 고침10 W2b E · S2 할 일 머리(50:52 · 50:55 · 50:56 · 56:8) — 머리의 「로그아웃」은 없고, 날짜 줄 오른쪽 원 단추 「‹」 하나가 지난 날 보기 */

const DAY: TodoDay = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");

function initial(todos: TodoItem[] = []): TodayRead {
  return { todos: { ok: true, data: { day: DAY, todos } }, categories: { ok: true, data: { categories: [] } } };
}
function api(over: Partial<ManageApi> = {}): ManageApi {
  return {
    editTodo: vi.fn(),
    deleteTodo: vi.fn(),
    reorderTodos: vi.fn(),
    addNote: vi.fn(),
    deleteNote: vi.fn(),
    fetchNotes: vi.fn(async () => ({ ok: true as const, data: { notes: [] } })),
    fetchYesterday: vi.fn(async () => ({ ok: true as const, data: { todos: [] as TodoItem[] } })),
    carryOver: vi.fn(),
    fetchDay: vi.fn(async (date: string) => ({ ok: true as const, data: { day: { ...DAY, date }, todos: [] as TodoItem[] } })),
    ...over,
  } as ManageApi;
}

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("S2 할 일 머리 (고침10 E)", () => {
  it("머리에 「로그아웃」 글이 없다(로그아웃은 내 정보 한 곳)", () => {
    render(<TodoScreen initial={initial()} manage={api()} />);
    expect(screen.queryByRole("button", { name: "로그아웃" })).toBeNull();
    expect(document.getElementById("logout-button")).toBeNull();
    expect(document.querySelector(".today-header")!.textContent).not.toContain("로그아웃");
  });

  it("날짜 줄 오른쪽에 원 단추 「‹」 하나 — 화면 읽기 이름 「지난 날 보기」, 「›」 하루 뒤는 없다, 목록 아래 글 단추 「지난 날 보기」는 없다", () => {
    render(<TodoScreen initial={initial()} manage={api()} />);
    const buttons = screen.getAllByRole("button", { name: "지난 날 보기" });
    expect(buttons).toHaveLength(1); // 글 단추는 뺐다 — 이름이 같은 단추는 머리의 원 단추 하나
    const past = buttons[0];
    expect(past.closest(".today-date-row")).toBeTruthy();
    expect(past.querySelector(".step-btn-face")!.textContent).toBe("‹");
    expect(past.querySelector(".step-btn-face")!.getAttribute("aria-hidden")).toBe("true");
    expect(past.className).toContain("step-btn"); // 보이는 원 32 · 누름 48(공통 .step-btn)
    expect(screen.queryByText("›", { selector: ".today-date-row *" })).toBeNull(); // 하루 뒤 단추 없음
    expect(document.querySelector(".today-date-row")!.querySelectorAll("button")).toHaveLength(1);
    expect(document.querySelector("main .btn-text")).toBeNull(); // 목록 아래 글 단추 없음
    expect(css).toMatch(/\.step-btn \{[^}]*inline-size: var\(--tap-min\)/);
    expect(css).toMatch(/\.step-btn-face \{[^}]*inline-size: 32px; block-size: 32px; border-radius: 50%/);
  });

  it("원 단추를 누르면 지난 날(어제) 보기가 열리고, 지난 날을 읽을 길이 없으면 단추도 없다", async () => {
    render(<TodoScreen initial={initial()} manage={api()} />);
    fireEvent.click(screen.getByRole("button", { name: "지난 날 보기" }));
    expect(await screen.findByRole("dialog", { name: "지난 날" })).toBeTruthy();
    cleanup();
    render(<TodoScreen initial={initial()} manage={api({ fetchDay: undefined })} />);
    expect(screen.queryByRole("button", { name: "지난 날 보기" })).toBeNull();
  });

  it("워드마크 아래 「오늘」까지 18(상자 여백 10 + 줄 높이 여유 4·4)", () => {
    expect(css).toMatch(/\.today-wordmark \{[^}]*margin-bottom: 10px/);
  });
});

describe("S2 할 일 몸 (고침10 E)", () => {
  it("이번 주 목표 줄 = 흰 카드(테두리 없음) 48 · 글 14 Bold · 오른쪽 「›」", () => {
    expect(css).toMatch(/\.goal-line \{[^}]*min-height: var\(--tap-min\)[^}]*border: 0[^}]*background: var\(--color-surface\)[^}]*font: 700 0\.875rem\/1\.25rem/);
  });
  it("빈 목록 예시 체크는 점선 원 24, 「+ 할 일 적기」는 144×48 한 덩어리", () => {
    render(<TodoScreen initial={initial()} manage={api()} />);
    expect(css).toMatch(/\.todo-example-check \{[^}]*inline-size: 24px; block-size: 24px;[^}]*dashed[^}]*border-radius: 50%/);
    const add = document.getElementById("add-todo-button")!;
    expect(add.textContent).toContain("할 일 적기");
    expect(css).toMatch(/\.add-todo-btn \{[^}]*min-height: 48px;[^}]*min-inline-size: 144px/);
    expect(document.body.textContent).not.toContain("포트폴리오");
    expect(document.body.textContent).toContain("글 한 편 초고 쓰기");
  });
});

describe("적는 창 막 · 분야 고르기 시트 체크 (고침10 J)", () => {
  it("적는 창을 열면 뒤에 막이 깔리지만(보이기만) 목록은 그대로 누를 수 있다(비모달 C-D1). 닫으면 막도 없다", () => {
    render(<TodoScreen initial={initial([{ id: "t1", readable: true, text: "목록 글", done: false, createdAt: "x", categoryId: null }])} manage={api()} />);
    expect(document.querySelector(".todo-sheet-scrim")).toBeNull();
    fireEvent.click(document.getElementById("add-todo-button")!);
    const scrim = document.querySelector(".todo-sheet-scrim")!;
    expect(scrim).toBeTruthy();
    expect(scrim.getAttribute("aria-hidden")).toBe("true");
    expect(css).toMatch(/\.todo-sheet-scrim \{[^}]*pointer-events: none/);
    expect(document.querySelector("[aria-modal]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(document.querySelector(".todo-sheet-scrim")).toBeNull();
  });
});
