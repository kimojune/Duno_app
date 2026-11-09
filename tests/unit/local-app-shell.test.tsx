// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 기기 먼저 저장의 입구(고침 3바퀴): 기기 저장소에 거울이 있으면 서버를 기다리지 않고 바로 그리고, 이 기기에서 처음이면 서버 사본을 기다린다.
 * 운영 장치는 진짜(메모리 저장소)이고, 서버는 가짜 send·fetchSnapshot이다. 브라우저 사건 듣기(startBrowserSync)만 바꾼다.
 */

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

const kvHolder: { kv: ReturnType<typeof import("../../lib/local/kv").createMemoryKv> | null; sent: { op: unknown; clientAt: string }[] } = { kv: null, sent: [] };
const pullGate: { reply: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }> } = { reply: async () => ({ ok: false, error: "unavailable" }) };
const startSync = vi.fn(() => () => {});
vi.mock("../../lib/local/browser", async () => {
  const real = await vi.importActual<typeof import("../../lib/local/browser")>("../../lib/local/browser");
  const { createRuntime } = await vi.importActual<typeof import("../../lib/local/runtime")>("../../lib/local/runtime");
  return {
    ...real,
    createBrowserRuntime: (userKey: string) =>
      createRuntime({
        userKey,
        kv: kvHolder.kv!,
        send: async (q: { op: unknown; clientAt: string }) => {
          kvHolder.sent.push(q);
          return { ok: true };
        },
        fetchSnapshot: () => pullGate.reply() as never,
        now: () => Date.parse("2026-11-07T06:00:00.000Z"),
        online: () => true,
      }),
    startBrowserSync: (...a: unknown[]) => (startSync as (...x: unknown[]) => () => void)(...a),
  };
});

import { FIRST_PULL_WAIT_MS, LocalAppShell } from "../../components/local-app-shell";
import { createMemoryKv, kvKeys } from "../../lib/local/kv";
import { emptyMirror } from "../../lib/local/reduce";
import type { Mirror, MirrorTodo } from "../../lib/local/types";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "11111111-1111-4111-8111-111111111111";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const todo = (id: string, text: string): MirrorTodo => ({ id, day: "2026-11-07", text, done: false, createdAt: "2026-11-07T01:00:00.000Z", categoryId: null, position: null });
const NOTIFY = { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 };
const mirror = (over: Partial<Mirror> = {}): Mirror => ({
  ...emptyMirror(),
  synced: true,
  categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" }],
  settings: { goal: null, goalReadable: true, onboardingDone: true, notify: NOTIFY, ratios: [{ categoryId: C1, percent: 100 }] },
  todos: [todo(T1, "기기에 있던 글")],
  ...over,
});

