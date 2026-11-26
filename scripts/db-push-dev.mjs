// 마이그레이션을 개발 DB(duno-dev)에만 적용하는 스크립트(AI와 사람이 같이 쓴다).
//   npm run db:push:dev               적용
//   npm run db:push:dev -- --dry-run  적용될 파일만 본다
// 접속 문자열은 .env.local의 DEV_DB_URL에서 읽는다. 화면·기록에 내지 않는다.
// 문자열에 개발 DB 프로젝트 ref가 없으면 아무것도 하지 않고 멈춘다(운영 DB 보호).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEV_PROJECT_REF = "tkowlkdkghhmdhhyyhwg";

/** 접속 문자열이 개발 DB를 가리키는지. 직접 주소(db.<ref>.supabase.co)와 풀러 사용자명(postgres.<ref>) 둘 다 받는다 */
export function isDevDbUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return false;
  const host = url.hostname.toLowerCase();
  const user = decodeURIComponent(url.username).toLowerCase();
  return host === `db.${DEV_PROJECT_REF}.supabase.co` || user === `postgres.${DEV_PROJECT_REF}`;
}

/** .env.local을 찾는다: 지금 폴더, 없으면 본 폴더(worktree의 원래 저장소) */
function findEnvFile() {
  const here = resolve(".env.local");
  if (existsSync(here)) return here;
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  if (r.status === 0) {
    const main = join(dirname(r.stdout.trim()), ".env.local");
    if (existsSync(main)) return main;
  }
  return null;
}

function main(args) {
  const envFile = findEnvFile();
  if (envFile) process.loadEnvFile(envFile);
  const url = process.env.DEV_DB_URL;
  if (!isDevDbUrl(url)) {
    console.error(`멈춤: DEV_DB_URL이 없거나 개발 DB(${DEV_PROJECT_REF})를 가리키지 않는다. .env.local을 확인한다(값은 출력하지 않는다).`);
    return 1;
  }
  const dryRun = args.includes("--dry-run");
  const cliArgs = ["supabase", "db", "push", "--db-url", url, ...(dryRun ? ["--dry-run"] : [])];
  console.log(`개발 DB(${DEV_PROJECT_REF})에 마이그레이션${dryRun ? "을 미리 본다" : "을 적용한다"}.`);
  const r = spawnSync("npx", cliArgs, { stdio: "inherit", shell: process.platform === "win32" });
  return r.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
