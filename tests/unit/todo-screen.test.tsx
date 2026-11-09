// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoDay, TodoItem, TodoResult } from "../../lib/todos/types";

const fetchTodayTodos = vi.fn();
const addTodo = vi.fn();
const setTodoDone = vi.fn();
const addCategory = vi.fn();
const signOut = vi.fn();
const refresh = vi.fn();
// MO-17 ①: 목록 다시 읽기는 Server Action이 아니라 GET(lib/read-client)이다. 쓰기만 Action을 가짜로 바꾼다.
// 읽기 결과는 할 일 + 분야(C-D5)라, 가짜 fetchToday는 할 일 칸에 fetchTodayTodos가 준 값을 싣는다(1단계 화면은 할 일 칸만 쓴다).
vi.mock("../../app/todos/actions", () => ({
  addTodo: (...a: unknown[]) => addTodo(...a),
  setTodoDone: (...a: unknown[]) => setTodoDone(...a),
  addCategory: (...a: unknown[]) => addCategory(...a),
}));
vi.mock("../../lib/read-client", () => ({
  fetchToday: async (...a: unknown[]) => ({
    todos: await fetchTodayTodos(...a),
    categories: { ok: true, data: { categories: [] } },
  }),
}));
vi.mock("../../app/actions", () => ({ signOut: (...a: unknown[]) => signOut(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

import { SAVE_TIMEOUT_MS, SAVING_HINT_DELAY_MS, TodoScreen } from "../../components/todo-screen";

const DAY: TodoDay = { date: "2026-11-05", year: 2026, month: 11, dayOfMonth: 5, weekday: 4 };
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

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
function item(id: string, text: string, done = false): TodoItem {
  return { id, readable: true, text, done, createdAt: "2026-11-05T01:00:00.000Z", categoryId: null };
}
const ok = <T,>(data: T): TodoResult<T> => ({ ok: true, data });
const fail = (error: "unauthenticated" | "unavailable" | "too_long"): TodoResult<never> => ({ ok: false, error });

function setOnline(value: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function renderLoaded(todos: TodoItem[] = []) {
  fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos }));
  render(<TodoScreen />);
  await screen.findByText(/개 중 \d개 끝냄/);
}

/** 방향 C: 할 일 칸은 적는 창 안에 있다. 창이 닫혀 있으면 「할 일 적기」 단추로 연다(옛 A 화면의 입력 줄 자리) */
function openSheet() {
  const button = screen.queryByRole("button", { name: /^(할 일 적기|적던 글 이어 적기)$/ });
  if (button) fireEvent.click(button);
}
function input() {
  openSheet();
  return screen.getByRole("textbox", { name: "할 일 적기" }) as HTMLInputElement;
}
function write(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}
function press() {
  fireEvent.click(screen.getByRole("button", { name: "적기" }));
}

beforeEach(() => {
  for (const m of [fetchTodayTodos, addTodo, setTodoDone, addCategory, signOut, refresh]) m.mockReset();
  setOnline(true);
  signOut.mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = vi.fn(); // jsdom에는 없다
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("할 일 화면 (T1~T4, 풀 수 없는 행)", () => {
  it("T1 불러오는 동안 목록 자리는 aria-busy, 뼈대는 aria-hidden이고, 끝나면 개수가 보인다", async () => {
    const d = deferred<TodoResult<{ day: TodoDay; todos: TodoItem[] }>>();
    fetchTodayTodos.mockReturnValue(d.promise);
    const { container } = render(<TodoScreen />);
    expect(container.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".todo-skeleton")?.getAttribute("aria-hidden")).toBe("true");
    d.resolve(ok({ day: DAY, todos: [item(ID_A, "첫 글")] }));
    await screen.findByText(/1개 중 0개 끝냄/);
    expect(container.querySelector("main")?.getAttribute("aria-busy")).toBe("false");
    expect(screen.getAllByRole("status").some((el) => el.textContent === "할 일 1개를 불러왔어요")).toBe(true);
  });

  it("T2 빈 목록은 0개 중 0개 끝냄과 예시(고침9 ⑬ 9), 이메일은 어디에도 없다", async () => {
    await renderLoaded([]);
    expect(screen.getByText(/0개 중 0개 끝냄/)).toBeTruthy();
    expect(screen.getByText("오늘 적은 할 일이 없어요.")).toBeTruthy();
    // 고침9 ⑬ 9: 「아래 단추를 눌러 적어 보세요.」 대신 이름표 「예시」 + 예시 할 일 줄 둘(누를 것 없음, 목록·개수에 안 섞임)
    expect(screen.queryByText("아래 단추를 눌러 적어 보세요.")).toBeNull();
    const example = screen.getByRole("region", { name: "예시" });
    expect(example.querySelectorAll("li")).toHaveLength(2);
    expect(example.textContent).toContain("토익 단어 50개");
    expect(example.textContent).toContain("포트폴리오 2장 고치기");
    expect(example.querySelectorAll("button, input, a, [tabindex]")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    // 흐림은 모양에만: 예시 글은 보조 글 색 클래스, 흐린 점은 opacity 규칙을 받는 클래스
    expect(example.querySelector(".todo-example-text")).not.toBeNull();
    expect(example.querySelectorAll(".todo-example-dot")).toHaveLength(2);
    expect(example.querySelectorAll(".todo-example-check")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("@");
  });

  it("T3 체크 칸은 할 일 글을 이름으로 갖는 체크 상자다", async () => {
    await renderLoaded([item(ID_A, "이력서 쓰기"), item(ID_B, "면접 준비", true)]);
    expect((screen.getByRole("checkbox", { name: "이력서 쓰기" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "면접 준비" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/2개 중 1개 끝냄/)).toBeTruthy();
  });

  it("악용: 꺾쇠·스크립트가 든 글은 글자 그대로 보이고 요소가 생기지 않는다", async () => {
    const evil = '<img src=x onerror="window.__x=1"><script>window.__y=1</script>';
    await renderLoaded([item(ID_A, evil)]);
    expect(screen.getByText(evil)).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("풀 수 없는 행은 그 줄만 「읽을 수 없는 할 일」로 보이고 나머지 목록은 멀쩡하다", async () => {
    fetchTodayTodos.mockResolvedValue(
      ok({
        day: DAY,
        todos: [item(ID_A, "멀쩡한 글"), { id: ID_B, readable: false, text: null, done: false, createdAt: "2026-11-05T02:00:00.000Z", categoryId: null }],
      }),
    );
    render(<TodoScreen />);
    expect(await screen.findByText("읽을 수 없는 할 일")).toBeTruthy();
    expect(screen.getByText("멀쩡한 글")).toBeTruthy();
  });

  it("T9 불러오기 실패는 role=alert와 「다시 불러오기」, 누르면 다시 불러온다", async () => {
    fetchTodayTodos.mockResolvedValueOnce(fail("unavailable"));
    render(<TodoScreen />);
    const alert = await screen.findByText("할 일을 불러오지 못했어요.");
    expect(alert.closest("[role=alert]")).toBeTruthy();
    fetchTodayTodos.mockResolvedValueOnce(ok({ day: DAY, todos: [item(ID_A, "돌아온 글")] }));
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(await screen.findByText("돌아온 글")).toBeTruthy();
    expect(fetchTodayTodos).toHaveBeenCalledTimes(2);
  });
});

describe("적기 (T6, T7, T11, D4)", () => {
  it("서로 다른 두 글은 id가 다르고, 「다시」는 처음 id·같은 글로만 다시 보낸다 (addTodo 계약)", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValueOnce(fail("unavailable")); // 첫 글: 저장 실패
    addTodo.mockResolvedValueOnce(ok({ day: DAY, todo: item("33333333-3333-4333-8333-333333333333", "둘째 글") }));
    write("첫째 글");
    press();
    await findOneVisible("저장하지 못했어요.");
    write("둘째 글");
    press();
    await waitFor(() => expect(addTodo).toHaveBeenCalledTimes(2));
    const [id1, text1] = addTodo.mock.calls[0];
    const [id2, text2] = addTodo.mock.calls[1];
    expect(id1).not.toBe(id2);
    expect([text1, text2]).toEqual(["첫째 글", "둘째 글"]);

    // 「다시」: 처음 id, 처음 글
    addTodo.mockResolvedValueOnce(ok({ day: DAY, todo: item(id1 as string, "첫째 글") }));
    fireEvent.click(screen.getByRole("button", { name: "다시" }));
    await waitFor(() => expect(addTodo).toHaveBeenCalledTimes(3));
    expect(addTodo.mock.calls[2]).toEqual([id1, "첫째 글", null]); // 방향 C: 셋째 인자는 분야 번호(null = 기타)
    await waitFor(() => expect(visibleTexts("저장하지 못했어요.")).toHaveLength(0));
    expect(screen.getAllByText("첫째 글")).toHaveLength(1); // 줄은 하나
  });

  it("T6 첫 누름에 칸이 비고 줄이 생기며(저장하는 중), 연타해도 한 번만 보낸다", async () => {
    await renderLoaded([]);
    const d = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValue(d.promise);
    write("연타할 글");
    press();
    press();
    press();
    expect(input().value).toBe("");
    expect(addTodo).toHaveBeenCalledTimes(1);
    expect(screen.getByText("저장하는 중")).toBeTruthy();
    expect(document.activeElement).toBe(input()); // 포커스는 입력 칸에 남는다
    d.resolve(ok({ day: DAY, todo: item(addTodo.mock.calls[0][0], "연타할 글") }));
    await waitFor(() => expect(screen.queryByText("저장하는 중")).toBeNull());
    expect(screen.getAllByText("연타할 글")).toHaveLength(1);
  });

  it("빈 칸으로 「적기」: 아무것도 만들지 않고 포커스가 칸에 남는다", async () => {
    await renderLoaded([]);
    write("   ");
    press();
    expect(addTodo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("T6 저장 중인 줄의 체크 칸은 aria-disabled와 「저장하는 중」 설명을 갖고, 눌러도 바뀌지 않는다", async () => {
    await renderLoaded([]);
    addTodo.mockReturnValue(new Promise(() => {}));
    write("저장 중인 글");
    press();
    const box = screen.getByRole("checkbox", { name: "저장 중인 글" }) as HTMLInputElement;
    expect(box.getAttribute("aria-disabled")).toBe("true");
    const describedBy = box.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toBe("저장하는 중");
    fireEvent.click(box);
    expect(setTodoDone).not.toHaveBeenCalled();
    expect(box.checked).toBe(false);
  });

  it("T7 저장 실패: 글이 남고 안내는 role=status, 「빼기」는 그 줄을 치운다", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValue(fail("unavailable"));
    write("못 저장한 글");
    press();
    const status = await findOneVisible("저장하지 못했어요.");
    expect(status.getAttribute("role")).toBe("status");
    expect(screen.getByText("못 저장한 글")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "빼기" }));
    expect(screen.queryByText("못 저장한 글")).toBeNull();
  });

  it("T11 300자를 붙여 넣어도 몰래 자르지 않고 안내하며, 보내지 않는다 (maxlength 없음)", async () => {
    await renderLoaded([]);
    const long = "가".repeat(300);
    write(long);
    expect(input().value).toBe(long);
    expect(input().getAttribute("maxlength")).toBeNull();
    const help = document.getElementById("todo-help")!;
    expect(help.textContent).toBe("200자까지 적을 수 있어요. 지금 300자예요.");
    expect(input().getAttribute("aria-describedby")).toBe("todo-help");
    press();
    expect(addTodo).not.toHaveBeenCalled();
    expect(input().value).toBe(long);
    expect(document.activeElement).toBe(input());
  });

  it("T11 180자부터 「180/200」, 200자는 그대로 보낸다 (정상 입력은 통과)", async () => {
    await renderLoaded([]);
    write("나".repeat(180));
    expect(document.getElementById("todo-help")!.textContent).toBe("180/200");
    const exactly = "나".repeat(200);
    addTodo.mockResolvedValue(ok({ day: DAY, todo: item(ID_A, exactly) }));
    write(exactly);
    press();
    await waitFor(() => expect(addTodo).toHaveBeenCalledTimes(1));
    expect(addTodo.mock.calls[0][1]).toBe(exactly);
  });

  it("T10 오프라인에서 「적기」: 글이 지워지지 않고 도움말이 나오며, 연결되면 안내가 사라지고 목록을 다시 불러온다", async () => {
    await renderLoaded([item(ID_A, "있던 글")]);
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(oneVisible("인터넷 연결이 끊겼어요. 연결되면 적고 끝냄 표시를 할 수 있어요.").closest("[role=status]")).toBeTruthy();
    write("지하철에서 적은 글");
    press();
    expect(addTodo).not.toHaveBeenCalled();
    expect(input().value).toBe("지하철에서 적은 글");
    expect(document.getElementById("todo-help")!.textContent).toBe("인터넷에 연결되면 적을 수 있어요. 적은 글은 그대로 있어요.");
    // 체크 칸도 바뀌지 않는다
    fireEvent.click(screen.getByRole("checkbox", { name: "있던 글" }));
    expect(setTodoDone).not.toHaveBeenCalled();

    setOnline(true);
    fetchTodayTodos.mockClear();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(fetchTodayTodos).toHaveBeenCalledTimes(1));
    expect(visibleTexts("인터넷 연결이 끊겼어요. 연결되면 적고 끝냄 표시를 할 수 있어요.")).toHaveLength(0);
    expect(input().value).toBe("지하철에서 적은 글"); // 입력 칸 글은 건드리지 않는다 (D10)
  });
});

describe("체크 (T8, D5)", () => {
  it("빠르게 여러 번 눌러도 마지막 값이 저장된다: 보낸 값은 켬·끔·켬이고 응답 순서가 뒤집혀도 켬으로 남는다", async () => {
    await renderLoaded([item(ID_A, "연타 체크")]);
    const resolvers: ((v: TodoResult<{ id: string; done: boolean }>) => void)[] = [];
    setTodoDone.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve as (v: TodoResult<{ id: string; done: boolean }>) => void)),
    );
    const box = screen.getByRole("checkbox", { name: "연타 체크" }) as HTMLInputElement;
    fireEvent.click(box);
    fireEvent.click(box);
    fireEvent.click(box);
    expect(setTodoDone.mock.calls.map((c) => c[1])).toEqual([true, false, true]);
    expect(box.checked).toBe(true);
    // 응답이 거꾸로 와도(앞 것이 늦게) 화면은 마지막 값
    resolvers[2](ok({ id: ID_A, done: true }));
    resolvers[1](ok({ id: ID_A, done: false }));
    resolvers[0](ok({ id: ID_A, done: true }));
    await act(async () => {});
    expect(box.checked).toBe(true);
  });

  it("T8 체크 바꾸기가 실패하면 칸이 원래대로 돌아가고 안내가 나온다", async () => {
    await renderLoaded([item(ID_A, "실패할 체크")]);
    setTodoDone.mockResolvedValue(fail("unavailable"));
    const box = screen.getByRole("checkbox", { name: "실패할 체크" }) as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true); // 누른 즉시 바뀐다
    await findOneVisible("끝냄 표시를 바꾸지 못했어요. 다시 눌러 주세요.");
    expect(box.checked).toBe(false);
  });

  it("체크를 보낼 때 id와 원하는 값만 보낸다(user_id·날짜 없음)", async () => {
    await renderLoaded([item(ID_A, "인자 확인")]);
    setTodoDone.mockResolvedValue(ok({ id: ID_A, done: true }));
    fireEvent.click(screen.getByRole("checkbox", { name: "인자 확인" }));
    await waitFor(() => expect(setTodoDone).toHaveBeenCalledTimes(1));
    expect(setTodoDone.mock.calls[0]).toEqual([ID_A, true]);
    expect(fetchTodayTodos.mock.calls.every((c) => c.length === 0)).toBe(true);
  });
});

describe("로그인 풀림 (T13), 로그아웃 (T16)", () => {
  it("T13 저장 중 401: 로그인 화면으로 넘기지 않고, 글이 보이며, 복사 단추가 클립보드에 넣는다", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValue(fail("unauthenticated"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    write("저장 못 한 글");
    press();
    const alert = await screen.findByText(/로그인이 풀렸어요\. 다시 로그인하면 이 화면을 떠나서/);
    expect(alert.closest("[role=alert]")).toBeTruthy();
    expect(screen.getByText("저장 못 한 글")).toBeTruthy(); // 줄이 T7 모양으로 남는다
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled(); // 바로 넘기지 않는다
    write("입력 칸 글");
    fireEvent.click(screen.getByRole("button", { name: "저장 안 된 글 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("저장 못 한 글\n입력 칸 글"));
    await waitFor(() => expect(screen.getAllByRole("status").some((el) => el.textContent === "복사했어요")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "다시 로그인" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("T13 저장 못 한 글이 없으면 복사 단추와 「사라져요」 문장 없이 짧은 안내만", async () => {
    fetchTodayTodos.mockResolvedValue(fail("unauthenticated"));
    render(<TodoScreen />);
    const alert = await screen.findByText("로그인이 풀렸어요. 다시 로그인해 주세요.");
    expect(alert.closest("[role=alert]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "저장 안 된 글 복사" })).toBeNull();
    expect(screen.queryByText(/사라져요/)).toBeNull();
    expect(screen.queryByText("할 일을 불러오지 못했어요.")).toBeNull(); // T9가 아니라 T13
  });

  it("T16 칸에 글이 있으면 확인을 먼저 보이고, 취소하면 사라지며, 비었으면 바로 로그아웃한다", async () => {
    await renderLoaded([]);
    write("적던 글");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    const notice = screen.getByText("아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.").closest("[role=alert]") as HTMLElement;
    expect(signOut).not.toHaveBeenCalled();
    fireEvent.click(within(notice).getByRole("button", { name: "취소" }));
    expect(screen.queryByText("아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    fireEvent.click(within(screen.getByText("아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.").closest("[role=alert]") as HTMLElement).getByRole("button", { name: "로그아웃" }));
    expect(signOut).toHaveBeenCalledTimes(1);

    signOut.mockClear();
    write("");
    fireEvent.click(screen.getAllByRole("button", { name: "로그아웃" })[0]);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("다시 불러오기 (D10), 새 하루 (T15), 기기 저장 없음 (D6)", () => {
  it("화면이 다시 보일 때 목록을 다시 불러오고 입력 칸 글은 건드리지 않는다", async () => {
    await renderLoaded([item(ID_A, "처음 글")]);
    write("쓰던 글");
    fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos: [item(ID_A, "처음 글"), item(ID_B, "다른 기기에서 적은 글")] }));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("다른 기기에서 적은 글")).toBeTruthy();
    expect(input().value).toBe("쓰던 글");
  });

  it("T15 새벽 4시(서울)를 넘기면 날짜와 목록이 새 하루로 바뀌고 입력 칸 글은 그대로다", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-05T18:59:00Z")); // 서울 11월 6일 03:59 → 두노 하루는 11월 5일
    fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos: [item(ID_A, "어제 글")] }));
    render(<TodoScreen />);
    await act(async () => {});
    expect(screen.getByText(/11월 5일/)).toBeTruthy();
    write("밤에 쓰던 글");
    fetchTodayTodos.mockResolvedValue(
      ok({ day: { date: "2026-11-06", year: 2026, month: 11, dayOfMonth: 6, weekday: 5 }, todos: [] }),
    );
    await act(async () => {
      vi.setSystemTime(new Date("2026-11-05T19:00:05Z"));
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    });
    expect(screen.getByText(/11월 6일 금요일/)).toBeTruthy();
    expect(screen.queryByText("어제 글")).toBeNull();
    expect(input().value).toBe("밤에 쓰던 글");
  });

  it("D6 할 일 글을 localStorage·sessionStorage에 쓰지 않는다", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    await renderLoaded([]);
    addTodo.mockResolvedValue(ok({ day: DAY, todo: item(ID_A, "기기에 두지 않는 글") }));
    write("기기에 두지 않는 글");
    press();
    await screen.findAllByText("기기에 두지 않는 글");
    expect(local).not.toHaveBeenCalled();
  });
});

describe("화면 검토 LOW 고침", () => {
  it("로그인이 풀렸다는 안내는 목록 불러오기가 성공하면 사라지고, 저장 못 한 줄은 그대로 남는다", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValue(fail("unauthenticated"));
    write("저장 못 한 글");
    press();
    await screen.findByText(/로그인이 풀렸어요/);
    fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos: [item(ID_A, "서버에 있던 글")] }));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await screen.findByText("서버에 있던 글");
    await waitFor(() => expect(screen.queryByText(/로그인이 풀렸어요/)).toBeNull());
    expect(screen.getByText("저장 못 한 글")).toBeTruthy();
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(1);
  });

  it("켬 성공이 늦게 도착하고 끔이 실패하면, 화면은 서버 확인값(켬)으로 돌아온다", async () => {
    await renderLoaded([item(ID_A, "엇갈린 체크")]);
    const resolvers: ((v: TodoResult<{ id: string; done: boolean }>) => void)[] = [];
    setTodoDone.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve as (v: TodoResult<{ id: string; done: boolean }>) => void)),
    );
    const box = screen.getByRole("checkbox", { name: "엇갈린 체크" }) as HTMLInputElement;
    fireEvent.click(box); // 켬
    fireEvent.click(box); // 끔
    expect(setTodoDone.mock.calls.map((c) => c[1])).toEqual([true, false]);
    resolvers[1](fail("unavailable")); // 끔 실패(먼저)
    await act(async () => {});
    resolvers[0](ok({ id: ID_A, done: true })); // 켬 성공(늦게)
    await act(async () => {});
    expect(box.checked).toBe(true); // 서버는 켬이다
  });

  it("켬 성공이 먼저 오고 끔이 실패해도 서버 확인값(켬)으로 돌아온다", async () => {
    await renderLoaded([item(ID_A, "차례대로 체크")]);
    const resolvers: ((v: TodoResult<{ id: string; done: boolean }>) => void)[] = [];
    setTodoDone.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve as (v: TodoResult<{ id: string; done: boolean }>) => void)),
    );
    const box = screen.getByRole("checkbox", { name: "차례대로 체크" }) as HTMLInputElement;
    fireEvent.click(box);
    fireEvent.click(box);
    resolvers[0](ok({ id: ID_A, done: true }));
    await act(async () => {});
    expect(box.checked).toBe(false); // 아직 최신 요청 기준
    resolvers[1](fail("unavailable"));
    await act(async () => {});
    expect(box.checked).toBe(true);
  });
});

