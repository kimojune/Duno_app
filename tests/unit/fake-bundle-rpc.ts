import { todoDayFor } from "../../lib/todos/day";
import type { FakeError, FakeStore, Row } from "./fake-tables";

/**
 * 시험용 DB 함수 흉내: save_goal_bundle·set_restart_requested(supabase/migrations/20261117100000_goal_bundles.sql의 규칙을 옮긴 것).
 * 진짜 SQL을 돌리는 것이 아니다(그건 supabase/tests/goal_bundles.test.sql, 미실행). 앱 코드가 함수를 **어떻게 부르고** 결과를 어떻게 받는지,
 * 그리고 옛 시험(비율 저장 등)이 보던 표 내용이 그대로 나오는지를 본다. 함수 본문처럼 한 트랜잭션: 오류가 나면 표를 되돌린다.
 */

type Result = { data: unknown; error: FakeError | null };
const fail = (code: string, hint: string): Result => ({ data: null, error: { code, hint } });
const CIPHER = /^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

class Abort extends Error {
  constructor(public result: Result) {
    super("abort");
  }
}

function settingsRow(store: FakeStore, uid: string): Row {
  const rows = store.table("user_settings");
  let row = rows.find((r) => r.user_id === uid);
  if (!row) {
    row = {
      user_id: uid,
      goal_encrypted: null,
      onboarding_done_at: null,
      notify_evening_enabled: false,
      notify_evening_minute: 1170,
      notify_morning_enabled: false,
      notify_morning_minute: 600,
      ratio_other_percent: null,
      created_at: store.nextTimestamp(),
    };
    rows.push(row);
  }
  row.bundle_revision ??= 0;
  row.bundle_op_ids ??= [];
  row.bundle_started_at ??= null;
  row.restart_requested_at ??= null;
  return row;
}

export function emulateRpc(store: FakeStore, viewer: string | null, name: string, args: Record<string, unknown>): Result {
  if (name === "set_restart_requested") {
    if (!viewer) return fail("28000", "unauthenticated");
    if (typeof args.p_requested !== "boolean") return fail("22023", "bundle_invalid");
    const row = settingsRow(store, viewer);
    row.restart_requested_at = args.p_requested ? (store.fixedNow ?? new Date()).toISOString() : null;
    return { data: null, error: null };
  }
  if (name !== "save_goal_bundle") return { data: null, error: { code: "42883", message: "unknown function" } };

  const snapshot = structuredClone(store.tables);
  try {
    return save(store, viewer, args);
  } catch (e) {
    if (e instanceof Abort) {
      store.tables = snapshot; // 한 트랜잭션: 아무것도 안 바뀐다
      return e.result;
    }
    throw e;
  }
}

