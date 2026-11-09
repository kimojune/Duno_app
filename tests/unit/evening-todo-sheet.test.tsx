// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
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
import type { EveningState, SavedEvening } from "../../lib/evening/types";
import { createLocalApis } from "../../lib/local/apis";
import { createMemoryKv, kvKeys } from "../../lib/local/kv";
import { emptyMirror } from "../../lib/local/reduce";
import { createRuntime, type Runtime } from "../../lib/local/runtime";
import { createLocalTodos, type LocalTodos } from "../../lib/local/todos";
import type { Mirror, MirrorTodo, QueuedOp } from "../../lib/local/types";
import type { TodayRead } from "../../lib/today-types";
import { FakeHistory } from "./fake-history";
import { typeWheel, wheelTotal, wheelValue } from "./time-wheel-helpers";

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
    // 시간 입력(두 줄 휠) 아래에 있다. 흰 카드 줄 + 왼쪽 체크 원 아이콘 22(꾸밈, 고침9 Figma 88:2)
    const wheel = document.querySelector(".time-wheel")!;
    expect(wheel.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const icon = button.querySelector("svg.evening-todo-line-icon")!;
    expect([icon.getAttribute("width"), icon.getAttribute("height"), icon.getAttribute("aria-hidden")]).toEqual(["22", "22", "true"]);
    expect(button.firstElementChild).toBe(icon);
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

  it("타이머로 미리 채웠으면 시간 입력 아래 「타이머 2시간 30분」 띠만 있고(알림 글은 뺐다 — 고침6 PM d-129 ④), 그 아래에 「오늘 할 일」 줄이 온다", async () => {
    const local = await makeLocal();
    await mountEvening({ local }, eveningApi(eveningState({ timerByCategory: [{ categoryId: C1, minutes: 90 }, { categoryId: null, minutes: 60 }] })));
    const chip = screen.getByText("타이머 2시간 30분");
    expect(chip.className).toBe("evening-timer-chip");
    expect(screen.queryByText(/미리 채웠어요/)).toBeNull(); // 옛 알림 글 없음(PM d-129 ④)
    expect(screen.getAllByText(/2시간 30분/).map((e) => e.textContent)).toEqual(["타이머 2시간 30분"]); // 합계 줄은 없앴다(고침9) — 띠 하나뿐
    expect([wheelValue("시간"), wheelValue("분")]).toEqual([2, 30]); // 휠이 타이머 합으로 미리 채워짐
    expect(document.querySelector(".time-wheel")!.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chip.compareDocumentPosition(line()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("타이머가 0분이면 타이머 표시가 없다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    expect(wheelTotal()).toBe(0);
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
    // 분야 = 색 점 10 + 이름 12 보조(바탕 없는 글 — 알약 .category-tag 아님, 고침9 Figma 88:12). 화면 읽기 앞말 「분야 」
    const tag = row.querySelector(".evening-todo-category-name")!;
    expect(tag.textContent).toBe("분야 어학");
    expect(tag.querySelector(".sr-only")!.textContent).toBe("분야 ");
    expect(row.querySelector(".category-tag")).toBeNull();
    const dot = row.querySelector<HTMLElement>(".evening-todo-dot")!;
    expect(dot.style.background).toBe("var(--color-category-1)");
    // 기타 할 일에는 분야 표시가 없다
    expect(dialog.querySelector(`#evening-todo-row-${T2} .evening-todo-category-name`)).toBeNull();
    // 오늘 기록 창의 다른 것(시간 입력)은 시트가 열린 동안 inert
    expect(screen.getByRole("button", { name: "분야마다 나누기", hidden: true }).closest("[inert]")).not.toBeNull();
    expect(dialog.closest("[inert]")).toBeNull();

    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "닫기" })));
    expect(screen.queryByRole("dialog", { name: "오늘 할 일" })).toBeNull();
    expect(document.activeElement).toBe(line());
    expect(screen.getByRole("button", { name: "분야마다 나누기" }).closest("[inert]")).toBeNull();
    // 오늘 기록 창은 그대로
    expect(screen.getByRole("dialog", { name: "오늘 기록" })).toBeTruthy();
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
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
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
    // 이름표 「분야」 + 칩 줄 맨 앞 「기타」가 골라진 채(고침9 Figma 88:73)
    const chips = within(sheet()).getByRole("group", { name: "분야" });
    expect(within(chips).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["기타", "true"],
      ["어학", "false"],
      ["포트폴리오", "false"],
    ]);

    fireEvent.change(input, { target: { value: "  면접 준비  " } });
    fireEvent.click(within(chips).getByRole("button", { name: "포트폴리오" }));
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
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
    const write = within(sheet()).getByRole("button", { name: "더하기" });
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
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
    expect(local.addTodo).not.toHaveBeenCalled();
    expect(within(sheet()).getAllByText("200자까지 적을 수 있어요. 지금 201자예요.").length).toBeGreaterThan(0);
    expect(input.value).toBe("가".repeat(201)); // 몰래 자르지 않는다
    fireEvent.change(input, { target: { value: "가".repeat(200) } });
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
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
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
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
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
    expect(onDone).toHaveBeenCalledTimes(6);
    expect(onDone).toHaveBeenLastCalledWith([]);
  });

  it("오늘 기록에 이어진다: 시트에서 체크한 분야가 나누기 처음 값에 들어가고, 되돌리면 빠진다", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    typeWheel("시간", 1);
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "닫기" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "분야마다 나누기" })));
    // 오늘 기록 나누기(E1) 규칙: 체크한 할 일의 분야 = 기타에서 30분. 60분에서 어학 30분, 남은 기타 30분(합 60)
    const stepperValue = (name: string) => Number((screen.getByRole("spinbutton", { name }) as HTMLInputElement).value);
    const otherValue = () => document.querySelector('.ratio-list [data-row-key="other"] .ratio-value')!.textContent;
    expect(stepperValue("어학")).toBe(30);
    expect(screen.queryByRole("spinbutton", { name: "포트폴리오" }), "고르지 않은 분야는 줄이 없다(E1: 칩으로 고른 분야만 다이얼·줄에)").toBeNull();
    expect(otherValue()).toBe("30분");
    expect(screen.getByRole("button", { name: /^어학, 다이얼에 넣기/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^포트폴리오, 다이얼에 넣기/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("오늘 기록에 이어진다: 기타가 30분보다 적으면 남은 만큼만 들어간다(쓴 시간 15분 → 어학 15분, 기타 0분)", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    typeWheel("시간", 0);
    typeWheel("분", 15);
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "닫기" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "분야마다 나누기" })));
    expect(Number((screen.getByRole("spinbutton", { name: "어학" }) as HTMLInputElement).value)).toBe(15);
    expect(document.querySelector('.ratio-list [data-row-key="other"] .ratio-value')!.textContent).toBe("0분");
  });

  it("체크하지 않으면 그 분야는 나누기 처음 값에 없다(위 시험의 대조)", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    typeWheel("시간", 1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "분야마다 나누기" })));
    expect(screen.queryByRole("spinbutton", { name: "어학" }), "체크하지 않으면 줄이 없다").toBeNull();
    expect(screen.getByRole("button", { name: /^어학, 다이얼에 넣기/ }).getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('.ratio-list [data-row-key="other"] .ratio-value')!.textContent).toBe("1시간");
  });

  it("체크했다가 되돌리면 나누기 처음 값에서 빠진다(기타가 1시간 그대로)", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    typeWheel("시간", 1);
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    await act(async () => fireEvent.click(sheetCheck("단어 외우기"))); // 되돌림
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "닫기" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "분야마다 나누기" })));
    expect(screen.queryByRole("spinbutton", { name: "어학" })).toBeNull();
    expect(screen.getByRole("button", { name: /^어학, 다이얼에 넣기/ }).getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('.ratio-list [data-row-key="other"] .ratio-value')!.textContent).toBe("1시간");
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
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
    expect(addTodo).toHaveBeenCalledTimes(1);
    const first = addTodo.mock.calls[0];
    expect(first).toEqual([expect.stringMatching(UUID), "발음 연습", C1]);
    expect(within(sheet()).getByText("저장하지 못했어요.")).toBeTruthy();
    expect((within(sheet()).getByRole("textbox", { name: "할 일" }) as HTMLInputElement).value).toBe("발음 연습");
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
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
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
    expect(addTodo).not.toHaveBeenCalled();
    expect(within(sheet()).getByText("인터넷에 연결되면 적을 수 있어요. 적은 글은 그대로 있어요.")).toBeTruthy();
    expect((within(sheet()).getByRole("textbox", { name: "할 일" }) as HTMLInputElement).value).toBe("나중에");
  });
});

