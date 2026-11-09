// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 고침 5바퀴: 오늘 기록 시간 단계의 「오늘 할 일 n/m ›」 줄과 「오늘 할 일」 시트(명세 ⑩ PM 11).
 * - 기기 먼저 저장(기본): 할 일 탭 시험(todo-local.test.tsx)과 같은 가짜 — 진짜 운영 장치(메모리 저장소) + 가짜 send.
 *   할 일 탭(TodoScreen)과 같은 LocalTodos 하나를 둘에 넘겨 같은 데이터인지 본다.
 * - 예전 방식: 할 일 탭 시험(todo-screen.test.tsx)과 같은 가짜 Server Action·GET.
 */

const addTodo = vi.fn();
const setTodoDone = vi.fn();
const fetchToday = vi.fn();
vi.mock("../../app/todos/actions", () => ({
  addTodo: (...a: unknown[]) => addTodo(...a),
  setTodoDone: (...a: unknown[]) => setTodoDone(...a),
  addCategory: vi.fn(),
}));
vi.mock("../../lib/read-client", () => ({ fetchToday: (...a: unknown[]) => fetchToday(...a) }));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { EveningRecord } from "../../components/evening-record";
import { doneCategoryIdsOf, EveningTodoLine, type EveningTodos } from "../../components/evening-todo-sheet";
import { TodoScreen } from "../../components/todo-screen";
import type { EveningApi } from "../../lib/evening-api";
import type { EveningState } from "../../lib/evening/types";
import { createLocalApis } from "../../lib/local/apis";
import { createMemoryKv, kvKeys } from "../../lib/local/kv";
import { emptyMirror } from "../../lib/local/reduce";
import { createRuntime, type Runtime } from "../../lib/local/runtime";
import { createLocalTodos, type LocalTodos } from "../../lib/local/todos";
import type { Mirror, MirrorTodo, QueuedOp } from "../../lib/local/types";
import type { TodayRead } from "../../lib/today-types";
import { FakeHistory } from "./fake-history";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOON = Date.parse("2026-11-07T06:00:00.000Z"); // 서울 15:00, 두노 하루 11-07
const todo = (id: string, text: string, over: Partial<MirrorTodo> = {}): MirrorTodo => ({
  id,
  day: "2026-11-07",
  text,
  done: false,
  createdAt: "2026-11-07T01:00:00.000Z",
  categoryId: null,
  position: null,
  ...over,
});

let runtime: Runtime;
let sent: QueuedOp[];
let online: boolean;
let history: FakeHistory;

/** 할 일 탭 시험과 같은 운영 장치. setDone·addTodo는 감시만 하고 진짜를 부른다(할 일 탭과 시트가 같은 객체를 쓴다) */
async function makeLocal(todos: MirrorTodo[] = [todo(T1, "단어 외우기", { categoryId: C1 }), todo(T2, "빨래", { done: true })]) {
  const base: Mirror = {
    ...emptyMirror(),
    synced: true,
    categories: [
      { id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" },
      { id: C2, readable: true, name: "포트폴리오", createdAt: "2026-11-02T00:00:00.000Z" },
    ],
    todos,
  };
  const kv = createMemoryKv();
  await kv.set(kvKeys.base(USER), base);
  // 이 운영 장치가 보낸 것만 센다(앞 시험의 운영 장치가 늦게 보내도 섞이지 않게)
  const mine: QueuedOp[] = [];
  sent = mine;
  runtime = createRuntime({
    userKey: USER,
    kv,
    send: async (q) => {
      mine.push(q);
      return { ok: true };
    },
    fetchSnapshot: async () => ({ ok: false, error: "unavailable" }),
    now: () => NOON,
    online: () => online,
  });
  await runtime.boot();
  const real = createLocalTodos(runtime, createLocalApis(runtime));
  const local: LocalTodos = { ...real, setDone: vi.fn(real.setDone), addTodo: vi.fn(real.addTodo) };
  return local;
}

function eveningState(over: Partial<EveningState> = {}): EveningState {
  return {
    today: "2026-11-07",
    day: "2026-11-07",
    existing: null,
    doneCategoryIds: [],
    timerByCategory: [],
    categories: [
      { id: C1, name: "어학" },
      { id: C2, name: "포트폴리오" },
    ],
    ...over,
  };
}
function eveningApi(s: EveningState = eveningState()): EveningApi {
  return {
    localFirst: true,
    fetchState: vi.fn(async (day?: string) => ({ ok: true as const, data: { ...s, day: day ?? s.today } })),
    save: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })),
  };
}

