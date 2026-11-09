import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { encryptCategoryName, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/**
 * 목표 비율이 바뀐 기록(고침 9바퀴, PM 「152 나」). 저장 길(saveRatiosForUser) 안에서 기록 한 줄을 남기는지 가짜 Supabase로 본다.
 * 처음 설정(S1-3)·내 정보(S8-a)·보낼 줄(ratios.save)이 모두 이 한 길(app/settings/actions.ts saveRatios → saveRatiosForUser)을 탄다.
 * 보낼 줄 재전송은 sendLocalOp를 실제로 거쳐 본다(세션·deps만 가짜).
 */

const getDeps = vi.fn();
vi.mock("../../lib/deps", () => ({ getDeps: (...a: unknown[]) => getDeps(...a) }));
const session: { sub: string | null } = { sub: null };
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => (session.sub ? { data: { claims: { sub: session.sub } }, error: null } : { data: null, error: new Error("no session") }),
    },
  }),
}));
// sendLocalOp가 불러오는 다른 Action은 이 시험과 상관없다(app/settings/actions는 진짜를 쓴다)
vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({ editTodo: vi.fn(), deleteTodo: vi.fn(), reorderTodos: vi.fn(), carryOverTodos: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(), dismissOffer: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/goals/actions", () => ({ saveWeeklyGoal: vi.fn(), clearWeeklyGoal: vi.fn() }));
vi.mock("../../app/views/actions", () => ({ recordView: vi.fn() }));

import { sendLocalOp } from "../../app/local/actions";
import { saveRatiosForUser } from "../../lib/settings/core";
import { ratioHistorySchema, sameRatios, toHistoryRatios } from "../../lib/settings/ratio-history";

const KEY = parseTodoKey(Buffer.alloc(32, 7).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const NOW = new Date("2026-11-09T03:00:00.000Z");
const HISTORY = "category_ratio_history";

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const id of [C1, C2]) store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName("분야", ME, KEY!), archived_at: null });
  store.seed("categories", { id: C3, user_id: OTHER, name_encrypted: "x", archived_at: null });
  return store;
}
const deps = (store: FakeStore, sub: string | null = ME) => ({ supabase: fakeTablesClient(store, { sub }), key: KEY, now: () => NOW });
const historyInserts = (store: FakeStore) => store.calls.filter((c) => c.table === HISTORY && c.op === "insert");
const historyCalls = (store: FakeStore) => store.calls.filter((c) => c.table === HISTORY);

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  session.sub = null;
  getDeps.mockReset();
});
afterEach(() => {
  warn.mockRestore();
});

describe("기록 묶음 만들기·비교(순수 함수)", () => {
  it("분야 몫은 받은 그대로(분야 번호 순), 기타는 0보다 클 때만 맨 끝", () => {
    expect(toHistoryRatios([{ categoryId: null, percent: 20 }, { categoryId: C2, percent: 30 }, { categoryId: C1, percent: 50 }])).toEqual([
      { category_id: C1, percent: 50 },
      { category_id: C2, percent: 30 },
      { category_id: null, percent: 20 },
    ]);
    expect(toHistoryRatios([{ categoryId: C1, percent: 100 }, { categoryId: null, percent: 0 }])).toEqual([{ category_id: C1, percent: 100 }]);
  });
  it("모양 검사: 합 100·0~100 정수·분야 중복 없음·uuid 또는 null·배열", () => {
    expect(ratioHistorySchema.safeParse([{ category_id: C1, percent: 60 }, { category_id: null, percent: 40 }]).success).toBe(true);
    expect(ratioHistorySchema.safeParse([{ category_id: C1, percent: 60 }, { category_id: C2, percent: 30 }]).success).toBe(false); // 합 90
    expect(ratioHistorySchema.safeParse([{ category_id: C1, percent: 50.5 }, { category_id: C2, percent: 49.5 }]).success).toBe(false);
    expect(ratioHistorySchema.safeParse([{ category_id: C1, percent: 50 }, { category_id: C1, percent: 50 }]).success).toBe(false);
    expect(ratioHistorySchema.safeParse([{ category_id: "x", percent: 100 }]).success).toBe(false);
    expect(ratioHistorySchema.safeParse({ category_id: C1, percent: 100 }).success).toBe(false);
    expect(ratioHistorySchema.safeParse([]).success).toBe(false);
  });
  it("같은 묶음은 순서와 상관없이 같고, 몫 하나라도 다르면 다르다", () => {
    const a = [{ category_id: C1, percent: 50 }, { category_id: null, percent: 50 }];
    expect(sameRatios(a, [{ category_id: null, percent: 50 }, { category_id: C1, percent: 50 }])).toBe(true);
    expect(sameRatios(a, [{ category_id: C1, percent: 55 }, { category_id: null, percent: 45 }])).toBe(false);
    expect(sameRatios(a, [{ category_id: C1, percent: 100 }])).toBe(false);
  });
});