function save(store: FakeStore, viewer: string | null, a: Record<string, unknown>): Result {
  const abort = (code: string, hint: string): never => {
    throw new Abort(fail(code, hint));
  };
  if (!viewer) return fail("28000", "unauthenticated");
  const uid = viewer;
  const now = store.fixedNow ?? new Date();
  const nowIso = now.toISOString();
  const legacy = a.p_legacy === true;
  const reason = a.p_reason;
  if (reason !== "edit" && reason !== "restart") abort("22023", "bundle_invalid");
  if (typeof a.p_set_goal !== "boolean") abort("22023", "bundle_invalid");
  if (!legacy && (typeof a.p_expected_revision !== "number" || a.p_expected_revision < 0)) abort("22023", "bundle_invalid");
  const other0 = a.p_other === null || a.p_other === undefined ? null : Number(a.p_other);
  if (other0 !== null && (other0 < 0 || other0 > 100)) abort("22023", "bundle_invalid");
  const goal = (a.p_goal_encrypted ?? null) as string | null;
  if (a.p_set_goal && goal !== null && (!CIPHER.test(goal) || goal.length > 1024)) abort("22023", "bundle_invalid");
  const items = a.p_items === undefined ? null : (a.p_items as Record<string, unknown>[] | null);
  if (items !== null && (!Array.isArray(items) || items.length > 50 || JSON.stringify(items).length > 16384)) abort("22023", "bundle_invalid");

  const s = settingsRow(store, uid);
  const opId = (a.p_op_id ?? null) as string | null;
  if (opId !== null && (s.bundle_op_ids as string[]).includes(opId)) {
    return { data: { revision: s.bundle_revision, past: "none", history: "none", idempotent: true }, error: null };
  }
  if (!legacy && a.p_expected_revision !== s.bundle_revision) abort("P0001", "bundle_conflict");

  let completing = false;
  if (a.p_complete_onboarding === true && s.onboarding_done_at === null) {
    s.onboarding_done_at = nowIso;
    completing = true;
  }

  const categories = store.table("categories");
  const ratios = store.table("category_ratios");
  const mineCats = () => categories.filter((c) => c.user_id === uid);
  const activeCats = () => mineCats().filter((c) => c.archived_at === null || c.archived_at === undefined);

  // 지난 묶음 남기기
  let past = "none";
  const ref = (s.bundle_started_at ?? s.onboarding_done_at) as string | null;
  if (ref !== null && !completing) {
    if (todoDayFor(new Date(ref)) === todoDayFor(now)) past = "same_day";
    else if (store.table("goal_bundles").filter((g) => g.user_id === uid).length >= 1000) past = "limit";
    else {
      const cats = [...activeCats()].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)) || String(x.id).localeCompare(String(y.id)));
      const rs: { category_id: string | null; percent: number }[] = ratios
        .filter((r) => r.user_id === uid && activeCats().some((c) => c.id === r.category_id))
        .map((r) => ({ category_id: r.category_id as string, percent: r.percent as number }))
        .sort((x, y) => String(x.category_id).localeCompare(String(y.category_id)));
      if (typeof s.ratio_other_percent === "number" && s.ratio_other_percent > 0) rs.push({ category_id: null, percent: s.ratio_other_percent });
      if (rs.reduce((n, r) => n + r.percent, 0) !== 100) past = "invalid";
      else {
        store.table("goal_bundles").push({
          id: store.nextUuid(),
          user_id: uid,
          started_at: ref,
          ended_at: nowIso,
          reason,
          goal_encrypted: s.goal_encrypted,
          categories: cats.map((c) => ({ category_id: c.id, name_encrypted: c.name_encrypted })),
          ratios: rs,
          created_at: nowIso,
        });
        past = "written";
      }
    }
  }

  // 지금 표 반영
  const ids: string[] = [];
  const pcts: number[] = [];
  let other = 0;
  let total: number | null = null;
  if (items !== null) {
    const seen: string[] = [];
    let moved = 0;
    for (const item of items) {
      const id = item.id;
      const pct = item.percent;
      if (typeof id !== "string" || !UUID.test(id) || typeof pct !== "number" || !Number.isInteger(pct) || pct < 0 || pct > 100 || seen.includes(id)) abort("22023", "bundle_invalid");
      const name = (item.name_encrypted ?? null) as string | null;
      if (name !== null && (!CIPHER.test(name) || name.length > 512)) abort("22023", "bundle_invalid");
      seen.push(id as string);
      const archived = typeof item.archived === "boolean" ? item.archived : null;
      let cat = mineCats().find((c) => c.id === id);
      let active: boolean;
      if (!cat) {
        if (item.new !== true) abort("P0002", "bundle_not_found");
        if (name === null || archived === true) abort("22023", "bundle_invalid");
        if (categories.some((c) => c.id === id)) abort("23505", "");
        cat = { id, user_id: uid, name_encrypted: name, archived_at: null, created_at: store.nextTimestamp(), color_order: mineCats().length };
        categories.push(cat);
        active = true;
      } else {
        if (name !== null && name !== cat.name_encrypted) cat.name_encrypted = name;
        const wasArchived = cat.archived_at !== null && cat.archived_at !== undefined;
        if (archived === true && !wasArchived) {
          moved += (ratios.find((r) => r.user_id === uid && r.category_id === id)?.percent as number | undefined) ?? 0;
          cat.archived_at = nowIso;
          active = false;
        } else if (archived === false && wasArchived) {
          cat.archived_at = null;
          active = true;
        } else active = !wasArchived;
      }
      if (active) {
        ids.push(id as string);
        pcts.push(pct as number);
      }
    }
    if (reason === "restart") for (const c of activeCats()) if (!seen.includes(c.id as string)) c.archived_at = nowIso;
    store.tables.category_ratios = ratios.filter((r) => r.user_id !== uid || ids.includes(r.category_id as string));
    const table = store.table("category_ratios");
    ids.forEach((id, i) => {
      const row = table.find((r) => r.user_id === uid && r.category_id === id);
      if (row) row.percent = pcts[i];
      else table.push({ user_id: uid, category_id: id, percent: pcts[i], created_at: store.nextTimestamp() });
    });
    other = (other0 ?? 0) + moved;
    total = pcts.reduce((n, p) => n + p, 0) + other;
    if (!legacy && total !== 100) abort("22023", "bundle_invalid");
    if (other > 100) other = 100;
  }

  // 목표 비율이 바뀐 기록: 같은 트랜잭션, 실패해도 저장은 성공(표시만)
  let history = "none";
  if (items !== null && total === 100 && ids.length + (other > 0 ? 1 : 0) >= 1) {
    const sorted = ids.map((id, i) => ({ category_id: id as string | null, percent: pcts[i] })).sort((x, y) => String(x.category_id).localeCompare(String(y.category_id)));
    if (other > 0) sorted.push({ category_id: null, percent: other });
    const hist = store.table("category_ratio_history").filter((h) => h.user_id === uid);
    const last = hist[hist.length - 1];
    if (last && JSON.stringify(last.ratios) === JSON.stringify(sorted)) history = "unchanged";
    else if (hist.length >= 1000) history = "skipped";
    else {
      store.table("category_ratio_history").push({ id: store.nextUuid(), user_id: uid, recorded_at: store.nextTimestamp(), ratios: sorted });
      history = "written";
    }
  }

  if (a.p_set_goal) s.goal_encrypted = goal;
  if (items !== null) s.ratio_other_percent = other > 0 ? other : null;
  if (completing || past === "written" || past === "limit" || past === "invalid") s.bundle_started_at = nowIso;
  if (reason === "restart") s.restart_requested_at = null;
  s.bundle_revision = (s.bundle_revision as number) + 1;
  if (opId !== null) s.bundle_op_ids = [...(s.bundle_op_ids as string[]), opId].slice(-20);
  return { data: { revision: s.bundle_revision, past, history, idempotent: false }, error: null };
}