beforeEach(() => {
  kvHolder.kv = createMemoryKv();
  kvHolder.sent = [];
  pullGate.reply = async () => ({ ok: false, error: "unavailable" });
  startSync.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LocalAppShell", () => {
  it("기기 저장소에 거울이 있으면 서버 사본을 기다리지 않고 바로 목록을 그린다(서버 사본은 영영 안 와도)", async () => {
    await kvHolder.kv!.set(kvKeys.base(USER), mirror());
    pullGate.reply = () => new Promise(() => {}); // 서버가 응답하지 않는다
    render(<LocalAppShell userKey={USER} />);
    expect(screen.getByText("불러오는 중")).toBeTruthy(); // 서버가 그린 첫 화면(개인 데이터 없음)
    expect(await screen.findByText("기기에 있던 글")).toBeTruthy();
    expect(screen.getByText("1개 중 0개 끝냄", { exact: false })).toBeTruthy();
    expect(startSync).toHaveBeenCalledTimes(1); // 보내기·받기는 뒤에서 시작
  });
  it("이 기기에서 처음 쓰는 사용자는 서버 사본이 올 때까지 「불러오는 중」, 오면 그린다", async () => {
    let release: (v: { ok: true; data: unknown }) => void = () => {};
    pullGate.reply = () => new Promise((resolve) => (release = resolve));
    render(<LocalAppShell userKey={USER} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText("불러오는 중")).toBeTruthy();
    expect(screen.queryByText("오늘")).toBeNull();
    await act(async () => release({ ok: true, data: { serverNow: "2026-11-07T06:00:00.000Z", todos: [todo(T1, "서버에서 온 글")], categories: [], settings: mirror().settings, logs: [], goal: null, sessions: [] } }));
    expect(await screen.findByText("서버에서 온 글")).toBeTruthy();
  });
  it(`이 기기에서 처음인데 서버 사본이 ${FIRST_PULL_WAIT_MS / 1000}초 안에 안 오면 그냥 열고, 비어 있는 것이 아니라 읽기 실패 안내를 보인다`, async () => {
    pullGate.reply = () => new Promise(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<LocalAppShell userKey={USER} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_PULL_WAIT_MS + 100);
    });
    vi.useRealTimers();
    expect(await screen.findByText("할 일을 불러오지 못했어요.")).toBeTruthy();
    expect(screen.queryByText("오늘 적은 할 일이 없어요.")).toBeNull();
  });
  it("처음 설정을 안 마친 사용자는 처음 설정부터 보인다", async () => {
    await kvHolder.kv!.set(kvKeys.base(USER), mirror({ settings: { goal: null, goalReadable: true, onboardingDone: false, notify: NOTIFY, ratios: [] } }));
    render(<LocalAppShell userKey={USER} />);
    expect(await screen.findByText("4단계 중 1단계")).toBeTruthy();
  });
  it("이 기기에 남은 다른 사용자의 기기 저장소는 읽지 않고 지운다", async () => {
    await kvHolder.kv!.set(kvKeys.base(USER), mirror());
    await kvHolder.kv!.set(kvKeys.base(OTHER), mirror({ todos: [todo(T1, "남의 글")] }));
    await kvHolder.kv!.set(kvKeys.op(OTHER, "0000000000001-0000-aaaa"), { key: "0000000000001-0000-aaaa", clientAt: "2026-11-07T00:00:00.000Z", attempts: 0, op: { kind: "todo.add", id: T1, text: "남의 보낼 글" } });
    render(<LocalAppShell userKey={USER} />);
    await screen.findByText("기기에 있던 글");
    expect(screen.queryByText("남의 글")).toBeNull();
    await waitFor(async () => expect(await kvHolder.kv!.keys("base/")).toEqual([kvKeys.base(USER)]));
    expect(await kvHolder.kv!.keys(kvKeys.opPrefix(OTHER))).toEqual([]);
  });
  it("옛 판의 오프라인 보관함(localStorage)에 남은 글은 보낼 줄로 옮겨지고 옛 보관함은 비워진다", async () => {
    await kvHolder.kv!.set(kvKeys.base(USER), mirror());
    window.localStorage.setItem(
      `duno.outbox.v1.${USER}`,
      JSON.stringify([{ id: "22222222-2222-4222-8222-222222222222", text: "옛 보관함 글", categoryId: null, writtenAt: "2026-11-07T05:00:00.000Z" }]),
    );
    render(<LocalAppShell userKey={USER} />);
    expect(await screen.findByText("옛 보관함 글")).toBeTruthy();
    expect(window.localStorage.getItem(`duno.outbox.v1.${USER}`)).toBeNull();
    // 적은 때(writtenAt)를 그대로 가져가 서버로 간다(하루가 바뀌지 않게)
    await waitFor(() => expect(kvHolder.sent).toEqual([{ key: expect.any(String), attempts: 0, op: { kind: "todo.add", id: "22222222-2222-4222-8222-222222222222", text: "옛 보관함 글", categoryId: null }, clientAt: "2026-11-07T05:00:00.000Z" }]));
  });
});

describe("LocalAppShell: 이 기기에서 처음 여는 사용자에게 서버가 실어 보낸 사본 (고침 3바퀴)", () => {
  const snapshot = () => ({ serverNow: "2026-11-07T06:00:00.000Z", todos: [todo(T1, "서버가 실어 보낸 글")], categories: mirror().categories, settings: mirror().settings, logs: [], goal: null, sessions: [] });
  const clearCookie = () => {
    document.cookie = "duno-device=; path=/; max-age=0";
  };
  beforeEach(clearCookie);
  afterEach(clearCookie);

  it("서버 사본이 실려 오면 서버에 다시 받으러 가지 않고 바로 그리며, 이 기기에 거울이 있다고 표시한다", async () => {
    pullGate.reply = () => new Promise(() => {}); // GET /mirror가 응답하지 않아도
    // 이 시험의 저장소는 기기 저장소가 아니라 메모리라 표시를 하지 않는다 → 저장소가 남는 경우를 따로 본다(아래)
    render(<LocalAppShell userKey={USER} initialSnapshot={snapshot()} />);
    expect(await screen.findByText("서버가 실어 보낸 글")).toBeTruthy();
  });
  it("기기 저장소가 남는 환경이면 표시 쿠키(사용자 번호)를 둔다. 서버 사본이 없던 사용자는 받은 뒤에 둔다", async () => {
    kvHolder.kv = { ...createMemoryKv(), persistent: true }; // 기기에 남는 저장소인 척한다(메모리 저장소의 메서드는 자기 안에 상태를 가져 복사해도 된다)
    render(<LocalAppShell userKey={USER} initialSnapshot={snapshot()} />);
    await screen.findByText("서버가 실어 보낸 글");
    expect(document.cookie).toContain(`duno-device=${USER}`);
  });
  it("기기에 이미 거울이 있으면 실려 온 사본으로 덮지 않는다(기기 것이 더 새것일 수 있다)", async () => {
    await kvHolder.kv!.set(kvKeys.base(USER), mirror({ todos: [todo(T1, "기기에 있던 글")] }));
    render(<LocalAppShell userKey={USER} initialSnapshot={snapshot()} />);
    expect(await screen.findByText("기기에 있던 글")).toBeTruthy();
    expect(screen.queryByText("서버가 실어 보낸 글")).toBeNull();
  });
});

