import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 시험용 가짜 Supabase. todos 표 하나를 메모리에 두고, RLS처럼 자기 행만 보이게 한다.
 * core 함수가 쓰는 만큼만 흉내 낸다: auth.getClaims, from().select/insert/update/eq/order.
 * calls에 DB 호출을 남겨 「DB를 부르지 않았다」를 확인할 수 있다.
 */

export type FakeRow = {
  id: string;
  user_id: string;
  day: string;
  text_encrypted: string;
  done: boolean;
  created_at: string;
};

export type FakeCall = { op: "select" | "insert" | "update"; payload?: Record<string, unknown>; filters: [string, unknown][]; orders: [string, boolean][] };
// orders: order(열, { ascending }) 호출을 부른 순서대로 남긴다. [열, 오름차순인가]
export type FakeError = { code: string; hint?: string; message?: string; details?: string };

export class FakeDb {
  rows: FakeRow[] = [];
  calls: FakeCall[] = [];
  /** 다음 insert에서 돌려줄 오류(한 번만) */
  insertError: FakeError | null = null;
  /** 모든 호출에서 돌려줄 오류 */
  alwaysError: FakeError | null = null;
  private clock = Date.parse("2026-11-05T00:00:00.000Z");

  nextCreatedAt(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
}

type AuthMode = { sub: string | null } | { claimsError: true } | { claimsThrow: true };

export function fakeClient(db: FakeDb, auth: AuthMode): SupabaseClient {
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
      if (table !== "todos") throw new Error("unexpected table");
      const call: FakeCall = { op: "select", filters: [], orders: [] };
      let returning = false;

      const run = (): { data: unknown; error: FakeError | null } => {
        db.calls.push(call);
        if (db.alwaysError) return { data: null, error: db.alwaysError };
        const visible = (r: FakeRow) => viewer !== null && r.user_id === viewer; // RLS USING
        const matches = (r: FakeRow) => call.filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v);

        if (call.op === "insert") {
          if (db.insertError) {
            const error = db.insertError;
            db.insertError = null;
            return { data: null, error };
          }
          const p = call.payload as Partial<FakeRow>;
          if (!viewer || p.user_id !== viewer) return { data: null, error: { code: "42501" } }; // WITH CHECK
          if (db.rows.some((r) => r.id === p.id)) return { data: null, error: { code: "23505" } }; // 기본 키
          const row: FakeRow = {
            id: String(p.id),
            user_id: String(p.user_id),
            day: String(p.day),
            text_encrypted: String(p.text_encrypted),
            done: Boolean(p.done ?? false),
            created_at: db.nextCreatedAt(),
          };
          db.rows.push(row);
          return { data: returning ? [{ ...row }] : null, error: null };
        }

        const hits = db.rows.filter((r) => visible(r) && matches(r));
        if (call.op === "update") {
          for (const r of hits) Object.assign(r, call.payload);
          return { data: returning ? hits.map((r) => ({ ...r })) : null, error: null };
        }
        // order()를 부른 만큼만 정렬한다. 부르지 않으면 넣은 순서 그대로라, order 줄을 지우면 순서 시험이 깨진다.
        const sorted = [...hits].sort((x, y) => {
          for (const [column, ascending] of call.orders) {
            const a = String((x as Record<string, unknown>)[column]);
            const b = String((y as Record<string, unknown>)[column]);
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
