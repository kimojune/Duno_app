import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptCategoryName, decryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/**
 * MO-46 2단계: 서버 행동(bundle.apply·bundle.restart·옛 op)·거울 반영(reduce)·거절 길·색 함수.
 * DB 함수는 tests/unit/fake-bundle-rpc.ts가 흉내 낸다(진짜 SQL이 아니다: SQL은 supabase/tests/goal_bundles.test.sql, 미실행).
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
vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/todos/manage-actions", () => ({ editTodo: vi.fn(), deleteTodo: vi.fn(), reorderTodos: vi.fn(), carryOverTodos: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(), dismissOffer: vi.fn(), addOfferTodo: vi.fn() }));
vi.mock("../../app/focus/actions", () => ({ startFocus: vi.fn(), endFocus: vi.fn() }));
vi.mock("../../app/evening/actions", () => ({ saveEveningLog: vi.fn() }));
vi.mock("../../app/goals/actions", () => ({ saveWeeklyGoal: vi.fn(), clearWeeklyGoal: vi.fn() }));
vi.mock("../../app/views/actions", () => ({ recordView: vi.fn() }));
vi.mock("../../app/local/actions", async (orig) => orig());

import { sendLocalOp } from "../../app/local/actions";
import { applyBundleForUser, saveLegacyBundleForUser, setRestartRequestedForUser } from "../../lib/bundles/core";
import { checkBundleApply } from "../../lib/bundles/validation";
import { categoryColorNumber, colorNumbersIn, resolveColorOrder } from "../../lib/category-color";
import { readableCategories } from "../../lib/local/derive";
import { readSettingsForUser, saveRatiosForUser, saveSettingsForUser } from "../../lib/settings/core";
import { createCategoryForUser } from "../../lib/categories/core";
import { createMemoryKv } from "../../lib/local/kv";
import { applyOp, emptyMirror, replay } from "../../lib/local/reduce";
import { createRuntime } from "../../lib/local/runtime";
import type { Mirror, MirrorSnapshot, Op, SendResult } from "../../lib/local/types";
import { readMirrorForUser } from "../../lib/mirror/core";

const KEY = parseTodoKey(Buffer.alloc(32, 9).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const C_OTHER = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const OP1 = "11111111-1111-4111-8111-111111111111";
const OP2 = "22222222-2222-4222-8222-222222222222";
const OP3 = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-17T03:00:00.000Z"); // 서울 12:00, 두노 하루 11-17

function setup(opts: { startedDaysAgo?: number } = {}) {
  const store = new FakeStore();
  store.rules = v2Rules();
  store.fixedNow = NOW;
  const enc = (n: string, u = ME) => encryptCategoryName(n, u, KEY!);
  store.seed("categories", { id: C1, user_id: ME, name_encrypted: enc("어학"), archived_at: null, color_order: 0 });
  store.seed("categories", { id: C2, user_id: ME, name_encrypted: enc("운동"), archived_at: null, color_order: 1 });
  store.seed("categories", { id: C_OTHER, user_id: OTHER, name_encrypted: enc("남의", OTHER), archived_at: null, color_order: 0 });
  store.seed("category_ratios", { user_id: ME, category_id: C1, percent: 60 });
  store.seed("category_ratios", { user_id: ME, category_id: C2, percent: 40 });
  const started = new Date(NOW.getTime() - (opts.startedDaysAgo ?? 3) * 86_400_000).toISOString();
  store.seed("user_settings", { user_id: ME, onboarding_done_at: started, goal_encrypted: null, bundle_revision: 0, bundle_op_ids: [], bundle_started_at: null, restart_requested_at: null });
  return store;
}
const deps = (store: FakeStore, sub: string | null = ME) => ({ supabase: fakeTablesClient(store, { sub }), key: KEY });
const rpcs = (store: FakeStore, name = "save_goal_bundle") => store.rpcCalls.filter((c) => c.name === name);
const base = (over: Record<string, unknown> = {}) => ({
  id: OP1,
  expectedRevision: 0,
  reason: "edit",
  goal: "영어 말하기",
  other: 0,
  items: [{ id: C1, percent: 60 }, { id: C2, percent: 40 }],
  ...over,
});

beforeEach(() => {
  session.sub = null;
  getDeps.mockReset();
});

describe("bundle.apply 서버 행동: 함수를 한 번만 부른다", () => {
  it("저장하면 save_goal_bundle을 정확히 한 번 부르고, 사용자 id·평문은 보내지 않는다(이름·목표 글은 암호문)", async () => {
    const store = setup();
    const res = await applyBundleForUser(
      deps(store),
      base({ items: [{ id: C1, percent: 50 }, { id: C2, percent: 30 }, { id: C3, isNew: true, name: "독서", percent: 20 }] }),
    );
    expect(res).toEqual({ ok: true, data: { revision: 1, pastSkipped: null } });
    expect(rpcs(store)).toHaveLength(1);
    expect(store.rpcCalls).toHaveLength(1); // 다른 함수 호출 없음
    const args = rpcs(store)[0].args;
    expect(Object.keys(args).sort()).toEqual(
      ["p_complete_onboarding", "p_expected_revision", "p_goal_encrypted", "p_items", "p_legacy", "p_op_id", "p_other", "p_reason", "p_set_goal"].sort(),
    ); // p_user_id 같은 사용자 인자가 없다
    expect(args).toMatchObject({ p_op_id: OP1, p_expected_revision: 0, p_reason: "edit", p_legacy: false, p_other: 0 });
    const text = JSON.stringify(args);
    expect(text).not.toContain("영어 말하기");
    expect(text).not.toContain("독서");
    expect(decryptTodoText(args.p_goal_encrypted, ME, KEY!, "goal_text")).toEqual({ ok: true, text: "영어 말하기" });
    // 이름을 바꾸지 않은 기존 분야 칸에는 이름 암호문을 싣지 않는다
    expect((args.p_items as Record<string, unknown>[])[0]).toEqual({ id: C1, percent: 50 });
    expect((args.p_items as Record<string, unknown>[])[2]).toMatchObject({ id: C3, new: true, percent: 20 });
  });

  it("같은 op id를 다시 보내면 판·기록이 늘지 않는다(멱등)", async () => {
    const store = setup();
    const input = base();
    expect((await applyBundleForUser(deps(store), input)).ok).toBe(true);
    const again = await applyBundleForUser(deps(store), input);
    expect(again).toEqual({ ok: true, data: { revision: 1, pastSkipped: null } });
    expect(store.table("goal_bundles")).toHaveLength(1); // 사흘 전 묶음 한 줄뿐
    expect(store.table("user_settings")[0].bundle_revision).toBe(1);
  });

  it("옛 고침 번호는 bundle_conflict로 거절되고 아무것도 안 바뀐다", async () => {
    const store = setup();
    const before = structuredClone(store.tables);
    const res = await applyBundleForUser(deps(store), base({ expectedRevision: 7, goal: "새 글" }));
    expect(res).toEqual({ ok: false, error: "bundle_conflict" });
    expect(store.tables).toEqual(before);
  });

  it("같은 날 두 번 저장하면 지난 묶음은 하나, 다른 날이면 새 줄", async () => {
    const store = setup({ startedDaysAgo: 3 });
    await applyBundleForUser(deps(store), base());
    expect(store.table("goal_bundles")).toHaveLength(1);
    await applyBundleForUser(deps(store), base({ id: OP2, expectedRevision: 1, items: [{ id: C1, percent: 50 }, { id: C2, percent: 50 }] }));
    expect(store.table("goal_bundles")).toHaveLength(1); // 같은 날
    // 시작이 어제로 돌아간 것으로 두고 다시 저장하면 한 줄 늘어난다
    store.table("user_settings")[0].bundle_started_at = new Date(NOW.getTime() - 86_400_000).toISOString();
    await applyBundleForUser(deps(store), base({ id: OP3, expectedRevision: 2, items: [{ id: C1, percent: 40 }, { id: C2, percent: 60 }] }));
    expect(store.table("goal_bundles")).toHaveLength(2);
  });

  it("지난 묶음 상한에서 저장은 되고 「남기지 못함」 표시(pastSkipped)가 결과에 실린다", async () => {
    const store = setup();
    for (let i = 0; i < 1000; i += 1) store.seed("goal_bundles", { user_id: ME, started_at: "2026-01-01T00:00:00.000Z", ended_at: "2026-01-02T00:00:00.000Z", ratios: [{ category_id: null, percent: 100 }], categories: [] });
    const res = await applyBundleForUser(deps(store), base());
    expect(res).toEqual({ ok: true, data: { revision: 1, pastSkipped: "limit" } });
    expect(store.table("goal_bundles")).toHaveLength(1000);
    expect(store.table("user_settings")[0]).toMatchObject({ bundle_revision: 1 });
  });
});

describe("분야 이름·보관·되살리기 · 같은 이름", () => {
  it("보관한 분야의 비율 몫은 기타로 가고, 남은 분야 비율은 그대로다", async () => {
    const store = setup();
    const res = await applyBundleForUser(deps(store), base({ items: [{ id: C1, percent: 60 }, { id: C2, percent: 40, archived: true }] }));
    expect(res.ok).toBe(true);
    expect(store.table("user_settings")[0].ratio_other_percent).toBe(40);
    expect(store.table("category_ratios").map((r) => [r.category_id, r.percent])).toEqual([[C1, 60]]);
    expect(store.table("categories").find((c) => c.id === C2)?.archived_at).not.toBeNull();
    expect(store.table("categories").find((c) => c.id === C2)?.color_order).toBe(1); // 색 순서는 그대로
  });

  it("이름 바꾸기는 새 암호문으로 간다(바꾸지 않은 칸은 안 보냄). 판 행에는 그때 이름 암호문이 남는다", async () => {
    const store = setup();
    const oldName = store.table("categories").find((c) => c.id === C1)!.name_encrypted;
    await applyBundleForUser(deps(store), base({ items: [{ id: C1, name: "영어", percent: 60 }, { id: C2, name: "운동", percent: 40 }] }));
    const args = rpcs(store)[0].args.p_items as Record<string, unknown>[];
    expect(args[0].name_encrypted).toEqual(expect.any(String));
    expect(args[1]).toEqual({ id: C2, percent: 40 }); // 같은 이름이라 안 보냄
    expect(store.table("categories").find((c) => c.id === C1)!.name_encrypted).not.toBe(oldName);
    expect((store.table("goal_bundles")[0].categories as { category_id: string; name_encrypted: string }[]).find((c) => c.category_id === C1)?.name_encrypted).toBe(oldName);
  });

  it("쓰는 분야와 이름이 겹치면 duplicate, 보관한 같은 이름이 있으면 그 id와 함께 archived_exists, 되살리는 칸이면 통과", async () => {
    const store = setup();
    store.seed("categories", { id: C3, user_id: ME, name_encrypted: encryptCategoryName("독서", ME, KEY!), archived_at: "2026-11-01T00:00:00.000Z", color_order: 2 });
    const clash = await applyBundleForUser(deps(store), base({ items: [{ id: C1, name: "운동", percent: 60 }, { id: C2, percent: 40 }] }));
    expect(clash).toEqual({ ok: false, error: "duplicate", existing: { id: C2, name: "운동" } });
    const NEW = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
    const archivedClash = await applyBundleForUser(deps(store), base({ items: [{ id: C1, percent: 60 }, { id: C2, percent: 20 }, { id: NEW, isNew: true, name: "독서", percent: 20 }] }));
    expect(archivedClash).toEqual({ ok: false, error: "archived_exists", existing: { id: C3, name: "독서" } });
    expect(store.rpcCalls).toHaveLength(0); // 거절은 함수를 부르기 전에
    const revive = await applyBundleForUser(deps(store), base({ items: [{ id: C1, percent: 60 }, { id: C2, percent: 20 }, { id: C3, percent: 20, archived: false }] }));
    expect(revive.ok).toBe(true);
    expect(store.table("categories").find((c) => c.id === C3)?.archived_at).toBeNull();
  });

  it("다시 시작: 넘긴 묶음에 없는 옛 분야는 보관되고 고른 분야는 같은 id로 이어진다. 이번 주 목표·할 일·저녁 기록 행은 건드리지 않는다", async () => {
    const store = setup();
    store.seed("weekly_goals", { user_id: ME, week_start: "2026-11-16", items: [{ categoryId: C1, minutes: 60 }] });
    store.seed("todos", { id: "t1", user_id: ME, day: "2026-11-16", text_encrypted: "x", done: false, category_id: null });
    const res = await applyBundleForUser(deps(store), base({ reason: "restart", items: [{ id: C1, percent: 100 }] }));
    expect(res.ok).toBe(true);
    expect(store.table("categories").find((c) => c.id === C1)?.archived_at).toBeNull();
    expect(store.table("categories").find((c) => c.id === C2)?.archived_at).not.toBeNull();
    expect(store.table("weekly_goals")).toHaveLength(1);
    expect(store.table("todos")).toHaveLength(1);
    expect(store.rpcCalls.filter((c) => c.name !== "save_goal_bundle")).toHaveLength(0); // 서버는 weekly_goals를 건드리지 않는다
  });

  it("다시 시작 표시·취소는 지금 표를 바꾸지 않는다", async () => {
    const store = setup();
    expect(await setRestartRequestedForUser(deps(store), true)).toEqual({ ok: true });
    expect(store.table("user_settings")[0].restart_requested_at).not.toBeNull();
    expect(store.table("category_ratios")).toHaveLength(2);
    expect(rpcs(store, "set_restart_requested")).toHaveLength(1);
    expect(await setRestartRequestedForUser(deps(store), false)).toEqual({ ok: true });
    expect(store.table("user_settings")[0].restart_requested_at).toBeNull();
    expect(await setRestartRequestedForUser(deps(store), "yes")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("같은 이름의 새 분야 더하기(category.add 길)도 보관한 같은 이름을 id와 함께 알린다", async () => {
    const store = setup();
    store.seed("categories", { id: C3, user_id: ME, name_encrypted: encryptCategoryName("독서", ME, KEY!), archived_at: "2026-11-01T00:00:00.000Z", color_order: 2 });
    const res = await createCategoryForUser({ supabase: fakeClientFor(store), key: KEY }, "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1", "독서");
    expect(res).toEqual({ ok: false, error: "archived_exists", existing: { id: C3, name: "독서" } });
  });
});

function fakeClientFor(store: FakeStore) {
  return fakeTablesClient(store, { sub: ME });
}

describe("악용 시나리오: 서버 행동의 입력 거절과 정상 통과", () => {
  it("비로그인은 함수를 부르지 않고 unauthenticated", async () => {
    const store = setup();
    expect(await applyBundleForUser(deps(store, null), base())).toEqual({ ok: false, error: "unauthenticated" });
    expect(store.rpcCalls).toHaveLength(0);
  });
  it("남의 분야 id는 not_found(함수를 부르기 전에 거절, 남의 행은 안 바뀐다)", async () => {
    const store = setup();
    const before = structuredClone(store.table("categories").find((c) => c.id === C_OTHER));
    const res = await applyBundleForUser(deps(store), base({ items: [{ id: C_OTHER, percent: 100, archived: true }] }));
    expect(res).toEqual({ ok: false, error: "not_found" });
    expect(store.rpcCalls).toHaveLength(0);
    expect(store.table("categories").find((c) => c.id === C_OTHER)).toEqual(before);
  });
  it("사용자 id를 끼워 넣거나 모르는 키를 보내면 거절", async () => {
    const store = setup();
    expect(await applyBundleForUser(deps(store), { ...base(), userId: OTHER })).toEqual({ ok: false, error: "invalid_input" });
    expect(await applyBundleForUser(deps(store), base({ items: [{ id: C1, percent: 100, user_id: OTHER }] }))).toEqual({ ok: false, error: "invalid_input" });
    expect(store.rpcCalls).toHaveLength(0);
  });
  it("50칸 넘는 목록·합이 100이 아님·5 단위가 아님·긴 이름·긴 목표 글은 거절", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, isNew: true, name: `분야${i}`, percent: 0 }));
    expect(checkBundleApply(base({ items: many, other: 100 })).ok).toBe(false);
    expect(checkBundleApply(base({ items: [{ id: C1, percent: 60 }, { id: C2, percent: 30 }] })).ok).toBe(false); // 합 90
    expect(checkBundleApply(base({ items: [{ id: C1, percent: 62 }, { id: C2, percent: 38 }] })).ok).toBe(false); // 5 단위 아님
    expect(checkBundleApply(base({ items: [{ id: C1, percent: 60 }, { id: C1, percent: 40 }] })).ok).toBe(false); // id 중복
    expect(checkBundleApply(base({ goal: "가".repeat(101) }))).toEqual({ ok: false, error: "too_long" });
    expect(checkBundleApply(base({ expectedRevision: -1 })).ok).toBe(false);
    expect(checkBundleApply(base({ reason: "initial" })).ok).toBe(false);
    expect(checkBundleApply(base()).ok).toBe(true); // 정상 입력은 통과
  });
  it("긴 분야 이름은 too_long, 「기타」는 reserved, 빈 이름은 empty로 함수 호출 전에 거절", async () => {
    const store = setup();
    const NEW = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
    const item = (name: string) => base({ items: [{ id: C1, percent: 60 }, { id: C2, percent: 20 }, { id: NEW, isNew: true, name, percent: 20 }] });
    expect(await applyBundleForUser(deps(store), item("가".repeat(21)))).toEqual({ ok: false, error: "too_long" });
    expect(await applyBundleForUser(deps(store), item("기타"))).toEqual({ ok: false, error: "reserved" });
    expect(await applyBundleForUser(deps(store), item("   "))).toEqual({ ok: false, error: "empty" });
    expect(store.rpcCalls).toHaveLength(0);
  });
});

describe("옛 op(ratios.save·settings.save의 goal)는 거절하지 않고 함수로 간다", () => {
  it("ratios.save: 충돌 검사를 건너뛰는 함수 호출 한 번으로 저장된다", async () => {
    const store = setup();
    session.sub = ME;
    getDeps.mockImplementation(async () => ({ ...deps(store), now: () => NOW }));
    store.table("user_settings")[0].bundle_revision = 9; // 기기는 옛 번호를 모른다
    const op = { kind: "ratios.save", ratios: [{ categoryId: C1, percent: 70 }, { categoryId: C2, percent: 30 }] };
    expect(await sendLocalOp(ME, op, NOW.toISOString())).toEqual({ ok: true });
    expect(rpcs(store)).toHaveLength(1);
    expect(rpcs(store)[0].args).toMatchObject({ p_legacy: true, p_op_id: null });
    expect(store.table("category_ratios").find((r) => r.category_id === C1)?.percent).toBe(70);
    expect(store.table("goal_bundles")).toHaveLength(1); // 판이 남는다
  });
  it("settings.save의 goal: 목표 글이 함수로 저장되고 판이 남는다. 알림만 바꾸면 함수를 부르지 않는다", async () => {
    const store = setup();
    session.sub = ME;
    getDeps.mockImplementation(async () => ({ ...deps(store), now: () => NOW }));
    expect(await sendLocalOp(ME, { kind: "settings.save", patch: { goal: "새 목표" } }, NOW.toISOString())).toEqual({ ok: true });
    expect(rpcs(store)).toHaveLength(1);
    expect(decryptTodoText(store.table("user_settings")[0].goal_encrypted, ME, KEY!, "goal_text")).toEqual({ ok: true, text: "새 목표" });
    expect(await sendLocalOp(ME, { kind: "settings.save", patch: { notify: { eveningEnabled: true } } }, NOW.toISOString())).toEqual({ ok: true });
    expect(rpcs(store)).toHaveLength(1);
  });
  it("saveLegacyBundleForUser는 기타 몫만 따로 보낼 수 있다", async () => {
    const store = setup();
    const res = await saveLegacyBundleForUser(deps(store), { ratios: [{ categoryId: C1, percent: 50 }, { categoryId: C2, percent: 30 }, { categoryId: null, percent: 20 }] });
    expect(res.ok).toBe(true);
    expect(store.table("user_settings")[0].ratio_other_percent).toBe(20);
  });
});

describe("보낼 줄 입구(sendLocalOp)", () => {
  it("bundle.apply: 충돌은 bundle_conflict로, 상한 표시는 pastSkipped로 돌려준다", async () => {
    const store = setup();
    session.sub = ME;
    getDeps.mockImplementation(async () => deps(store));
    const { kind: _k, ...input } = { kind: "bundle.apply", ...base() };
    void _k;
    const op = { kind: "bundle.apply", ...input };
    expect(await sendLocalOp(ME, { ...op, expectedRevision: 5 }, NOW.toISOString())).toEqual({ ok: false, error: "bundle_conflict" });
    for (let i = 0; i < 1000; i += 1) store.seed("goal_bundles", { user_id: ME, started_at: "2026-01-01T00:00:00.000Z", ended_at: "2026-01-02T00:00:00.000Z", ratios: [{ category_id: null, percent: 100 }], categories: [] });
    expect(await sendLocalOp(ME, op, NOW.toISOString())).toEqual({ ok: true, pastSkipped: "limit" });
  });
  it("bundle.apply의 archived_exists는 그 분야(existing)와 함께 돌아온다", async () => {
    const store = setup();
    store.seed("categories", { id: C3, user_id: ME, name_encrypted: encryptCategoryName("독서", ME, KEY!), archived_at: "2026-11-01T00:00:00.000Z", color_order: 2 });
    session.sub = ME;
    getDeps.mockImplementation(async () => deps(store));
    const NEW = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
    const op = { kind: "bundle.apply", ...base({ items: [{ id: C1, percent: 60 }, { id: C2, percent: 20 }, { id: NEW, isNew: true, name: "독서", percent: 20 }] }) };
    expect(await sendLocalOp(ME, op, NOW.toISOString())).toEqual({ ok: false, error: "archived_exists", existing: { id: C3, name: "독서" } });
  });
  it("bundle.restart·bundle.restartCancel은 표시 함수 한 번씩", async () => {
    const store = setup();
    session.sub = ME;
    getDeps.mockImplementation(async () => deps(store));
    expect(await sendLocalOp(ME, { kind: "bundle.restart" }, NOW.toISOString())).toEqual({ ok: true });
    expect(store.table("user_settings")[0].restart_requested_at).not.toBeNull();
    expect(await sendLocalOp(ME, { kind: "bundle.restartCancel" }, NOW.toISOString())).toEqual({ ok: true });
    expect(store.table("user_settings")[0].restart_requested_at).toBeNull();
    expect(rpcs(store, "set_restart_requested")).toHaveLength(2);
  });
});

describe("거울(reduce): bundle.apply를 입힌다", () => {
  const cat = (id: string, name: string, colorOrder: number) => ({ id, readable: true as const, name, createdAt: "2026-11-01T00:00:00.000Z", colorOrder });
  function mirror(over: Partial<Mirror> = {}): Mirror {
    return {
      ...emptyMirror(),
      synced: true,
      categories: [cat(C1, "어학", 0), cat(C2, "운동", 1)],
      settings: { goal: "옛 목표", goalReadable: true, onboardingDone: true, notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 }, ratios: [{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }] },
      bundle: { revision: 3, startedAt: "2026-11-10T03:00:00.000Z", restartRequestedAt: "2026-11-16T03:00:00.000Z" },
      ...over,
    };
  }
  const apply = (m: Mirror, op: Record<string, unknown>) => applyOp(m, { op: { kind: "bundle.apply", ...base(), ...op } as Op, clientAt: NOW.toISOString() });

  it("목표 글·비율·고침 번호를 바꾸고, 다른 날이면 시작 시각을 오늘로 옮긴다", () => {
    const next = apply(mirror(), { goal: "새 목표", items: [{ id: C1, percent: 50 }, { id: C2, percent: 50 }] });
    expect(next.settings?.goal).toBe("새 목표");
    expect(next.settings?.ratios).toEqual([{ categoryId: C1, percent: 50 }, { categoryId: C2, percent: 50 }]);
    expect(next.bundle).toEqual({ revision: 4, startedAt: NOW.toISOString(), restartRequestedAt: "2026-11-16T03:00:00.000Z" });
    // 같은 날이면 시작 시각은 그대로
    const sameDay = apply(mirror({ bundle: { revision: 3, startedAt: "2026-11-17T01:00:00.000Z", restartRequestedAt: null } }), {});
    expect(sameDay.bundle?.startedAt).toBe("2026-11-17T01:00:00.000Z");
  });
  it("보관한 분야의 몫은 기타로 가고 분야는 보관 목록으로 옮겨진다(다른 분야의 색 순서는 그대로)", () => {
    const next = apply(mirror(), { items: [{ id: C1, percent: 60 }, { id: C2, percent: 40, archived: true }] });
    expect(next.settings?.ratios).toEqual([{ categoryId: C1, percent: 60 }, { categoryId: null, percent: 40 }]);
    expect(next.categories.map((c) => c.id)).toEqual([C1]);
    expect(next.archivedCategories?.map((c) => c.id)).toEqual([C2]);
    expect(next.categories[0].colorOrder).toBe(0);
    // 되살리기: 같은 id가 쓰는 목록으로 돌아온다
    const back = apply(next, { expectedRevision: 4, items: [{ id: C1, percent: 60 }, { id: C2, percent: 40, archived: false }] });
    expect(back.categories.map((c) => c.id).sort()).toEqual([C1, C2]);
    expect(back.settings?.ratios).toEqual([{ categoryId: C1, percent: 60 }, { categoryId: C2, percent: 40 }]);
  });
  it("새 분야·이름 바꾸기가 반영되고, 새 분야의 색 순서는 분야 수(보관 포함)다", () => {
    const next = apply(mirror(), { items: [{ id: C1, name: "영어", percent: 40 }, { id: C2, percent: 40 }, { id: C3, isNew: true, name: "독서", percent: 20 }] });
    expect(next.categories.map((c) => [c.id, c.name])).toEqual([[C1, "영어"], [C2, "운동"], [C3, "독서"]]);
    expect(next.categories[2].colorOrder).toBe(2);
  });
  it("다시 시작: 넘긴 묶음에 없는 분야는 보관되고 표시가 지워진다. 처음 설정을 마치는 표시도 반영", () => {
    const next = apply(mirror({ settings: { ...mirror().settings!, onboardingDone: false } }), { reason: "restart", completeOnboarding: true, items: [{ id: C1, percent: 100 }] });
    expect(next.categories.map((c) => c.id)).toEqual([C1]);
    expect(next.archivedCategories?.map((c) => c.id)).toEqual([C2]);
    expect(next.bundle?.restartRequestedAt).toBeNull();
    expect(next.settings?.onboardingDone).toBe(true);
    expect(next.settings?.ratios).toEqual([{ categoryId: C1, percent: 100 }]);
  });
  it("bundle.restart·취소는 표시만 바꾼다", () => {
    const m = mirror({ bundle: { revision: 3, startedAt: null, restartRequestedAt: null } });
    const asked = applyOp(m, { op: { kind: "bundle.restart" }, clientAt: NOW.toISOString() });
    expect(asked.bundle?.restartRequestedAt).toBe(NOW.toISOString());
    expect(asked.categories).toEqual(m.categories);
    expect(applyOp(asked, { op: { kind: "bundle.restartCancel" }, clientAt: NOW.toISOString() }).bundle?.restartRequestedAt).toBeNull();
  });
  it("replay: 줄의 bundle.apply 둘을 차례로 입히면 고침 번호가 둘 오른다", () => {
    const ops = [
      { key: "1", clientAt: NOW.toISOString(), attempts: 0, op: { kind: "bundle.apply", ...base({ goal: "하나" }) } as Op },
      { key: "2", clientAt: NOW.toISOString(), attempts: 0, op: { kind: "bundle.apply", ...base({ id: OP2, expectedRevision: 4, goal: "둘" }) } as Op },
    ];
    const next = replay(mirror(), ops);
    expect(next.bundle?.revision).toBe(5);
    expect(next.settings?.goal).toBe("둘");
  });
});

describe("충돌 거절이 되돌림 길을 탄다(보낼 줄 runtime)", () => {
  const snap = (over: Partial<MirrorSnapshot> = {}): MirrorSnapshot => ({
    serverNow: NOW.toISOString(),
    userId: ME,
    todos: [],
    categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z", colorOrder: 0 }],
    settings: { goal: "서버 목표", goalReadable: true, onboardingDone: true, notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 }, ratios: [{ categoryId: C1, percent: 100 }] },
    logs: [],
    goal: null,
    sessions: [],
    archivedCategories: [],
    bundle: { revision: 4, startedAt: "2026-11-10T03:00:00.000Z", restartRequestedAt: null },
    ...over,
  });
  function harness(reply: (op: Op) => SendResult) {
    const sent: Op[] = [];
    const runtime = createRuntime({
      userKey: ME,
      kv: createMemoryKv(),
      send: async (q) => {
        sent.push(structuredClone(q.op));
        return reply(q.op);
      },
      fetchSnapshot: async () => ({ ok: true, data: snap() }),
      now: () => NOW.getTime(),
      online: () => true,
      setTimer: () => ({}),
      clearTimer: () => {},
      onReset: () => {},
    });
    return { runtime, sent };
  }
  const apply: Op = { kind: "bundle.apply", id: OP1, expectedRevision: 4, reason: "edit", goal: "내 새 목표", other: 0, items: [{ id: C1, percent: 100 }] };

  it("bundle_conflict면 줄에서 빼고 거울을 되돌리고(서버 목표로) 글을 보관한다", async () => {
    const h = harness((op) => (op.kind === "bundle.apply" ? { ok: false, error: "bundle_conflict" } : { ok: true }));
    await h.runtime.boot();
    await h.runtime.pull(); // 서버 사본을 받는다
    expect(h.runtime.getMirror().bundle?.revision).toBe(4);
    h.runtime.enqueue(apply);
    expect(h.runtime.getMirror().settings?.goal).toBe("내 새 목표"); // 기기에 먼저 반영
    expect(h.runtime.getMirror().bundle?.revision).toBe(5);
    const result = await h.runtime.flush();
    expect(result.rejected).toEqual([{ kind: "bundle.apply", error: "bundle_conflict" }]);
    expect(h.runtime.getMirror().settings?.goal).toBe("서버 목표"); // 되돌림
    expect(h.runtime.getMirror().bundle?.revision).toBe(4);
    expect(h.runtime.pendingCount()).toBe(0);
    // 글 보관: 거절된 목표 글이 보관 목록에 남는다(되돌리고 글 보관)
    expect(h.runtime.archivedWrites().map((a) => [a.kind, a.text, a.error])).toEqual([["bundle.apply", "내 새 목표", "bundle_conflict"]]);
  });
  it("성공하면 줄이 비고 거울의 고침 번호가 서버 사본과 맞는다", async () => {
    const h = harness(() => ({ ok: true }));
    await h.runtime.boot();
    await h.runtime.pull();
    h.runtime.enqueue(apply);
    expect(await h.runtime.flush()).toMatchObject({ sent: 1, remaining: 0 });
    expect(h.sent.map((o) => o.kind)).toEqual(["bundle.apply"]);
  });
});

describe("색 함수: 고정 칸 우선", () => {
  it("color_order가 있으면 그것을, 없으면(null·undefined) 화면 순서를 쓴다", () => {
    expect(resolveColorOrder(5, 0)).toBe(5);
    expect(resolveColorOrder(undefined, 3)).toBe(3);
    expect(resolveColorOrder(null, 3)).toBe(3);
    expect(resolveColorOrder(null, null)).toBeNull(); // 기타
    expect(resolveColorOrder(-1, 2)).toBe(2); // 이상한 값은 버린다
  });
  it("분야 하나를 보관해도 다른 분야의 색 번호가 그대로다 — 분야 목록(보관 포함) → 거울에 입힌 뒤 → 화면이 쓰는 색 번호(실제 경로)", () => {
    const cat = (id: string, name: string, colorOrder: number) => ({ id, readable: true as const, name, createdAt: "2026-11-01T00:00:00.000Z", colorOrder });
    const settings = { goal: null, goalReadable: true, onboardingDone: true, notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 }, ratios: [{ categoryId: "a", percent: 40 }, { categoryId: "b", percent: 30 }, { categoryId: "c", percent: 30 }] };
    const m: Mirror = { ...emptyMirror(), synced: true, categories: [cat("a", "가", 0), cat("b", "나", 1), cat("c", "다", 2)], archivedCategories: [], settings, bundle: { revision: 0, startedAt: null, restartRequestedAt: null } };
    // 화면이 읽는 목록(derive.readableCategories) → 색 번호(lib/category-color의 colorNumbersIn). 화면은 이 순서·색 순서로 칠한다
    const before = colorNumbersIn(readableCategories(m));
    expect(before).toEqual({ a: 1, b: 2, c: 3 });
    // b를 보관하는 bundle.apply를 거울에 입힌다(같은 reduce 경로)
    const after = applyOp(m, { clientAt: NOW.toISOString(), op: { kind: "bundle.apply", id: OP1, expectedRevision: 0, reason: "edit", goal: null, other: 0, items: [{ id: "a", percent: 40 }, { id: "b", percent: 30, archived: true }, { id: "c", percent: 30 }] } as Op });
    expect(after.categories.map((c) => c.id)).toEqual(["a", "c"]); // 화면 목록에서 b가 빠져 c의 화면 순서는 1로 당겨졌다
    const colors = colorNumbersIn(readableCategories(after));
    expect(colors.a).toBe(before.a);
    expect(colors.c).toBe(before.c); // 고정 칸이라 3 그대로(옛 방식이면 2로 바뀐다)
    // 고정 칸이 없던 옛 사본(colorOrder 없음)은 화면 순서로 폴백한다 — 이 경우 c의 색이 당겨진다(옛 동작 그대로)
    const legacy = (list: { id: string }[]) => colorNumbersIn(list.map(({ id }) => ({ id })));
    expect(legacy(readableCategories(after)).c).toBe(2);
    // 9번째부터 돌려 쓴다
    expect(categoryColorNumber(8)).toBe(1);
  });
});

describe("mirror: 서버 사본에 묶음 상태·보관 분야·분야 색 순서가 실린다", () => {
  it("고침 번호·시작·다시 시작 표시와 보관한 분야(이름 찾기용), 분야 색 순서가 온다. 지난 묶음 목록은 없다", async () => {
    const store = setup();
    store.seed("categories", { id: C3, user_id: ME, name_encrypted: encryptCategoryName("독서", ME, KEY!), archived_at: "2026-11-01T00:00:00.000Z", color_order: 2 });
    Object.assign(store.table("user_settings")[0], { bundle_revision: 6, bundle_started_at: "2026-11-10T03:00:00.000Z", restart_requested_at: "2026-11-16T03:00:00.000Z" });
    store.seed("goal_bundles", { user_id: ME, started_at: "2026-11-01T00:00:00.000Z", ended_at: "2026-11-10T03:00:00.000Z", ratios: [{ category_id: null, percent: 100 }], categories: [] });
    const res = await readMirrorForUser({ supabase: fakeTablesClient(store, { sub: ME }), key: KEY, now: () => NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.bundle).toEqual({ revision: 6, startedAt: "2026-11-10T03:00:00.000Z", restartRequestedAt: "2026-11-16T03:00:00.000Z" });
    expect(res.data.archivedCategories).toEqual([expect.objectContaining({ id: C3, name: "독서", colorOrder: 2 })]);
    expect(res.data.categories?.map((c) => [c.id, c.colorOrder])).toEqual([[C1, 0], [C2, 1]]);
    expect(Object.keys(res.data)).not.toContain("bundles"); // 지난 판 목록은 싣지 않는다
    expect(JSON.stringify(res.data)).not.toContain("ended_at");
  });
});

describe("고침 1/3: 빠진 키 거절(흉내)·옛 op 번호·지난 묶음 못 남긴 까닭·키 없이 비율·반쪽 저장·처음 설정 문", () => {
  const rpcDirect = (store: FakeStore, args: Record<string, unknown>) =>
    fakeTablesClient(store, { sub: ME }).rpc("save_goal_bundle", { p_op_id: null, p_expected_revision: 0, p_reason: "edit", p_set_goal: false, p_goal_encrypted: null, p_other: 0, p_items: null, ...args }) as unknown as Promise<{ data: unknown; error: { hint?: string; code?: string } | null }>;

  it("함수에 id 빠짐·percent 빠짐·archived:true+percent 빠짐을 직접 넣으면 모두 bundle_invalid로 거절되고 아무것도 안 바뀐다", async () => {
    const store = setup();
    const before = structuredClone(store.tables);
    for (const items of [[{ percent: 10 }], [{ id: C1 }], [{ id: C1, archived: true }], [{ id: null, percent: 100 }], ["문자열"]]) {
      const res = await rpcDirect(store, { p_items: items, p_other: 100 });
      expect(res.error?.hint, JSON.stringify(items)).toBe("bundle_invalid");
    }
    expect(store.tables).toEqual(before);
    // 정상 입력은 통과(양성 대조)
    expect((await rpcDirect(store, { p_items: [{ id: C1, percent: 60 }, { id: C2, percent: 40 }] })).error).toBeNull();
  });

  it("옛 op(ratios.save·settings.save goal)도 서버가 고침 번호를 올리고 거울도 같이 올려, 뒤따르는 bundle.apply는 충돌 없이 저장된다", async () => {
    const store = setup();
    store.table("user_settings")[0].bundle_revision = 4;
    session.sub = ME;
    getDeps.mockImplementation(async () => ({ ...deps(store), now: () => NOW }));
    let m: Mirror = { ...emptyMirror(), synced: true, categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" }, { id: C2, readable: true, name: "운동", createdAt: "2026-11-01T00:00:00.000Z" }], bundle: { revision: 4, startedAt: null, restartRequestedAt: null } };
    const legacyOps: Op[] = [
      { kind: "ratios.save", ratios: [{ categoryId: C1, percent: 70 }, { categoryId: C2, percent: 30 }] },
      { kind: "settings.save", patch: { goal: "옛 목표" } },
      { kind: "settings.save", patch: { notify: { eveningEnabled: true } } }, // 함수를 부르지 않는다 → 번호도 그대로
    ];
    for (const op of legacyOps) {
      m = applyOp(m, { op, clientAt: NOW.toISOString() });
      expect((await sendLocalOp(ME, op, NOW.toISOString())).ok).toBe(true);
    }
    expect(store.table("user_settings")[0].bundle_revision).toBe(6);
    expect(m.bundle?.revision).toBe(6); // 거울이 서버와 같은 번호
    // 이제 거울의 번호로 bundle.apply를 보내면 가짜 충돌이 없다
    const res = await applyBundleForUser(deps(store), base({ expectedRevision: m.bundle!.revision }));
    expect(res.ok).toBe(true);
  });

  it("줄에 옛 op 다음 bundle.apply가 있어도(replay) 두 번째 apply가 기대하는 번호가 거울에서 이어진다", () => {
    const m: Mirror = { ...emptyMirror(), synced: true, categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" }], bundle: { revision: 4, startedAt: null, restartRequestedAt: null } };
    const q = (key: string, op: Op) => ({ key, clientAt: NOW.toISOString(), attempts: 0, op });
    const next = replay(m, [q("1", { kind: "ratios.save", ratios: [{ categoryId: C1, percent: 100 }] }), q("2", { kind: "bundle.apply", ...base({ expectedRevision: 5, items: [{ id: C1, percent: 100 }] }) } as Op)]);
    expect(next.bundle?.revision).toBe(6); // 옛 op +1, bundle.apply +1
  });

  it("지난 묶음을 못 남긴 까닭을 갈라 돌려준다: 상한은 limit, 옛 데이터 합≠100은 invalid", async () => {
    const limited = setup();
    for (let i = 0; i < 1000; i += 1) limited.seed("goal_bundles", { user_id: ME, started_at: "2026-01-01T00:00:00.000Z", ended_at: "2026-01-02T00:00:00.000Z", ratios: [{ category_id: null, percent: 100 }], categories: [] });
    expect(await applyBundleForUser(deps(limited), base())).toEqual({ ok: true, data: { revision: 1, pastSkipped: "limit" } });
    const invalid = setup();
    invalid.table("category_ratios").find((r) => r.category_id === C1)!.percent = 30; // 옛 데이터: 합 70
    expect(await applyBundleForUser(deps(invalid), base())).toEqual({ ok: true, data: { revision: 1, pastSkipped: "invalid" } });
    expect(invalid.table("goal_bundles")).toHaveLength(0);
    // 남겼으면 null
    expect(await applyBundleForUser(deps(setup()), base())).toEqual({ ok: true, data: { revision: 1, pastSkipped: null } });
  });

  it("비율만 저장할 때는 암호화 키가 없어도 된다(전과 같다). 목표 글은 키가 필요해 config", async () => {
    const store = setup();
    const noKey = { supabase: fakeTablesClient(store, { sub: ME }), key: null };
    expect((await saveRatiosForUser(noKey, [{ categoryId: C1, percent: 70 }, { categoryId: C2, percent: 30 }])).ok).toBe(true);
    expect(store.table("category_ratios").find((r) => r.category_id === C1)?.percent).toBe(70);
    expect(await saveLegacyBundleForUser(noKey, { goal: { value: "글" } })).toEqual({ ok: false, error: "config" });
    expect((await saveLegacyBundleForUser(noKey, { goal: { value: null } })).ok).toBe(true); // 목표를 비우는 것은 키가 필요 없다
  });

  it("settings.save가 알림과 목표를 함께 받아 목표(함수)만 실패하면, 알림은 저장돼 있고 결과가 partial: notify_saved로 정확히 말한다", async () => {
    const store = setup();
    store.rpcError = { code: "XX000", message: "boom" };
    const res = await saveSettingsForUser({ supabase: fakeTablesClient(store, { sub: ME }), key: KEY, now: () => NOW }, { notify: { eveningEnabled: true }, goal: "새 목표" });
    expect(res).toEqual({ ok: false, error: "unavailable", partial: "notify_saved" });
    expect(store.table("user_settings")[0].notify_evening_enabled).toBe(true); // 알림은 먼저 저장됐다
    expect(store.table("user_settings")[0].goal_encrypted).toBeNull(); // 목표 글은 저장되지 않았다
    expect(store.rpcCalls).toHaveLength(1);
    // 순서: 알림 upsert가 함수 호출보다 먼저
    const upsertAt = store.calls.findIndex((c) => c.table === "user_settings" && c.op === "upsert");
    expect(upsertAt).toBeGreaterThanOrEqual(0);
    // 알림 저장이 실패하면 목표 함수를 부르지 않는다(아무것도 저장 안 됨)
    const store2 = setup();
    store2.alwaysError = { code: "XX000" };
    const res2 = await saveSettingsForUser({ supabase: fakeTablesClient(store2, { sub: ME }), key: KEY, now: () => NOW }, { notify: { eveningEnabled: true }, goal: "새 목표" });
    expect(res2).toEqual({ ok: false, error: "unavailable" });
    expect(store2.rpcCalls).toHaveLength(0);
    // 목표만 보내고 실패하면 partial 없이 그냥 실패
    const store3 = setup();
    store3.rpcError = { code: "XX000" };
    expect(await saveSettingsForUser({ supabase: fakeTablesClient(store3, { sub: ME }), key: KEY, now: () => NOW }, { goal: "새 목표" })).toEqual({ ok: false, error: "unavailable" });
    // 둘 다 성공하면 새 설정을 돌려준다
    const store4 = setup();
    const ok = await saveSettingsForUser({ supabase: fakeTablesClient(store4, { sub: ME }), key: KEY, now: () => NOW }, { notify: { eveningEnabled: true }, goal: "새 목표" });
    expect(ok).toMatchObject({ ok: true, data: { goal: "새 목표", notify: { eveningEnabled: true } } });
  });

  it("처음 설정 문: onboarding_done_at이 비었거나 restart_requested_at이 있으면 열린다(서버 읽기·거울·다시 시작 끝)", async () => {
    const store = setup();
    const read = () => readSettingsForUser({ supabase: fakeTablesClient(store, { sub: ME }), key: KEY });
    const done = await read();
    expect(done.ok && done.data.onboardingDone).toBe(true); // 마쳤고 표시 없음 → 닫힘
    store.table("user_settings")[0].restart_requested_at = NOW.toISOString();
    const asked = await read();
    expect(asked.ok && asked.data.onboardingDone).toBe(false); // 표시가 있으면 열림
    expect(store.table("user_settings")[0].onboarding_done_at).not.toBeNull(); // DB의 마친 시각은 지우지 않는다
    store.table("user_settings")[0].restart_requested_at = null;
    store.table("user_settings")[0].onboarding_done_at = null;
    const fresh = await read();
    expect(fresh.ok && fresh.data.onboardingDone).toBe(false); // 마친 시각이 비면 열림
    // 거울: bundle.restart → 열림, 취소 → 닫힘, 다시 시작 끝(bundle.apply restart) → 닫힘
    const m: Mirror = { ...emptyMirror(), synced: true, categories: [{ id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" }], settings: { goal: null, goalReadable: true, onboardingDone: true, notify: { eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 }, ratios: [] }, bundle: { revision: 1, startedAt: null, restartRequestedAt: null } };
    const opened = applyOp(m, { op: { kind: "bundle.restart" }, clientAt: NOW.toISOString() });
    expect(opened.settings?.onboardingDone).toBe(false);
    expect(applyOp(opened, { op: { kind: "bundle.restartCancel" }, clientAt: NOW.toISOString() }).settings?.onboardingDone).toBe(true);
    const finished = applyOp(opened, { op: { kind: "bundle.apply", ...base({ reason: "restart", items: [{ id: C1, percent: 100 }] }) } as Op, clientAt: NOW.toISOString() });
    expect(finished.settings?.onboardingDone).toBe(true);
  });
});