async function mountEvening(todos: EveningTodos, api: EveningApi = eveningApi()) {
  const onClose = vi.fn();
  const view = render(<EveningRecord api={api} onClose={onClose} todos={todos} />);
  await screen.findByRole("button", { name: "분야마다 나누기" });
  return { onClose, ...view };
}

const line = () => screen.getByRole("button", { name: /^오늘 할 일/ });
const sheet = () => screen.getByRole("dialog", { name: "오늘 할 일" });
const openSheet = () => act(async () => fireEvent.click(line()));
const sheetCheck = (text: string) => within(sheet()).getByRole("checkbox", { name: text }) as HTMLInputElement;
const tabRowCheck = (id: string) => document.querySelector<HTMLInputElement>(`#row-${id} input[type=checkbox]`)!;

beforeEach(() => {
  for (const m of [addTodo, setTodoDone, fetchToday]) m.mockReset();
  online = true;
  history = new FakeHistory(null).install();
  vi.spyOn(window.navigator, "onLine", "get").mockImplementation(() => online);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  history.flush();
  vi.restoreAllMocks();
});

describe("시간 단계의 「오늘 할 일 n/m ›」 줄", () => {
  it("끝낸 수/전체 수를 보이고 숫자는 굵다. 접근 이름은 보이는 글로 시작한다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    const button = line();
    expect(button.textContent).toBe("오늘 할 일 1/2›");
    expect(button.querySelector("b")?.textContent).toBe("1/2");
    expect(button.getAttribute("aria-label")).toBe("오늘 할 일 1/2, 2개 중 1개 끝냄");
    // 시간 입력(합계 줄) 아래에 있다
    const total = screen.getByText("합계 0분");
    expect(total.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("할 일이 없으면 「오늘 할 일 0/0 ›」이고, 시트에서 더할 수 있다", async () => {
    const local = await makeLocal([]);
    await mountEvening({ local });
    expect(line().textContent).toBe("오늘 할 일 0/0›");
    await openSheet();
    expect(within(sheet()).getByText("오늘 적은 할 일이 없어요.")).toBeTruthy();
    expect(within(sheet()).getByRole("button", { name: "+ 할 일" })).toBeTruthy();
  });

  it("어제를 고르면 줄을 숨기고, 오늘로 돌아오면 다시 보인다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "어제" })));
    await screen.findByRole("heading", { name: "어제 몇 시간 썼어요?" });
    expect(screen.queryByRole("button", { name: /^오늘 할 일/ })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "오늘" })));
    await screen.findByRole("heading", { name: "오늘 몇 시간 썼어요?" });
    expect(line().textContent).toBe("오늘 할 일 1/2›");
  });

  it("타이머로 미리 채웠으면 시간 입력 아래 「타이머 2시간 30분」 표시가 있고(앞 알림 글도 그대로), 그 아래에 「오늘 할 일」 줄이 온다", async () => {
    const local = await makeLocal();
    await mountEvening({ local }, eveningApi(eveningState({ timerByCategory: [{ categoryId: C1, minutes: 90 }, { categoryId: null, minutes: 60 }] })));
    const chip = screen.getByText("타이머 2시간 30분");
    expect(chip.className).toBe("evening-timer-chip");
    expect(screen.getByText("타이머로 2시간 30분 미리 채웠어요.")).toBeTruthy(); // 지우지 않는다(PM 11-09)
    expect(screen.getByText("합계 2시간 30분").compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chip.compareDocumentPosition(line()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("타이머가 0분이면 타이머 표시가 없다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    expect(screen.getByText("합계 0분")).toBeTruthy();
    expect(screen.queryByText(/^타이머 /)).toBeNull();
    expect(document.querySelector(".evening-timer-chip")).toBeNull();
  });

  it("todos를 넘기지 않으면(개발 화면 등) 줄을 그리지 않는다", async () => {
    render(<EveningRecord api={eveningApi()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "분야마다 나누기" });
    expect(screen.queryByRole("button", { name: /^오늘 할 일/ })).toBeNull();
  });
});

describe("「오늘 할 일」 시트 열기·닫기(겹친 창 규칙)", () => {
  it("누르면 시트가 열리고 제목에 포커스, 목록에 글·분야 점·이름. 「닫기」로 닫으면 포커스가 줄로 돌아온다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    line().focus();
    await openSheet();
    const dialog = sheet();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("heading", { name: "오늘 할 일" }));
    expect(sheetCheck("단어 외우기").checked).toBe(false);
    expect(sheetCheck("빨래").checked).toBe(true);
    const row = dialog.querySelector(`#evening-todo-row-${T1}`)!;
    expect(row.querySelector(".category-tag")?.textContent).toBe("분야 어학");
    const dot = row.querySelector<HTMLElement>(".evening-todo-dot")!;
    expect(dot.style.background).toBe("var(--color-category-1)");
    // 기타 할 일에는 분야 표시가 없다
    expect(dialog.querySelector(`#evening-todo-row-${T2} .category-tag`)).toBeNull();
    // 오늘 기록 창의 다른 것(시간 입력)은 시트가 열린 동안 inert
    expect(screen.getByRole("button", { name: "분야마다 나누기", hidden: true }).closest("[inert]")).not.toBeNull();
    expect(dialog.closest("[inert]")).toBeNull();

    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "닫기" })));
    expect(screen.queryByRole("dialog", { name: "오늘 할 일" })).toBeNull();
    expect(document.activeElement).toBe(line());
    expect(screen.getByRole("button", { name: "분야마다 나누기" }).closest("[inert]")).toBeNull();
    // 오늘 기록 창은 그대로
    expect(screen.getByRole("dialog", { name: "오늘 몇 시간 썼어요?" })).toBeTruthy();
  });

  it("Esc는 시트만 닫는다(오늘 기록은 닫히지 않음). 포커스는 줄로", async () => {
    const local = await makeLocal();
    const { onClose } = await mountEvening({ local });
    line().focus();
    await openSheet();
    await act(async () => fireEvent.keyDown(within(sheet()).getByRole("heading", { name: "오늘 할 일" }), { key: "Escape" }));
    expect(screen.queryByRole("dialog", { name: "오늘 할 일" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(line());
  });

  it("안드로이드 뒤로 가기는 시트만 닫고, 한 번 더 누르면 오늘 기록이 닫힌다(앱은 나가지 않는다)", async () => {
    const local = await makeLocal();
    const { onClose } = await mountEvening({ local });
    expect(history.entries).toHaveLength(2); // 오늘 기록이 쌓은 칸
    line().focus();
    await openSheet();
    expect(history.entries).toHaveLength(3);
    await act(async () => history.userBack());
    expect(screen.queryByRole("dialog", { name: "오늘 할 일" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(line());
    expect(history.back).not.toHaveBeenCalled(); // 칸을 이미 떠났다
    await act(async () => history.userBack());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(history.leftApp).toBe(false);
  });
});

describe("체크·되돌림: 할 일 탭과 같은 저장 길(기기 먼저 저장)", () => {
  it("시트에서 체크하면 할 일 탭과 같은 local.setDone(id, true)을 부르고 보낼 줄에 todo.done이 들어가며, 닫으면 n/m이 바로 바뀐다", async () => {
    const local = await makeLocal();
    render(
      <>
        <TodoScreen initial={local.read()} local={local} />
        <EveningRecord api={eveningApi()} onClose={vi.fn()} todos={{ local }} />
      </>,
    );
    await screen.findByRole("button", { name: "분야마다 나누기" });
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    expect(local.setDone).toHaveBeenCalledTimes(1);
    expect(local.setDone).toHaveBeenLastCalledWith(T1, true);
    expect(sheetCheck("단어 외우기").checked).toBe(true);
    await waitFor(() => expect(sent.map((q) => q.op)).toEqual([{ kind: "todo.done", id: T1, done: true }]));
    // 할 일 탭에도 그대로 보인다(같은 데이터)
    expect(tabRowCheck(T1).checked).toBe(true);
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "닫기" })));
    expect(line().textContent).toBe("오늘 할 일 2/2›");
  });

  it("다시 누르면 되돌린다: local.setDone(id, false)", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("빨래")));
    expect(local.setDone).toHaveBeenLastCalledWith(T2, false);
    expect(sheetCheck("빨래").checked).toBe(false);
    expect(line().textContent).toBe("오늘 할 일 0/2›");
  });

  it("할 일 탭에서 한 체크가 시트에도 보인다(따로 담아 두지 않고 같은 거울을 따른다)", async () => {
    const local = await makeLocal();
    render(
      <>
        <TodoScreen initial={local.read()} local={local} />
        <EveningRecord api={eveningApi()} onClose={vi.fn()} todos={{ local }} />
      </>,
    );
    await screen.findByRole("button", { name: "분야마다 나누기" });
    await act(async () => fireEvent.click(tabRowCheck(T1))); // 할 일 탭의 체크(같은 setDone)
    expect(local.setDone).toHaveBeenLastCalledWith(T1, true);
    expect(line().textContent).toBe("오늘 할 일 2/2›");
    await openSheet();
    expect(sheetCheck("단어 외우기").checked).toBe(true);
  });

  it("끊겨 있어도 체크·적기가 기기에 남고(보낼 줄), 할 일 탭과 같은 끊김 안내가 보이며, 연결되면 올라간다", async () => {
    online = false;
    const local = await makeLocal();
    await mountEvening({ local });
    await openSheet();
    expect(within(sheet()).getByText("인터넷 연결이 끊겼어요. 적고 끝낸 것은 이 기기에 두었다가 연결되면 보내요.")).toBeTruthy();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    fireEvent.change(within(sheet()).getByRole("textbox", { name: "할 일" }), { target: { value: "끊긴 채 적은 글" } });
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "적기" })));
    expect(within(sheet()).getByText("끊긴 채 적은 글")).toBeTruthy();
    expect(runtime.pendingOps().map((o) => o.op.kind)).toEqual(["todo.done", "todo.add"]);
    expect(sent).toEqual([]); // 아직 보내지 않았다
    online = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await runtime.flush();
    });
    expect(sent.map((q) => q.op.kind)).toEqual(["todo.done", "todo.add"]);
  });

  it("로그아웃·계정 바뀜으로 기기 저장소를 지우면 시트도 앞 사용자의 할 일을 보이지 않는다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    await openSheet();
    expect(within(sheet()).getByText("단어 외우기")).toBeTruthy();
    await act(async () => {
      await runtime.wipe();
    });
    expect(within(sheet()).queryByText("단어 외우기")).toBeNull();
    expect(within(sheet()).queryByText("빨래")).toBeNull();
    expect(within(sheet()).getByText("할 일을 불러오지 못했어요.")).toBeTruthy();
    expect(line().textContent).toBe("오늘 할 일›"); // 숫자를 모르면 숫자 없이
  });
});