describe("saveRatiosForUser → 바뀐 기록", () => {
  it("저장이 성공하면 기록 한 줄을 넣는다: user_id = 세션, ratios = 저장한 묶음(기타 포함), 시각은 보내지 않는다(서버 기본값)", async () => {
    const store = setup();
    const ratios = [{ categoryId: C2, percent: 30 }, { categoryId: C1, percent: 50 }, { categoryId: null, percent: 20 }];
    expect(await saveRatiosForUser(deps(store), ratios)).toEqual({ ok: true, data: { ratios } });

    const inserts = historyInserts(store);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toEqual({
      user_id: ME,
      ratios: [{ category_id: C1, percent: 50 }, { category_id: C2, percent: 30 }, { category_id: null, percent: 20 }],
    });
    expect(Object.keys(inserts[0].payload as object)).not.toContain("recorded_at");
    const rows = store.table(HISTORY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: ME });
    expect(typeof rows[0].recorded_at).toBe("string");
    // 직전 기록 읽기는 자기 행으로 거른다
    const read = historyCalls(store).find((c) => c.op === "select");
    expect(read?.filters).toContainEqual(["eq", "user_id", ME]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("같은 묶음을 다시 저장하면(순서가 달라도) 기록을 넣지 않는다", async () => {
    const store = setup();
    await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }]);
    expect(store.table(HISTORY)).toHaveLength(1);
    expect((await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }])).ok).toBe(true);
    expect((await saveRatiosForUser(deps(store), [{ categoryId: C2, percent: 40 }, { categoryId: C1, percent: 60 }])).ok).toBe(true);
    expect(historyInserts(store)).toHaveLength(1);
    expect(store.table(HISTORY)).toHaveLength(1);
  });

  it("같은 묶음 100번 저장해도 한 줄(행 폭증 막기)", async () => {
    const store = setup();
    const ratios = [{ categoryId: C1, percent: 70 }, { categoryId: null, percent: 30 }];
    for (let i = 0; i < 100; i += 1) expect((await saveRatiosForUser(deps(store), ratios)).ok).toBe(true);
    expect(store.table(HISTORY)).toHaveLength(1);
    expect(historyInserts(store)).toHaveLength(1);
  });

  it("바뀐 묶음은 새 줄로 쌓이고, 되돌아간 값(가 → 나 → 가)도 바뀐 것이라 세 줄", async () => {
    const store = setup();
    const first = [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }];
    const second = [{ categoryId: C1, percent: 50 }, { categoryId: C2, percent: 30 }, { categoryId: null, percent: 20 }];
    await saveRatiosForUser(deps(store), first);
    await saveRatiosForUser(deps(store), second);
    await saveRatiosForUser(deps(store), first);
    const rows = store.table(HISTORY);
    expect(rows.map((r) => r.ratios)).toEqual([
      [{ category_id: C1, percent: 60 }, { category_id: C2, percent: 40 }],
      [{ category_id: C1, percent: 50 }, { category_id: C2, percent: 30 }, { category_id: null, percent: 20 }],
      [{ category_id: C1, percent: 60 }, { category_id: C2, percent: 40 }],
    ]);
    expect(String(rows[0].recorded_at) < String(rows[1].recorded_at)).toBe(true);
  });

  it("기타를 0%로 빼면 기록에서도 빠진다(저장 규칙 그대로: ratio_other_percent를 비움)", async () => {
    const store = setup();
    await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 80 }, { categoryId: null, percent: 20 }]);
    await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 100 }, { categoryId: null, percent: 0 }]);
    expect(store.table(HISTORY).map((r) => r.ratios)).toEqual([
      [{ category_id: C1, percent: 80 }, { category_id: null, percent: 20 }],
      [{ category_id: C1, percent: 100 }],
    ]);
  });

  it("남의 기록은 「직전 기록」으로 읽히지 않는다(같은 묶음이 남에게 있어도 내 첫 줄은 쓴다)", async () => {
    const store = setup();
    store.seed(HISTORY, { user_id: OTHER, recorded_at: "2026-11-09T02:00:00.000Z", ratios: [{ category_id: C1, percent: 100 }] });
    await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 100 }]);
    expect(store.table(HISTORY).filter((r) => r.user_id === ME)).toHaveLength(1);
    expect(store.table(HISTORY).filter((r) => r.user_id === OTHER)).toHaveLength(1);
  });

  it("비율 저장이 실패하면 기록을 읽지도 쓰지도 않는다(남의 분야·형식 오류·로그인 없음·DB 오류)", async () => {
    const store = setup();
    expect(await saveRatiosForUser(deps(store), [{ categoryId: C3, percent: 100 }])).toEqual({ ok: false, error: "not_found" });
    expect(await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 0 }])).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveRatiosForUser(deps(store, null), [{ categoryId: C1, percent: 100 }])).toEqual({ ok: false, error: "unauthenticated" });
    // 기타 열 쓰기만 실패(분야 행은 이미 들어감): 저장 실패로 돌려주고 기록은 안 쓴다
    store.rules.user_settings.insertColumns = store.rules.user_settings.insertColumns!.filter((c) => c !== "ratio_other_percent");
    expect((await saveRatiosForUser(deps(store), [{ categoryId: C1, percent: 50 }, { categoryId: null, percent: 50 }])).ok).toBe(false);
    expect(historyCalls(store)).toEqual([]);
    expect(store.table(HISTORY)).toHaveLength(0);
  });

  it("기록 쓰기가 실패해도(권한 거절) 비율 저장은 성공으로 돌려주고, 로그에는 짧은 코드만 남긴다(값·사용자 번호 없음)", async () => {
    const store = setup();
    store.rules[HISTORY].insertColumns = []; // insert 거절(42501)
    const ratios = [{ categoryId: C1, percent: 75 }, { categoryId: null, percent: 25 }];
    expect(await saveRatiosForUser(deps(store), ratios)).toEqual({ ok: true, data: { ratios } });
    expect(store.table("category_ratios").map((r) => [r.category_id, r.percent])).toEqual([[C1, 75]]);
    expect(store.table("user_settings")[0]).toMatchObject({ ratio_other_percent: 25 });
    expect(historyInserts(store)).toHaveLength(1);
    expect(store.table(HISTORY)).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe("[ratio_history] write_failed code=42501");
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(line).not.toContain(ME);
    expect(line).not.toContain(C1);
  });

  it("표가 없는 DB(적용 전)에서도 비율 저장은 성공한다: 직전 기록 읽기가 실패하면 쓰지 않고 로그만", async () => {
    const store = setup();
    const real = fakeTablesClient(store, { sub: ME });
    const supabase = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== "from") return Reflect.get(target, prop, receiver);
        return (table: string) => {
          if (table !== HISTORY) return target.from(table);
          const missing = { data: null, error: { code: "42P01", message: 'relation "public.category_ratio_history" does not exist' } };
          const chain: Record<string, unknown> = {};
          for (const m of ["select", "eq", "order", "limit", "insert"]) chain[m] = () => chain;
          chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(missing).then(resolve);
          store.calls.push({ table, op: "select", filters: [] });
          return chain;
        };
      },
    });
    const ratios = [{ categoryId: C1, percent: 100 }];
    expect(await saveRatiosForUser({ supabase: supabase as never, key: KEY, now: () => NOW }, ratios)).toEqual({ ok: true, data: { ratios } });
    expect(store.table("category_ratios").map((r) => [r.category_id, r.percent])).toEqual([[C1, 100]]);
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["[ratio_history] read_failed code=42P01"]);
  });

  it("합이 100이 아닌 묶음(화면 밖 길)은 저장은 그대로 하고 기록만 건너뛴다", async () => {
    const store = setup();
    const ratios = [{ categoryId: C1, percent: 30 }, { categoryId: C2, percent: 10 }];
    expect(await saveRatiosForUser(deps(store), ratios)).toEqual({ ok: true, data: { ratios } });
    expect(store.table("category_ratios")).toHaveLength(2);
    expect(historyCalls(store)).toEqual([]);
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["[ratio_history] skipped_invalid"]);
  });

  it("사용자 행 수 상한(1000)에 닿으면 기록만 실패하고(로그 code=P0001) 비율 저장은 성공한다", async () => {
    const store = setup();
    for (let i = 0; i < 1000; i += 1) {
      store.seed(HISTORY, { user_id: ME, recorded_at: `2026-11-01T00:00:00.${String(i).padStart(3, "0")}Z`, ratios: [{ category_id: C1, percent: i % 2 === 0 ? 60 : 40 }, { category_id: C2, percent: i % 2 === 0 ? 40 : 60 }] });
    }
    // 남의 행은 내 상한에 세지 않는다
    store.seed(HISTORY, { user_id: OTHER, recorded_at: "2026-11-01T00:00:00.000Z", ratios: [{ category_id: null, percent: 100 }] });
    const ratios = [{ categoryId: C1, percent: 75 }, { categoryId: null, percent: 25 }];
    expect(await saveRatiosForUser(deps(store), ratios)).toEqual({ ok: true, data: { ratios } });
    expect(store.table("category_ratios").map((r) => [r.category_id, r.percent])).toEqual([[C1, 75]]);
    expect(store.table("user_settings")[0]).toMatchObject({ ratio_other_percent: 25 });
    expect(historyInserts(store)).toHaveLength(1); // 넣으려 했고
    expect(store.table(HISTORY).filter((r) => r.user_id === ME)).toHaveLength(1000); // 늘지 않았다
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["[ratio_history] write_failed code=P0001"]);
  });
});