describe("고침6 ③: 내 정보 S8-b에서 고친 목표 한 문장 = 상태보기 맨 위 목표 줄(같은 기기 설정에서 읽는다)", () => {
  it("저장하면 내 정보 카드와 상태보기 맨 위 줄이 새 값, 비우고 저장하면 둘 다 목표 없음(줄 사라짐). 기기 거울과 보낼 줄에도 같은 값", async () => {
    await kvHolder.kv!.set(kvKeys.base(USER), mirror({ settings: { goal: "토익 900점", goalReadable: true, onboardingDone: true, notify: NOTIFY, ratios: [{ categoryId: C1, percent: 100 }] } }));
    render(<LocalAppShell userKey={USER} />);
    await screen.findByText("기기에 있던 글");
    const goalLine = () => document.querySelector(".growth-goal-line");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "상태보기" })));
    await waitFor(() => expect(goalLine()?.textContent).toBe("목표, 토익 900점"));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "목표, 토익 900점, 고치기" })));
    const dlg = screen.getByRole("dialog", { name: "목표" });
    await act(async () => fireEvent.change(within(dlg).getByRole("textbox", { name: "목표" }), { target: { value: "  포트폴리오  끝내기 " } }));
    await act(async () => fireEvent.click(within(dlg).getByRole("button", { name: "저장" })));
    expect(screen.queryByRole("dialog", { name: "목표" })).toBeNull();
    expect(screen.getByRole("button", { name: "목표, 포트폴리오 끝내기, 고치기" })).toBeTruthy();
    // 같은 원천: 기기 거울의 설정 값이 바뀌었고, 상태보기는 그 값을 읽는다
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "상태보기" })));
    await waitFor(() => expect(goalLine()?.textContent).toBe("목표, 포트폴리오 끝내기"));
    await waitFor(() => expect(kvHolder.sent.some((q) => JSON.stringify(q.op).includes("포트폴리오 끝내기"))).toBe(true));

    // 비우고 저장 → 목표 없음: 카드 「목표 적기」, 상태보기 맨 위 줄 사라짐
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "목표, 포트폴리오 끝내기, 고치기" })));
    const dlg2 = screen.getByRole("dialog", { name: "목표" });
    await act(async () => fireEvent.change(within(dlg2).getByRole("textbox", { name: "목표" }), { target: { value: "" } }));
    await act(async () => fireEvent.click(within(dlg2).getByRole("button", { name: "저장" })));
    expect(screen.getByRole("button", { name: "목표, 목표 적기" })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "상태보기" })));
    await waitFor(() => expect(goalLine()).toBeNull());
    await waitFor(() => expect(kvHolder.sent.some((q) => JSON.stringify(q.op).includes('"goal":null'))).toBe(true));
  });

  it("악용: 목표에 HTML을 넣어도 상태보기 맨 위 줄·내 정보 카드에 글자 그대로, img 요소 없음", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    await kvHolder.kv!.set(kvKeys.base(USER), mirror({ settings: { goal: evil, goalReadable: true, onboardingDone: true, notify: NOTIFY, ratios: [{ categoryId: C1, percent: 100 }] } }));
    render(<LocalAppShell userKey={USER} />);
    await screen.findByText("기기에 있던 글");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "상태보기" })));
    await waitFor(() => expect(document.querySelector(".growth-goal-line")?.textContent).toBe(`목표, ${evil}`));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "내 정보" })));
    expect(document.querySelector(".me-goal-text")?.textContent).toBe(evil);
    expect(document.querySelector("img")).toBeNull();
  });
});
