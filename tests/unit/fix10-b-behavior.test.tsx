// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 고침10 W2b 「동작」 둘 — 먼저 재현하는 시험(고치기 전에 실패했다), 고친 뒤 통과한다.
 *  1) 작업 기록을 쓴 직후 할 일 줄 종이 아이콘이 안 보임(기기 먼저 저장 길)
 *  2) 끊긴 채 적은 줄에 저장 대기 원(128:87)이 안 그려짐(기기 먼저 저장 길)
 * 기기 먼저 저장(local) 길이 앱의 실제 길이다. 서버는 가짜 send·fetchSnapshot, 운영 장치는 진짜(메모리 저장소).
 */

vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../lib/read-client", () => ({
  fetchToday: vi.fn(async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } })),
}));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(), dismissOffer: vi.fn() }));
vi.mock("../../lib/push/subscribe", () => ({ defaultPushApi: { enable: vi.fn(async () => "ok") } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { TodoScreen } from "../../components/todo-screen";
import { createLocalApis } from "../../lib/local/apis";
import { createMemoryKv, kvKeys } from "../../lib/local/kv";
import { emptyMirror } from "../../lib/local/reduce";
import { createRuntime, type Runtime } from "../../lib/local/runtime";
import { createLocalTodos } from "../../lib/local/todos";
import type { Mirror, MirrorTodo, QueuedOp, SendResult } from "../../lib/local/types";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T1 = "11111111-1111-4111-8111-111111111111";
const NOON = Date.parse("2026-11-07T06:00:00.000Z");
const todo = (id: string, text: string): MirrorTodo => ({ id, day: "2026-11-07", text, done: false, createdAt: "2026-11-07T01:00:00.000Z", categoryId: null, position: null });

let runtime: Runtime;
let sent: QueuedOp[];
let online: boolean;

async function mount() {
  const base: Mirror = { ...emptyMirror(), synced: true, categories: [], todos: [todo(T1, "처음 글")] };
  const kv = createMemoryKv();
  await kv.set(kvKeys.base(USER), base);
  sent = [];
  online = true;
  runtime = createRuntime({
    userKey: USER,
    kv,
    send: async (q): Promise<SendResult> => {
      sent.push(q);
      return { ok: true };
    },
    fetchSnapshot: async () => ({ ok: false, error: "unavailable" }),
    now: () => NOON,
    online: () => online,
  });
  await runtime.boot();
  const apis = createLocalApis(runtime);
  const local = createLocalTodos(runtime, apis);
  render(<TodoScreen initial={local.read()} manage={apis.manage} local={local} />);
  return { apis, local };
}
const rowOf = (text: string) => screen.getByText(text).closest("li") as HTMLElement;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState(null, "");
  vi.spyOn(window.history, "back").mockImplementation(() => {});
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("동작 1: 작업 기록을 쓴 직후 할 일 줄에 종이 아이콘이 생긴다(자리는 할 일 글 바로 뒤)", () => {
  async function leaveAfterNote(text: string) {
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 처음 글" }));
    const dialog = await screen.findByRole("dialog");
    const box = await within(dialog).findByRole("textbox", { name: "작업 기록" });
    fireEvent.change(box, { target: { value: text } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "남기기" })));
    await within(dialog).findByText(text, { selector: ".note-text" }).catch(() => null);
    fireEvent.click(within(dialog).getByRole("button", { name: "이전" })); // 돌아온다
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    return dialog;
  }

  it("재현: 기기가 그 할 일의 기록 목록을 모를 때(끊겨서 못 읽음) 기록을 쓰고 돌아와도 줄에 아이콘이 생긴다 — 글 바로 뒤, 거울을 다시 읽어도 그대로", async () => {
    await mount(); // 시험 환경은 서버 읽기(fetch)가 없다 → 기록 목록을 읽지 못한 채 쓰는 길
    expect(rowOf("처음 글").querySelector(".todo-note-icon")).toBeNull();
    await leaveAfterNote("오늘 한 일");
    const icon = rowOf("처음 글").querySelector(".todo-note-icon");
    expect(icon, "기록을 쓴 직후 줄에 종이 아이콘").toBeTruthy();
    expect(icon!.getAttribute("aria-label")).toBe("작업 기록 있음");
    expect(icon!.previousElementSibling?.textContent, "자리 = 할 일 글 바로 뒤").toBe("처음 글");
    await act(async () => {
      await runtime.flush(); // 서버가 받아 거울을 다시 맞춘 뒤에도
    });
    expect(rowOf("처음 글").querySelector(".todo-note-icon")).toBeTruthy();
  });

  it("기록 목록을 아는 할 일: 기록을 쓰면 아이콘이 생기고, 그 기록을 지우면 없어진다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { notes: [] } }), { status: 200 })));
    try {
      await mount();
      await leaveAfterNote("오늘 한 일");
      expect(rowOf("처음 글").querySelector(".todo-note-icon")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "자세히 보기: 처음 글" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(await within(dialog).findByRole("button", { name: /^지우기: .* 기록$/ }));
      await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "지우기" })));
      fireEvent.click(within(dialog).getByRole("button", { name: "이전" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(rowOf("처음 글").querySelector(".todo-note-icon")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("동작 2: 끊긴 채 적은 줄에 저장 대기 원(128:87)이 그려진다", () => {
  it("끊긴 채 적으면 그 줄 오른쪽에 도는 원 + 숨은 글 「저장 대기」가 있고(체크 칸 설명에 이어짐), 연결되어 보내면 사라진다. 처음 있던 줄에는 없다", async () => {
    await mount();
    online = false;
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    fireEvent.click(screen.getByRole("button", { name: /^(할 일 적기|적던 글 이어 적기)$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: "끊긴 채 적음" } });
    fireEvent.click(screen.getByRole("button", { name: "적기" }));
    const row = rowOf("끊긴 채 적음");
    const pending = row.querySelector(".save-pending");
    expect(pending, "저장 대기 원").toBeTruthy();
    expect(pending!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(pending!.querySelector(".sr-only")!.textContent).toBe("저장 대기");
    const check = within(row).getByRole("checkbox") as HTMLInputElement;
    expect(document.getElementById(check.getAttribute("aria-describedby")!)!.textContent).toContain("저장 대기");
    expect(rowOf("처음 글").querySelector(".save-pending")).toBeNull();
    // 연결되어 서버가 받으면 원이 사라진다
    online = true;
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await runtime.flush();
    });
    await waitFor(() => expect(rowOf("끊긴 채 적음").querySelector(".save-pending")).toBeNull());
    expect(sent.map((q) => q.op.kind)).toContain("todo.add");
  });
  it("연결된 채 적으면 원이 깜박이지 않는다(저장 대기는 끊긴 동안만)", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /^(할 일 적기|적던 글 이어 적기)$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: "연결된 채 적음" } });
    fireEvent.click(screen.getByRole("button", { name: "적기" }));
    expect(rowOf("연결된 채 적음").querySelector(".save-pending")).toBeNull();
  });
});
