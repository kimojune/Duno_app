import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * 통합 시험용 환경 변수 읽기.
 * Vitest는 NODE_ENV=test라 Next의 env 로더가 .env.local을 읽지 않는다.
 * 그래서 Node 내장 parseEnv로 duno/.env.local을 직접 읽는다(process.env는 바꾸지 않는다).
 * 파일에 없으면 process.env 값을 쓴다. 값이 하나라도 없으면 이름만 담아 던진다(값은 찍지 않는다).
 */
export const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DUNO_TEST_A_EMAIL",
  "DUNO_TEST_A_PASSWORD",
  "DUNO_TEST_B_EMAIL",
  "DUNO_TEST_B_PASSWORD",
] as const;

export type IntegrationEnv = Record<(typeof REQUIRED_ENV)[number], string>;

export function loadIntegrationEnv(envFile = path.resolve(__dirname, "../../.env.local")): IntegrationEnv {
  const fromFile: Record<string, string | undefined> = existsSync(envFile)
    ? parseEnv(readFileSync(envFile, "utf8"))
    : {};

  const values: Partial<IntegrationEnv> = {};
  const missing: string[] = [];
  for (const name of REQUIRED_ENV) {
    const value = (fromFile[name] ?? process.env[name])?.trim();
    if (value) values[name] = value;
    else missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(`통합 시험 환경 변수가 없음: ${missing.join(", ")}`);
  }
  return values as IntegrationEnv;
}