// ── PM d-126: 「닫기」로 입력 잃음 막기(오늘 기록 · 오늘 할 일 시트가 같은 확인 부품을 쓴다) ──
describe("닫기 전 확인(PM d-126)", () => {
  const confirmBox = () => screen.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
  const confirms = () => screen.queryAllByRole("alertdialog");
  const recordDialog = () => screen.queryByRole("dialog", { name: "오늘 기록" });
  const headClose = () => within(recordDialog()!).getAllByRole("button", { name: "닫기" })[0];
  /** 휠 「시간」 열을 위 화살표로 한 칸(1시간) — 사용자가 쓴 시간을 바꾼 것 */
  const plusHour = () => act(async () => fireEvent.keyDown(screen.getByRole("spinbutton", { name: "시간" }), { key: "ArrowUp" }));
  const keep = () => act(async () => fireEvent.click(within(confirmBox()).getByRole("button", { name: "계속 적기" })));
  const closeInConfirm = () => act(async () => fireEvent.click(within(confirmBox()).getByRole("button", { name: "나가기" })));

  /** 오늘 기록을 열고 닫는 바깥(진짜 앱처럼 onClose가 창을 내린다) */
  function Host({ api, todos, onClosed }: { api: EveningApi; todos?: EveningTodos; onClosed: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button">바깥</button>
        {open && (
          <EveningRecord
            api={api}
            todos={todos}
            onClose={() => {
              onClosed();
              setOpen(false);
            }}
          />
        )}
      </>
    );
  }
  async function mountHost(api: EveningApi = eveningApi(), todos?: EveningTodos) {
    const onClosed = vi.fn();
    render(<Host api={api} todos={todos} onClosed={onClosed} />);
    await screen.findByRole("button", { name: "분야마다 나누기" });
    return { onClosed, api };
  }
  async function openForm() {
    await openSheet();
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    return within(sheet()).getByRole("textbox", { name: "할 일" }) as HTMLInputElement;
  }

  it("오늘 기록: 바꾼 것이 없으면 「닫기」는 확인 없이 바로 닫는다", async () => {
    const { onClosed } = await mountHost();
    await act(async () => fireEvent.click(headClose()));
    expect(confirms()).toHaveLength(0);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(recordDialog()).toBeNull();
  });

  it("오늘 기록: 쓴 시간을 바꾸면 「닫기」가 확인을 띄운다 — alertdialog·제목 이름·처음 포커스 「계속 적기」. 「계속 적기」면 값 그대로 열린 채, 포커스는 「닫기」로", async () => {
    const { onClosed, api } = await mountHost();
    await plusHour();
    expect(wheelTotal()).toBe(60);
    const close = headClose();
    close.focus();
    await act(async () => fireEvent.click(close));
    const box = confirmBox();
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(box.querySelector("h2")?.textContent).toBe("저장하지 않고 나갈까요?"); // PM d-135
    const keepButton = within(box).getByRole("button", { name: "계속 적기" });
    expect(keepButton.className).toContain("btn-primary"); // 주 단추(먹남색)
    expect(document.activeElement).toBe(keepButton);
    expect(within(box).getAllByRole("button").map((b) => b.textContent)).toEqual(["계속 적기", "나가기"]);
    // 확인 밖(오늘 기록의 나머지)은 inert
    expect(close.closest("[inert]")).not.toBeNull();
    expect(onClosed).not.toHaveBeenCalled();

    await keep();
    expect(confirms()).toHaveLength(0);
    expect(recordDialog()).not.toBeNull();
    expect(wheelTotal()).toBe(60);
    expect(document.activeElement).toBe(close);
    expect(close.closest("[inert]")).toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
  });

  it("오늘 기록: 확인에서 「나가기」면 닫힌다 — 저장 호출 0", async () => {
    const { onClosed, api } = await mountHost();
    await plusHour();
    await act(async () => fireEvent.click(headClose()));
    await closeInConfirm();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(recordDialog()).toBeNull();
    expect(confirms()).toHaveLength(0);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("오늘 기록: Esc도 같은 확인을 탄다. 확인에서 Esc = 계속 적기(값 그대로)", async () => {
    const { onClosed } = await mountHost();
    await plusHour();
    await act(async () => fireEvent.keyDown(screen.getByRole("heading", { name: "오늘 몇 시간 썼어요?" }), { key: "Escape" }));
    expect(confirms()).toHaveLength(1);
    await act(async () => fireEvent.keyDown(confirmBox(), { key: "Escape" }));
    expect(confirms()).toHaveLength(0);
    expect(wheelTotal()).toBe(60);
    expect(onClosed).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(screen.getByRole("heading", { name: "오늘 몇 시간 썼어요?" }), { key: "Escape" }));
    await closeInConfirm();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("오늘 기록: 처음 값(타이머로 미리 채움 · 나누기 처음 값)은 바꾼 것이 아니다 — 나누기 단계에서도 바로 닫힌다", async () => {
    const { onClosed } = await mountHost(eveningApi(eveningState({ timerByCategory: [{ categoryId: C1, minutes: 90 }] })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "분야마다 나누기" })));
    await screen.findByRole("heading", { name: "분야마다 나눠 주세요" });
    await act(async () => fireEvent.click(headClose()));
    expect(confirms()).toHaveLength(0);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("오늘 기록: 나누기에서 칩을 고르면 확인한다. 「계속 적기」면 고른 칩 그대로", async () => {
    const { onClosed } = await mountHost(eveningApi(eveningState({ timerByCategory: [{ categoryId: C1, minutes: 90 }] })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "분야마다 나누기" })));
    await screen.findByRole("heading", { name: "분야마다 나눠 주세요" });
    const chip = () => document.querySelector<HTMLButtonElement>(`[data-chip-id="${C2}"]`)!;
    expect(chip().getAttribute("aria-pressed")).toBe("false");
    await act(async () => fireEvent.click(chip()));
    expect(chip().getAttribute("aria-pressed")).toBe("true");
    await act(async () => fireEvent.click(headClose()));
    expect(confirms()).toHaveLength(1);
    await keep();
    expect(chip().getAttribute("aria-pressed")).toBe("true");
    await act(async () => fireEvent.click(headClose()));
    await closeInConfirm();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("오늘 기록: 나누기 줄 값(−/+)만 바꿔도 확인한다", async () => {
    const { onClosed } = await mountHost(eveningApi(eveningState({ timerByCategory: [{ categoryId: C1, minutes: 90 }] })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "분야마다 나누기" })));
    await screen.findByRole("heading", { name: "분야마다 나눠 주세요" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "어학 5분 줄이기" })));
    await act(async () => fireEvent.click(headClose()));
    expect(confirms()).toHaveLength(1);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("오늘 기록: 저장한 뒤의 「닫기」는 묻지 않는다", async () => {
    const api = eveningApi();
    vi.mocked(api.save).mockImplementation(async () => ({ ok: true as const, data: { log: {} as SavedEvening["log"], delta: [] } }));
    const { onClosed } = await mountHost(api);
    await plusHour();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "나누지 않고 저장" })));
    await screen.findByRole("heading", { name: "저장했어요" });
    expect(api.save).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(headClose()));
    expect(confirms()).toHaveLength(0);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("오늘 기록 + 뒤로 가기(FakeHistory): 바꾼 것이 있으면 같은 확인을 타고 자기 칸으로 돌아간다. 「계속 적기」 뒤 뒤로 가기를 다시 누르면 다시 확인, 「나가기」면 닫히고 앱은 나가지 않는다", async () => {
    const { onClosed, api } = await mountHost();
    expect(history.entries).toHaveLength(2);
    expect(history.index).toBe(1);
    await plusHour();
    await act(async () => history.userBack());
    expect(confirms()).toHaveLength(1);
    expect(onClosed).not.toHaveBeenCalled();
    expect(history.forward).toHaveBeenCalledTimes(1); // 새 칸을 쌓지 않고 자기 칸으로 돌아간다
    history.flush();
    expect(history.index).toBe(1);
    expect(history.pushState).toHaveBeenCalledTimes(1); // 처음 열 때 한 번뿐
    expect(confirms()).toHaveLength(1); // 돌아온 popstate는 확인을 닫거나 겹치지 않는다
    await keep();
    expect(recordDialog()).not.toBeNull();
    expect(wheelTotal()).toBe(60);

    // 다시 뒤로 가기 → 다시 확인(먹히지 않는다)
    await act(async () => history.userBack());
    expect(confirms()).toHaveLength(1);
    history.flush();
    expect(history.index).toBe(1);
    await closeInConfirm();
    expect(onClosed).toHaveBeenCalledTimes(1);
    history.flush(); // 닫으며 거둔 칸
    expect(history.index).toBe(0);
    expect(history.leftApp).toBe(false);
    expect(recordDialog()).toBeNull();
    expect(api.save).not.toHaveBeenCalled();
  });

  it("오늘 기록 + 뒤로 가기: 바꾼 것이 없으면 확인 없이 닫힌다(예전 그대로)", async () => {
    const { onClosed } = await mountHost();
    await act(async () => history.userBack());
    expect(confirms()).toHaveLength(0);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(history.forward).not.toHaveBeenCalled();
    expect(history.leftApp).toBe(false);
  });

  it("시트: 「+ 할 일」 칸이 비었으면(띄어쓰기만 포함) 「닫기」는 확인 없이 시트만 닫는다", async () => {
    const local = await makeLocal();
    const { onClosed } = await mountHost(eveningApi(), { local });
    const input = await openForm();
    await act(async () => fireEvent.change(input, { target: { value: "   " } }));
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "닫기" })));
    expect(confirms()).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "오늘 할 일" })).toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("시트: 체크만 했으면(바로 저장됨) 묻지 않는다", async () => {
    const local = await makeLocal();
    await mountHost(eveningApi(), { local });
    await openSheet();
    await act(async () => fireEvent.click(sheetCheck("단어 외우기")));
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "닫기" })));
    expect(confirms()).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "오늘 할 일" })).toBeNull();
  });

  it("시트: 글을 썼으면 「닫기」·Esc·바깥 누름이 같은 확인. 「계속 적기」면 글 그대로, 「나가기」면 시트만 닫히고 적기 호출 0", async () => {
    const local = await makeLocal();
    const { onClosed } = await mountHost(eveningApi(), { local });
    const input = await openForm();
    await act(async () => fireEvent.change(input, { target: { value: "발음 연습" } }));
    const close = within(sheet()).getByRole("button", { name: "닫기" });
    close.focus();
    await act(async () => fireEvent.click(close));
    expect(confirms()).toHaveLength(1);
    expect(document.activeElement).toBe(within(confirmBox()).getByRole("button", { name: "계속 적기" }));
    await keep();
    expect(input.value).toBe("발음 연습");
    expect(document.activeElement).toBe(close);
    // Esc(시트 안)
    input.focus();
    await act(async () => fireEvent.keyDown(input, { key: "Escape" }));
    expect(confirms()).toHaveLength(1);
    await keep();
    expect(document.activeElement).toBe(input);
    // 바깥(어두운 바탕) 누름
    await act(async () => fireEvent.click(document.querySelector(".evening-todo-backdrop")!));
    expect(confirms()).toHaveLength(1);
    await closeInConfirm();
    expect(screen.queryByRole("dialog", { name: "오늘 할 일" })).toBeNull();
    expect(recordDialog()).not.toBeNull(); // 오늘 기록은 그대로
    expect(onClosed).not.toHaveBeenCalled();
    expect(local.addTodo).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("시트 + 뒤로 가기(FakeHistory): 시트 확인만 뜬다(오늘 기록 확인과 겹치지 않음). 「계속 적기」 뒤 다시 뒤로 가기 → 다시 시트 확인, 「나가기」면 시트만 닫힌다", async () => {
    const local = await makeLocal();
    const { onClosed } = await mountHost(eveningApi(), { local });
    await plusHour(); // 오늘 기록에도 바꾼 것이 있다
    line().focus();
    const input = await openForm();
    expect(history.entries).toHaveLength(3);
    await act(async () => fireEvent.change(input, { target: { value: "발음 연습" } }));
    await act(async () => history.userBack());
    expect(confirms()).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "오늘 할 일", hidden: true }).parentElement!.contains(confirmBox())).toBe(true); // 시트 층의 확인
    history.flush();
    expect(history.index).toBe(2);
    expect(confirms()).toHaveLength(1);
    await keep();
    expect(input.value).toBe("발음 연습");
    await act(async () => history.userBack());
    expect(confirms()).toHaveLength(1);
    history.flush();
    expect(history.index).toBe(2);
    await closeInConfirm();
    expect(screen.queryByRole("dialog", { name: "오늘 할 일" })).toBeNull();
    history.flush();
    expect(history.index).toBe(1);
    expect(recordDialog()).not.toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    expect(confirms()).toHaveLength(0);
    // 이제 뒤로 가기는 오늘 기록의 확인(바꾼 시간이 있다)
    await act(async () => history.userBack());
    expect(confirms()).toHaveLength(1);
    expect(wheelTotal()).toBe(60);
    history.flush();
    expect(history.index).toBe(1);
    expect(history.leftApp).toBe(false);
  });
});

