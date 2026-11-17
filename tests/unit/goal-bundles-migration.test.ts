import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 마이그레이션 20261117100000_goal_bundles.sql 글을 읽어 안전 장치를 정적으로 단언한다(DB 없이 돈다).
 * 행동(RLS가 실제로 막는지)은 supabase/tests/goal_bundles.test.sql(pgTAP)과 tests/integration/goal-bundles-rls.test.ts가 본다 — 둘 다 미실행.
 */

const ROOT = path.resolve(__dirname, "../..");
const SQL = readFileSync(path.join(ROOT, "supabase/migrations/20261117100000_goal_bundles.sql"), "utf8");
const DOWN = readFileSync(path.join(ROOT, "supabase/rollback/20261117100000_goal_bundles.down.sql"), "utf8");

/** 주석(-- …)을 뺀 글 */
const code = SQL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

type Fn = { name: string; header: string; body: string; definer: boolean };
function functions(): Fn[] {
  const out: Fn[] = [];
  const re = /create\s+function\s+([a-z_.]+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\$\$([\s\S]*?)\$\$\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const header = m[0].slice(0, m[0].indexOf("$$"));
    out.push({ name: m[1], header, body: m[3], definer: /security\s+definer/i.test(header) });
  }
  return out;
}
const FNS = functions();
const DEFINERS = FNS.filter((f) => f.definer);