function liveText(): string {
  return (document.querySelector(".sr-only[role=status]") as HTMLElement).textContent ?? "";
}
function fireVisible() {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
const resolversFor = () => {
  const resolvers: ((v: TodoResult<{ id: string; done: boolean }>) => void)[] = [];
  setTodoDone.mockImplementation(
    () => new Promise((resolve) => resolvers.push(resolve as (v: TodoResult<{ id: string; done: boolean }>) => void)),
  );
  return resolvers;
};

describe("디자인 검토 1차 최우선 (R1·R2·R3·R11)", () => {
  it("R1 확인 1: 3줄을 불러온 뒤 로그인이 풀려도 3줄·개수가 그대로이고 안내가 뜬다 (visibilitychange)", async () => {
    await renderLoaded([item(ID_A, "첫째"), item(ID_B, "둘째", true), item("33333333-3333-4333-8333-333333333333", "셋째")]);
    fetchTodayTodos.mockResolvedValue(fail("unauthenticated"));
    fireVisible();
    const alert = await screen.findByText("로그인이 풀렸어요. 다시 로그인해 주세요.");
    expect(alert.closest("[role=alert]")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByText(/3개 중 1개 끝냄/)).toBeTruthy(); // 개수 = 보이는 줄
    expect(screen.queryByText("오늘 적은 할 일이 없어요.")).toBeNull();
  });

  it("R1 확인 1: online·pageshow(persisted)에서도 줄을 지우지 않는다", async () => {
    await renderLoaded([item(ID_A, "첫째")]);
    fetchTodayTodos.mockResolvedValue(fail("unauthenticated"));
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await screen.findByText(/로그인이 풀렸어요/);
    expect(screen.getByText("첫째")).toBeTruthy();
    expect(fetchTodayTodos).toHaveBeenCalledTimes(2); // 처음 + online
    const event = new Event("pageshow") as Event & { persisted: boolean };
    event.persisted = true;
    act(() => {
      window.dispatchEvent(event);
    });
    // pageshow가 실제로 다시 불러왔고(그 결과도 로그인 풀림), 그 뒤에도 줄이 남는지 본다.
    // (예전에는 다시 불러왔는지 보지 않아, pageshow 처리가 없어도 통과했다)
    await waitFor(() => expect(fetchTodayTodos).toHaveBeenCalledTimes(3));
    await act(async () => {});
    expect(screen.getByText("첫째")).toBeTruthy();
    expect(screen.getByText(/1개 중 0개 끝냄/)).toBeTruthy();
  });

  it("R1 확인 1: 저장 못 한 줄도 로그인이 풀려도 남는다", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValue(fail("unavailable"));
    write("못 저장한 글");
    press();
    await findOneVisible("저장하지 못했어요.");
    fetchTodayTodos.mockResolvedValue(fail("unauthenticated"));
    fireVisible();
    await screen.findByText(/로그인이 풀렸어요/);
    expect(screen.getByText("못 저장한 글")).toBeTruthy();
  });

  it("R1 확인 2: 처음부터 로그인이 풀렸으면 빈 문구·개수 없이 안내만 있고 머리 줄은 날짜만이다", async () => {
    fetchTodayTodos.mockResolvedValue(fail("unauthenticated"));
    const { container } = render(<TodoScreen />);
    await screen.findByText("로그인이 풀렸어요. 다시 로그인해 주세요.");
    expect(screen.queryByText("오늘 적은 할 일이 없어요.")).toBeNull();
    expect(screen.queryByText("아래 칸에 적어 보세요.")).toBeNull();
    expect(screen.queryByText(/개 중 \d개 끝냄/)).toBeNull();
    expect(container.querySelector(".today-date")?.textContent).toMatch(/^\d+월 \d+일 .요일$/);
    expect(container.querySelector(".todo-skeleton")).toBeNull();
  });

  it("R2 저장 못 한 줄의 체크 칸은 눌러도 바뀌지 않고, 서버를 부르지 않으며, 「다시」로 저장되면 눌린다", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValueOnce(fail("unavailable"));
    write("저장 못 한 글");
    press();
    await findOneVisible("저장하지 못했어요.");
    const box = screen.getByRole("checkbox", { name: "저장 못 한 글" }) as HTMLInputElement;
    expect(box.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(box.getAttribute("aria-describedby")!)?.textContent).toBe("저장하지 못했어요.");
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(setTodoDone).not.toHaveBeenCalled();
    expect(visibleTexts("끝냄 표시를 바꾸지 못했어요. 다시 눌러 주세요.")).toHaveLength(0);

    const id = addTodo.mock.calls[0][0] as string;
    addTodo.mockResolvedValueOnce(ok({ day: DAY, todo: item(id, "저장 못 한 글") }));
    setTodoDone.mockResolvedValue(ok({ id, done: true }));
    fireEvent.click(screen.getByRole("button", { name: "다시" }));
    await waitFor(() => expect(screen.queryByText("저장하는 중")).toBeNull()); // 저장됨
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "저장 못 한 글" }));
    await waitFor(() => expect(setTodoDone).toHaveBeenCalledWith(id, true));
  });

  it("R3 저장 못 한 줄이 있으면 입력 칸이 비어 있어도 로그아웃 확인이 뜨고 signOut은 바로 불리지 않는다", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValue(fail("unavailable"));
    write("저장 못 한 글");
    press();
    await findOneVisible("저장하지 못했어요.");
    expect(input().value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    const notice = screen.getByText("아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.").closest("[role=alert]");
    expect(notice).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("R3 저장 중인 줄만 있어도 확인이 뜬다", async () => {
    await renderLoaded([]);
    addTodo.mockReturnValue(new Promise(() => {}));
    write("저장 중인 글");
    press();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(screen.getByText("아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.")).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("R11 글자 수 넘음과 오프라인으로 막히면 도움말과 같은 글을 LiveRegion에도 넣는다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos: [] }));
    render(<TodoScreen />);
    await act(async () => {});
    write("가".repeat(230));
    press();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(liveText()).toBe("200자까지 적을 수 있어요. 지금 230자예요.");
    expect(document.getElementById("todo-help")!.textContent).toBe(liveText());
    expect(input().getAttribute("aria-describedby")).toBe("todo-help");

    write("짧은 글");
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    press();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(liveText()).toBe("인터넷에 연결되면 적을 수 있어요. 적은 글은 그대로 있어요.");
    expect(document.getElementById("todo-help")!.textContent).toBe(liveText());
  });
});

describe("디자인 검토 1차 권장 (R5·R6·L1)", () => {
  it("R5 저장 실패와 체크 실패 안내를 LiveRegion에도 넣는다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos: [item(ID_A, "체크할 글")] }));
    render(<TodoScreen />);
    await act(async () => {});
    addTodo.mockResolvedValue(fail("unavailable"));
    write("저장 안 될 글");
    press();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(liveText()).toBe("저장하지 못했어요.");
    setTodoDone.mockResolvedValue(fail("unavailable"));
    fireEvent.click(screen.getByRole("checkbox", { name: "체크할 글" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(liveText()).toBe("끝냄 표시를 바꾸지 못했어요. 다시 눌러 주세요.");
  });

  it("R6 15초 안에 답이 없으면 그 줄을 T7로 바꾸고, 「다시」는 같은 id이며, 늦은 성공이 오면 줄은 하나로 저장됨이 된다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos: [] }));
    render(<TodoScreen />);
    await act(async () => {});
    const first = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValueOnce(first.promise);
    write("느린 글");
    press();
    expect(screen.getByText("저장하는 중")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS - 1);
    });
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(1);

    const id = addTodo.mock.calls[0][0] as string;
    addTodo.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "다시" }));
    expect(addTodo.mock.calls[1]).toEqual([id, "느린 글", null]); // 같은 id, 같은 글, 같은 분야 번호(기타)

    first.resolve(ok({ day: DAY, todo: item(id, "느린 글") })); // 늦게 온 성공
    await act(async () => {});
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(0);
    expect(screen.queryByText("저장하는 중")).toBeNull();
    expect(screen.getAllByText("느린 글")).toHaveLength(1);
  });

  it("L1 켬 성공이 늦게 와서 화면을 맞출 때 「체크를 바꾸지 못했어요」도 사라진다", async () => {
    await renderLoaded([item(ID_A, "엇갈린 체크")]);
    const resolvers = resolversFor();
    const box = screen.getByRole("checkbox", { name: "엇갈린 체크" }) as HTMLInputElement;
    fireEvent.click(box);
    fireEvent.click(box);
    resolvers[1](fail("unavailable"));
    await findOneVisible("끝냄 표시를 바꾸지 못했어요. 다시 눌러 주세요.");
    resolvers[0](ok({ id: ID_A, done: true }));
    await waitFor(() => expect(visibleTexts("끝냄 표시를 바꾸지 못했어요. 다시 눌러 주세요.")).toHaveLength(0));
    expect(box.checked).toBe(true);
  });

  it("L1 끔·켬 실패·끔(진행 중) 순서에서는 늦은 첫 성공이 세 번째 값을 덮지 않는다", async () => {
    await renderLoaded([item(ID_A, "세 번 체크", true)]); // 처음 켜져 있음
    const resolvers = resolversFor();
    const box = screen.getByRole("checkbox", { name: "세 번 체크" }) as HTMLInputElement;
    fireEvent.click(box); // 1: 끔 요청
    fireEvent.click(box); // 2: 켬 요청
    resolvers[1](fail("unavailable")); // 2 실패 → 확인값(켬)으로 돌아감
    await findOneVisible("끝냄 표시를 바꾸지 못했어요. 다시 눌러 주세요.");
    expect(box.checked).toBe(true);
    fireEvent.click(box); // 3: 끔 요청(진행 중)
    expect(box.checked).toBe(false);
    expect(visibleTexts("끝냄 표시를 바꾸지 못했어요. 다시 눌러 주세요.")).toHaveLength(0);
    resolvers[0](ok({ id: ID_A, done: false })); // 낡은 첫 응답: 성공
    await act(async () => {});
    expect(box.checked).toBe(false); // 세 번째 값 그대로
    expect(visibleTexts("끝냄 표시를 바꾸지 못했어요. 다시 눌러 주세요.")).toHaveLength(0);
    resolvers[2](ok({ id: ID_A, done: false }));
    await act(async () => {});
    expect(box.checked).toBe(false);
  });
});