describe("시트 꼴(고침9 Figma 88:12): 흰 카드 목록 · 원 체크 · 색 점 분야 · 「기타」 칩 · 「더하기」 폭 가득", () => {
  it("목록은 흰 카드 하나(줄 사이 1px 선), 체크는 원 24(끝냄 = 채운 원 + 흰 체크, 안 함 = 2px 테두리 원 — CSS가 실제로 칠함), 네모 체크 상자 없음", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    await openSheet();
    const list = sheet().querySelector("ul.evening-todo-list")!;
    expect(list.querySelectorAll("li.todo-row")).toHaveLength(2);
    expect(list.querySelectorAll(".check-box")).toHaveLength(0);
    const circles = list.querySelectorAll(".check-circle svg");
    expect(circles).toHaveLength(2);
    expect([circles[0].getAttribute("width"), circles[0].querySelector("circle")!.getAttribute("r")]).toEqual(["24", "11"]);
    expect(sheetCheck("빨래").closest("label")!.className).toBe("check-hit evening-todo-check");
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toMatch(/\.evening-todo-list \{[^}]*border-radius: var\(--radius-card\); background: var\(--color-surface\);/);
    expect(css).toMatch(/\.evening-todo-list > \.todo-row \+ \.todo-row \{ border-top: 1px solid var\(--color-notice-bg\); \}/);
    expect(css).toMatch(/\.check-circle-ring \{ fill: none; stroke: var\(--color-primary\); stroke-width: 2; \}/);
    expect(css).toMatch(/\.evening-todo-check input:checked \+ \.check-circle \.check-circle-ring \{ fill: var\(--color-primary\); \}/);
    expect(css).toMatch(/\.evening-todo-check input:checked \+ \.check-circle \.check-circle-mark \{ stroke: var\(--color-on-primary\); \}/);
    expect(css).toMatch(/\.evening-todo-category-name \{[^}]*font: 400 0\.75rem\/1rem var\(--font-family\); color: var\(--color-text-sub\);/);
  });

  it("「+ 할 일」을 열면 글 칸 · 이름표 「분야」 · 칩 줄(맨 앞 「기타」 골라짐, 색 점) · 「더하기」(주 단추, 폭 가득, 맨 끝)", async () => {
    const local = await makeLocal();
    await mountEvening({ local });
    await openSheet();
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    const form = sheet().querySelector("form.evening-todo-form")!;
    const order = Array.from(form.children).map((c) => c.className);
    expect(order).toEqual(["input-label", "input evening-todo-input", "input-help", "evening-todo-category-label", "chip-scroller", "btn btn-primary evening-todo-submit"]);
    expect(form.querySelector(".evening-todo-category-label")!.textContent).toBe("분야");
    const add = within(sheet()).getByRole("button", { name: "더하기" }) as HTMLButtonElement;
    expect(add.type).toBe("submit");
    const chips = within(within(sheet()).getByRole("group", { name: "분야" })).getAllByRole("button");
    expect(chips[0].querySelector<HTMLElement>(".chip-dot")!.style.background).toBe("var(--color-category-other)");
    expect(chips[1].querySelector<HTMLElement>(".chip-dot")!.style.background).toBe("var(--color-category-1)");
    expect(chips[0].querySelector(".chip-check")).not.toBeNull(); // 고른 칩 = 체크
  });

  it("「기타」 칩 = 분야 없음(저장 값 null): 그대로 더하면 null, 어학을 골랐다 다시 누르거나 「기타」를 누르면 기타로 돌아간다. 새 분야를 만들지 않는다", async () => {
    const local = await makeLocal();
    const addCategory = vi.spyOn(local, "addCategory");
    await mountEvening({ local });
    await openSheet();
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "+ 할 일" })));
    const input = within(sheet()).getByRole("textbox", { name: "할 일" });
    const group = () => within(sheet()).getByRole("group", { name: "분야" });
    const chipPressed = () => within(group()).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
    fireEvent.change(input, { target: { value: "책 읽기" } });
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
    expect(vi.mocked(local.addTodo).mock.calls[0][0]).toMatchObject({ text: "책 읽기", categoryId: null });
    // 어학 → 다시 누르면 풀려 기타
    fireEvent.click(within(group()).getByRole("button", { name: "어학" }));
    expect(chipPressed()).toEqual([["기타", "false"], ["어학", "true"], ["포트폴리오", "false"]]);
    fireEvent.click(within(group()).getByRole("button", { name: "어학" }));
    expect(chipPressed()).toEqual([["기타", "true"], ["어학", "false"], ["포트폴리오", "false"]]);
    // 포트폴리오 → 「기타」를 누르면 기타
    fireEvent.click(within(group()).getByRole("button", { name: "포트폴리오" }));
    fireEvent.click(within(group()).getByRole("button", { name: "기타" }));
    fireEvent.change(input, { target: { value: "산책" } });
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
    expect(vi.mocked(local.addTodo).mock.calls[1][0]).toMatchObject({ text: "산책", categoryId: null });
    // 고른 분야는 그 분야로(정상 길)
    fireEvent.click(within(group()).getByRole("button", { name: "포트폴리오" }));
    fireEvent.change(input, { target: { value: "표지 고치기" } });
    await act(async () => fireEvent.click(within(sheet()).getByRole("button", { name: "더하기" })));
    expect(vi.mocked(local.addTodo).mock.calls[2][0]).toMatchObject({ text: "표지 고치기", categoryId: C2 });
    expect(chipPressed()[0]).toEqual(["기타", "true"]); // 더한 뒤 다시 기타
    expect(addCategory).not.toHaveBeenCalled();
  });
});