describe("마이그레이션 SQL의 행 수 상한 트리거(정적 — 적용 뒤 행동은 tests/integration/ratio-history-rls.test.ts)", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261109150000_category_ratio_history.sql"), "utf8");
  const fn = /create function private\.category_ratio_history_enforce_limit\(\)([\s\S]*?)\r?\n\$\$;/.exec(sql)?.[1] ?? "";

  it("상한 함수가 있고, 다른 쌓기 표와 같은 꼴이다(search_path 고정·사용자별 잠금·자기 행 세기·1000·P0001·hint)", () => {
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).toContain("returns trigger");
    expect(fn).toContain("set search_path = ''");
    expect(fn).not.toMatch(/security definer/i); // evening_logs 등과 같이 부른 사람 권한(RLS 아래에서 자기 행만 센다)
    expect(fn).toMatch(/history_limit constant integer := 1000;/);
    expect(fn).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('category_ratio_history:' || new.user_id::text, 0))");
    expect(fn).toContain("from public.category_ratio_history h where h.user_id = new.user_id");
    expect(fn).toContain("if existing >= history_limit then");
    expect(fn).toContain("errcode = 'P0001', hint = 'category_ratio_history_limit'");
  });
  it("함수 실행 권한은 public·anon·authenticated에서 모두 거두고, before insert 행 트리거로 단다", () => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sql).toContain(`revoke all on function private.category_ratio_history_enforce_limit() from ${role};`);
    }
    expect(sql).toMatch(
      /create trigger category_ratio_history_enforce_limit\s+before insert on public\.category_ratio_history\s+for each row execute function private\.category_ratio_history_enforce_limit\(\);/,
    );
  });
  it("되돌림 파일은 표 다음에 상한 함수도 지운다", () => {
    const down = readFileSync(path.resolve(__dirname, "../../supabase/rollback/20261109150000_category_ratio_history.down.sql"), "utf8");
    const table = down.indexOf("drop table if exists public.category_ratio_history;");
    const func = down.indexOf("drop function if exists private.category_ratio_history_enforce_limit();");
    expect(table).toBeGreaterThan(-1);
    expect(func).toBeGreaterThan(table);
  });
});

