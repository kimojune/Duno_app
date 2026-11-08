import { beforeEach, describe, expect, it, vi } from "vitest";
import { readMirrorForUser } from "../../lib/mirror/core";
import { encryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/**
 * 기기 먼저 저장의 서버 입구 계정 확인(고침 4바퀴, S1). 보낼 줄의 쓰기(sendLocalOp)와 서버 사본 받기(/mirror)는 「이 줄의 주인」(기대 사용자 번호)을 싣고,
 * 서버는 세션 사용자와 다르면 account_mismatch로 거절한다. 기대 번호는 거절에만 쓰고 권한을 넓히지 않는다(쓰기는 세션 사용자로만).
 */

const getDeps = vi.fn();
vi.mock("../../lib/deps", () => ({ getDeps: (...a: unknown[]) => getDeps(...a) }));

// sendLocalOp가 쓰는 세션: 시험마다 세션 사용자를 바꾼다
const session: { sub: string | null } = { sub: null };
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => (session.sub ? { data: { claims: { sub: session.sub } }, error: null } : { data: null, error: new Error("no session") }),
    },
  }),
}));
const addTodo = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true }));
const addCategory = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true }));
vi.mock("../../app/todos/actions", () => ({ addTodo: (...a: unknown[]) => addTodo(...a), setTodoDone: vi.fn(), addCategory: (...a: unknown[]) => addCategory(...a) }));
vi.mock("../../app/todos/manage-actions", () => ({ editTodo: vi.fn(), deleteTodo: vi.fn(), reorderTodos: vi.fn(), carryOverTodos: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
vi.mock("../../app/settings/actions", () => ({ saveRatios: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(), dismissOffer: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/goals/actions", () => ({ saveWeeklyGoal: vi.fn(), clearWeeklyGoal: vi.fn() }));
vi.mock("../../app/views/actions", () => ({ recordView: vi.fn() }));

import { sendLocalOp } from "../../app/local/actions";
import { GET } from "../../app/mirror/route";

const KEY = parseTodoKey(Buffer.alloc(32, 3).toString("base64"));
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "11111111-1111-4111-8111-111111111111";
const C_NEW = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C_OLD = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const NOW = new Date("2026-11-07T06:00:00.000Z");
const AT = "2026-11-07T05:59:00.000Z";

function store() {
  const s = new FakeStore();
  s.rules = v2Rules();
  s.fixedNow = NOW;
  s.seed("todos", { id: T1, user_id: B, day: "2026-11-07", text_encrypted: encryptTodoText("B의 글", B, KEY!), done: false, category_id: null, position: null });
  return s;
}
const deps = (s: FakeStore, sub: string | null) => ({ supabase: fakeTablesClient(s, { sub }), key: KEY, now: () => NOW });

beforeEach(() => {
  session.sub = null;
  addTodo.mockClear();
  addCategory.mockClear();
  getDeps.mockReset();
});

describe("sendLocalOp: 보낼 줄의 쓰기 하나(계정 확인 + 기존 Server Action)", () => {
  it("세션 사용자 ≠ 기대 사용자(A가 쌓은 줄을 B 세션으로)면 account_mismatch로 거절하고 쓰지 않는다", async () => {
    session.sub = B;
    const res = await sendLocalOp(A, { kind: "todo.add", id: T1, text: "A의 글" }, AT);
    expect(res).toEqual({ ok: false, error: "account_mismatch" });
    expect(addTodo).not.toHaveBeenCalled();
  });
  it("기대 번호가 없거나 모양이 틀려도 거절한다(누구의 줄인지 모르면 보내지 않는다)", async () => {
    session.sub = A;
    for (const expected of [undefined, null, "", "not-a-uuid", 42, { id: A }]) {
      expect(await sendLocalOp(expected, { kind: "todo.add", id: T1, text: "x" }, AT)).toEqual({ ok: false, error: "account_mismatch" });
    }
    expect(addTodo).not.toHaveBeenCalled();
  });
  it("세션이 없으면 unauthenticated(줄은 기기에 그대로 둔다)", async () => {
    expect(await sendLocalOp(A, { kind: "todo.add", id: T1, text: "x" }, AT)).toEqual({ ok: false, error: "unauthenticated" });
    expect(addTodo).not.toHaveBeenCalled();
  });
  it("같으면 기존 Server Action을 부른다. 기대 번호는 그 Action에 넘기지 않는다(쓰기는 그 Action이 세션 사용자로 한다: 권한을 넓히지 않음)", async () => {
    session.sub = A;
    expect(await sendLocalOp(A, { kind: "todo.add", id: T1, text: "글", categoryId: null }, AT)).toEqual({ ok: true });
    expect(addTodo).toHaveBeenCalledTimes(1);
    expect(addTodo.mock.calls[0]).toEqual([T1, "글", null, AT]);
    expect(JSON.stringify(addTodo.mock.calls[0])).not.toContain(A);
  });
  it("자기 계정 남용: 요청의 기대 번호를 남의 번호로 바꾸면 거절될 뿐 남의 계정에 쓰지 않는다", async () => {
    session.sub = A;
    expect(await sendLocalOp(B, { kind: "todo.add", id: T1, text: "남의 계정에" }, AT)).toEqual({ ok: false, error: "account_mismatch" });
    expect(addTodo).not.toHaveBeenCalled();
  });
  it("모르는 쓰기 종류·이상한 모양은 invalid_input", async () => {
    session.sub = A;
    expect(await sendLocalOp(A, { kind: "drop.table" }, AT)).toEqual({ ok: false, error: "invalid_input" });
    expect(await sendLocalOp(A, "todo.add", AT)).toEqual({ ok: false, error: "invalid_input" });
  });
  it("분야 만들기가 duplicate면 이미 있는 그 분야(번호·이름)를 함께 돌려준다(기기가 뒤의 쓰기의 분야 번호를 바꾼다)", async () => {
    session.sub = A;
    addCategory.mockResolvedValueOnce({ ok: false, error: "duplicate", existing: { id: C_OLD, name: "운동" } });
    expect(await sendLocalOp(A, { kind: "category.add", id: C_NEW, name: "운동" }, AT)).toEqual({ ok: false, error: "duplicate", existing: { id: C_OLD, name: "운동" } });
  });
  it("Action이 던지면 unavailable(원문 없음)", async () => {
    session.sub = A;
    addTodo.mockRejectedValueOnce(new Error("boom secret"));
    const res = await sendLocalOp(A, { kind: "todo.add", id: T1, text: "x" }, AT);
    expect(res).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("/mirror: 서버 사본 받기의 계정 확인", () => {
  it("readMirrorForUser: 기대 사용자가 세션 사용자와 다르면 account_mismatch(B의 글을 A 기기 장치에 주지 않는다)", async () => {
    const s = store();
    const res = await readMirrorForUser(deps(s, B), A);
    expect(res).toEqual({ ok: false, error: "account_mismatch" });
    expect(JSON.stringify(res)).not.toContain("B의 글");
  });
  it("같으면 사본에 주인(userId = 세션 사용자)을 싣는다", async () => {
    const s = store();
    const res = await readMirrorForUser(deps(s, B), B);
    expect(res.ok && res.data.userId).toBe(B);
    expect(res.ok && res.data.todos?.map((t) => t.text)).toEqual(["B의 글"]);
  });
  it("GET: x-duno-expected-user 머리글이 세션 사용자와 다르면 400 account_mismatch, 몸에 데이터 없음", async () => {
    const s = store();
    getDeps.mockResolvedValue(deps(s, B));
    const res = await GET(new Request("http://localhost/mirror", { headers: { "x-duno-expected-user": A } }));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "account_mismatch" });
    const ok = await GET(new Request("http://localhost/mirror", { headers: { "x-duno-expected-user": B } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.userId).toBe(B);
  });
});
