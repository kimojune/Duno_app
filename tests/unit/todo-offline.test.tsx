// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Outbox, OutboxItem } from "../../lib/outbox";
import type { TodayRead } from "../../lib/today-types";
import type { TodoDay, TodoItem, TodoResult } from "../../lib/todos/types";

const addTodo = vi.fn();
const signOut = vi.fn();
vi.mock("../../app/todos/actions", () => ({
  addTodo: (...a: unknown[]) => addTodo(...a),
  setTodoDone: vi.fn(),
  addCategory: vi.fn(),
}));
vi.mock("../../lib/read-client", () => ({
  fetchToday: async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: true, data: { categories: [] } } }),
}));
vi.mock("../../app/actions", () => ({ signOut: (...a: unknown[]) => signOut(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { TodoScreen } from "../../components/todo-screen";

const DAY: TodoDay = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const ID_OLD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INITIAL: TodayRead = {
  todos: { ok: true, data: { day: DAY, todos: [] } },
  categories: { ok: true, data: { categories: [] } },
};

function memoryOutbox(initial: OutboxItem[] = []) {
  let stored = [...initial];
  const box: Outbox & { stored: () => OutboxItem[] } = {
    load: () => [...stored],
    save: (items) => {
      stored = [...items];
    },
    clear: () => {
      stored = [];
    },
    stored: () => stored,
  };
  return box;
}
const item = (id: string, text: string): TodoItem => ({ id, readable: true, text, done: false, createdAt: "2026-11-07T01:00:00.000Z", categoryId: null });
const ok = (todo: TodoItem): TodoResult<{ todo: TodoItem }> => ({ ok: true, data: { todo } });
function setOnline(value: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
}
async function goOnline() {
  setOnline(true);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
}
async function write(text: string) {
  const open = screen.queryByRole("button", { name: /^(할 일 적기|적던 글 이어 적기)$/ });
  if (open) fireEvent.click(open);
  fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: text } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "적기" })));
}
async function mount(outbox: Outbox | undefined, initial: TodayRead = INITIAL) {
  render(<TodoScreen initial={initial} outbox={outbox} />);
  await act(async () => {});
}

