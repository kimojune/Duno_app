import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 읽기 길(Route Handler, GET /todos/today — 할 일 + 분야 함께, C-D5)과 Server Action 파일의 모양 (MO-17 ①, 악용 1·10·11).
 * DAL은 가짜로 바꾼다(세션 확인은 core가 한다: todo-core·category-core 시험이 본다).
 */

const readToday = vi.fn();
const createTodayTodo = vi.fn();
const updateTodoDone = vi.fn();
const createMyCategory = vi.fn();
vi.mock("../../lib/today-dal", () => ({ readToday: (...a: unknown[]) => readToday(...a) }));
vi.mock("../../lib/todos/dal", () => ({
  createTodayTodo: (...a: unknown[]) => createTodayTodo(...a),
  updateTodoDone: (...a: unknown[]) => updateTodoDone(...a),
}));
vi.mock("../../lib/categories/dal", () => ({
  createMyCategory: (...a: unknown[]) => createMyCategory(...a),
}));

import * as actions from "../../app/todos/actions";
import { GET } from "../../app/todos/today/route";

const DAY = { date: "2026-11-05", year: 2026, month: 11, dayOfMonth: 5, weekday: 4 };
const TODOS = { ok: true, data: { day: DAY, todos: [] } };
const CATEGORIES = { ok: true, data: { categories: [] } };

beforeEach(() => {
  for (const m of [readToday, createTodayTodo, updateTodoDone, createMyCategory]) m.mockReset();
});

describe("GET /todos/today", () => {
  it("정상: 200, 몸은 { todos, categories }, Cache-Control: private, no-store (악용 10)", async () => {
    readToday.mockResolvedValue({ todos: TODOS, categories: CATEGORIES });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ todos: TODOS, categories: CATEGORIES });
    expect(readToday).toHaveBeenCalledTimes(1);
    expect(readToday.mock.calls[0]).toEqual([]); // 요청에서 아무 값도 넘기지 않는다(user_id는 세션에서만)
  });

  it("분야만 실패하면 200이고 칸이 나뉘어 실린다(C-D5)", async () => {
    readToday.mockResolvedValue({ todos: TODOS, categories: { ok: false, error: "unavailable" } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ todos: TODOS, categories: { ok: false, error: "unavailable" } });
  });

  it("악용 1: 세션 없음은 401과 짧은 코드만, 같은 캐시 헤더", async () => {
    const no = { ok: false, error: "unauthenticated" };
    readToday.mockResolvedValue({ todos: no, categories: no });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ todos: no, categories: no });
  });

  it("악용 11: DAL이 내부 오류를 던져도 503과 unavailable만, 원문 없음", async () => {
    readToday.mockRejectedValue(new Error("connection to 10.0.0.1 failed: password=hunter2"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    const un = { ok: false, error: "unavailable" };
    expect(JSON.parse(text)).toEqual({ todos: un, categories: un });
    expect(text).not.toMatch(/10\.0\.0\.1|hunter2|connection/);
  });

  it("결과 객체에 다른 값이 섞여 있어도 ok·data·error 말고는 내보내지 않는다", async () => {
    readToday.mockResolvedValue({
      todos: { ok: false, error: "config", detail: "TODO_ENCRYPTION_KEY missing" },
      categories: { ok: true, data: { categories: [] }, raw: "name_encrypted" },
      extra: "leak",
    });
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ todos: { ok: false, error: "config" }, categories: CATEGORIES });
  });
});

describe("Server Action 파일은 쓰기만 (MO-17 ①)", () => {
  it("app/todos/actions.ts가 내보내는 것은 addTodo·setTodoDone·addCategory뿐(목록 읽기 Action 없음)", () => {
    expect(Object.keys(actions).sort()).toEqual(["addCategory", "addTodo", "setTodoDone"]);
  });

  it("addTodo는 id·글·분야 번호를 그대로 DAL에 넘기고(검증은 core), 예외는 unavailable", async () => {
    const category = "33333333-3333-4333-8333-333333333333";
    createTodayTodo.mockResolvedValue({ ok: false, error: "invalid_category" });
    expect(await actions.addTodo("id", "글", category)).toEqual({ ok: false, error: "invalid_category" });
    expect(createTodayTodo.mock.calls[0]).toEqual(["id", "글", category]);
    createTodayTodo.mockRejectedValue(new Error("secret detail"));
    const res = await actions.addTodo("id", "글");
    expect(res).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  it("addCategory는 unknown 인자를 그대로 DAL에 넘기고(검증은 core), 예외는 unavailable", async () => {
    createMyCategory.mockResolvedValue({ ok: false, error: "invalid_input" });
    const weird = { name: "취업", user_id: "someone-else" };
    expect(await actions.addCategory(42, weird)).toEqual({ ok: false, error: "invalid_input" });
    expect(createMyCategory.mock.calls[0]).toEqual([42, weird]);
    createMyCategory.mockRejectedValue(new Error("db password leaked"));
    const res = await actions.addCategory("id", "이름");
    expect(res).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(res)).not.toContain("password");
  });

  it("화면 코드가 목록을 Server Action으로 부르지 않는다(todo-screen이 actions에서 가져오는 것은 쓰기뿐)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../components/todo-screen.tsx"), "utf8");
    const imported = /import\s*\{([^}]*)\}\s*from\s*"\.\.\/app\/todos\/actions"/.exec(src);
    expect(imported).not.toBeNull();
    const names = imported![1].split(",").map((s) => s.trim()).filter(Boolean).sort();
    expect(names).toEqual(["addTodo", "setTodoDone"]);
    expect(src).toContain('from "../lib/read-client"');
  });
});

describe("서비스 워커가 읽기 길을 캐시하지 않는다 (악용 10, public/sw.js 대조)", () => {
  function loadSw() {
    const handlers: Record<string, (e: unknown) => void> = {};
    const put = vi.fn(async () => {});
    const cache = { keys: async () => [], match: async () => undefined, put, delete: async () => true, addAll: async () => {} };
    const self = { location: { origin: "http://x" }, addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = h) };
    const caches = { open: async () => cache, keys: async () => [], match: async () => undefined, delete: async () => true };
    const fetchFn = async () => new Response("ok");
    const src = fs.readFileSync(path.join(__dirname, "../../public/sw.js"), "utf8");
    new Function("self", "caches", "fetch", "Response", "URL", src)(self, caches, fetchFn, Response, URL);
    return { handlers, put };
  }

  function dispatch(handlers: Record<string, (e: unknown) => void>, url: string, mode: RequestMode = "cors") {
    const respondWith = vi.fn();
    handlers.fetch({ request: { method: "GET", url, mode }, respondWith });
    return respondWith;
  }

  it("양성 대조: 정적 파일은 가로챈다(이 시험 틀이 실제로 sw.js를 돌린다)", () => {
    const { handlers } = loadSw();
    expect(dispatch(handlers, "http://x/_next/static/chunks/a.js", "no-cors")).toHaveBeenCalledTimes(1);
  });

  it("/todos/today GET은 가로채지 않아 캐시에 넣지 않는다", () => {
    const { handlers, put } = loadSw();
    for (const url of ["http://x/todos/today", "http://x/todos/today?x=1"]) {
      expect(dispatch(handlers, url)).not.toHaveBeenCalled();
      expect(dispatch(handlers, url, "same-origin")).not.toHaveBeenCalled();
    }
    expect(put).not.toHaveBeenCalled();
  });
});
