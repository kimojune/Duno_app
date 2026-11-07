// @vitest-environment jsdom
import { randomBytes, randomUUID } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManageApi } from "../../lib/manage-api";
import type { TodayRead } from "../../lib/today-types";
import { listTodosForPastDay } from "../../lib/todos/core";
import { encryptTodoText, parseTodoKey, type TodoKey } from "../../lib/todos/crypto";
import type { TodayTodos, TodoDay, TodoItem, TodoResult } from "../../lib/todos/types";
import { FakeDb, fakeClient } from "./fake-supabase";

vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../lib/read-client", () => ({
  fetchToday: vi.fn(async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } })),
}));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { PastDays } from "../../components/past-days";
import { TodoScreen } from "../../components/todo-screen";

const TODAY: TodoDay = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const A = "11111111-1111-4111-8111-111111111111";

function todo(id: string, text: string, done = false): TodoItem {
  return { id, readable: true, text, done, createdAt: "2026-11-06T01:00:00.000Z", categoryId: null };
}
function dayOf(date: string): TodoDay {
  const [y, m, d] = date.split("-").map(Number);
  return { date, year: y, month: m, dayOfMonth: d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
function manageApi(fetchDay: ManageApi["fetchDay"]): ManageApi {
  return {
    editTodo: vi.fn(),
    deleteTodo: vi.fn(),
    reorderTodos: vi.fn(),
    addNote: vi.fn(),
    deleteNote: vi.fn(),
    fetchNotes: vi.fn(async () => ({ ok: true as const, data: { notes: [] } })),
    fetchYesterday: vi.fn(async () => ({ ok: true as const, data: { todos: [] as TodoItem[] } })),
    carryOver: vi.fn(),
    fetchDay,
  } as unknown as ManageApi;
}

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("지난 날 보기 화면 (고침 3바퀴 PM 답 d-69 ⑦)", () => {
  it("어제 할 일을 보기만 한다: 글과 「끝냄」만 있고 체크 칸·고치기·적기 단추가 없다", async () => {
    const fetchDay = vi.fn(async (date: string): Promise<TodoResult<TodayTodos>> => ({ ok: true, data: { day: dayOf(date), todos: [todo(A, "단어 외우기", true), todo("b", "이력서")] } }));
    render(<PastDays api={manageApi(fetchDay)} today={TODAY.date} onClose={vi.fn()} />);
    expect(await screen.findByText("단어 외우기")).toBeTruthy();
    expect(fetchDay).toHaveBeenCalledWith("2026-11-06");
    expect(screen.getByText("11월 6일 금요일")).toBeTruthy();
    expect(screen.getByText("끝냄")).toBeTruthy();
    expect(screen.getByText("보기만 할 수 있어요.")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /적기|자세히|빼기/ })).toBeNull();
  });
  it("「이전 날」로 하루씩 거슬러 가고, 「다음 날」은 어제까지만(오늘·앞날은 못 본다)", async () => {
    const fetchDay = vi.fn(async (date: string): Promise<TodoResult<TodayTodos>> => ({ ok: true, data: { day: dayOf(date), todos: [] } }));
    render(<PastDays api={manageApi(fetchDay)} today={TODAY.date} onClose={vi.fn()} />);
    await screen.findByText("그날 적은 할 일이 없어요.");
    const newer = screen.getByRole("button", { name: "다음 날" }) as HTMLButtonElement;
    expect(newer.disabled).toBe(true); // 어제가 가장 최근
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "이전 날" })));
    await screen.findByText("11월 5일 목요일");
    expect(fetchDay).toHaveBeenLastCalledWith("2026-11-05");
    expect((screen.getByRole("button", { name: "다음 날" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다음 날" })));
    await screen.findByText("11월 6일 금요일");
    expect(fetchDay.mock.calls.map((c) => c[0])).toEqual(["2026-11-06", "2026-11-05", "2026-11-06"]);
  });
  it("읽지 못하면 안내와 「다시 불러오기」, 닫기와 Esc가 닫는다", async () => {
    let fail = true;
    const fetchDay = vi.fn(async (date: string): Promise<TodoResult<TodayTodos>> =>
      fail ? { ok: false, error: "unavailable" } : { ok: true, data: { day: dayOf(date), todos: [todo(A, "글")] } },
    );
    const onClose = vi.fn();
    render(<PastDays api={manageApi(fetchDay)} today={TODAY.date} onClose={onClose} />);
    expect(await screen.findByText("할 일을 불러오지 못했어요.")).toBeTruthy();
    fail = false;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" })));
    expect(await screen.findByText("글")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("글은 글자 그대로 보인다(꺾쇠가 요소가 되지 않는다)", async () => {
    const tagged = '<b>굵게</b> <img src=x onerror="window.__x=1">';
    const fetchDay = vi.fn(async (date: string): Promise<TodoResult<TodayTodos>> => ({ ok: true, data: { day: dayOf(date), todos: [todo(A, tagged)] } }));
    const { container } = render(<PastDays api={manageApi(fetchDay)} today={TODAY.date} onClose={vi.fn()} />);
    expect(await screen.findByText(tagged)).toBeTruthy();
    expect(container.querySelector("b, img")).toBeNull();
  });
});

describe("할 일 화면의 「지난 날 보기」 입구", () => {
  function initial(): TodayRead {
    return { todos: { ok: true, data: { day: TODAY, todos: [] } }, categories: { ok: true, data: { categories: [] } } };
  }
  it("fetchDay가 있으면 입구가 있고 누르면 창이 열리며 어제를 읽는다. 없으면 입구도 없다", async () => {
    const fetchDay = vi.fn(async (date: string): Promise<TodoResult<TodayTodos>> => ({ ok: true, data: { day: dayOf(date), todos: [todo(A, "어제 글")] } }));
    const { unmount } = render(<TodoScreen initial={initial()} manage={manageApi(fetchDay)} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "지난 날 보기" })));
    const dialog = await screen.findByRole("dialog", { name: "지난 날" });
    expect(await within(dialog).findByText("어제 글")).toBeTruthy();
    unmount();
    render(<TodoScreen initial={initial()} manage={manageApi(undefined)} />);
    await waitFor(() => expect(screen.getByText("오늘")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "지난 날 보기" })).toBeNull();
  });
});

