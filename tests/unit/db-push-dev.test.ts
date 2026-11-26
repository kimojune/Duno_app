import { describe, expect, it } from "vitest";
import { DEV_PROJECT_REF, isDevDbUrl } from "../../scripts/db-push-dev.mjs";

describe("isDevDbUrl — 개발 DB만 통과시킨다", () => {
  it("직접 주소의 개발 DB를 받는다", () => {
    expect(isDevDbUrl(`postgresql://postgres:pw@db.${DEV_PROJECT_REF}.supabase.co:5432/postgres`)).toBe(true);
  });

  it("풀러 주소의 개발 DB 사용자명을 받는다", () => {
    expect(isDevDbUrl(`postgresql://postgres.${DEV_PROJECT_REF}:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`)).toBe(true);
  });

  it("다른 프로젝트(운영 DB 등)는 막는다", () => {
    expect(isDevDbUrl("postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres")).toBe(false);
    expect(isDevDbUrl("postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres")).toBe(false);
  });

  it("ref가 비밀번호·경로·질의에만 있으면 막는다", () => {
    const refAsPassword = new URL("postgresql://db.abcdefghijklmnopqrst.supabase.co:5432/postgres");
    refAsPassword.username = "postgres";
    refAsPassword.password = DEV_PROJECT_REF;
    expect(isDevDbUrl(refAsPassword.href)).toBe(false);
    expect(isDevDbUrl(`postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/${DEV_PROJECT_REF}`)).toBe(false);
    expect(isDevDbUrl(`postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?x=db.${DEV_PROJECT_REF}.supabase.co`)).toBe(false);
  });

  it("비었거나 형식이 틀리면 막는다", () => {
    expect(isDevDbUrl(undefined)).toBe(false);
    expect(isDevDbUrl("")).toBe(false);
    expect(isDevDbUrl("not a url")).toBe(false);
    expect(isDevDbUrl(`https://db.${DEV_PROJECT_REF}.supabase.co`)).toBe(false);
  });
});
