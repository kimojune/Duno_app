// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeRead } from "../../lib/home-types";
import type { TodayRead } from "../../lib/today-types";

const signOut = vi.fn();
vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({ editTodo: vi.fn(), deleteTodo: vi.fn(), reorderTodos: vi.fn(), carryOverTodos: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/views/actions", () => ({ recordView: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(async () => ({ ok: true, data: { offer: null } })), dismissOffer: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/actions", () => ({ signOut: (...a: unknown[]) => signOut(...a) }));
vi.mock("../../lib/read-client", () => ({
  fetchToday: vi.fn(async () => ({ todos: { ok: false, error: "unavailable" }, categories: { ok: false, error: "unavailable" } })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { AppShell } from "../../components/app-shell";
import { TodoScreen } from "../../components/todo-screen";
import { LOGOUT_REQUEST_NAME, TodoScreenWithLogout } from "./logout-request-helper";

const DAY = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const today: TodayRead = { todos: { ok: true, data: { day: DAY, todos: [] } }, categories: { ok: true, data: { categories: [] } } };
const home = { today, settings: { ok: false, error: "unavailable" } } as HomeRead;
const OTHER_BOX = "duno.outbox.v1.other-user";

beforeEach(() => {
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// 로그아웃은 내 정보 맨 아래 단추 한 곳(고침10 E: 할 일 머리의 「로그아웃」은 없다). 그 단추가 할 일 탭의 로그아웃 흐름을 건다
const logout = () => act(async () => fireEvent.click((document.getElementById("me-logout-button") ?? screen.getByRole("button", { name: LOGOUT_REQUEST_NAME })) as HTMLElement));

describe("로그아웃 때 푸시 구독 거두기 (A7)", () => {
  it("구독을 거둔 뒤에 로그아웃한다(세션이 살아 있을 때 지워야 해서)", async () => {
    const order: string[] = [];
    const before = vi.fn(async () => {
      order.push("disable");
    });
    signOut.mockImplementation(async () => {
      order.push("signOut");
    });
    render(<TodoScreenWithLogout initial={today} onBeforeSignOut={before} />);
    await logout();
    expect(before).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["disable", "signOut"]);
  });

  it("구독 거두기가 실패하거나 3초 안에 끝나지 않아도 로그아웃은 진행한다", async () => {
    render(<TodoScreenWithLogout initial={today} onBeforeSignOut={async () => Promise.reject(new Error("boom"))} />);
    await logout();
    expect(signOut).toHaveBeenCalledTimes(1);
    cleanup();
    signOut.mockClear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<TodoScreenWithLogout initial={today} onBeforeSignOut={() => new Promise<void>(() => {})} />);
    await logout();
    expect(signOut).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("옛 호출(onBeforeSignOut 없음)은 바로 로그아웃한다", async () => {
    render(<TodoScreenWithLogout initial={today} />);
    await logout();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("앱 틀은 이 기기의 푸시 구독 끄기를 로그아웃 앞에 건다", async () => {
    const push = { permission: vi.fn(() => "default" as const), supported: vi.fn(() => true), hasKey: vi.fn(() => true), subscribed: vi.fn(async () => false), enable: vi.fn(), disable: vi.fn(async () => {}) };
    render(<AppShell home={home} apis={{ push }} />);
    await act(async () => {});
    await logout();
    expect(push.disable).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("로그인 직후 다른 사용자의 보관함 지우기 (A6)", () => {
  it("userKey가 있으면 이 기기에 남은 다른 사용자의 보관함만 지우고 내 것은 둔다", async () => {
    window.localStorage.setItem(OTHER_BOX, "[]");
    window.localStorage.setItem("duno.outbox.v1.me", "[]");
    window.localStorage.setItem("theme", "dark");
    render(<AppShell home={home} userKey="me" />);
    await act(async () => {});
    expect(window.localStorage.getItem(OTHER_BOX)).toBeNull();
    expect(window.localStorage.getItem("duno.outbox.v1.me")).not.toBeNull();
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });
  it("userKey가 없으면 건드리지 않는다", async () => {
    window.localStorage.setItem(OTHER_BOX, "[]");
    render(<AppShell home={home} />);
    await act(async () => {});
    expect(window.localStorage.getItem(OTHER_BOX)).not.toBeNull();
  });
});