describe("「+ 할 일」로 적기: 할 일 탭과 같은 저장 함수·같은 인자 꼴", () => {
  it("보이는 이름표 「할 일」이 있는 칸 + 분야 칩 줄 + 「적기」. 고른 분야로 local.addTodo({ id, text, categoryId })를 부르고 할 일 탭에도 보인다", async () => {
    const local = await makeLocal();
    render(
      <>
        <TodoScreen initial={local.read()} local={local} />
        <EveningRecord api={eveningApi()} onClose={vi.fn()} todos={{ local }} />
      </>,
    );
    await screen.findByRole("button", { name: "분야마다 나누기" });
    await openSheet();
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    const input = within(sheet()).getByRole("textbox", { name: "할 일" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    // 이름표는 보이는 label 요소다(흐린 안내 글만이 아니다, WCAG 3.3.2)
    const label = sheet().querySelector<HTMLLabelElement>('label[for="evening-todo-input"]')!;
    expect(label.textContent).toBe("할 일");
    expect(label.className).not.toContain("sr-only");
    expect(input.getAttribute("placeholder")).toBeNull();
    const chips = within(sheet()).getByRole("group", { name: "분야 (고르지 않으면 기타)" });
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["어학", "포트폴리오"]);

    fireEvent.change(input, { target: { value: "  면접 준비  " } });
    fireEvent.click(within(chips).getByRole("button", { name: "포트폴리오" }));
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "적기" })));
    expect(local.addTodo).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(local.addTodo).mock.calls[0][0];
    expect(arg).toEqual({ id: expect.stringMatching(UUID), text: "면접 준비", categoryId: C2 });
    expect(Object.keys(arg).sort()).toEqual(["categoryId", "id", "text"]); // 할 일 탭이 부르는 꼴과 같은 열쇠
    expect(input.value).toBe("");
    expect(within(chips).getByRole("button", { name: "포트폴리오" }).getAttribute("aria-pressed")).toBe("false");
    // 보낼 줄을 거쳐 서버로 간다(할 일 탭과 같은 op)
    await waitFor(() => expect(sent.map((q) => q.op)).toEqual([{ kind: "todo.add", id: arg.id, text: "면접 준비", categoryId: C2 }]));
    expect(within(sheet()).getByText("면접 준비")).toBeTruthy();
    // 할 일 탭 목록에도 같은 id로 보인다
    expect(document.getElementById(`row-${arg.id}`)?.textContent).toContain("면접 준비");
    expect(line().textContent).toBe("오늘 할 일 1/3›");
  });

  it("할 일 탭의 적기도 같은 꼴(id·text·categoryId)로 같은 함수를 부른다(같은 길 확인)", async () => {
    const local = await makeLocal();
    render(<TodoScreen initial={local.read()} local={local} />);
    fireEvent.click(screen.getByRole("button", { name: /^(할 일 적기|적던 글 이어 적기)$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: "탭에서 적음" } });
    fireEvent.click(screen.getByRole("button", { name: "적기" }));
    const arg = vi.mocked(local.addTodo).mock.calls[0][0];
    expect(Object.keys(arg).sort()).toEqual(["categoryId", "id", "text"]);
    expect(arg).toEqual({ id: expect.stringMatching(UUID), text: "탭에서 적음", categoryId: null });
  });

  it("빠르게 두 번 누르면 하나만 적힌다(첫 누름에 칸이 빈다). 빈 글은 아무것도 안 만든다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    await openSheet();
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    fireEvent.change(within(sheet()).getByRole("textbox", { name: "할 일" }), { target: { value: "한 번만" } });
    const write = within(sheet()).getByRole("button", { name: "적기" });
    await act(async () => {
      fireEvent.click(write);
      fireEvent.click(write);
    });
    expect(local.addTodo).toHaveBeenCalledTimes(1);
    // 보낼 줄에도 하나만 들어간다
    await waitFor(() => expect(sent.map((q) => q.op)).toEqual([{ kind: "todo.add", id: vi.mocked(local.addTodo).mock.calls[0][0].id, text: "한 번만", categoryId: null }]));
    expect(within(sheet()).getAllByText("한 번만")).toHaveLength(1);
  });

  it("200자를 넘는 글은 보내지 않고 안내한다. 200자는 그대로 보낸다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    await openSheet();
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    const input = within(sheet()).getByRole("textbox", { name: "할 일" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "가".repeat(201) } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "적기" })));
    expect(local.addTodo).not.toHaveBeenCalled();
    expect(within(sheet()).getAllByText("200자까지 적을 수 있어요. 지금 201자예요.").length).toBeGreaterThan(0);
    expect(input.value).toBe("가".repeat(201)); // 몰래 자르지 않는다
    fireEvent.change(input, { target: { value: "가".repeat(200) } });
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "적기" })));
    expect(local.addTodo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(local.addTodo).mock.calls[0][0].text).toBe("가".repeat(200));
  });

  it("HTML 같은 글은 글자 그대로 보이고 img 요소가 생기지 않는다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    await openSheet();
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    const evil = "<img src=x onerror=alert(1)>";
    fireEvent.change(within(sheet()).getByRole("textbox", { name: "할 일" }), { target: { value: evil } });
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "적기" })));
    expect(vi.mocked(local.addTodo).mock.calls[0][0].text).toBe(evil);
    expect(within(sheet()).getByText(evil).tagName).toBe("P");
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("끝낸 할 일 분야 목록(나누기 처음 값의 재료, d-116 가)", () => {
  it("doneCategoryIdsOf: 끝낸 것의 분야만, 중복 없이, 기타는 빼고", () => {
    expect(
      doneCategoryIdsOf([
        { done: true, categoryId: C1 },
        { done: true, categoryId: null },
        { done: false, categoryId: C2 },
        { done: true, categoryId: C1 },
      ]),
    ).toEqual([C1]);
    expect(doneCategoryIdsOf([])).toEqual([]);
  });

  it("시트에서 체크하면 그 분야가 들어가고 되돌리면 빠진다. 기타 할 일 체크는 넣지 않는다. 적기도 그때 목록을 알린다", async () => {
    const local = await makeLocal([todo(T1, "단어 외우기", { categoryId: C1 }), todo(T2, "빨래"), todo(T3, "이력서", { categoryId: C2 })]);
    const onDone = vi.fn();
    render(<EveningTodoLine todos={{ local }} onDoneCategoriesChange={onDone} />);
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    expect(onDone).toHaveBeenLastCalledWith([C1]);
    await act(async () => fireEvent.click(sheetCheck("빨래")));
    expect(onDone).toHaveBeenLastCalledWith([C1]); // 기타는 넣지 않는다
    await act(async () => fireEvent.click(sheetCheck("이력서")));
    expect(onDone).toHaveBeenLastCalledWith([C1, C2]);
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    expect(onDone).toHaveBeenLastCalledWith([C2]);
    await act(async () => fireEvent.click(sheetCheck("이력서")));
    expect(onDone).toHaveBeenLastCalledWith([]);
    expect(onDone).toHaveBeenCalledTimes(5);
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    fireEvent.change(within(sheet()).getByRole("textbox", { name: "할 일" }), { target: { value: "새 글" } });
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "적기" })));
    expect(onDone).toHaveBeenCalledTimes(6);
    expect(onDone).toHaveBeenLastCalledWith([]);
  });

  it("오늘 기록에 이어진다: 시트에서 체크한 분야가 나누기 처음 값에 들어가고, 되돌리면 빠진다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    fireEvent.change(screen.getByLabelText("시간"), { target: { value: "1" } });
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "닫기" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "분야마다 나누기" })));
    const 어학 = () => Number((screen.getByRole("spinbutton", { name: "어학" }) as HTMLInputElement).value);
    expect(어학()).toBeGreaterThan(0);
    expect(어학()).toBeLessThanOrEqual(60);
    expect(Number((screen.getByRole("spinbutton", { name: "포트폴리오" }) as HTMLInputElement).value)).toBe(0);
  });

  it("체크하지 않으면 그 분야는 나누기 처음 값에 없다(위 시험의 대조)", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    fireEvent.change(screen.getByLabelText("시간"), { target: { value: "1" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "분야마다 나누기" })));
    expect(Number((screen.getByRole("spinbutton", { name: "어학" }) as HTMLInputElement).value)).toBe(0);
  });
});

