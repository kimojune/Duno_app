// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayRead } from "../../lib/today-types";
import type { TodoDay, TodoItem } from "../../lib/todos/types";

/**
 * MO-17 ①: 목록 다시 불러오기가 Server Action 줄에 서지 않는다.
 * 쓰기(addTodo·setTodoDone)만 가짜 Action으로 바꾸고, 다시 읽기는 진짜 lib/read-client가 fetch로 GET /todos/today를 부른다.
 * (Next의 Server Action은 하나씩 줄 서서 돈다. 다시 읽기가 Action이면 아래 「적기가 끝나지 않는 동안」 목록이 바뀔 수 없다.)
 * 읽기 결과는 할 일 + 분야를 나눠 싣는다(C-D5).
 */

const addTodo = vi.fn();
const setTodoDone = vi.fn();
vi.mock("../../app/todos/actions", () => ({
  addTodo: (...a: unknown[]) => addTodo(...a),
  setTodoDone: (...a: unknown[]) => setTodoDone(...a),
}));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { TodoScreen } from "../../components/todo-screen";

const DAY: TodoDay = { date: "2026-11-05", year: 2026, month: 11, dayOfMonth: 5, weekday: 4 };
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const item = (id: string, text: string): TodoItem => ({
  id,
  readable: true,
  text,
  done: false,
  createdAt: "2026-11-05T01:00:00.000Z",
  categoryId: null,
});
const NO_CATEGORIES: TodayRead["categories"] = { ok: true, data: { categories: [] } };
const ok = (todos: TodoItem[]): TodayRead => ({ todos: { ok: true, data: { day: DAY, todos } }, categories: NO_CATEGORIES });
const failed = (error: "unauthenticated" | "unavailable"): TodayRead => ({
  todos: { ok: false, error },
  categories: { ok: false, error },
});

let fetchMock: ReturnType<typeof vi.fn>;
let serverTodos: TodoItem[];

beforeEach(() => {
  addTodo.mockReset();
  setTodoDone.mockReset();
  serverTodos = [];
  fetchMock = vi.fn(async () => new Response(JSON.stringify(ok(serverTodos)), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fireVisible() {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("MO-17 ① 다시 불러오기는 적기·체크와 나란히 돈다", () => {
  it("적기(addTodo) 응답이 끝나지 않는 동안 다시 불러오기가 끝나 목록이 바뀐다", async () => {
    render(<TodoScreen initial={ok([item(ID_A, "처음 글")])} />);
    let addResolved = false;
    addTodo.mockReturnValue(new Promise(() => {}).then(() => (addResolved = true))); // 끝나지 않는 적기
    fireEvent.click(screen.getByRole("button", { name: "할 일 적기" })); // 방향 C: 적는 창을 연다
    fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: "느린 망에서 적은 글" } });
    fireEvent.click(screen.getByRole("button", { name: "적기" }));
    expect(addTodo).toHaveBeenCalledTimes(1);

    serverTodos = [item(ID_A, "처음 글"), item(ID_B, "다른 기기에서 적은 글")];
    fireVisible();
    expect(await screen.findByText("다른 기기에서 적은 글")).toBeTruthy();
    expect(addResolved).toBe(false); // 적기는 아직 끝나지 않았다
    expect(screen.getByText("저장하는 중")).toBeTruthy(); // 저장 중인 줄은 그대로 끝에 남는다
    expect(screen.getByText("느린 망에서 적은 글")).toBeTruthy();

    // 다시 읽기는 같은 출처 GET /todos/today 하나였다(Server Action이 아니다. user_id·날짜를 보내지 않는다)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/todos/today");
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(init.body).toBeUndefined();
  });

  it("체크(setTodoDone) 응답이 끝나지 않는 동안에도 다시 불러오기가 끝난다", async () => {
    render(<TodoScreen initial={ok([item(ID_A, "체크할 글")])} />);
    setTodoDone.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole("checkbox", { name: "체크할 글" }));
    expect(setTodoDone).toHaveBeenCalledTimes(1);
    serverTodos = [item(ID_A, "체크할 글"), item(ID_B, "새로 보인 글")];
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByText("새로 보인 글")).toBeTruthy();
    // 체크를 보내는 중인 줄은 화면 값(켬)을 지킨다
    expect((screen.getByRole("checkbox", { name: "체크할 글" }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("처음 목록은 서버 컴포넌트가 넘긴다", () => {
  it("initial이 있으면 처음에 다시 읽지 않고 바로 목록·개수를 그린다", async () => {
    render(<TodoScreen initial={ok([item(ID_A, "서버가 넘긴 글")])} />);
    expect(screen.getByText("서버가 넘긴 글")).toBeTruthy();
    expect(screen.getByText(/1개 중 0개 끝냄/)).toBeTruthy();
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("initial이 로그인 풀림이면 목록 없이 안내만(T13c), 다시 읽지 않는다", async () => {
    render(<TodoScreen initial={failed("unauthenticated")} />);
    expect(screen.getByText("로그인이 풀렸어요. 다시 로그인해 주세요.").closest("[role=alert]")).toBeTruthy();
    expect(screen.queryByText(/개 중 \d개 끝냄/)).toBeNull();
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("initial이 실패면 T9이고 「다시 불러오기」는 GET으로 다시 읽는다", async () => {
    render(<TodoScreen initial={failed("unavailable")} />);
    expect(screen.getByText("할 일을 불러오지 못했어요.").closest("[role=alert]")).toBeTruthy();
    serverTodos = [item(ID_A, "돌아온 글")];
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(await screen.findByText("돌아온 글")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GET 응답이 망가졌거나 네트워크가 끊기면 unavailable로 다룬다(던지지 않는다)", async () => {
    render(<TodoScreen initial={failed("unavailable")} />);
    fetchMock.mockResolvedValueOnce(new Response("<html>not json</html>", { status: 502 }));
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("할 일을 불러오지 못했어요.")).toBeTruthy();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("할 일을 불러오지 못했어요.")).toBeTruthy();
  });

  it("분야만 못 읽어도(C-D5) 할 일 목록은 그대로 보인다", async () => {
    render(
      <TodoScreen
        initial={{
          todos: { ok: true, data: { day: DAY, todos: [item(ID_A, "할 일은 보임")] } },
          categories: { ok: false, error: "unavailable" },
        }}
      />,
    );
    expect(screen.getByText("할 일은 보임")).toBeTruthy();
    expect(screen.queryByText("할 일을 불러오지 못했어요.")).toBeNull();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          todos: { ok: true, data: { day: DAY, todos: [item(ID_B, "다시 읽은 글")] } },
          categories: { ok: false, error: "unavailable" },
        }),
      ),
    );
    fireVisible();
    expect(await screen.findByText("다시 읽은 글")).toBeTruthy();
  });
});
