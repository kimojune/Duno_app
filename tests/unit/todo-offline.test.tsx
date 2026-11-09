// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
import { LOGOUT_REQUEST_NAME, TodoScreenWithLogout } from "./logout-request-helper";

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
/**
 * 화면에 보이는 글만 센다(화면 읽기용 안내 영역 .sr-only는 뺀다).
 * 실패·「어제 날짜로 저장했어요」는 보이는 줄과 안내 영역이 같은 글을 담는데, 안내 영역은 announce(…, { again: true })가 비운 뒤
 * 100ms 뒤에 채운다. 그래서 시험이 빠르면 한 곳, 느리면(전체 시험이 몰려 도는 때) 두 곳에서 잡혀 getByText가 「여러 개」로 실패했다(11-09 04:1x).
 */
function visibleTexts(text: string): HTMLElement[] {
  return screen.queryAllByText(text).filter((el) => !el.closest(".sr-only"));
}
async function mount(outbox: Outbox | undefined, initial: TodayRead = INITIAL) {
  render(<TodoScreenWithLogout initial={initial} outbox={outbox} />);
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
  it("끊긴 채 적으면 서버로 보내지 않고 저장 대기 줄(16px 도는 원 + 숨은 글 「저장 대기」 — 고침9)로 남고, 글 칸은 비워지며, 기기에 적힌다", async () => {
    const box = memoryOutbox();
    await mount(box);
    setOnline(false);
    await write("지하철에서 적은 글");
    expect(addTodo).not.toHaveBeenCalled();
    expect(screen.getByText("지하철에서 적은 글")).toBeTruthy();
    // 고침9: 보이는 글 대신 원(aria-hidden) + 숨은 글 「저장 대기」. 체크 칸 설명으로 이어진다
    const pending = document.querySelector(".save-pending .sr-only") as HTMLElement;
    expect(pending.textContent).toBe("저장 대기");
    const mark = pending.closest(".save-pending")!;
    expect(mark.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(mark.querySelector("svg")!.getAttribute("width")).toBe("16");
    expect(screen.queryByText("연결되면 저장해요")).toBeNull();
    const box1 = screen.getByRole("checkbox", { name: "지하철에서 적은 글" });
    expect(box1.getAttribute("aria-describedby")).toContain(mark.id);
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
    // 올라가면 원과 숨은 글이 함께 사라진다(「저장됨」 같은 글을 줄에 남기지 않음)
    expect(document.querySelector(".save-pending .sr-only")).toBeNull();
    expect(document.querySelector(".save-pending")).toBeNull();
    expect(box.stored()).toEqual([]);
  });

  it("새벽 4시 전에 끊긴 채 적고 4시 뒤에 올리면, 서버가 어제 날짜로 넣은 글은 오늘 목록에서 빠지고 「어제 날짜로 저장했어요」가 보인다 (A4)", async () => {
    const box = memoryOutbox();
    await mount(box);
    setOnline(false);
    await write("자정 넘어 적은 글");
    expect(screen.getByText("자정 넘어 적은 글")).toBeTruthy();
    const yesterday: TodoDay = { date: "2026-11-06", year: 2026, month: 11, dayOfMonth: 6, weekday: 5 };
    addTodo.mockImplementation(async (id: string, text: string) => ({ ok: true, data: { day: yesterday, todo: item(id, text) } }));
    await goOnline();
    expect(addTodo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("자정 넘어 적은 글")).toBeNull(); // 오늘 목록에 「저장됨」으로 남지 않는다
    expect(visibleTexts("어제 날짜로 저장했어요")).toHaveLength(1);
    expect(box.stored()).toEqual([]); // 올라갔으니 기기에서는 지운다
    // 안내 줄의 글 단추 「닫기」(적는 창 머리 단추 「✕」 — 이름 「닫기」 — 와 다르다)
    fireEvent.click(within(document.querySelector<HTMLElement>(".notice-top")!).getByRole("button", { name: "닫기" }));
    expect(visibleTexts("어제 날짜로 저장했어요")).toHaveLength(0);
  });

  it("오늘 날짜로 저장된 글은 그대로 오늘 목록에 남는다 (A4)", async () => {
    await mount(memoryOutbox());
    setOnline(false);
    await write("오늘 글");
    addTodo.mockImplementation(async (id: string, text: string) => ({ ok: true, data: { day: DAY, todo: item(id, text) } }));
    await goOnline();
    expect(screen.getByText("오늘 글")).toBeTruthy();
    expect(screen.queryByText(/날짜로 저장했어요/)).toBeNull();
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
    expect(document.querySelector(".save-pending .sr-only")!.textContent).toBe("저장 대기");
    expect(document.querySelectorAll(".save-pending")).toHaveLength(1);
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
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(1);
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
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(1);
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: LOGOUT_REQUEST_NAME })));
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
    expect(document.querySelector(".save-pending")).toBeNull();
  });

  it("글은 글자 그대로 보인다(꺾쇠가 요소가 되지 않는다)", async () => {
    const box = memoryOutbox([{ id: ID_OLD, text: '<img src=x onerror="window.__o=1">', categoryId: null, writtenAt: "x" }]);
    setOnline(false);
    await mount(box);
    expect(screen.getByText('<img src=x onerror="window.__o=1">')).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