describe("다듬기 1회차 P1 「저장하는 중」은 1초 뒤에만 보인다", () => {
  async function renderFake() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos: [] }));
    render(<TodoScreen />);
    await act(async () => {});
  }
  const hint = () => screen.getByText("저장하는 중");
  const visible = () => !hint().classList.contains("sr-only");

  it("① 900ms에 응답이 오면 그 글이 한 번도 보이지 않는다", async () => {
    await renderFake();
    const d = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValue(d.promise);
    write("빠른 저장");
    press();
    const seen: boolean[] = [visible()];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    seen.push(visible());
    d.resolve(ok({ day: DAY, todo: item(addTodo.mock.calls[0][0], "빠른 저장") }));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200); // 1초 타이머가 남아 있었다면 여기서 보였을 것
    });
    expect(seen).toEqual([false, false]);
    expect(screen.queryByText("저장하는 중")).toBeNull();
  });

  it("② 1500ms 응답이면 1초에 보이고, 응답이 오면 사라진다", async () => {
    await renderFake();
    const d = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValue(d.promise);
    write("느린 저장");
    press();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVING_HINT_DELAY_MS - 1);
    });
    expect(visible()).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(visible()).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    d.resolve(ok({ day: DAY, todo: item(addTodo.mock.calls[0][0], "느린 저장") }));
    await act(async () => {});
    expect(screen.queryByText("저장하는 중")).toBeNull();
  });

  it("③ 저장 중 내내 체크 칸의 aria-describedby가 그 글 id를 가리키고 그 노드가 DOM에 있다 (⑤ LiveRegion은 바로)", async () => {
    await renderFake();
    addTodo.mockReturnValue(new Promise(() => {}));
    write("설명 연결");
    press();
    expect(liveText()).toBe("할 일을 저장하는 중"); // ⑤ 누른 즉시
    const box = screen.getByRole("checkbox", { name: "설명 연결" });
    for (const wait of [0, SAVING_HINT_DELAY_MS, 2000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(wait);
      });
      const id = box.getAttribute("aria-describedby")!;
      expect(document.getElementById(id)?.textContent).toBe("저장하는 중");
      expect(box.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("15초 한도는 그대로이고, 1초 타이머는 T7로 바뀐 줄에 「저장하는 중」을 되살리지 않는다", async () => {
    await renderFake();
    addTodo.mockReturnValue(new Promise(() => {}));
    write("한도 확인");
    press();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    });
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(1);
    expect(screen.queryByText("저장하는 중")).toBeNull();
  });
});

