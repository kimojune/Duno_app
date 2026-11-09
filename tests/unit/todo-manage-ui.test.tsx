// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManageApi } from "../../lib/manage-api";
import type { NoteItem } from "../../lib/notes/types";
import type { TodayRead } from "../../lib/today-types";
import type { TodoDay, TodoItem } from "../../lib/todos/types";

vi.mock("../../app/todos/actions", () => ({
  addTodo: vi.fn(),
  setTodoDone: vi.fn(),
  addCategory: vi.fn(),
}));
vi.mock("../../lib/read-client", () => ({
  fetchToday: vi.fn(async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } })),
}));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { addCategory, setTodoDone } from "../../app/todos/actions";
import { TodoScreen } from "../../components/todo-screen";
import { confirmTitle, expectConfirmShape, expectHeadButton } from "./confirm-helpers";

const DAY: TodoDay = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function item(id: string, text: string, categoryId: string | null = null, done = false): TodoItem {
  return { id, readable: true, text, done, createdAt: "2026-11-07T01:00:00.000Z", categoryId };
}
function initial(todos: TodoItem[]): TodayRead {
  return {
    todos: { ok: true, data: { day: DAY, todos } },
    categories: { ok: true, data: { categories: [{ id: CAT, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" }] } },
  };
}
function fakeApi(over: Partial<ManageApi> = {}): ManageApi {
  return {
    editTodo: vi.fn(async (id, patch) => ({ ok: true as const, data: { todo: { ...item(id, patch.text ?? "x"), categoryId: patch.categoryId ?? null } } })),
    deleteTodo: vi.fn(async (id) => ({ ok: true as const, data: { id } })),
    reorderTodos: vi.fn(async (ids) => ({ ok: true as const, data: { ids } })),
    addNote: vi.fn(async (id, todoId, text) => ({
      ok: true as const,
      data: { note: { id, todoId, day: "2026-11-07", createdAt: "x", readable: true as const, text } satisfies NoteItem },
    })),
    deleteNote: vi.fn(async (id) => ({ ok: true as const, data: { id } })),
    fetchNotes: vi.fn(async () => ({ ok: true as const, data: { notes: [] as NoteItem[] } })),
    fetchYesterday: vi.fn(async () => ({ ok: true as const, data: { todos: [] as TodoItem[] } })),
    carryOver: vi.fn(async () => ({ ok: true as const, data: { todos: [] as TodoItem[], day: DAY } })),
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("manage가 없으면 기존 화면 그대로", () => {
  it("「자세히」 단추도 가져오기 줄도 없다", () => {
    render(<TodoScreen initial={initial([item(A, "이력서")])} />);
    expect(screen.queryByRole("button", { name: /자세히/ })).toBeNull();
    expect(screen.queryByText(/어제 못 끝낸/)).toBeNull();
  });
});

/** 고침9 Figma 58:92: 「⋯」(더 보기) 메뉴를 연다 */
function openMenu(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "더 보기" }));
  return within(dialog).getByRole("menu", { name: "할 일 메뉴" });
}

describe("할 일 자세히 (0번) — 고침9 할 일 페이지(Figma 51:55 · 58:92 · 66:12 · 66:76)", () => {
  it("줄의 「자세히」가 대화상자를 열고, 머리 단추 「‹」(고침10 A, 이름 「이전」)로 닫으면 그 줄의 「자세히」로 포커스가 돌아온다", async () => {
    const api = fakeApi();
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 자세히" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(api.fetchNotes).toHaveBeenCalledWith(A);
    const back = within(dialog).getByRole("button", { name: "이전" });
    expect(expectHeadButton(dialog, "back")).toBe(back);
    expect(back.getAttribute("data-head-button")).toBe("back");
    expect(back.textContent).toBe(""); // 아이콘(꾸밈)만 — 「‹ 할 일」 글 단추와 머리의 「할 일」 글은 없다
    const head = dialog.querySelector(".screen-head")!;
    expect(head.querySelector("button")).toBe(back); // 머리의 첫 단추(왼쪽 위)
    expect(head.textContent).not.toContain("할 일");
    expect(within(dialog).queryByRole("button", { name: "할 일로 돌아가기" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "닫기" })).toBeNull();
    // 큰 제목 = 할 일 글, 속성 줄 끝냄·분야·하는 날
    expect((within(dialog).getByLabelText("할 일 글") as HTMLInputElement).value).toBe("이력서");
    expect(within(dialog).getByRole("checkbox", { name: "끝냄" })).toBeTruthy();
    expect(within(dialog).getByText("11월 7일 토요일")).toBeTruthy();
    fireEvent.click(back);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
  });

  it("큰 제목 글을 고치고 엔터면 api로 바뀐 것만 보내고(「고치기」 단추 없음), 머리에 「저장됨」, 목록 글이 바뀐다. 안 바꾼 채 칸을 떠나면 보내지 않는다", async () => {
    const api = fakeApi();
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 자세히" });
    expect(within(dialog).queryByRole("button", { name: "고치기" })).toBeNull();
    const title = within(dialog).getByLabelText("할 일 글");
    fireEvent.blur(title);
    expect(api.editTodo).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: "이력서 고치기" } });
    await act(async () => fireEvent.keyDown(title, { key: "Enter" }));
    expect(api.editTodo).toHaveBeenCalledTimes(1);
    expect(api.editTodo).toHaveBeenCalledWith(A, { text: "이력서 고치기" });
    expect(dialog.querySelector(".detail-status")!.textContent).toBe("저장됨");
    expect(dialog.querySelector(".sr-only[role=status]")!.textContent).toBe("저장됨"); // O-8 알림 한 곳
    await act(async () => fireEvent.blur(title)); // 이미 저장한 글이면 다시 보내지 않는다
    expect(api.editTodo).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "이전" }));
    expect(screen.getByRole("checkbox", { name: "이력서 고치기" })).toBeTruthy();
  });

  it("고치기가 실패하면 머리에 「저장 안 됨 · 다시 시도」(Figma 66:76), 글은 그대로, 누르면 같은 값으로 다시 보낸다", async () => {
    const editTodo = vi.fn(async () => ({ ok: false as const, error: "unavailable" as const }));
    const api = fakeApi({ editTodo });
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    const title = await screen.findByLabelText("할 일 글");
    fireEvent.change(title, { target: { value: "새 글" } });
    await act(async () => fireEvent.keyDown(title, { key: "Enter" }));
    const retry = screen.getByRole("button", { name: "저장 안 됨 · 다시 시도" });
    expect((screen.getByLabelText("할 일 글") as HTMLInputElement).value).toBe("새 글");
    await act(async () => fireEvent.click(retry));
    expect(editTodo).toHaveBeenCalledTimes(2);
    expect(editTodo.mock.calls[1]).toEqual([A, { text: "새 글" }]);
  });

  it("「⋯」 → 지우기는 공통 확인 창(고침10 B 147:2 — 제목 초점, 위 「지우기」·아래 「그대로 두기」)을 띄우고, Esc·「그대로 두기」는 지우지 않으며, 「지우기」 연타에도 한 번만 지운다", async () => {
    const api = fakeApi();
    render(<TodoScreen initial={initial([item(A, "이력서"), item(B, "면접 준비")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 자세히" });
    expect(within(dialog).queryByRole("button", { name: "지우기" }), "지우기는 메뉴 안에만").toBeNull();
    fireEvent.click(within(openMenu(dialog)).getByRole("menuitem", { name: "지우기" }));
    expect(api.deleteTodo).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog", { name: "이 할 일을 지울까요?" });
    expectConfirmShape(confirm, "지우기", "그대로 두기");
    expect(document.getElementById(confirm.getAttribute("aria-describedby")!)!.textContent).toBe("작업 기록도 함께 지워져요.");
    fireEvent.click(within(confirm).getByRole("button", { name: "그대로 두기" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.deleteTodo).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement, "연 메뉴 항목은 없으니 초점은 「더 보기」").toBe(within(dialog).getByRole("button", { name: "더 보기" }));
    // Esc = 「그대로 두기」
    fireEvent.click(within(openMenu(dialog)).getByRole("menuitem", { name: "지우기" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: "할 일 자세히" }), "Esc는 확인만 닫는다").toBeTruthy();
    expect(api.deleteTodo).not.toHaveBeenCalled();
    fireEvent.click(within(openMenu(dialog)).getByRole("menuitem", { name: "지우기" }));
    const yes = within(screen.getByRole("alertdialog")).getByRole("button", { name: "지우기" });
    await act(async () => {
      fireEvent.click(yes);
      fireEvent.click(yes);
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.deleteTodo).toHaveBeenCalledTimes(1);
    expect(api.deleteTodo).toHaveBeenCalledWith(A);
    expect(screen.queryByRole("checkbox", { name: "이력서" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "면접 준비" })).toBeTruthy();
  });

  it("「⋯」 위로·아래로: 순서를 서버에 보내고, 맨 위·맨 아래에서는 막힌다", async () => {
    const api = fakeApi();
    render(<TodoScreen initial={initial([item(A, "첫째"), item(B, "둘째")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 첫째" }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 자세히" });
    const menu = openMenu(dialog);
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["위로", "아래로", "지우기"]);
    expect((within(menu).getByRole("menuitem", { name: "위로" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.click(within(menu).getByRole("menuitem", { name: "아래로" })));
    expect(api.reorderTodos).toHaveBeenCalledWith([B, A]);
    expect((within(openMenu(dialog)).getByRole("menuitem", { name: "아래로" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "이전" }));
    const boxes = screen.getAllByRole("checkbox").map((el) => el.getAttribute("aria-labelledby"));
    expect(boxes).toEqual([`todo-text-${B}`, `todo-text-${A}`]);
  });

  it("순서 바꾸기가 실패하면 순서는 그대로고 안내가 보인다", async () => {
    const api = fakeApi({ reorderTodos: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    render(<TodoScreen initial={initial([item(A, "첫째"), item(B, "둘째")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 첫째" }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 자세히" });
    const menu = openMenu(dialog);
    await act(async () => fireEvent.click(within(menu).getByRole("menuitem", { name: "아래로" })));
    expect(dialog.querySelector(".detail-message")!.textContent).toBe("순서를 바꾸지 못했어요.");
    expect(dialog.querySelector(".sr-only[role=status]")!.textContent).toBe("순서를 바꾸지 못했어요."); // O-8 알림 한 곳
    fireEvent.click(within(dialog).getByRole("button", { name: "이전" }));
    expect(screen.getAllByRole("checkbox").map((el) => el.getAttribute("aria-labelledby"))).toEqual([`todo-text-${A}`, `todo-text-${B}`]);
  });

  it("오프라인이면 메뉴의 순서·지우기가 막히고 안내가 보인다", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    render(<TodoScreen initial={initial([item(A, "첫째"), item(B, "둘째")])} manage={fakeApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 첫째" }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 자세히" });
    expect(within(dialog).getByText("인터넷에 연결되면 고치거나 지울 수 있어요.")).toBeTruthy();
    const menu = openMenu(dialog);
    expect((within(menu).getByRole("menuitem", { name: "아래로" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(menu).getByRole("menuitem", { name: "지우기" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: /^분야 / }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("「⋯」 메뉴: aria-expanded·첫 항목 초점, Esc는 메뉴만 닫고(페이지는 남음) 초점은 「더 보기」", async () => {
    render(<TodoScreen initial={initial([item(A, "첫째"), item(B, "둘째")])} manage={fakeApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 첫째" }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 자세히" });
    const more = within(dialog).getByRole("button", { name: "더 보기" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    const menu = openMenu(dialog);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "아래로" })); // 첫 쓸 수 있는 항목(위로는 막힘)
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(within(dialog).queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "할 일 자세히" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(more));
  });

  it("「끝냄」 줄을 누르면 목록 줄의 끝냄 체크와 같이 바뀐다(같은 길 — setTodoDone(id, true))", async () => {
    vi.mocked(setTodoDone).mockResolvedValue({ ok: true, data: { id: A, done: true } } as never);
    render(<TodoScreen initial={initial([item(A, "첫째")])} manage={fakeApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 첫째" }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 자세히" });
    const done = within(dialog).getByRole("checkbox", { name: "끝냄" }) as HTMLInputElement;
    expect(done.checked).toBe(false);
    await act(async () => fireEvent.click(done));
    expect((within(dialog).getByRole("checkbox", { name: "끝냄" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "이전" }));
    expect((screen.getByRole("checkbox", { name: "첫째" }) as HTMLInputElement).checked).toBe(true);
    expect(setTodoDone).toHaveBeenCalledWith(A, true);
  });

  it("Esc로 닫힌다", async () => {
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={fakeApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("작업 기록 (0-1번)", () => {
  it("불러온 기록을 보이고, 새 기록을 남기면 목록 끝에 붙고 칸이 비워진다", async () => {
    const existing: NoteItem = { id: "n1", todoId: A, day: "2026-11-06", createdAt: "x", readable: true, text: "어제 경력을 적었다" };
    const api = fakeApi({ fetchNotes: vi.fn(async () => ({ ok: true as const, data: { notes: [existing] } })) });
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    expect(await screen.findByText("어제 경력을 적었다")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("작업 기록 쓰기"), { target: { value: "오늘은 학력 항목" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "작업 기록 남기기" })));
    expect(api.addNote).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), A, "오늘은 학력 항목");
    expect(screen.getByText("오늘은 학력 항목")).toBeTruthy();
    expect((screen.getByLabelText("작업 기록 쓰기") as HTMLTextAreaElement).value).toBe("");
  });

  it("남기기가 실패하면 글을 지우지 않고, 같은 글로 다시 누르면 같은 id를 쓴다", async () => {
    const addNote = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unavailable" })
      .mockImplementation(async (id: string, todoId: string, text: string) => ({
        ok: true,
        data: { note: { id, todoId, day: "2026-11-07", createdAt: "x", readable: true, text } },
      }));
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={fakeApi({ addNote })} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    fireEvent.change(await screen.findByLabelText("작업 기록 쓰기"), { target: { value: "다시 보낼 글" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "작업 기록 남기기" })));
    expect(screen.getByText("기록을 남기지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect((screen.getByLabelText("작업 기록 쓰기") as HTMLTextAreaElement).value).toBe("다시 보낼 글");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "작업 기록 남기기" })));
    expect(addNote.mock.calls[0][0]).toBe(addNote.mock.calls[1][0]);
  });

  it("빈 글은 단추가 막혀 있고, 기록 「지우기」는 확인 창(고침10 B 147:95)을 거친다 — Esc·「그대로 두기」는 지우지 않고, 「지우기」면 그 카드만 사라진다", async () => {
    const existing: NoteItem = { id: "n1", todoId: A, day: "2026-11-06", createdAt: "x", readable: true, text: "지울 기록" };
    const api = fakeApi({ fetchNotes: vi.fn(async () => ({ ok: true as const, data: { notes: [existing] } })) });
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    await screen.findByText("지울 기록");
    expect((screen.getByRole("button", { name: "작업 기록 남기기" }) as HTMLButtonElement).disabled).toBe(true);
    const remove = screen.getByRole("button", { name: /지우기: 2026-11-06 기록/ });
    remove.focus();
    fireEvent.click(remove);
    const confirm = screen.getByRole("alertdialog", { name: "이 작업 기록을 지울까요?" });
    expectConfirmShape(confirm, "지우기", "그대로 두기");
    expect(confirm.getAttribute("aria-describedby")).toBeNull(); // 보조 글 없음
    expect(api.deleteNote, "확인 없이 바로 지우지 않는다(PM 11)").not.toHaveBeenCalled();
    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement, "닫히면 초점은 연 「지우기」").toBe(remove);
    fireEvent.click(remove);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "그대로 두기" }));
    expect(api.deleteNote).not.toHaveBeenCalled();
    expect(screen.getByText("지울 기록")).toBeTruthy();
    fireEvent.click(remove);
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "지우기" })));
    expect(api.deleteNote).toHaveBeenCalledTimes(1);
    expect(api.deleteNote).toHaveBeenCalledWith("n1");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText("지울 기록")).toBeNull();
  });

  it("악용: 작업 기록 지우기 확인 「지우기」 연타·Enter 연타 → 첫 누름 뒤 「지우는 중」 + 두 단추 막힘(aria-busy), 지우기 호출 1번, 응답 뒤 창 닫힘·그 카드만 사라짐", async () => {
    const notes: NoteItem[] = [
      { id: "n1", todoId: A, day: "2026-11-06", createdAt: "x", readable: true, text: "지울 기록" },
      { id: "n2", todoId: A, day: "2026-11-07", createdAt: "y", readable: true, text: "남을 기록" },
    ];
    type Done = { ok: true; data: { id: string } };
    const waiting: ((v: Done) => void)[] = [];
    const deleteNote = vi.fn(() => new Promise<Done>((resolve) => waiting.push(resolve)));
    const api = fakeApi({ fetchNotes: vi.fn(async () => ({ ok: true as const, data: { notes } })), deleteNote });
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    await screen.findByText("지울 기록");
    fireEvent.click(screen.getByRole("button", { name: /지우기: 2026-11-06 기록/ }));
    const confirm = screen.getByRole("alertdialog", { name: "이 작업 기록을 지울까요?" });
    const [yes, keep] = within(confirm).getAllByRole("button") as HTMLButtonElement[];
    await act(async () => {
      fireEvent.click(yes);
      fireEvent.click(yes);
      fireEvent.keyDown(yes, { key: "Enter" });
      fireEvent.click(yes);
    });
    expect(deleteNote).toHaveBeenCalledTimes(1);
    expect(yes.textContent).toBe("지우는 중");
    expect(yes.disabled && keep.disabled).toBe(true);
    expect(yes.getAttribute("aria-busy")).toBe("true");
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement, "막히면 초점은 제목(창 밖으로 새지 않음)").toBe(confirmTitle(confirm));
    fireEvent.keyDown(confirm, { key: "Escape" }); // 막힌 동안 Esc는 아무것도 하지 않는다
    expect(screen.getByRole("alertdialog")).toBe(confirm);
    await act(async () => waiting[0]({ ok: true, data: { id: "n1" } }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText("지울 기록")).toBeNull();
    expect(screen.getByText("남을 기록")).toBeTruthy();
    expect(deleteNote).toHaveBeenCalledTimes(1);
  });

  it("글자 모양 그대로 보인다(꺾쇠·스크립트가 요소가 되지 않는다)", async () => {
    const evil = '<img src=x onerror="window.__n=1"><script>window.__m=1</script>';
    const note: NoteItem = { id: "n1", todoId: A, day: "2026-11-06", createdAt: "x", readable: true, text: evil };
    const api = fakeApi({ fetchNotes: vi.fn(async () => ({ ok: true as const, data: { notes: [note] } })) });
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    expect(await screen.findByText(evil)).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("작업 기록을 못 불러오면 안내와 「다시 불러오기」", async () => {
    const fetchNotes = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unavailable" })
      .mockResolvedValue({ ok: true, data: { notes: [] } });
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={fakeApi({ fetchNotes })} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    expect(await screen.findByText("작업 기록을 불러오지 못했어요.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" })));
    expect(fetchNotes).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText("작업 기록을 불러오지 못했어요.")).toBeNull());
    // 고침9 ⑬ 17(PM 3): 기록이 없으면 힌트 글 없이 빈 칸 — 쓰는 칸만 있다
    expect(screen.queryByText(/하는 중에, 끝낸 뒤에/)).toBeNull();
    expect(screen.queryByText(/남긴 기록이 없어요/)).toBeNull();
    expect(screen.getByLabelText("작업 기록 쓰기")).toBeTruthy();
  });
});

describe("고침9 PM 3 분야 고르기 시트(Figma 77:18)", () => {
  function openSheet(api = fakeApi(), todos = [item(A, "단어 외우기", CAT)], read = initial(todos)) {
    render(<TodoScreen initial={read} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: `자세히 보기: ${todos[0].text}` }));
    const dialog = screen.getByRole("dialog", { name: "할 일 자세히" });
    const line = within(dialog).getByRole("button", { name: /^분야 / });
    line.focus();
    fireEvent.click(line);
    return { api, dialog, line, sheet: () => screen.queryByRole("dialog", { name: "분야 고르기" }) };
  }

  it("분야 한 줄에 하나(색 원 + 이름) → 기타 → 「+ 분야」, 고른 줄만 체크·aria-pressed, 포커스는 고른 줄", () => {
    const { sheet } = openSheet();
    // 고침10 A: 분야 고르기 시트 머리 = 왼쪽 위 「✕」(이름 「닫기」) 하나, 바로 옆 제목
    const close = expectHeadButton(sheet()!, "close");
    expect(close.compareDocumentPosition(within(sheet()!).getByRole("heading", { name: "분야 고르기" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = within(within(sheet()!).getByRole("list")).getAllByRole("button");
    expect(rows.map((b) => b.textContent)).toEqual(["어학", "기타", "+ 분야"]);
    expect(rows.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", null]);
    expect(rows[0].querySelector(".category-sheet-check")).not.toBeNull();
    expect(rows[1].querySelector(".category-sheet-check")).toBeNull();
    // 색 원: 첫 분야 = 분야 색 1, 기타 = 기타 색
    expect((rows[0].querySelector(".detail-category-dot") as HTMLElement).style.background).toBe("var(--color-category-1)");
    expect((rows[1].querySelector(".detail-category-dot") as HTMLElement).style.background).toBe("var(--color-category-other)");
    expect(document.activeElement).toBe(rows[0]);
    expect(within(sheet()!).getByRole("button", { name: "닫기" })).toBeTruthy();
  });

  it("같은 분야를 고르면 저장하지 않고 닫기만, 「닫기」로 닫으면 분야 줄로 포커스가 돌아온다", async () => {
    const { api, line, sheet } = openSheet();
    await act(async () => fireEvent.click(within(sheet()!).getByRole("button", { name: "어학" })));
    expect(sheet()).toBeNull();
    expect(api.editTodo).not.toHaveBeenCalled();
    fireEvent.click(line);
    fireEvent.click(within(sheet()!).getByRole("button", { name: "닫기" }));
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(line);
    expect(screen.getByRole("dialog", { name: "할 일 자세히" })).toBeTruthy();
  });

  it("Esc는 시트만 닫고(할 일 페이지는 남음) 포커스는 분야 줄", () => {
    const { line, sheet } = openSheet();
    fireEvent.keyDown(within(sheet()!).getAllByRole("button")[0], { key: "Escape" });
    expect(sheet()).toBeNull();
    expect(screen.getByRole("dialog", { name: "할 일 자세히" })).toBeTruthy();
    expect(document.activeElement).toBe(line);
  });

  it("저장이 실패하면 앞 분야로 되돌리고 안내한다", async () => {
    const api = fakeApi({ editTodo: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    const { dialog, sheet } = openSheet(api, [item(A, "단어 외우기")]);
    await act(async () => fireEvent.click(within(sheet()!).getByRole("button", { name: "어학" })));
    expect(api.editTodo).toHaveBeenCalledWith(A, { categoryId: CAT });
    expect(within(dialog).getByRole("button", { name: "분야 기타" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "저장 안 됨 · 다시 시도" })).toBeTruthy(); // 고침9 Figma 66:76 머리 글
  });

  it("「+ 분야」: 지금 분야 더하기 길(addCategory)로 만들고 바로 골라 저장·닫힘. 분야 이름 HTML은 글자 그대로", async () => {
    const evil = "<img src=x>"; // 분야 이름 상한 20자 안의 HTML
    const NEW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    vi.mocked(addCategory).mockResolvedValue({ ok: true, data: { category: { id: NEW, readable: true, name: evil, createdAt: "x" } } } as never);
    const { api, dialog, sheet } = openSheet(fakeApi(), [item(A, "단어 외우기")]);
    fireEvent.click(within(sheet()!).getByRole("button", { name: "+ 분야" }));
    const input = within(sheet()!).getByLabelText("새 분야 이름");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: evil } });
    await act(async () => fireEvent.click(within(sheet()!).getByRole("button", { name: "더하기" })));
    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addCategory).mock.calls[0][1]).toBe(evil);
    expect(api.editTodo).toHaveBeenCalledWith(A, { categoryId: NEW });
    expect(sheet()).toBeNull();
    const line = within(dialog).getByRole("button", { name: `분야 ${evil}` });
    expect(line.querySelector("img")).toBeNull();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("「+ 분야」에 「기타」를 적으면 분야 행을 만들지 않고 기타로 고른다(요청 없음)", async () => {
    const { api, sheet } = openSheet();
    fireEvent.click(within(sheet()!).getByRole("button", { name: "+ 분야" }));
    fireEvent.change(within(sheet()!).getByLabelText("새 분야 이름"), { target: { value: " 기타 " } });
    await act(async () => fireEvent.click(within(sheet()!).getByRole("button", { name: "더하기" })));
    expect(addCategory).not.toHaveBeenCalled();
    expect(api.editTodo).toHaveBeenCalledWith(A, { categoryId: null });
  });

  it("악용: 분야가 이미 50개면 「+ 분야」는 칸을 열지 않고 한도 안내만, 요청 0", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
      readable: true as const,
      name: `분야${i + 1}`,
      createdAt: "2026-11-01T00:00:00.000Z",
    }));
    const read: TodayRead = { todos: { ok: true, data: { day: DAY, todos: [item(A, "단어 외우기")] } }, categories: { ok: true, data: { categories: many } } };
    const { sheet } = openSheet(fakeApi(), [item(A, "단어 외우기")], read);
    expect(within(sheet()!).getAllByRole("button", { name: /^분야\d+$/ })).toHaveLength(50);
    fireEvent.click(within(sheet()!).getByRole("button", { name: "+ 분야" }));
    expect(within(sheet()!).queryByLabelText("새 분야 이름")).toBeNull();
    expect(within(sheet()!).getByText("분야는 50개까지 둘 수 있어요.")).toBeTruthy();
    expect(addCategory).not.toHaveBeenCalled();
  });
});

describe("고침9 S2 목록 줄 꼴(Figma 50:52)", () => {
  it("분야 점(분야 색) + 이름, 기타는 표시 없음, 줄 오른쪽 「›」(이름 「자세히 보기: 글」), 저장 대기 줄에는 「›」 대신 도는 원 자리", () => {
    render(<TodoScreen initial={initial([item(A, "단어", CAT), item(B, "기타 할 일")])} manage={fakeApi()} />);
    const rowA = document.getElementById(`row-${A}`)!;
    const dot = rowA.querySelector<HTMLElement>(".category-tag-dot")!;
    expect(dot.style.background).toBe("var(--color-category-1)");
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    expect(rowA.querySelector(".category-tag")!.textContent).toBe("분야 어학");
    const go = within(rowA).getByRole("button", { name: "자세히 보기: 단어" });
    expect(go.textContent).toBe("›");
    expect(rowA.closest("ul")!.classList.contains("todo-list")).toBe(true);
    const rowB = document.getElementById(`row-${B}`)!;
    expect(rowB.querySelector(".category-tag-line")).toBeNull();
    expect(rowB.querySelector(".category-tag-dot")).toBeNull();
  });
});

describe("고침9 PM 2-B 할 일 줄 작업 기록 아이콘", () => {
  it("기록이 있는 할 일만 글 바로 뒤에 종이 아이콘(화면 읽기 「작업 기록 있음」), 없으면 없음", () => {
    const withNotes: TodoItem = { ...item(A, "토익 단어 50개"), hasNotes: true };
    render(<TodoScreen initial={initial([withNotes, item(B, "포트폴리오")])} manage={fakeApi()} />);
    const icons = screen.getAllByRole("img", { name: "작업 기록 있음" });
    expect(icons).toHaveLength(1);
    const icon = icons[0];
    // 자리: 할 일 글(span)의 바로 다음 형제, 같은 글 줄(p.todo-text) 안
    const text = document.getElementById(`todo-text-${A}`)!;
    expect(text.textContent).toBe("토익 단어 50개");
    expect(text.nextElementSibling).toBe(icon);
    expect(icon.parentElement!.classList.contains("todo-text")).toBe(true);
    expect(icon.getAttribute("width")).toBe("16");
    expect(icon.querySelector("path")!.getAttribute("stroke-width")).toBe("1.5");
    // 체크 칸 이름은 글만, 설명에 「작업 기록 있음」
    const box = screen.getByRole("checkbox", { name: "토익 단어 50개" });
    expect(box.getAttribute("aria-describedby")).toContain(icon.id);
    expect(screen.queryByText("기록 있음")).toBeNull(); // 옛 글 없음
    expect(document.getElementById(`row-${B}`)!.querySelector(".todo-note-icon")).toBeNull();
  });

  it("할 일 페이지에서 기록을 남기면 아이콘이 생기고, 지우면 없어진다", async () => {
    const api = fakeApi();
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    expect(screen.queryByRole("img", { name: "작업 기록 있음" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    fireEvent.change(await screen.findByLabelText("작업 기록 쓰기"), { target: { value: "첫 장 고침" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "작업 기록 남기기" })));
    await waitFor(() => expect(document.getElementById(`row-${A}`)!.querySelector(".todo-note-icon")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /^지우기: / }));
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog", { name: "이 작업 기록을 지울까요?" })).getByRole("button", { name: "지우기" })));
    await waitFor(() => expect(document.getElementById(`row-${A}`)!.querySelector(".todo-note-icon")).toBeNull());
  });
});

describe("어제 못 끝낸 할 일 가져오기", () => {
  it("어제 것이 없으면 아무것도 안 그린다", async () => {
    render(<TodoScreen initial={initial([])} manage={fakeApi()} />);
    await act(async () => {});
    expect(screen.queryByText(/어제 못 끝낸/)).toBeNull();
  });

  it("고른 것만 가져오고, 가져오면 오늘 목록에 붙고 그 줄은 후보에서 빠진다", async () => {
    const y1 = item("aaaaaaa1-1111-4111-8111-111111111111", "어제 못 한 일 하나");
    const y2 = item("aaaaaaa2-2222-4222-8222-222222222222", "어제 못 한 일 둘");
    const carried = item("ccccccc1-1111-4111-8111-111111111111", "어제 못 한 일 하나");
    const api = fakeApi({
      fetchYesterday: vi.fn(async () => ({ ok: true as const, data: { todos: [y1, y2] } })),
      carryOver: vi.fn(async () => ({ ok: true as const, data: { todos: [carried], day: DAY } })),
    });
    render(<TodoScreen initial={initial([])} manage={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "어제 못 끝낸 할 일 2개 보기" }));
    // 고침10 E(148:108): 처음엔 모두 고른 채, 주 단추 「n개 가져오기」(막지 않는다), 설명 글 없음
    expect((screen.getByRole("checkbox", { name: "어제 못 한 일 하나" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "어제 못 한 일 둘" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "2개 가져오기" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/오늘로 가져올 것을 골라요/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "어제 못 한 일 둘" })); // 풀기
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "1개 가져오기" })));
    expect(api.carryOver).toHaveBeenCalledWith([{ from: y1.id, id: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
    // 오늘 목록에 붙었다(체크 칸)
    expect(screen.getByRole("checkbox", { name: "어제 못 한 일 하나" })).toBeTruthy();
    // 남은 후보는 하나
    expect(screen.getByRole("button", { name: "어제 못 끝낸 할 일 1개 보기" })).toBeTruthy();
  });

  it("고침10 E: 모두 풀면 주 단추 자리에 글 「고른 할 일 없음」(단추 아님), 접기 글 단추는 그대로. 접은 줄은 카드 줄 + 「›」", async () => {
    const y1 = item("aaaaaaa1-1111-4111-8111-111111111111", "어제 못 한 일 하나");
    const api = fakeApi({ fetchYesterday: vi.fn(async () => ({ ok: true as const, data: { todos: [y1] } })) });
    render(<TodoScreen initial={initial([])} manage={api} />);
    const row = await screen.findByRole("button", { name: "어제 못 끝낸 할 일 1개 보기" });
    expect(row.className).toContain("carry-row"); // 접힌 줄 = 카드 줄(알약 아님)
    expect(row.querySelector(".carry-row-go")?.textContent).toBe("›");
    fireEvent.click(row);
    expect(screen.getByRole("button", { name: "1개 가져오기" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "어제 못 한 일 하나" })); // 모두 풀기
    expect(screen.queryByRole("button", { name: /가져오기/ })).toBeNull();
    const none = screen.getByText("고른 할 일 없음");
    expect(none.tagName).toBe("P");
    expect(none.closest("button")).toBeNull(); // 단추가 아니다
    fireEvent.click(screen.getByRole("button", { name: "접기" }));
    expect(screen.queryByText("고른 할 일 없음")).toBeNull();
    expect(screen.getByRole("button", { name: "어제 못 끝낸 할 일 1개 보기" })).toBeTruthy();
  });

  it("가져오기가 실패하면 안내를 보이고 고른 것은 그대로 둔다", async () => {
    const y1 = item("aaaaaaa1-1111-4111-8111-111111111111", "어제 못 한 일 하나");
    const api = fakeApi({
      fetchYesterday: vi.fn(async () => ({ ok: true as const, data: { todos: [y1] } })),
      carryOver: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })),
    });
    render(<TodoScreen initial={initial([])} manage={api} />);
    fireEvent.click(await screen.findByRole("button", { name: /어제 못 끝낸 할 일 1개 보기/ }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "1개 가져오기" })));
    expect(screen.getByText("가져오지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "어제 못 한 일 하나" }) as HTMLInputElement).checked).toBe(true);
  });
});