describe("기기 먼저 저장(보낼 줄) → 같은 서버 저장 길", () => {
  it("ratios.save를 보내면 기록이 남고, 답을 못 받아 같은 쓰기를 다시 보내도 기록은 한 줄", async () => {
    const store = setup();
    session.sub = ME;
    getDeps.mockImplementation(async () => deps(store));
    const op = { kind: "ratios.save", ratios: [{ categoryId: C1, percent: 40 }, { categoryId: C2, percent: 40 }, { categoryId: null, percent: 20 }] };
    expect(await sendLocalOp(ME, op, "2026-11-09T02:59:00.000Z")).toEqual({ ok: true });
    expect(await sendLocalOp(ME, op, "2026-11-09T02:59:00.000Z")).toEqual({ ok: true }); // 재전송(같은 줄)
    expect(store.table(HISTORY)).toHaveLength(1);
    expect(store.table(HISTORY)[0]).toMatchObject({
      user_id: ME,
      ratios: [{ category_id: C1, percent: 40 }, { category_id: C2, percent: 40 }, { category_id: null, percent: 20 }],
    });
    expect(historyInserts(store)).toHaveLength(1);
  });
  it("다른 사용자 세션으로 온 줄은 계정 확인에서 거절되어 기록이 생기지 않는다", async () => {
    const store = setup();
    session.sub = OTHER;
    getDeps.mockImplementation(async () => deps(store, OTHER));
    const op = { kind: "ratios.save", ratios: [{ categoryId: C1, percent: 100 }] };
    expect(await sendLocalOp(ME, op, "2026-11-09T02:59:00.000Z")).toEqual({ ok: false, error: "account_mismatch" });
    expect(store.table(HISTORY)).toHaveLength(0);
  });
});