describe("다듬기 1회차 P2 로그아웃 확인 정리와 포커스", () => {
  const CONFIRM = "아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.";
  const confirmBox = () => (screen.queryByText(CONFIRM)?.closest("[role=alert]") ?? null) as HTMLElement | null;

  it("① 입력 칸 글만 / 저장 중 줄만 / 저장 못 한 줄만 — 세 경우 모두 확인 문구가 같다", async () => {
    // 입력 칸만
    await renderLoaded([]);
    write("입력 칸에만 있는 글");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(confirmBox()).toBeTruthy();
    cleanup();

    // 저장 중 줄만
    fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos: [] }));
    render(<TodoScreen />);
    await screen.findByText(/개 중 \d개 끝냄/);
    addTodo.mockReturnValue(new Promise(() => {}));
    write("저장 중인 글");
    press();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(confirmBox()).toBeTruthy();
    cleanup();

    // 저장 못 한 줄만
    fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos: [] }));
    render(<TodoScreen />);
    await screen.findByText(/개 중 \d개 끝냄/);
    addTodo.mockResolvedValue(fail("unavailable"));
    write("저장 못 한 글");
    press();
    await findOneVisible("저장하지 못했어요.");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(confirmBox()).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("② T13에서 저장 못 한 글이 있으면 문구가 「아직 저장되지 않은 글은 사라져요…」다", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValue(fail("unauthenticated"));
    write("저장 못 한 글");
    press();
    const alert = await screen.findByText(
      "로그인이 풀렸어요. 다시 로그인하면 이 화면을 떠나서, 아직 저장되지 않은 글은 사라져요. 필요하면 먼저 복사해 두세요.",
    );
    expect(alert.closest("[role=alert]")).toBeTruthy();
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(1); // 줄 안의 문구는 그대로
  });

  it("③ 확인이 뜬 뒤 실패 줄을 빼면 확인이 사라지고 포커스가 다음 줄 체크 칸(없으면 입력 칸)에 있다", async () => {
    await renderLoaded([item(ID_A, "서버에 있던 글")]);
    addTodo.mockResolvedValue(fail("unavailable"));
    write("저장 못 한 글");
    press();
    await findOneVisible("저장하지 못했어요.");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(confirmBox()).toBeTruthy();
    // 실패 줄은 마지막 줄이라 아래 줄이 없다 → 위 줄 체크 칸
    fireEvent.click(screen.getByRole("button", { name: "빼기" }));
    await waitFor(() => expect(confirmBox()).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "서버에 있던 글" }));
  });

  it("③ 줄이 하나도 남지 않으면 입력 칸으로 간다", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValue(fail("unavailable"));
    write("혼자 있는 글");
    press();
    await findOneVisible("저장하지 못했어요.");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    fireEvent.click(screen.getByRole("button", { name: "빼기" }));
    await waitFor(() => expect(confirmBox()).toBeNull());
    expect(document.activeElement).toBe(input());
  });

  it("⑤ 확인이 없을 때 「빼기」만 눌러도 같은 포커스 규칙이다: 바로 아래 줄 체크 칸이 먼저", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValueOnce(fail("unavailable")).mockResolvedValueOnce(fail("unavailable"));
    write("첫째 실패");
    press();
    await findOneVisible("저장하지 못했어요.");
    write("둘째 실패");
    press();
    await waitFor(() => expect(screen.getAllByText("저장하지 못했어요.")).toHaveLength(2));
    expect(confirmBox()).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "빼기" })[0]); // 첫째 줄 → 아래 줄(둘째) 체크 칸
    await waitFor(() => expect(screen.queryByText("첫째 실패")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "둘째 실패" }));
  });

  it("④ 확인 안 「취소」에 포커스가 있는 채 저장 중이던 줄이 저장되면 확인이 사라지고 포커스가 머리 「로그아웃」으로 간다", async () => {
    await renderLoaded([]);
    const d = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValue(d.promise);
    write("저장 중인 글");
    press();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    const cancel = within(confirmBox()!).getByRole("button", { name: "취소" });
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    d.resolve(ok({ day: DAY, todo: item(addTodo.mock.calls[0][0], "저장 중인 글") }));
    await waitFor(() => expect(confirmBox()).toBeNull());
    expect(document.activeElement).toBe(document.getElementById("logout-button"));
  });

  it("입력 칸을 비우면 확인이 닫히고, 다시 글을 적어도 확인이 저절로 되살아나지 않는다", async () => {
    await renderLoaded([]);
    write("적던 글");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(confirmBox()).toBeTruthy();
    write("");
    await waitFor(() => expect(confirmBox()).toBeNull());
    write("다시 적은 글");
    expect(confirmBox()).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("MO-17 LOW 고침", () => {
  async function renderFake(todos: TodoItem[] = []) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchTodayTodos.mockResolvedValue(ok({ day: DAY, todos }));
    render(<TodoScreen />);
    await act(async () => {});
  }

  it("늦게 온 저장 실패: 15초 뒤 「다시」로 보낸 새 시도가 저장 중인데 앞 시도의 실패가 늦게 와도 그 줄을 실패로 되돌리지 않는다", async () => {
    await renderFake();
    const first = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValueOnce(first.promise).mockReturnValueOnce(new Promise(() => {}));
    write("느린 글");
    press();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    });
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "다시" }));
    expect(addTodo).toHaveBeenCalledTimes(2);
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(0);

    first.resolve(fail("unavailable")); // 앞 시도의 실패가 늦게 도착
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(0); // 새 시도는 아직 저장하는 중
    expect(screen.getByText("저장하는 중")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다시" })).toBeNull();
  });

  it("늦게 온 저장 실패: 15초 한도로 띄운 실패 안내를 늦은 실패 응답이 다시 읽히지 않는다", async () => {
    await renderFake();
    const first = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValueOnce(first.promise);
    write("느린 글");
    press();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + 100);
    });
    expect(liveText()).toBe("저장하지 못했어요.");
    // 그 뒤 다른 안내가 나간다(글자 수 넘음)
    write("가".repeat(230));
    press();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(liveText()).toBe("200자까지 적을 수 있어요. 지금 230자예요.");
    first.resolve(fail("unavailable")); // 늦은 실패 응답
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(liveText()).toBe("200자까지 적을 수 있어요. 지금 230자예요."); // 실패 안내를 다시 띄우지 않았다
    expect(screen.getAllByText("저장하지 못했어요.")).toHaveLength(1); // 줄 안 안내는 그대로 하나
  });

  it("늦게 온 저장 실패: 빼 버린 줄의 늦은 실패는 아무것도 되살리지 않는다", async () => {
    await renderFake();
    const first = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValueOnce(first.promise);
    write("뺄 글");
    press();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + 100);
    });
    fireEvent.click(screen.getByRole("button", { name: "빼기" }));
    expect(screen.queryByText("뺄 글")).toBeNull();
    write("가".repeat(230)); // 다른 안내를 하나 내보낸다
    press();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(liveText()).toBe("200자까지 적을 수 있어요. 지금 230자예요.");
    first.resolve(fail("unavailable"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByText("뺄 글")).toBeNull();
    expect(document.querySelectorAll(".todo-row")).toHaveLength(0);
    expect(liveText()).toBe("200자까지 적을 수 있어요. 지금 230자예요."); // 실패 안내가 다시 나가지 않았다
  });

  it("늦게 온 성공 뒤: 「다시」로 보낸 새 시도의 15초 타이머가 이미 저장된 줄에 실패 안내를 띄우지 않는다", async () => {
    await renderFake();
    const first = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValueOnce(first.promise).mockReturnValueOnce(new Promise(() => {}));
    write("느린 글");
    press();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    });
    fireEvent.click(screen.getByRole("button", { name: "다시" }));
    first.resolve(ok({ day: DAY, todo: item(addTodo.mock.calls[0][0], "느린 글") })); // 앞 시도의 늦은 성공
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(liveText()).toBe("할 일을 저장했어요");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + 200); // 새 시도의 15초 한도가 지난다
    });
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(0);
    expect(liveText()).toBe("할 일을 저장했어요");
  });

  it("정상 대조: 늦게 온 성공은 여전히 그 줄을 저장됨으로 바꾼다", async () => {
    await renderFake();
    const first = deferred<TodoResult<{ day: TodoDay; todo: TodoItem }>>();
    addTodo.mockReturnValueOnce(first.promise);
    write("늦은 성공");
    press();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    });
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(1);
    first.resolve(ok({ day: DAY, todo: item(addTodo.mock.calls[0][0], "늦은 성공") }));
    await act(async () => {});
    expect(visibleTexts("저장하지 못했어요.")).toHaveLength(0);
    expect(screen.getAllByText("늦은 성공")).toHaveLength(1);
  });

  it("사라지는 단추의 포커스: 「다시」를 누르면 단추가 사라져도 포커스가 body가 아니라 그 줄 체크 칸에 있다", async () => {
    await renderLoaded([]);
    addTodo.mockResolvedValueOnce(fail("unavailable")).mockReturnValueOnce(new Promise(() => {}));
    write("다시 보낼 글");
    press();
    await findOneVisible("저장하지 못했어요.");
    const again = screen.getByRole("button", { name: "다시" });
    again.focus();
    fireEvent.click(again);
    await waitFor(() => expect(screen.queryByRole("button", { name: "다시" })).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "다시 보낼 글" }));
  });

  it("사라지는 단추의 포커스: 「다시 불러오기」를 누르면 안내가 사라져도 포커스가 body가 아니라 「할 일 적기」 단추에 있다(창이 닫혀 있을 때)", async () => {
    fetchTodayTodos.mockResolvedValueOnce(fail("unavailable"));
    render(<TodoScreen />);
    const reloadButton = await screen.findByRole("button", { name: "다시 불러오기" });
    fetchTodayTodos.mockReturnValueOnce(new Promise(() => {})); // 불러오는 중에 머문다
    reloadButton.focus();
    fireEvent.click(reloadButton);
    expect(screen.queryByRole("button", { name: "다시 불러오기" })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    // 방향 C: 할 일 칸은 창 안에 있어, 창이 닫혀 있으면 「할 일 적기」 단추로 간다(창이 열려 있으면 칸 — todo-sheet 시험)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "할 일 적기" }));
  });
});