describe("goal_bundles 마이그레이션: 정적 안전 장치", () => {
  it("함수를 찾았다(정규식이 빈 손이 아니다)", () => {
    expect(FNS.map((f) => f.name)).toEqual(
      expect.arrayContaining(["public.save_goal_bundle", "public.set_restart_requested", "private.categories_assign_color_order", "private.doono_day"]),
    );
    expect(DEFINERS.map((f) => f.name).sort()).toEqual(["public.save_goal_bundle", "public.set_restart_requested"]);
  });

  it("security definer 함수마다 search_path가 빈 값으로 고정된다", () => {
    for (const f of DEFINERS) expect(f.header, f.name).toMatch(/set\s+search_path\s*=\s*''/i);
  });

  it("함수는 모두(definer가 아니어도) search_path를 빈 값으로 고정한다", () => {
    for (const f of FNS) expect(f.header, f.name).toMatch(/set\s+search_path\s*=\s*''/i);
  });

  it("definer 함수는 auth.uid()가 null이면 거절하고, 사용자 id를 인자로 받지 않는다", () => {
    for (const f of DEFINERS) {
      expect(f.body, f.name).toMatch(/auth\.uid\(\)\s+is\s+null/i);
      expect(f.body, f.name).toMatch(/errcode\s*=\s*'28000'/);
      expect(f.header, f.name).not.toMatch(/p_user|p_uid|user_id/i);
    }
  });

  it("definer 함수의 쓰기·읽기는 모두 user_id = auth.uid()(v_uid)로 제한된다", () => {
    const body = DEFINERS.find((f) => f.name === "public.save_goal_bundle")!.body;
    // categories·category_ratios·goal_bundles·user_settings에 대한 delete·update·select는 모두 user_id 조건을 가진다
    const statements = body.split(";").filter((s) => /\b(update|delete\s+from|select\s+\*?[\s\S]*?from)\s+public\.(categories|category_ratios|goal_bundles|user_settings|category_ratio_history)\b/i.test(s));
    expect(statements.length).toBeGreaterThan(5);
    for (const s of statements) expect(s, s.trim().slice(0, 80)).toMatch(/user_id\s*=\s*v_uid/);
  });

  it("함수 안에서 동적 SQL(execute format)을 쓰지 않는다", () => {
    for (const f of FNS) {
      expect(f.body, f.name).not.toMatch(/\bexecute\b/i);
      expect(f.body, f.name).not.toMatch(/\bformat\s*\(/i);
    }
  });

  it("definer 함수는 execute를 public·anon에서 거두고 authenticated에만 준다", () => {
    for (const f of DEFINERS) {
      const sig = f.name.replace(/\./g, "\\.") + "\\s*\\([^)]*\\)";
      expect(code, f.name).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${sig}\\s+from\\s+public`, "i"));
      expect(code, f.name).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${sig}\\s+from\\s+anon`, "i"));
      expect(code, f.name).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${sig}\\s+to\\s+authenticated\\s*;`, "i"));
      expect(code, f.name).not.toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${sig}\\s+to\\s+(public|anon)`, "i"));
    }
  });

  it("private 도우미·트리거 함수는 execute를 모두 거둔다(어떤 역할에도 주지 않는다)", () => {
    for (const f of FNS.filter((x) => x.name.startsWith("private."))) {
      const sig = f.name.replace(/\./g, "\\.") + "\\s*\\([^)]*\\)";
      for (const role of ["public", "anon", "authenticated"]) {
        expect(code, `${f.name} ${role}`).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${sig}\\s+from\\s+${role}`, "i"));
      }
    }
    expect(code).not.toMatch(/grant\s+execute\s+on\s+function\s+private\./i);
  });

  it("goal_bundles는 RLS를 켜고 authenticated에 select만 준다(insert·update·delete grant 없음)", () => {
    expect(code).toMatch(/alter\s+table\s+public\.goal_bundles\s+enable\s+row\s+level\s+security/i);
    expect(code).toMatch(/revoke\s+all\s+on\s+table\s+public\.goal_bundles\s+from\s+public/i);
    expect(code).toMatch(/revoke\s+all\s+on\s+table\s+public\.goal_bundles\s+from\s+anon/i);
    expect(code).toMatch(/revoke\s+all\s+on\s+table\s+public\.goal_bundles\s+from\s+authenticated/i);
    const grants = [...code.matchAll(/grant\s+([^;]*?)\s+on\s+table\s+public\.goal_bundles\s+to\s+([a-z_]+)/gi)];
    expect(grants.map((g) => [g[1].trim().toLowerCase(), g[2].toLowerCase()])).toEqual([["select", "authenticated"]]);
  });

  it("goal_bundles 정책은 select 하나뿐이고 (select auth.uid()) 꼴·to authenticated다", () => {
    const policies = [...code.matchAll(/create\s+policy\s+(\w+)\s+on\s+public\.goal_bundles\s+for\s+(\w+)\s+to\s+(\w+)([\s\S]*?);/gi)];
    expect(policies.map((p) => [p[1], p[2].toLowerCase(), p[3].toLowerCase()])).toEqual([["goal_bundles_select_own", "select", "authenticated"]]);
    expect(policies[0][4]).toMatch(/\(select\s+auth\.uid\(\)\)\s*=\s*user_id/i);
  });

  it("categories에 update·delete grant를 열지 않는다(이 파일에서 categories grant가 없다)", () => {
    expect(code).not.toMatch(/grant\s+[^;]*\bon\s+table\s+public\.categories\b/i);
    expect(code).not.toMatch(/create\s+policy\s+\w+\s+on\s+public\.categories/i);
  });

  it("user_settings의 새 칸(고침 번호·op id·묶음 시작·다시 시작 표시)은 insert·update grant에 넣지 않는다", () => {
    expect(code).not.toMatch(/grant\s+(insert|update)\s*\([^)]*\)\s+on\s+table\s+public\.user_settings/i);
  });

  it("지난 묶음 상한 1000·분야 목록 50칸·입력 16KB가 임시값으로 표시돼 있다", () => {
    expect(SQL).toMatch(/c_past_limit\s+constant\s+integer\s*:=\s*1000;\s*--\s*임시, 결정 필요/);
    expect(SQL).toMatch(/c_items_max\s+constant\s+integer\s*:=\s*50;\s*--\s*임시, 결정 필요/);
    expect(SQL).toMatch(/c_items_bytes\s+constant\s+integer\s*:=\s*16384;\s*--\s*임시, 결정 필요/);
  });

  it("판 행의 비율은 합 100, 암호문 형식·길이, reason은 edit·restart만 허용한다", () => {
    expect(code).toMatch(/goal_bundle_ratios_sum\(ratios\)\s*=\s*100/);
    expect(code).toMatch(/reason\s+in\s+\('edit',\s*'restart'\)/);
    expect(code).toMatch(/goal_encrypted\s+~\s+'\^v\[1-9\]/);
    expect(code).toMatch(/char_length\(goal_encrypted\)\s*<=\s*1024/);
  });

  it("지난 묶음 표에 판 번호 칸·부분 유일 인덱스가 없다(지난 것만 쌓는다)", () => {
    const table = code.slice(code.indexOf("create table public.goal_bundles"), code.indexOf("create index goal_bundles_user_ended_idx"));
    expect(table).not.toMatch(/bundle_no/);
    expect(code).not.toMatch(/create\s+unique\s+index[^;]*goal_bundles/i);
  });

  it("함수는 충돌 검사를 아무것도 바꾸기 전에 한다(검사 줄이 첫 표 쓰기보다 앞)", () => {
    const body = DEFINERS.find((f) => f.name === "public.save_goal_bundle")!.body;
    const conflict = body.indexOf("bundle_conflict");
    expect(conflict).toBeGreaterThan(0);
    const firstWriteAfterLock = body.search(/update\s+public\.user_settings\s+u\s+set\s+onboarding_done_at/i);
    expect(conflict).toBeLessThan(firstWriteAfterLock);
    const idem = body.indexOf("idempotent");
    expect(idem).toBeLessThan(conflict); // 같은 op 재전송이 충돌보다 먼저
  });

  it("되돌리는 SQL이 함수·표·새 칸·색 칸을 모두 지우고 dump 안내가 머리에 있다", () => {
    expect(DOWN.split("\n").slice(0, 8).join("\n")).toMatch(/dump/);
    for (const needle of [
      "drop function if exists public.save_goal_bundle",
      "drop function if exists public.set_restart_requested",
      "drop table if exists public.goal_bundles",
      "drop column if exists color_order",
      "drop column if exists bundle_started_at",
      "drop column if exists restart_requested_at",
      "drop column if exists bundle_revision",
      "drop column if exists bundle_op_ids",
      "drop trigger if exists categories_assign_color_order",
    ]) {
      expect(DOWN, needle).toContain(needle);
    }
  });
});