describe("예전 방식(기기 먼저 저장 꺼짐): 할 일 탭과 같은 GET·Server Action", () => {
  const read = (): TodayRead => ({
    todos: {
      ok: true,
      data: {
        day: { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 },
        todos: [
          { id: T1, readable: true, text: "단어 외우기", done: false, createdAt: "2026-11-07T01:00:00.000Z", categoryId: C1 },
          { id: T2, readable: true, text: "빨래", done: true, createdAt: "2026-11-07T01:00:00.000Z", categoryId: null },
        ],
      },
    },
    categories: {
      ok: true,
      data: { categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" }] },
    },
  });

  it("체크·되돌림이 할 일 탭과 같은 setTodoDone(id, done)을 부르고, 성공하면 onChanged로 할 일 탭이 다시 읽게 한다", async () => {
    fetchToday.mockResolvedValue(read());
    setTodoDone.mockImplementation(async (id: string, done: boolean) => ({ ok: true, data: { id, done } }));
    const onChanged = vi.fn();
    const onDone = vi.fn();
    render(<EveningTodoLine todos={{ onChanged }} onDoneCategoriesChange={onDone} />);
    await waitFor(() => expect(line().textContent).toBe("오늘 할 일 1/2›"));
    expect(fetchToday).toHaveBeenCalledTimes(1);
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    expect(setTodoDone).toHaveBeenLastCalledWith(T1, true);
    expect(onDone).toHaveBeenLastCalledWith([C1]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    expect(setTodoDone).toHaveBeenLastCalledWith(T1, false);
    expect(onDone).toHaveBeenLastCalledWith([]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect(addTodo).not.toHaveBeenCalled();
  });

  it("서버가 체크를 받지 않으면(남의 할 일·로그인 풀림 등) 되돌리고 안내한다", async () => {
    fetchToday.mockResolvedValue(read());
    setTodoDone.mockResolvedValue({ ok: false, error: "not_found" });
    const onDone = vi.fn();
    render(<EveningTodoLine todos={{}} onDoneCategoriesChange={onDone} />);
    await waitFor(() => expect(line().textContent).toBe("오늘 할 일 1/2›"));
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    await waitFor(() => expect(within(sheet()).getByText("끝냄 표시를 바꾸지 못했어요. 다시 눌러 주세요.")).toBeTruthy());
    expect(sheetCheck("단어 외우기").checked).toBe(false);
    expect(onDone).toHaveBeenLastCalledWith([]);
  });

  it("「+ 할 일」 적기는 할 일 탭과 같은 addTodo(id, 글, 분야 번호)를 세 인자로 부르고, 실패 뒤 다시 누르면 같은 id로 보낸다", async () => {
    fetchToday.mockResolvedValue(read());
    addTodo.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    addTodo.mockImplementationOnce(async (id: string, text: string, categoryId: string | null) => ({
      ok: true,
      data: {
        day: { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 },
        todo: { id, readable: true, text, done: false, createdAt: "2026-11-07T02:00:00.000Z", categoryId },
      },
    }));
    const onChanged = vi.fn();
    render(<EveningTodoLine todos={{ onChanged }} onDoneCategoriesChange={vi.fn()} />);
    await waitFor(() => expect(line().textContent).toBe("오늘 할 일 1/2›"));
    await openSheet();
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    fireEvent.change(within(sheet()).getByRole("textbox", { name: "할 일" }), { target: { value: "발음 연습" } });
    fireEvent.click(within(sheet()).getByRole("button", { name: "어학" }));
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "적기" })));
    expect(addTodo).toHaveBeenCalledTimes(1);
    const first = addTodo.mock.calls[0];
    expect(first).toEqual([expect.stringMatching(UUID), "발음 연습", C1]);
    expect(within(sheet()).getByText("저장하지 못했어요.")).toBeTruthy();
    expect((within(sheet()).getByRole("textbox", { name: "할 일" }) as HTMLInputElement).value).toBe("발음 연습");
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "적기" })));
    expect(addTodo).toHaveBeenCalledTimes(2);
    expect(addTodo.mock.calls[1]).toEqual([first[0], "발음 연습", C1]); // 같은 id
    expect(within(sheet()).getByText("발음 연습")).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(line().textContent).toBe("오늘 할 일 1/3›");
  });

  it("끊겨 있으면 적기·체크를 보내지 않고 안내한다(글은 그대로)", async () => {
    fetchToday.mockResolvedValue(read());
    render(<EveningTodoLine todos={{}} onDoneCategoriesChange={vi.fn()} />);
    await waitFor(() => expect(line().textContent).toBe("오늘 할 일 1/2›"));
    online = false;
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    expect(setTodoDone).not.toHaveBeenCalled();
    expect(sheetCheck("단어 외우기").checked).toBe(false);
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    fireEvent.change(within(sheet()).getByRole("textbox", { name: "할 일" }), { target: { value: "나중에" } });
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "적기" })));
    expect(addTodo).not.toHaveBeenCalled();
    expect(within(sheet()).getByText("인터넷에 연결되면 적을 수 있어요. 적은 글은 그대로 있어요.")).toBeTruthy();
    expect((within(sheet()).getByRole("textbox", { name: "할 일" }) as HTMLInputElement).value).toBe("나중에");
  });
});
