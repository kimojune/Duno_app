import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 시험용 가짜 Supabase. todos·categories 표를 메모리에 두고, RLS처럼 자기 행만 보이게 한다.
 * core 함수가 쓰는 만큼만 흉내 낸다: auth.getClaims, from().select/insert/update/eq/is/order.
 * calls에 DB 호출을 남겨 「DB를 부르지 않았다」를 확인할 수 있다.
 *
 * 마이그레이션(supabase/migrations/20261106003000_categories.sql)의 DB 쪽 방어도 흉내 낸다:
 *  - todos (category_id, user_id) → categories (id, user_id) 외래 키: 남의 분야·없는 분야면 23503(RLS와 상관없이 본다)
 *  - categories 이름 암호문 형식·길이(512자) check: 23514
 *  - 사용자별 분야 개수 상한(임시 50): P0001, hint categories_limit
 */

export type FakeRow = {
  id: string;
  user_id: string;
  day: string;
  text_encrypted: string;
  done: boolean;
  created_at: string;
  category_id: string | null;
};

export type FakeCategoryRow = {
  id: string;
  user_id: string;
  name_encrypted: string;
  archived_at: string | null;
  created_at: string;
};

export type FakeCall = {
  table: "todos" | "categories";
  op: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: [string, unknown][];
  orders: [string, boolean][];
};
// orders: order(열, { ascending }) 호출을 부른 순서대로 남긴다. [열, 오름차순인가]
export type FakeError = { code: string; hint?: string; message?: string; details?: string };

const CIPHERTEXT_FORMAT = /^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$/;

export class FakeDb {
  rows: FakeRow[] = [];
  categories: FakeCategoryRow[] = [];
  calls: FakeCall[] = [];
  /** 다음 insert에서 돌려줄 오류(한 번만, 표 상관없이) */
  insertError: FakeError | null = null;
  /** 모든 호출에서 돌려줄 오류 */
  alwaysError: FakeError | null = null;
  /** insert를 처리하기 직전에 한 번 부른다(그 사이 다른 요청이 먼저 들어간 경우를 흉내 낸다) */
  beforeInsert: (() => void) | null = null;
  /** 사용자별 분야 개수 상한(마이그레이션의 임시 50) */
  categoryLimit = 50;
  private clock = Date.parse("2026-11-05T00:00:00.000Z");

  nextCreatedAt(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
}

type AuthMode = { sub: string | null } | { claimsError: true } | { claimsThrow: true };
type AnyRow = Record<string, unknown>;

export function fakeClient(db: FakeDb, auth: AuthMode): SupabaseClient {
  const viewer = "sub" in auth ? auth.sub : null;

  function insertTodo(p: Partial<FakeRow>): { row?: FakeRow; error?: FakeError } {
    if (!viewer || p.user_id !== viewer) return { error: { code: "42501" } }; // WITH CHECK
    if (db.rows.some((r) => r.id === p.id)) return { error: { code: "23505" } }; // 기본 키
    const categoryId = p.category_id ?? null;
    // 복합 외래 키: RLS를 거치지 않고 모든 분야 중에서 (id, user_id)가 맞는 행이 있어야 한다
    if (categoryId !== null && !db.categories.some((c) => c.id === categoryId && c.user_id === p.user_id)) {
      return { error: { code: "23503", message: 'violates foreign key constraint "todos_category_owner_fkey"' } };
    }
    const row: FakeRow = {
      id: String(p.id),
      user_id: String(p.user_id),
      day: String(p.day),
      text_encrypted: String(p.text_encrypted),
      done: Boolean(p.done ?? false),
      created_at: db.nextCreatedAt(),
      category_id: categoryId,
    };
    db.rows.push(row);
    return { row };
  }

  function insertCategory(p: Partial<FakeCategoryRow>): { row?: FakeCategoryRow; error?: FakeError } {
    // 넣을 수 있는 열은 id, user_id, name_encrypted뿐(grant). 그 밖의 열을 보내면 42501.
    if (Object.keys(p).some((k) => !["id", "user_id", "name_encrypted"].includes(k))) return { error: { code: "42501" } };
    if (!viewer || p.user_id !== viewer) return { error: { code: "42501" } }; // WITH CHECK
    if (db.categories.some((c) => c.id === p.id)) return { error: { code: "23505" } };
    const name = String(p.name_encrypted);
    if (!CIPHERTEXT_FORMAT.test(name) || name.length > 512) return { error: { code: "23514" } };
    if (db.categories.filter((c) => c.user_id === p.user_id).length >= db.categoryLimit) {
      return { error: { code: "P0001", hint: "categories_limit", message: "category limit reached" } };
    }
    const row: FakeCategoryRow = {
      id: String(p.id),
      user_id: String(p.user_id),
      name_encrypted: name,
      archived_at: null,
      created_at: db.nextCreatedAt(),
    };
    db.categories.push(row);
    return { row };
  }

  const client = {
    auth: {
      async getClaims() {
        if ("claimsThrow" in auth) throw new Error("network down");
        if ("claimsError" in auth) return { data: null, error: { name: "AuthError", message: "jwt expired", status: 401 } };
        return auth.sub ? { data: { claims: { sub: auth.sub } }, error: null } : { data: null, error: null };
      },
    },
    from(table: string) {
      if (table !== "todos" && table !== "categories") throw new Error("unexpected table");
      const call: FakeCall = { table, op: "select", filters: [], orders: [] };
      let returning = false;

      const run = (): { data: unknown; error: FakeError | null } => {
        db.calls.push(call);
        if (db.alwaysError) return { data: null, error: db.alwaysError };
        const source: AnyRow[] = table === "todos" ? db.rows : db.categories;
        const visible = (r: AnyRow) => viewer !== null && r.user_id === viewer; // RLS USING
        const matches = (r: AnyRow) => call.filters.every(([c, v]) => r[c] === v);

        if (call.op === "insert") {
          const hook = db.beforeInsert;
          db.beforeInsert = null;
          hook?.();
          if (db.insertError) {
            const error = db.insertError;
            db.insertError = null;
            return { data: null, error };
          }
          const result =
            table === "todos"
              ? insertTodo(call.payload as Partial<FakeRow>)
              : insertCategory(call.payload as Partial<FakeCategoryRow>);
          if (result.error) return { data: null, error: result.error };
          return { data: returning ? [{ ...result.row }] : null, error: null };
        }

        const hits = source.filter((r) => visible(r) && matches(r));
        if (call.op === "update") {
          if (table === "categories") return { data: null, error: { code: "42501" } }; // update grant 없음
          for (const r of hits) Object.assign(r, call.payload);
          return { data: returning ? hits.map((r) => ({ ...r })) : null, error: null };
        }
        // order()를 부른 만큼만 정렬한다. 부르지 않으면 넣은 순서 그대로라, order 줄을 지우면 순서 시험이 깨진다.
        const sorted = [...hits].sort((x, y) => {
          for (const [column, ascending] of call.orders) {
            const a = String(x[column]);
            const b = String(y[column]);
            const cmp = a.localeCompare(b);
            if (cmp !== 0) return ascending ? cmp : -cmp;
          }
          return 0;
        });
        return { data: sorted.map((r) => ({ ...r })), error: null };
      };

      const builder = {
        select() {
          returning = true;
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          call.op = "insert";
          call.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.op = "update";
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        is(column: string, value: null) {
          call.filters.push([column, value]);
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          call.orders.push([column, options?.ascending !== false]);
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
