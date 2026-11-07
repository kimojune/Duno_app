import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 원샷 v2 표(todos·todo_notes·user_settings·evening_logs 등)를 흉내 내는 시험용 가짜 Supabase.
 * tests/unit/fake-supabase.ts(할 일·분야 전용, 기존 시험이 쓴다)와 따로 두어, 거기는 건드리지 않는다.
 * 흉내 내는 것: RLS(user_id가 있는 표는 자기 행만 보임, insert는 user_id가 나이거나 비어 있어야 하고 비면 나로 채움),
 * 기본 키·고유 제약(23505), 외래 키(23503), 개수 상한(P0001), delete·upsert, eq/is/in/gte/lte/order/limit.
 * calls에 표·동작·필터를 남겨 「DB를 부르지 않았다」나 「이 열은 보내지 않았다」를 확인할 수 있다.
 */

export type Row = Record<string, unknown>;
export type FakeError = { code: string; hint?: string; message?: string };
export type TableRule = {
  /** 기본 키 열(기본 ["id"]) */
  primaryKey?: string[];
  /** 그 밖의 고유 제약 */
  uniques?: string[][];
  /** 외래 키: cols 가운데 하나라도 null이면 검사하지 않는다(MATCH SIMPLE) */
  fks?: { cols: string[]; table: string; refCols: string[]; onDelete?: "cascade" | "restrict" }[];
  /** 한 사용자 행 수 상한 */
  limit?: { count: number; hint: string };
  /** insert 때 채울 기본값 */
  defaults?: (row: Row, store: FakeStore) => Row;
  /** 이 열들만 넣을 수 있다(grant insert). 다른 열을 보내면 42501 */
  insertColumns?: string[];
  /** update로 바꿀 수 있는 열만(grant update). 없으면 update 불가(42501) */
  updateColumns?: string[];
  /** delete 허용 여부(grant delete) */
  allowDelete?: boolean;
  /** user_id 열이 없는 표(보이는 범위를 제한하지 않는다) */
  noUser?: boolean;
};

export type FakeCall = { table: string; op: "select" | "insert" | "upsert" | "update" | "delete"; payload?: unknown; filters: [string, string, unknown][] };

export class FakeStore {
  tables: Record<string, Row[]> = {};
  rules: Record<string, TableRule> = {};
  calls: FakeCall[] = [];
  alwaysError: FakeError | null = null;
  private clock = Date.parse("2026-11-07T00:00:00.000Z");
  private seq = 0;

