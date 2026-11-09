// @vitest-environment jsdom
import { randomBytes, randomUUID } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadButton } from "./confirm-helpers";
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

import { deriveEveningState } from "../../lib/local/derive";
import { emptyMirror } from "../../lib/local/reduce";
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
    expect(screen.getByText(/^끝냄:$/, { selector: ".sr-only" })).toBeTruthy(); // 끝냄 = 채운 원(그림) + 화면 읽기 글
    expect(screen.queryByText("보기만 할 수 있어요.")).toBeNull(); // PM d-174 ①: 설명 글을 지웠다
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /적기|자세히|빼기/ })).toBeNull();
  });
  it("「이전 날」로 하루씩 거슬러 가고, 「다음 날」은 어제까지만(오늘·앞날은 못 본다)", async () => {
    const fetchDay = vi.fn(async (date: string): Promise<TodoResult<TodayTodos>> => ({ ok: true, data: { day: dayOf(date), todos: [] } }));
    render(<PastDays api={manageApi(fetchDay)} today={TODAY.date} onClose={vi.fn()} />);
    await screen.findByText("할 일 0개");
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
  it("읽지 못하면 안내와 「다시 불러오기」, 머리 「‹」(이름 「이전」, 고침10 A)와 Esc가 닫는다", async () => {
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
    expect(screen.queryByRole("button", { name: "닫기" })).toBeNull();
    expectHeadButton(screen.getByRole("dialog"), "back");
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
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

describe("지난 날 (고침10 W2b — 148:56 · 148:95, PM d-173 · d-174 ①)", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
  const withTodos = (todos: TodoItem[]) => vi.fn(async (date: string): Promise<TodoResult<TodayTodos>> => ({ ok: true, data: { day: dayOf(date), todos } }));

  it("꼴: 머리 「‹」 → 이름표 「지난 날」(14 Medium 보조) → 날짜 24 Bold + 오른쪽 원 단추 둘(보이는 32 · 누름 48) → 할 일 카드 → 「이날 기록」 카드", async () => {
    render(<PastDays api={manageApi(withTodos([todo(A, "단어 외우기", true)]))} today={TODAY.date} onClose={vi.fn()} />);
    await screen.findByText("단어 외우기");
    const dialog = screen.getByRole("dialog", { name: "지난 날" });
    expectHeadButton(dialog, "back");
    const order = ["#past-days-title", ".past-date", ".past-nav", ".past-todos", ".past-record"].map((q) => dialog.querySelector(q)!);
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}번째`).toBeTruthy();
    expect(dialog.querySelector(".past-date")!.tagName).toBe("H3");
    const [older, newer] = [...dialog.querySelectorAll(".past-nav .step-btn")] as HTMLButtonElement[];
    expect([older.getAttribute("aria-label"), newer.getAttribute("aria-label")]).toEqual(["이전 날", "다음 날"]);
    expect([older.textContent, newer.textContent]).toEqual(["‹", "›"]);
    expect(newer.disabled).toBe(true); // 어제에서는 › 막힘
    expect(css).toMatch(/\.past-title \{[^}]*font: 500 0\.875rem\/1\.25rem[^}]*color: var\(--color-text-sub\)/);
    expect(css).toMatch(/\.past-date \{[^}]*font: var\(--font-title\)/); // 24 Bold
    expect(css).toMatch(/\.step-btn-face \{[^}]*inline-size: 32px; block-size: 32px/);
  });

  it("할 일 카드: 끝냄 = 채운 원, 안 끝냄 = 빈 원. 카드 안에 누를 수 있는 것(버튼·링크·체크 칸·입력)이 0개, 「›」도 없다", async () => {
    render(<PastDays api={manageApi(withTodos([todo(A, "끝낸 일", true), todo("b", "못 끝낸 일")]))} today={TODAY.date} onClose={vi.fn()} />);
    await screen.findByText("끝낸 일");
    const card = document.querySelector(".past-todos") as HTMLElement;
    const dots = [...card.querySelectorAll(".past-dot")];
    expect(dots.map((d) => d.classList.contains("is-done"))).toEqual([true, false]);
    expect(card.querySelectorAll("button, a, input, textarea, select, [role=button], [role=checkbox], [tabindex]")).toHaveLength(0);
    expect(card.textContent).not.toContain("›");
    expect(within(card).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["끝냄: 끝낸 일", "안 끝냄: 못 끝낸 일"]);
    // 누르거나 키보드로 눌러도 아무 일도 없다(끝냄 표시가 바뀌지 않는다)
    fireEvent.click(within(card).getByText("못 끝낸 일"));
    fireEvent.keyDown(within(card).getByText("못 끝낸 일"), { key: "Enter" });
    fireEvent.keyDown(within(card).getByText("못 끝낸 일"), { key: " " });
    expect([...card.querySelectorAll(".past-dot")].map((d) => d.classList.contains("is-done"))).toEqual([true, false]);
    expect(css).toMatch(/\.past-dot\.is-done \{[^}]*background: var\(--color-primary\)/);
  });

  it("읽을 수 없는 날(7일 넘음·읽기 실패)은 거짓 「0분」 대신 「–」(화면 읽기 「알 수 없음」), 기록 0인 날은 「0분」", async () => {
    const api = manageApi(withTodos([]));
    api.fetchDayRecord = vi.fn(async (date: string) =>
      date === "2026-11-06" ? { ok: true as const, data: { totalMinutes: 0 } } : { ok: false as const, error: "invalid_input" as const },
    );
    render(<PastDays api={api} today={TODAY.date} onClose={vi.fn()} />);
    const total = async () => (await screen.findByRole("region", { name: "이날 기록" })).querySelector(".past-record-total")!;
    expect((await total()).textContent).toBe("0분"); // 기록 0 = 0분
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "이전 날" })));
    await waitFor(() => expect(screen.getByRole("region", { name: "이날 기록" }).querySelector(".past-record-total")!.textContent).toBe("–"));
    expect(screen.getByLabelText("알 수 없음")).toBeTruthy();
    expect(screen.queryByText("0분")).toBeNull();
  });

  it("거울 읽기: 7일을 넘은 날은 범위 밖(invalid_input) — 화면이 「–」로 보인다", () => {
    const m = { ...emptyMirror(), synced: true };
    expect(deriveEveningState(m, "2026-10-20", Date.parse("2026-11-07T06:00:00.000Z"))).toEqual({ ok: false, error: "invalid_input" });
    expect(deriveEveningState(m, "2026-11-05", Date.parse("2026-11-07T06:00:00.000Z")).ok).toBe(true);
  });

  it("빈 날 = 카드 안 「할 일 0개」(14 보조색), 「이날 기록」 카드 = 그날 합계 숫자만(기록이 없으면 0분)", async () => {
    const api = manageApi(withTodos([]));
    api.fetchDayRecord = vi.fn(async (date: string) => ({ ok: true as const, data: { totalMinutes: date === "2026-11-06" ? 150 : null } }));
    render(<PastDays api={api} today={TODAY.date} onClose={vi.fn()} />);
    const empty = await screen.findByText("할 일 0개");
    expect(empty.closest(".card-box")).toBeTruthy();
    expect(empty.className).toContain("todo-sub");
    const record = await screen.findByRole("region", { name: "이날 기록" });
    expect(record.querySelector(".past-record-total")!.textContent).toBe("2시간 30분");
    expect(api.fetchDayRecord).toHaveBeenCalledWith("2026-11-06");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "이전 날" })));
    await waitFor(() => expect(screen.getByRole("region", { name: "이날 기록" }).querySelector(".past-record-total")!.textContent).toBe("0분"));
    expect(api.fetchDayRecord).toHaveBeenLastCalledWith("2026-11-05");
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