beforeEach(() => {
  addTodo.mockReset();
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  setOnline(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("오프라인으로 할 일 적기 (PRD 10절)", () => {
  it("끊긴 채 적으면 서버로 보내지 않고 「연결되면 저장해요」 줄로 남고, 글 칸은 비워지며, 기기에 적힌다", async () => {
    const box = memoryOutbox();
    await mount(box);
    setOnline(false);
    await write("지하철에서 적은 글");
    expect(addTodo).not.toHaveBeenCalled();
    expect(screen.getByText("지하철에서 적은 글")).toBeTruthy();
    expect(screen.getByText("연결되면 저장해요")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "할 일 적기" }) as HTMLInputElement).value).toBe("");
    expect(box.stored()).toEqual([
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/), text: "지하철에서 적은 글", categoryId: null, writtenAt: expect.any(String) },
    ]);
    // 옛 안내(글을 못 적는다)는 나오지 않는다
    expect(screen.queryByText("인터넷에 연결되면 적을 수 있어요. 적은 글은 그대로 있어요.")).toBeNull();
  });

  it("연결이 돌아오면 같은 id·글·적은 때로 보내고, 저장되면 줄이 저장됨이 되며 기기에서 지워진다", async () => {
    const box = memoryOutbox();
    await mount(box);
    setOnline(false);
    await write("나중에 올릴 글");
    const queued = box.stored()[0];
    addTodo.mockImplementation(async (id: string, text: string) => ok(item(id, text)));
    await goOnline();
    expect(addTodo).toHaveBeenCalledTimes(1);
    expect(addTodo).toHaveBeenCalledWith(queued.id, "나중에 올릴 글", null, queued.writtenAt);
    expect(screen.queryByText("연결되면 저장해요")).toBeNull();
    expect(box.stored()).toEqual([]);
  });

  it("앱을 닫았다 열어도(보관함에 남은 글) 연결 대기 줄로 올라오고 연결이 있으면 바로 보낸다", async () => {
    const box = memoryOutbox([{ id: ID_OLD, text: "어제 적어 둔 글", categoryId: null, writtenAt: "2026-11-06T10:00:00.000Z" }]);
    addTodo.mockImplementation(async (id: string, text: string) => ok(item(id, text)));
    await mount(box);
    await act(async () => {});
    expect(addTodo).toHaveBeenCalledWith(ID_OLD, "어제 적어 둔 글", null, "2026-11-06T10:00:00.000Z");
    expect(screen.getByText("어제 적어 둔 글")).toBeTruthy();
    expect(box.stored()).toEqual([]);
  });

  it("끊긴 채 다시 열면 남은 글이 연결 대기로 보이고 보내지 않는다", async () => {
    setOnline(false);
    const box = memoryOutbox([{ id: ID_OLD, text: "남은 글", categoryId: null, writtenAt: "2026-11-07T01:00:00.000Z" }]);
    await mount(box);
    expect(screen.getByText("남은 글")).toBeTruthy();
    expect(screen.getByText("연결되면 저장해요")).toBeTruthy();
    expect(addTodo).not.toHaveBeenCalled();
    expect(box.stored()).toHaveLength(1);
  });

  it("보내기가 실패하면 줄은 「저장하지 못했어요」로 남고 기기에도 남으며, 「다시」는 같은 적은 때로 다시 보낸다", async () => {
    const box = memoryOutbox();
    await mount(box);
    setOnline(false);
    await write("실패할 글");
    const queued = box.stored()[0];
    addTodo.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    await goOnline();
    expect(screen.getByText("저장하지 못했어요.")).toBeTruthy();
    expect(box.stored()).toHaveLength(1);
    addTodo.mockImplementation(async (id: string, text: string) => ok(item(id, text)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시" })));
    expect(addTodo).toHaveBeenLastCalledWith(queued.id, "실패할 글", null, queued.writtenAt);
    expect(box.stored()).toEqual([]);
  });

  it("연결된 채 적었는데 저장이 실패해도 기기에 남아 새로고침 뒤에 이어진다", async () => {
    const box = memoryOutbox();
    addTodo.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    await mount(box);
    await write("연결은 있었는데 실패");
    expect(screen.getByText("저장하지 못했어요.")).toBeTruthy();
    expect(box.stored().map((i) => i.text)).toEqual(["연결은 있었는데 실패"]);
    // 온라인 첫 시도에는 적은 때를 싣지 않는다(옛 호출 꼴 그대로)
    expect(addTodo.mock.calls[0]).toHaveLength(3);
  });

  it("연결 대기 줄은 「빼기」로 뺄 수 있고 기기에서도 지워진다", async () => {
    const box = memoryOutbox();
    await mount(box);
    setOnline(false);
    await write("뺄 글");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "빼기" })));
    expect(screen.queryByText("뺄 글")).toBeNull();
    expect(box.stored()).toEqual([]);
    await goOnline();
    expect(addTodo).not.toHaveBeenCalled();
  });

  it("연결 대기 줄의 체크 칸은 눌러도 바뀌지 않고, 「자세히」도 없다", async () => {
    const box = memoryOutbox();
    await mount(box);
    setOnline(false);
    await write("체크 못 하는 글");
    const check = screen.getByRole("checkbox", { name: "체크 못 하는 글" }) as HTMLInputElement;
    expect(check.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(check);
    expect(check.checked).toBe(false);
  });

  it("로그아웃하면 기기에 둔 못 올린 글을 지운다", async () => {
    const box = memoryOutbox();
    await mount(box);
    setOnline(false);
    await write("지워질 글");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "로그아웃" })));
    // 저장 안 된 글이 있어 확인이 뜬다
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "로그아웃" }).at(-1)!));
    expect(signOut).toHaveBeenCalled();
    expect(box.stored()).toEqual([]);
  });

  it("보관함이 없으면(outbox 없음) 옛 방식 그대로: 끊긴 채 적을 수 없고 글은 칸에 남는다", async () => {
    await mount(undefined);
    setOnline(false);
    await write("못 적는 글");
    expect(addTodo).not.toHaveBeenCalled();
    expect(screen.getByText("인터넷에 연결되면 적을 수 있어요. 적은 글은 그대로 있어요.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "할 일 적기" }) as HTMLInputElement).value).toBe("못 적는 글");
    expect(screen.queryByText("연결되면 저장해요")).toBeNull();
  });

  it("글은 글자 그대로 보인다(꺾쇠가 요소가 되지 않는다)", async () => {
    const box = memoryOutbox([{ id: ID_OLD, text: '<img src=x onerror="window.__o=1">', categoryId: null, writtenAt: "x" }]);
    setOnline(false);
    await mount(box);
    expect(screen.getByText('<img src=x onerror="window.__o=1">')).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