describe("listTodosForPastDay (서버)", () => {
  const key: TodoKey = parseTodoKey(randomBytes(32).toString("base64"))!;
  const NOW = new Date("2026-11-07T10:00:00+09:00");
  const me = randomUUID();
  const other = randomUUID();
  function setup() {
    const db = new FakeDb();
    const put = (user_id: string, day: string, text: string, done = false) =>
      db.rows.push({ id: randomUUID(), user_id, day, text_encrypted: encryptTodoText(text, user_id, key), done, created_at: db.nextCreatedAt(), category_id: null });
    return { db, put, deps: (sub: string | null = me) => ({ supabase: fakeClient(db, { sub }), key, now: () => NOW }) };
  }
  it("그 날 내 할 일만 읽는다(남의 것·다른 날은 안 나온다)", async () => {
    const { put, deps } = setup();
    put(me, "2026-11-06", "어제 내 글", true);
    put(me, "2026-11-05", "그제 내 글");
    put(other, "2026-11-06", "남의 글");
    const res = await listTodosForPastDay(deps(), "2026-11-06");
    expect(res.ok && res.data.day.date).toBe("2026-11-06");
    expect(res.ok && res.data.todos.map((t) => (t.readable ? t.text : null))).toEqual(["어제 내 글"]);
  });
  it("오늘·앞날·잘못된 날짜는 invalid_input(앞날 적기·보기는 없다), 로그인이 없으면 unauthenticated", async () => {
    const { db, deps } = setup();
    for (const bad of ["2026-11-07", "2026-11-08", "2026-13-40", "어제", 5, undefined, null, "2026-11-06T00:00"]) {
      expect(await listTodosForPastDay(deps(), bad)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(db.calls.filter((c) => c.table === "todos")).toHaveLength(0);
    expect(await listTodosForPastDay(deps(null), "2026-11-06")).toEqual({ ok: false, error: "unauthenticated" });
  });
  it("새벽 4시 전의 서버 시계는 아직 전날이라 그 전날이 「지난 날」이다", async () => {
    const { put, deps } = setup();
    put(me, "2026-11-06", "글");
    const early = { ...deps(), now: () => new Date("2026-11-07T03:00:00+09:00") }; // 두노 하루로는 11-06
    expect(await listTodosForPastDay(early, "2026-11-06")).toEqual({ ok: false, error: "invalid_input" });
    expect((await listTodosForPastDay(early, "2026-11-05")).ok).toBe(true);
  });
});
