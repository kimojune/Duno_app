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

import { TodoScreen } from "../../components/todo-screen";

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

describe("할 일 자세히 (0번)", () => {
  it("줄의 「자세히」가 대화상자를 열고, 닫으면 그 줄의 「자세히」로 포커스가 돌아온다", async () => {
    const api = fakeApi();
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    const dialog = await screen.findByRole("dialog", { name: "할 일 자세히" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(api.fetchNotes).toHaveBeenCalledWith(A);
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
  });

  it("글을 고치면 api로 바뀐 것만 보내고 목록 글이 바뀐다", async () => {
    const api = fakeApi();
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    const save = await screen.findByRole("button", { name: "고치기" });
    expect((save as HTMLButtonElement).disabled).toBe(true); // 바뀐 것이 없다
    fireEvent.change(screen.getByLabelText("할 일 글"), { target: { value: "이력서 고치기" } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await act(async () => fireEvent.click(save));
    expect(api.editTodo).toHaveBeenCalledWith(A, { text: "이력서 고치기" });
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByRole("checkbox", { name: "이력서 고치기" })).toBeTruthy();
  });

  it("분야를 고르면 분야만 보내고, 기타로 돌릴 수 있다", async () => {
    const api = fakeApi();
    render(<TodoScreen initial={initial([item(A, "단어 외우기")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 단어 외우기" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "어학" }));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "고치기" })));
    expect(api.editTodo).toHaveBeenCalledWith(A, { categoryId: CAT });
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.getByText("어학")).toBeTruthy(); // 목록 줄의 분야 표시
  });

  it("고치기가 실패하면 안내를 보이고 글은 그대로 둔다", async () => {
    const api = fakeApi({ editTodo: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    fireEvent.change(await screen.findByLabelText("할 일 글"), { target: { value: "새 글" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "고치기" })));
    expect(screen.getByText("고치지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect((screen.getByLabelText("할 일 글") as HTMLInputElement).value).toBe("새 글");
  });

  it("지우기는 한 번 더 확인하고, 지우면 줄이 없어진다", async () => {
    const api = fakeApi();
    render(<TodoScreen initial={initial([item(A, "이력서"), item(B, "면접 준비")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "지우기" }));
    expect(api.deleteTodo).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/작업 기록도 함께 지워져요/)).toBeTruthy();
    await act(async () => fireEvent.click(within(dialog).getAllByRole("button", { name: "지우기" })[0]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.deleteTodo).toHaveBeenCalledWith(A);
    expect(screen.queryByRole("checkbox", { name: "이력서" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "면접 준비" })).toBeTruthy();
  });

  it("위로·아래로: 순서를 서버에 보내고, 맨 위·맨 아래에서는 막힌다", async () => {
    const api = fakeApi();
    render(<TodoScreen initial={initial([item(A, "첫째"), item(B, "둘째")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 첫째" }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByRole("button", { name: "위로" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "아래로" })));
    expect(api.reorderTodos).toHaveBeenCalledWith([B, A]);
    expect((within(dialog).getByRole("button", { name: "아래로" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    const boxes = screen.getAllByRole("checkbox").map((el) => el.getAttribute("aria-labelledby"));
    expect(boxes).toEqual([`todo-text-${B}`, `todo-text-${A}`]);
  });

  it("순서 바꾸기가 실패하면 순서는 그대로고 안내가 보인다", async () => {
    const api = fakeApi({ reorderTodos: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    render(<TodoScreen initial={initial([item(A, "첫째"), item(B, "둘째")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 첫째" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "아래로" })));
    expect(within(dialog).getByText("순서를 바꾸지 못했어요.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.getAllByRole("checkbox").map((el) => el.getAttribute("aria-labelledby"))).toEqual([`todo-text-${A}`, `todo-text-${B}`]);
  });

  it("오프라인이면 고치기·지우기·순서 단추가 막히고 안내가 보인다", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    render(<TodoScreen initial={initial([item(A, "첫째"), item(B, "둘째")])} manage={fakeApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 첫째" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("인터넷에 연결되면 고치거나 지울 수 있어요.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "아래로" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "지우기" }) as HTMLButtonElement).disabled).toBe(true);
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "기록 남기기" })));
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "기록 남기기" })));
    expect(screen.getByText("기록을 남기지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect((screen.getByLabelText("작업 기록 쓰기") as HTMLTextAreaElement).value).toBe("다시 보낼 글");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "기록 남기기" })));
    expect(addNote.mock.calls[0][0]).toBe(addNote.mock.calls[1][0]);
  });

  it("빈 글은 단추가 막혀 있고, 기록을 지울 수 있다", async () => {
    const existing: NoteItem = { id: "n1", todoId: A, day: "2026-11-06", createdAt: "x", readable: true, text: "지울 기록" };
    const api = fakeApi({ fetchNotes: vi.fn(async () => ({ ok: true as const, data: { notes: [existing] } })) });
    render(<TodoScreen initial={initial([item(A, "이력서")])} manage={api} />);
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 이력서" }));
    await screen.findByText("지울 기록");
    expect((screen.getByRole("button", { name: "기록 남기기" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /지우기: 2026-11-06 기록/ })));
    expect(api.deleteNote).toHaveBeenCalledWith("n1");
    expect(screen.queryByText("지울 기록")).toBeNull();
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
    expect(await screen.findByText(/남긴 기록이 없어요/)).toBeTruthy();
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
    const take = screen.getByRole("button", { name: "고른 0개 가져오기" }) as HTMLButtonElement;
    expect(take.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "어제 못 한 일 하나" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "고른 1개 가져오기" })));
    expect(api.carryOver).toHaveBeenCalledWith([{ from: y1.id, id: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
    // 오늘 목록에 붙었다(체크 칸)
    expect(screen.getByRole("checkbox", { name: "어제 못 한 일 하나" })).toBeTruthy();
    // 남은 후보는 하나
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
    fireEvent.click(screen.getByRole("checkbox", { name: "어제 못 한 일 하나" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "고른 1개 가져오기" })));
    expect(screen.getByText("가져오지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "어제 못 한 일 하나" }) as HTMLInputElement).checked).toBe(true);
  });
});
