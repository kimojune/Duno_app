// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 기기 먼저 저장(고침 3바퀴)의 할 일 화면: local이 있으면 서버 Server Action을 부르지 않고, 누르면 기기 거울에 먼저 반영되어 바로 바뀐다.
 * 서버는 가짜 send·fetchSnapshot이다. 운영 장치는 진짜(메모리 저장소)를 쓴다.
 */

const addTodo = vi.fn();
const setTodoDone = vi.fn();
const addCategoryAction = vi.fn();
const signOut = vi.fn();
vi.mock("../../app/todos/actions", () => ({
  addTodo: (...a: unknown[]) => addTodo(...a),
  setTodoDone: (...a: unknown[]) => setTodoDone(...a),
  addCategory: (...a: unknown[]) => addCategoryAction(...a),
}));
vi.mock("../../lib/read-client", () => ({
  fetchToday: vi.fn(async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } })),
}));
vi.mock("../../app/actions", () => ({ signOut: (...a: unknown[]) => signOut(...a) }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(), dismissOffer: vi.fn() }));
vi.mock("../../lib/push/subscribe", () => ({ defaultPushApi: { enable: vi.fn(async () => "ok") } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { TodoScreen } from "../../components/todo-screen";
import { createLocalApis } from "../../lib/local/apis";
import { createMemoryKv, kvKeys } from "../../lib/local/kv";
import { emptyMirror } from "../../lib/local/reduce";
import { createRuntime, type Runtime } from "../../lib/local/runtime";
import { createLocalTodos } from "../../lib/local/todos";
import type { Mirror, MirrorSnapshot, MirrorTodo, QueuedOp, SendResult } from "../../lib/local/types";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T1 = "11111111-1111-4111-8111-111111111111";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const NOON = Date.parse("2026-11-07T06:00:00.000Z"); // 서울 15:00, 두노 하루 11-07
const todo = (id: string, text: string, over: Partial<MirrorTodo> = {}): MirrorTodo => ({ id, day: "2026-11-07", text, done: false, createdAt: "2026-11-07T01:00:00.000Z", categoryId: null, position: null, ...over });

let runtime: Runtime;
let sent: QueuedOp[];
let reply: (q: QueuedOp) => SendResult;
let online: boolean;
let snapshotReply: () => Promise<{ ok: true; data: MirrorSnapshot } | { ok: false; error: string }>;
let kvRef: ReturnType<typeof createMemoryKv>;

async function mount(mirror: Partial<Mirror> = {}) {
  const base: Mirror = {
    ...emptyMirror(),
    synced: true,
    categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" }],
    todos: [todo(T1, "처음 글")],
    ...mirror,
  };
  kvRef = createMemoryKv();
  await kvRef.set(kvKeys.base(USER), base);
  sent = [];
  reply = () => ({ ok: true });
  online = true;
  snapshotReply = async () => ({ ok: false, error: "unavailable" });
  runtime = createRuntime({
    userKey: USER,
    kv: kvRef,
    send: async (q) => {
      sent.push(q);
      return reply(q);
    },
    fetchSnapshot: () => snapshotReply(),
    now: () => NOON,
    online: () => online,
  });
  await runtime.boot();
  const apis = createLocalApis(runtime);
  const local = createLocalTodos(runtime, apis);
  render(<TodoScreen initial={local.read()} manage={apis.manage} local={local} />);
  return { apis, local };
}

const openButton = () => screen.getByRole("button", { name: /^(할 일 적기|적던 글 이어 적기)$/ });
const todoInput = () => screen.getByRole("textbox", { name: "할 일 적기" }) as HTMLInputElement;
const typeTodo = (text: string) => fireEvent.change(todoInput(), { target: { value: text } });
const pressWrite = () => fireEvent.click(screen.getByRole("button", { name: "적기" }));
const rowOf = (text: string) => screen.getByText(text).closest("li") as HTMLElement;

beforeEach(() => {
  for (const m of [addTodo, setTodoDone, addCategoryAction, signOut]) m.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState(null, "");
  vi.spyOn(window.history, "back").mockImplementation(() => {});
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("적기·끝냄: 누르면 서버 응답 없이 바로 바뀐다", () => {
  it("적으면 서버 Action을 부르지 않고 목록이 바로(저장하는 중 없이) 바뀌며 칸이 비고, 보낼 줄에 들어간다", async () => {
    await mount();
    fireEvent.click(openButton());
    typeTodo("새로 적은 글");
    pressWrite();
    expect(screen.getByText("새로 적은 글")).toBeTruthy(); // 동기: await 없이 바로
    expect(todoInput().value).toBe("");
    expect(screen.queryByText("저장하는 중")).toBeNull();
    expect(screen.queryByText("연결되면 저장해요")).toBeNull();
    expect(screen.queryByText("저장 대기")).toBeNull();
    expect(screen.getByText("2개 중 0개 끝냄", { exact: false })).toBeTruthy();
    expect(addTodo).not.toHaveBeenCalled(); // 화면이 서버 Action을 직접 부르지 않는다
    expect(runtime.pendingOps().map((o) => o.op)).toEqual([expect.objectContaining({ kind: "todo.add", text: "새로 적은 글", categoryId: null })]);
    await waitFor(() => expect(sent.map((q) => q.op.kind)).toEqual(["todo.add"])); // 뒤에서 서버로 간다(보낼 줄)
    expect(sent[0].clientAt).toBe(new Date(NOON).toISOString());
  });
  it("고른 분야를 달아 적는다. 빈 글은 아무것도 안 만든다", async () => {
    await mount();
    fireEvent.click(openButton());
    typeTodo("   ");
    pressWrite();
    expect(runtime.pendingCount()).toBe(0);
    fireEvent.click(within(screen.getByRole("group", { name: "분야" })).getByRole("button", { name: "어학" }));
    typeTodo("분야 있는 글");
    pressWrite();
    expect(runtime.pendingOps()[0].op).toMatchObject({ kind: "todo.add", text: "분야 있는 글", categoryId: C1 });
    expect(within(rowOf("분야 있는 글")).getByText("어학", { exact: false })).toBeTruthy();
  });
  it("끊긴 채 적어도 막히지 않는다: 안내 없이 목록에 들어가고 기기에 남으며, 연결되면 서버에 한 번 간다", async () => {
    await mount();
    online = false;
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    fireEvent.click(openButton());
    typeTodo("끊긴 채 적음");
    pressWrite();
    expect(screen.getByText("끊긴 채 적음")).toBeTruthy();
    expect(screen.queryByText(/인터넷에 연결되면 적을 수 있어요/)).toBeNull();
    expect(todoInput().value).toBe("");
    await runtime.flush();
    expect(sent).toHaveLength(0); // 끊겨서 못 보냄
    expect(runtime.pendingCount()).toBe(1);
    online = true;
    await act(async () => {
      await runtime.flush();
    });
    expect(sent.map((q) => q.op.kind)).toEqual(["todo.add"]);
    expect(runtime.pendingCount()).toBe(0);
  });
  it("끊긴 안내 글은 「이 기기에 두었다가 연결되면 보내요」다", async () => {
    await mount();
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText(/이 기기에 두었다가 연결되면 보내요/)).toBeTruthy();
  });
  it("끝냄 표시는 바로 바뀌고, 방금 적은 줄도(서버에 올라가기 전에도) 바로 누를 수 있다", async () => {
    await mount();
    online = false;
    fireEvent.click(screen.getByRole("checkbox", { name: /처음 글/ }));
    expect((screen.getByRole("checkbox", { name: /처음 글/ }) as HTMLInputElement).checked).toBe(true);
    expect(setTodoDone).not.toHaveBeenCalled();
    fireEvent.click(openButton());
    typeTodo("방금 적은 글");
    pressWrite();
    const box = screen.getByRole("checkbox", { name: /방금 적은 글/ }) as HTMLInputElement;
    fireEvent.click(box);
    expect((screen.getByRole("checkbox", { name: /방금 적은 글/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("2개 중 2개 끝냄", { exact: false })).toBeTruthy();
    expect(runtime.pendingOps().map((o) => o.op.kind)).toEqual(["todo.done", "todo.add", "todo.done"]);
    // 다시 누르면 원래대로(마지막 값이 이긴다)
    fireEvent.click(screen.getByRole("checkbox", { name: /처음 글/ }));
    expect((screen.getByRole("checkbox", { name: /처음 글/ }) as HTMLInputElement).checked).toBe(false);
  });
  it("분야 더하기: 서버 Action 없이 바로 칩이 생기고 골라지며, 같은 이름은 새로 만들지 않고 고른다", async () => {
    await mount();
    online = false; // 보낼 줄에 그대로 남아 있게 한다
    fireEvent.click(openButton());
    fireEvent.click(screen.getByRole("button", { name: "+ 분야" }));
    fireEvent.change(screen.getByRole("textbox", { name: "새 분야 이름" }), { target: { value: "글쓰기" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^(더하기|더하는 중)$/ })));
    const group = () => screen.getByRole("group", { name: "분야" });
    expect(within(group()).getByRole("button", { name: "글쓰기" }).getAttribute("aria-pressed")).toBe("true");
    expect(addCategoryAction).not.toHaveBeenCalled();
    expect(runtime.pendingOps()[0].op).toMatchObject({ kind: "category.add", name: "글쓰기" });
    // 같은 이름
    fireEvent.click(screen.getByRole("button", { name: "+ 분야" }));
    fireEvent.change(screen.getByRole("textbox", { name: "새 분야 이름" }), { target: { value: "어학" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^(더하기|더하는 중)$/ })));
    expect(runtime.pendingOps().filter((o) => o.op.kind === "category.add")).toHaveLength(1);
    expect(within(group()).getByRole("button", { name: "어학" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("서버와 맞추기: 되돌림·받기", () => {
  it("서버가 거절한 쓰기는 목록에서 사라진다(기기 것을 되돌린다)", async () => {
    await mount();
    reply = (q) => (q.op.kind === "todo.add" ? { ok: false, error: "daily_limit" } : { ok: true });
    fireEvent.click(openButton());
    typeTodo("거절될 글");
    pressWrite();
    expect(screen.getByText("거절될 글")).toBeTruthy();
    await act(async () => {
      await runtime.flush();
    });
    await waitFor(() => expect(screen.queryByText("거절될 글")).toBeNull());
    expect(screen.getByText("처음 글")).toBeTruthy();
  });
  it("서버에서 받아 맞추면(다른 기기에서 적은 글) 화면이 따라간다", async () => {
    await mount();
    snapshotReply = async () => ({
      ok: true,
      data: { serverNow: new Date(NOON).toISOString(), todos: [todo(T1, "처음 글"), todo("22222222-2222-4222-8222-222222222222", "다른 기기에서 적은 글")], categories: null, settings: null, logs: null, goal: null, sessions: null },
    });
    await act(async () => {
      await runtime.pull();
    });
    expect(await screen.findByText("다른 기기에서 적은 글")).toBeTruthy();
  });
  it("처음 쓰는 기기에서 서버 사본을 못 받았으면 비어 있는 것이 아니라 읽기 실패 안내가 뜬다", async () => {
    kvRef = createMemoryKv();
    runtime = createRuntime({ userKey: USER, kv: kvRef, send: async () => ({ ok: true }), fetchSnapshot: async () => ({ ok: false, error: "unavailable" }), now: () => NOON, online: () => false });
    await runtime.boot();
    const apis = createLocalApis(runtime);
    const local = createLocalTodos(runtime, apis);
    render(<TodoScreen initial={local.read()} manage={apis.manage} local={local} />);
    expect(screen.getByText("할 일을 불러오지 못했어요.")).toBeTruthy();
    expect(screen.queryByText("오늘 적은 할 일이 없어요.")).toBeNull();
  });
});

describe("로그아웃·로그인 풀림", () => {
  it("보낼 줄이 없으면 먼저 보내 보고 기기 저장소를 지운 뒤 바로 로그아웃한다", async () => {
    await mount();
    document.cookie = "duno-device=" + USER + "; path=/";
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "로그아웃" })));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(await kvRef.keys("base/")).toEqual([]);
    expect(document.cookie).not.toContain("duno-device"); // 이 기기에 거울이 없어졌다는 표시도 지운다
  });
  it("못 보낸 쓰기가 있으면 「보내지 못한 기록이 있어요」를 알리고, 취소하면 그대로, 로그아웃을 고르면 기기 저장소를 지우고 로그아웃한다", async () => {
    await mount();
    online = false;
    fireEvent.click(openButton());
    typeTodo("못 보낸 글");
    pressWrite();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "로그아웃" })));
    expect(await screen.findByText(/보내지 못한 기록이 있어요/)).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
    // 취소: 기록은 그대로
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByText(/보내지 못한 기록이 있어요/)).toBeNull();
    expect(runtime.pendingCount()).toBe(1);
    // 다시 로그아웃 → 확인에서 로그아웃
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "로그아웃" })));
    await screen.findByText(/보내지 못한 기록이 있어요/);
    const notice = screen.getByText(/보내지 못한 기록이 있어요/).closest("[role=alert]") as HTMLElement;
    await act(async () => fireEvent.click(within(notice).getByRole("button", { name: "로그아웃" })));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(await kvRef.keys("op/")).toEqual([]);
    expect(await kvRef.keys("base/")).toEqual([]);
  });
  it("연결이 있으면 로그아웃 직전에 보낼 줄을 서버에 보내고, 다 보냈으면 확인 없이 로그아웃한다", async () => {
    await mount();
    fireEvent.click(openButton());
    typeTodo("보내질 글");
    pressWrite();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "로그아웃" })));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(sent.map((q) => q.op.kind)).toContain("todo.add");
    expect(screen.queryByText(/보내지 못한 기록이 있어요/)).toBeNull();
  });
  it("로그인이 풀려 서버에 보내지 못하면 안내를 보인다. 보낼 줄은 기기에 남는다고 알리고 복사 단추는 없다", async () => {
    await mount();
    reply = () => ({ ok: false, error: "unauthenticated" });
    fireEvent.click(openButton());
    typeTodo("글");
    pressWrite();
    await act(async () => {
      await runtime.flush();
    });
    expect(await screen.findByText("로그인이 풀렸어요. 다시 로그인해 주세요.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "저장 안 된 글 복사" })).toBeNull();
    expect(runtime.pendingCount()).toBe(1); // 지우지 않는다: 다시 로그인하면 이어서 보낸다
  });
});
