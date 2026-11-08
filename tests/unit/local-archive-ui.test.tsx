// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 기기 먼저 저장 고침 4바퀴(F4 a): 서버가 받지 않은 쓰기의 내용이 화면에 보이고 복사할 수 있다. 글은 React 텍스트로만 그린다.
 * 입구(LocalAppShell)는 진짜 운영 장치(메모리 저장소)로 돌린다. 서버는 가짜.
 */

vi.mock("../../app/local/actions", () => ({ sendLocalOp: vi.fn() }));
vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({ editTodo: vi.fn(), deleteTodo: vi.fn(), reorderTodos: vi.fn(), carryOverTodos: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(async () => ({ ok: true, data: { offer: null, reason: "no_target" } })), dismissOffer: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("../../lib/read-client", () => ({ fetchToday: vi.fn() }));
vi.mock("../../lib/push/subscribe", () => ({
  defaultPushApi: {
    permission: () => "default",
    supported: () => false,
    hasKey: () => false,
    subscribed: async () => false,
    enable: async () => "unsupported",
    disable: async () => {},
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const holder: { kv: ReturnType<typeof import("../../lib/local/kv").createMemoryKv> | null; reply: (q: { op: { kind: string } }) => unknown; resets: ((r: "account_mismatch" | "signed_out_elsewhere") => void)[] } = {
  kv: null,
  reply: () => ({ ok: true }),
  resets: [],
};
vi.mock("../../lib/local/browser", async () => {
  const real = await vi.importActual<typeof import("../../lib/local/browser")>("../../lib/local/browser");
  const { createRuntime } = await vi.importActual<typeof import("../../lib/local/runtime")>("../../lib/local/runtime");
  return {
    ...real,
    createBrowserRuntime: (userKey: string, onReset?: (r: "account_mismatch" | "signed_out_elsewhere") => void) => {
      if (onReset) holder.resets.push(onReset);
      return createRuntime({
        userKey,
        kv: holder.kv!,
        send: async (q) => holder.reply(q as never) as never,
        fetchSnapshot: async () => ({ ok: false, error: "unavailable" }),
        now: () => Date.parse("2026-11-07T06:00:00.000Z"),
        online: () => true,
        onReset,
      });
    },
    startBrowserSync: () => () => {},
  };
});

import { ArchivedWrites, LOCAL_SAVE_TEXT } from "../../components/app-shell";
import { LocalAppShell } from "../../components/local-app-shell";
import { createMemoryKv, kvKeys } from "../../lib/local/kv";
import { emptyMirror } from "../../lib/local/reduce";
import type { ArchivedWrite, Mirror } from "../../lib/local/types";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const NOTIFY = { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 };
const mirror = (): Mirror => ({
  ...emptyMirror(),
  synced: true,
  categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" }],
  settings: { goal: null, goalReadable: true, onboardingDone: true, notify: NOTIFY, ratios: [{ categoryId: C1, percent: 100 }] },
});
const HOSTILE = `<img src=x onerror="window.__pwned=1">${"길다".repeat(300)}`;
const item = (key: string, text: string, kind: ArchivedWrite["kind"] = "todo.add"): ArchivedWrite => ({ key, kind, error: "daily_limit", clientAt: "2026-11-07T05:00:00.000Z", text });

beforeEach(() => {
  holder.kv = createMemoryKv();
  holder.reply = () => ({ ok: true });
  holder.resets = [];
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("ArchivedWrites: 받지 않은 쓰기 보관 자리", () => {
  it("글을 텍스트로만 그린다(꺾쇠가 태그가 되지 않는다). 긴 글은 감싼다", () => {
    render(<ArchivedWrites items={[item("k1", HOSTILE)]} onDismiss={() => {}} clipboard={{ writeText: async () => {} }} />);
    expect(screen.getByText(LOCAL_SAVE_TEXT.archivedTitle(1))).toBeTruthy();
    const text = screen.getByText(HOSTILE);
    expect(text.textContent).toBe(HOSTILE);
    expect(document.querySelector("img")).toBeNull();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    expect(text.style.overflowWrap).toBe("anywhere");
  });
  it("「복사」는 그 글을 클립보드에 넣고 알린다. 실패하면 길게 눌러 고르라고 알린다", async () => {
    const writeText = vi.fn(async (_t: string) => {});
    render(<ArchivedWrites items={[item("k1", "첫 글"), item("k2", "둘째 글", "note.add")]} onDismiss={() => {}} clipboard={{ writeText }} />);
    expect(screen.getByText("할 일")).toBeTruthy();
    expect(screen.getByText("작업 기록")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: LOCAL_SAVE_TEXT.copy })[1]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("둘째 글"));
    expect(await screen.findByText(LOCAL_SAVE_TEXT.copied)).toBeTruthy();
    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getAllByRole("button", { name: LOCAL_SAVE_TEXT.copy })[0]);
    expect(await screen.findByText(LOCAL_SAVE_TEXT.copyFailed)).toBeTruthy();
  });
  it("보관한 것이 없으면 아무것도 그리지 않는다", () => {
    const { container } = render(<ArchivedWrites items={[]} onDismiss={() => {}} />);
    expect(container.textContent).toBe("");
  });
});

describe("앱 화면: 서버가 거절하면 그 글이 보관 자리에 보이고 복사·지우기를 할 수 있다", () => {
  it("기기에 보관된 글이 열 때 보이고, 서버가 새로 거절한 글도 보인다. 복사·지우기", async () => {
    await holder.kv!.set(kvKeys.base(USER), mirror());
    await holder.kv!.set(kvKeys.rejected(USER, "0000000000001-0000-aaaa"), item("0000000000001-0000-aaaa", "지난번에 받지 않은 글"));
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    holder.reply = (q) => (q.op.kind === "todo.add" ? { ok: false, error: "daily_limit" } : { ok: true });
    render(<LocalAppShell userKey={USER} />);
    expect(await screen.findByText("지난번에 받지 않은 글")).toBeTruthy();

    // 새로 적은 할 일을 서버가 받지 않는다
    fireEvent.click(screen.getByRole("button", { name: "할 일 적기" }));
    fireEvent.change(screen.getByRole("textbox", { name: "할 일 적기" }), { target: { value: "서버가 받지 않을 글" } });
    fireEvent.click(screen.getByRole("button", { name: "적기" }));
    expect(await screen.findByText(LOCAL_SAVE_TEXT.archivedTitle(2), {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getAllByText("서버가 받지 않을 글").length).toBeGreaterThan(0);

    const list = screen.getByRole("list", { name: "받지 않은 기록" });
    const copyButtons = list.querySelectorAll("button");
    fireEvent.click(copyButtons[2]); // 둘째 항목의 「복사」
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("서버가 받지 않을 글"));

    fireEvent.click(screen.getByRole("button", { name: LOCAL_SAVE_TEXT.dismissAll }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "받지 않은 기록" })).toBeNull());
    await waitFor(async () => expect(await holder.kv!.keys("rej/")).toEqual([]));
  });
  it("계정이 바뀌어 운영 장치가 자기 것을 지우면 안내를 보인다", async () => {
    await holder.kv!.set(kvKeys.base(USER), mirror());
    render(<LocalAppShell userKey={USER} />);
    await screen.findByRole("button", { name: "할 일 적기" });
    await act(async () => {
      holder.resets[0]("signed_out_elsewhere");
    });
    expect(screen.getByText(LOCAL_SAVE_TEXT.resetSignedOut)).toBeTruthy();
    expect(screen.getByRole("button", { name: LOCAL_SAVE_TEXT.reopen })).toBeTruthy();
  });
});