  table(name: string): Row[] {
    return (this.tables[name] ??= []);
  }
  /** 정하면 모든 DB 기본값 시각(now())이 이 시각이 된다(서버 시계와 앱 시계를 맞추는 시험용) */
  fixedNow: Date | null = null;
  nextTimestamp(): string {
    if (this.fixedNow) return this.fixedNow.toISOString();
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
  nextUuid(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }
  /** 시험이 직접 행을 심는다(RLS·제약을 거치지 않는다) */
  seed(name: string, row: Row): Row {
    const full = { ...row };
    if (full.id === undefined && !this.rules[name]?.primaryKey) full.id = this.nextUuid();
    if (full.created_at === undefined) full.created_at = this.nextTimestamp();
    this.table(name).push(full);
    return full;
  }
}

type AuthMode = { sub: string | null } | { claimsError: true } | { claimsThrow: true };

export function fakeTablesClient(store: FakeStore, auth: AuthMode): SupabaseClient {
  const viewer = "sub" in auth ? auth.sub : null;

  const client = {
    auth: {
      async getClaims() {
        if ("claimsThrow" in auth) throw new Error("network down");
        if ("claimsError" in auth) return { data: null, error: { name: "AuthError", message: "jwt expired", status: 401 } };
        return auth.sub ? { data: { claims: { sub: auth.sub } }, error: null } : { data: null, error: null };
      },
    },
    from(table: string) {
      const rule = store.rules[table] ?? {};
      const call: FakeCall = { table, op: "select", filters: [] };
      let returning = false;
      let payload: Row | Row[] | null = null;
      let upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {};
      const orders: [string, boolean][] = [];
      let limitCount: number | null = null;

      const pk = rule.primaryKey ?? ["id"];
      const sameKey = (a: Row, b: Row, cols: string[]) => cols.every((c) => a[c] === b[c] && a[c] !== undefined && a[c] !== null);

      const visible = (r: Row) => rule.noUser || (viewer !== null && r.user_id === viewer);
      const matches = (r: Row) =>
        call.filters.every(([op, col, val]) => {
          const v = r[col];
          if (op === "eq") return v === val;
          if (op === "is") return (v ?? null) === val;
          if (op === "in") return (val as unknown[]).includes(v);
          if (op === "gte") return String(v) >= String(val);
          if (op === "lte") return String(v) <= String(val);
          return true;
        });

      function insertOne(input: Row): { row?: Row; error?: FakeError } {
        if (rule.insertColumns) {
          const extra = Object.keys(input).filter((k) => !rule.insertColumns!.includes(k));
          if (extra.length > 0) return { error: { code: "42501", message: `no insert grant on ${extra.join(",")}` } };
        }
        const row: Row = { ...input };
        if (!rule.noUser) {
          if (row.user_id === undefined) row.user_id = viewer;
          if (!viewer || row.user_id !== viewer) return { error: { code: "42501" } }; // WITH CHECK
        }
        if (rule.defaults) Object.assign(row, rule.defaults(row, store));
        if (pk.includes("id") && row.id === undefined) row.id = store.nextUuid();
        if (row.created_at === undefined && !rule.noUser) row.created_at = store.nextTimestamp();
        const rows = store.table(table);
        if (rows.some((r) => sameKey(r, row, pk))) return { error: { code: "23505" } };
        for (const cols of rule.uniques ?? []) {
          if (rows.some((r) => sameKey(r, row, cols))) return { error: { code: "23505" } };
        }
        for (const fk of rule.fks ?? []) {
          if (fk.cols.some((c) => row[c] === null || row[c] === undefined)) continue;
          const target = store.table(fk.table);
          if (!target.some((t) => fk.cols.every((c, i) => t[fk.refCols[i]] === row[c]))) {
            return { error: { code: "23503", message: `fk ${fk.table}` } };
          }
        }
        if (rule.limit && rows.filter((r) => r.user_id === row.user_id).length >= rule.limit.count) {
          return { error: { code: "P0001", hint: rule.limit.hint } };
        }
        return { row };
      }

      const run = (): { data: unknown; error: FakeError | null } => {
        store.calls.push(call);
        if (store.alwaysError) return { data: null, error: store.alwaysError };
        const rows = store.table(table);

        if (call.op === "insert" || call.op === "upsert") {
          const list = Array.isArray(payload) ? payload : [payload as Row];
          const out: Row[] = [];
          for (const item of list) {
            if (call.op === "upsert") {
              const cols = (upsertOptions.onConflict ?? pk.join(",")).split(",").map((c) => c.trim());
              const existing = rows.find((r) => visible(r) && cols.every((c) => r[c] === (item[c] ?? (c === "user_id" ? viewer : undefined))));
              if (existing) {
                if (upsertOptions.ignoreDuplicates) continue;
                const allowed = rule.updateColumns;
                const changed = Object.keys(item).filter((k) => !cols.includes(k));
                if (allowed && changed.some((k) => !allowed.includes(k))) return { data: null, error: { code: "42501" } };
                Object.assign(existing, item);
                out.push({ ...existing });
                continue;
              }
            }
            const result = insertOne(item);
            if (result.error) return { data: null, error: result.error };
            rows.push(result.row!);
            out.push({ ...result.row! });
          }
          return { data: returning ? out : null, error: null };
        }

        const hits = rows.filter((r) => visible(r) && matches(r));
        if (call.op === "update") {
          const allowed = rule.updateColumns;
          const keys = Object.keys(payload as Row);
          if (!allowed || keys.some((k) => !allowed.includes(k))) return { data: null, error: { code: "42501" } };
          for (const fk of rule.fks ?? []) {
            for (const r of hits) {
              const next = { ...r, ...(payload as Row) };
              if (fk.cols.some((c) => next[c] === null || next[c] === undefined)) continue;
              const target = store.table(fk.table);
              if (!target.some((t) => fk.cols.every((c, i) => t[fk.refCols[i]] === next[c]))) {
                return { data: null, error: { code: "23503" } };
              }
            }
          }
          for (const r of hits) Object.assign(r, payload);
          return { data: returning ? hits.map((r) => ({ ...r })) : null, error: null };
        }
        if (call.op === "delete") {
          if (!rule.allowDelete) return { data: null, error: { code: "42501" } };
          for (const r of hits) {
            const i = rows.indexOf(r);
            if (i >= 0) rows.splice(i, 1);
            // on delete cascade
            for (const [otherName, otherRule] of Object.entries(store.rules)) {
              for (const fk of otherRule.fks ?? []) {
                if (fk.table !== table || fk.onDelete !== "cascade") continue;
                store.tables[otherName] = store.table(otherName).filter((o) => !fk.cols.every((c, j) => o[c] === r[fk.refCols[j]]));
              }
            }
          }
          return { data: returning ? hits.map((r) => ({ ...r })) : null, error: null };
        }

        let sorted = [...hits];
        if (orders.length > 0) {
          sorted = sorted.sort((x, y) => {
            for (const [column, ascending] of orders) {
              const a = String(x[column] ?? "");
              const b = String(y[column] ?? "");
              const cmp = a.localeCompare(b);
              if (cmp !== 0) return ascending ? cmp : -cmp;
            }
            return 0;
          });
        }
        if (limitCount !== null) sorted = sorted.slice(0, limitCount);
        return { data: sorted.map((r) => ({ ...r })), error: null };
      };

      const builder = {
        select() {
          returning = true;
          return builder;
        },
        insert(p: Row | Row[]) {
          call.op = "insert";
          call.payload = p;
          payload = p;
          return builder;
        },
        upsert(p: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          call.op = "upsert";
          call.payload = p;
          payload = p;
          upsertOptions = options ?? {};
          return builder;
        },
        update(p: Row) {
          call.op = "update";
          call.payload = p;
          payload = p;
          return builder;
        },
        delete() {
          call.op = "delete";
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push(["eq", column, value]);
          return builder;
        },
        is(column: string, value: null) {
          call.filters.push(["is", column, value]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          call.filters.push(["in", column, values]);
          return builder;
        },
        gte(column: string, value: unknown) {
          call.filters.push(["gte", column, value]);
          return builder;
        },
        lte(column: string, value: unknown) {
          call.filters.push(["lte", column, value]);
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          orders.push([column, options?.ascending !== false]);
          return builder;
        },
        limit(n: number) {
          limitCount = n;
          return builder;
        },
        then<T>(resolve: (v: { data: unknown; error: FakeError | null }) => T, reject?: (e: unknown) => T) {
          return Promise.resolve().then(run).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

/** 안 보낸 열을 기본값으로 채우는 defaults 함수(보낸 값은 그대로 둔다) */
function fill(values: Row): (row: Row) => Row {
  return (row) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(values)) if (row[k] === undefined) out[k] = v;
    return out;
  };
}

/** 원샷 v2 마이그레이션의 규칙을 시험용으로 옮긴 것(표 이름은 마이그레이션과 같다) */
export function v2Rules(): Record<string, TableRule> {
  return {
    weekly_goals: {
      primaryKey: ["user_id", "week_start"],
      allowDelete: true,
      insertColumns: ["user_id", "week_start", "items"],
      updateColumns: ["items"],
    },
    todo_offers: {
      insertColumns: ["id", "user_id", "day", "surface", "category_id", "todo_id", "offer_key"],
      updateColumns: ["dismissed_at"],
      uniques: [["user_id", "day", "offer_key"]],
      defaults: (row, store) => ({ offered_at: store.nextTimestamp(), dismissed_at: null, ...(row.category_id === undefined ? { category_id: null } : {}), ...(row.todo_id === undefined ? { todo_id: null } : {}) }),
      fks: [{ cols: ["category_id", "user_id"], table: "categories", refCols: ["id", "user_id"] }],
      limit: { count: 50000, hint: "todo_offers_limit" },
    },
    focus_sessions: {
      insertColumns: [
        "id",
        "user_id",
        "client_started_at",
        "day",
        "planned_minutes",
        "todo_id",
        "category_id",
        "offer_id",
        "surface",
        "opposite_by_goal",
        "opposite_by_ratio",
      ],
      updateColumns: ["ended_at", "elapsed_seconds"],
      defaults: (row, store) => ({ started_at: store.nextTimestamp(), ended_at: null, elapsed_seconds: null, ...(row.todo_id === undefined ? { todo_id: null } : {}), ...(row.category_id === undefined ? { category_id: null } : {}), ...(row.offer_id === undefined ? { offer_id: null } : {}) }),
      fks: [{ cols: ["category_id", "user_id"], table: "categories", refCols: ["id", "user_id"] }],
      limit: { count: 50000, hint: "focus_sessions_limit" },
    },
    evening_logs: {
      insertColumns: ["id", "user_id", "target_day", "total_minutes", "items", "save_mode", "client_saved_at"],
      defaults: (_row, store) => ({ saved_at: store.nextTimestamp() }),
      limit: { count: 20000, hint: "evening_logs_limit" },
    },
    user_settings: {
      primaryKey: ["user_id"],
      insertColumns: [
        "user_id",
        "goal_encrypted",
        "onboarding_done_at",
        "notify_evening_enabled",
        "notify_evening_minute",
        "notify_morning_enabled",
        "notify_morning_minute",
      ],
      updateColumns: [
        "goal_encrypted",
        "onboarding_done_at",
        "notify_evening_enabled",
        "notify_evening_minute",
        "notify_morning_enabled",
        "notify_morning_minute",
      ],
      defaults: fill({
        goal_encrypted: null,
        onboarding_done_at: null,
        notify_evening_enabled: false,
        notify_evening_minute: 1170,
        notify_morning_enabled: false,
        notify_morning_minute: 600,
      }),
    },
    category_ratios: {
      primaryKey: ["user_id", "category_id"],
      allowDelete: true,
      insertColumns: ["user_id", "category_id", "percent"],
      updateColumns: ["percent"],
      fks: [{ cols: ["category_id", "user_id"], table: "categories", refCols: ["id", "user_id"] }],
    },
    todos: {
      allowDelete: true,
      updateColumns: ["done", "text_encrypted", "category_id", "position"],
      fks: [{ cols: ["category_id", "user_id"], table: "categories", refCols: ["id", "user_id"] }],
    },
    categories: { fks: [] },
    todo_notes: {
      allowDelete: true,
      insertColumns: ["id", "user_id", "todo_id", "day", "note_encrypted"],
      fks: [{ cols: ["todo_id", "user_id"], table: "todos", refCols: ["id", "user_id"], onDelete: "cascade" }],
      limit: { count: 20000, hint: "todo_notes_limit" },
    },
  };
}
