#!/usr/bin/env node
// 비밀 검사 — git diff의 추가된 줄에서 키 모양 문자열을 찾는다. 의존성 없음(Node 18+).
//
// 쓰임
//   node secret-scan.mjs --staged                         지금 저장소의 staged diff
//   node secret-scan.mjs --range <base>...HEAD            지정한 범위(그 사이 커밋마다 본다)
//   node secret-scan.mjs --repo <경로> --range <a>...<b>  다른 작업 폴더(git -C)
//
// 종료 코드: 0 걸린 것 없음 · 1 걸림 · 2 검사 실패(git 오류, 인자 오류). 2를 통과로 치지 않는다.
// 출력: 값은 찍지 않는다. 규칙 이름과 파일:줄(범위 모드면 커밋 해시도)만 찍는다.
// 오탐이 확실한 줄은 그 줄에 `secret-scan:allow`를 적으면 건너뛰되, 「허용」 줄로 따로 찍는다.
//
// 규칙 출처: 이름에 [gitleaks]가 붙은 정규식은 gitleaks 기본 규칙
//   (https://github.com/gitleaks/gitleaks, config/gitleaks.toml, 커밋 5f6ec56 2026-10-23, MIT License,
//   Copyright (c) 2019 Zachary Rice)을 옮긴 것이다. 줄 단위 검사에 맞게 끝 경계 조건을 줄였다.
//   [자체]는 이 저장소가 정한 규칙이다. supabase-secret-key는 Supabase API 키 문서의 `sb_secret_` 접두사를 따른다(2026-11-04 확인).
//   Vercel 토큰은 공개된 값 형식을 확인하지 못해 값 규칙이 없다 — env-assignment가 이름(VERCEL_TOKEN 등)으로 잡는다.
//
// 이 저장소(Procrastinatio)에서: 설치·되돌리기·우회 금지는 .githooks/pre-commit 머리 주석을 본다.
// [AI 수정안] 22_개발 견본(SHA-256 bca6484376804037e52f6fcaf230d91cfba71539ab28888746df327491b5b60b, 7588바이트)에서
// 바꾼 것 (2026-11-04, 22_개발 팀장 작업 지시. 쓰임·종료 코드·값 안 찍기·secret-scan:allow는 견본과 같다):
//   1. env-assignment 「줄 첫머리 이름 = 값」: 이름이 대문자 스네이크(API_KEY 꼴)일 때만 본다. env·셸·설정 파일
//      (.env*, .envrc, .sh, .ini, .conf, .toml 등)에서는 견본처럼 이름의 대소문자를 가리지 않는다.
//      까닭: 들여쓴 JSX 속성 줄(key={…}, onKeyDown={…})이 이름=값으로 읽혀 archive/2026-11-04_예시/duno-app에서 14건 오탐.
//   2. env-assignment 「코드의 비밀 이름 = "값"」: JSX·HTML 꼴 파일에서 = 양옆에 빈칸 없는 key="…"(React 목록 key)와
//      on…="…"(이벤트 처리기) 속성은 비밀 이름으로 보지 않는다. 한 줄에 여러 개면 하나씩 본다(견본은 첫 번째만 봤다).
//   3. sk- 키 보조 규칙 [자체]: gitleaks 규칙이 못 잡는 꼴(정해진 길이·중간 표식이 없는 sk-ant-…, sk-proj-… 등,
//      접두사 없는 sk- + 32자 이상). 위 규칙이 하나도 안 걸린 줄에만 본다 — 같은 줄을 두 번 세지 않는다.
//   4. 비밀 파일 이름: diff의 +++ 줄 대신 바뀐 파일 목록으로 본다. 빈 파일·바이너리·이름 바꾸기(git mv로 .env)도 걸린다.
//      diff는 --no-renames로 뽑아 이름을 바꾼 파일의 내용도 다시 본다. 「파일 N개」는 이 목록(지운 파일 뺌)의 수다.
//   5. diff 머리줄은 diff --git 과 첫 @@ 사이에서만 읽는다. 견본은 「++」로 시작하는 내용 줄을 파일 이름 줄로 읽거나 건너뛰었다.
//   6. 예상 못 한 오류는 종료 코드 2(검사 실패)로 끝낸다. 견본은 node 기본값 1이라 「걸림」과 섞였다.

import { spawnSync } from 'node:child_process';

process.on('uncaughtException', e => {
  console.error(`secret-scan: 검사 실패 — 예상 못 한 오류: ${e?.message ?? e}`);
  process.exit(2);
});

const RULES = [
  ['anthropic-api-key [gitleaks]', /\bsk-ant-api03-[a-zA-Z0-9_\-]{93}AA/],
  ['anthropic-admin-api-key [gitleaks]', /\bsk-ant-admin01-[a-zA-Z0-9_\-]{93}AA/],
  ['openai-api-key [gitleaks]', /\bsk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})\b|\bsk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}/],
  ['gcp-api-key [gitleaks]', /\bAIza[\w-]{35}/],
  ['github-pat [gitleaks]', /ghp_[0-9a-zA-Z]{36}/],
  ['github-fine-grained-pat [gitleaks]', /github_pat_\w{82}/],
  ['github-oauth [gitleaks]', /gho_[0-9a-zA-Z]{36}/],
  ['github-app-token [gitleaks]', /(?:ghu|ghs)_[0-9a-zA-Z]{36}/],
  ['aws-access-token [gitleaks]', /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/],
  ['jwt [gitleaks]', /\bey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9\/\\_-]{17,}\.(?:[a-zA-Z0-9\/\\_-]{10,}={0,2})?/],
  ['private-key [gitleaks, 첫 줄만]', /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/i],
  ['supabase-secret-key [자체]', /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ['connection-string-password [자체]', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:\/@'"`<>]+:[^\s@\/'"`<>]{3,}@[^\s'"`]+/i],
];

// gitleaks 규칙이 못 잡는 sk- 꼴(바꾼 것 3). RULES가 하나도 안 걸린 줄에만 본다.
const EXTRA_RULES = [
  ['anthropic-key-loose [자체]', /\bsk-ant-[a-z]+\d{2}-[A-Za-z0-9_-]{20,}/],
  ['openai-key-loose [자체]', /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/],
  ['sk-key-generic [자체]', /\bsk-[A-Za-z0-9]{32,}/],
];

// .env 꼴 KEY=값, 또는 코드의 비밀 이름 = "값". 이름이 비밀을 뜻하고 값이 자리표시자·변수 참조가 아닐 때만 잡는다.
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|PRIVATE|CREDENTIAL|DSN|DATABASE_URL|POSTGRES_URL|CONNECTION_STRING)/i;
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const CODE_LINE = /\b([A-Za-z_][A-Za-z0-9_]*(?:key|secret|token|password|passwd)[A-Za-z0-9_]*)(["']?\s*[:=]\s*)(["'`])([^"'`]{12,})\3/gi;
const PLACEHOLDER = /^(<[^>]*>|\$\{?[A-Za-z_][^}]*\}?|x+|\*+|\.\.\.|changeme|change_me|your[-_].*|example.*|dummy.*|test|null|none|true|false|\d{1,6}|.*(\.\.\.|…|xxx|XXX))$/i;
const ENV_READ = /process\.env|import\.meta\.env|Deno\.env|os\.environ|getenv|env\(/;
// 바꾼 것 1: 줄 첫머리 「이름 = 값」은 대문자 스네이크 이름만. env·셸·설정 파일에서는 대소문자를 가리지 않는다.
const UPPER_NAME = /^[A-Z_][A-Z0-9_]*$/;
const CONFIG_FILE = /(^|\/)\.env(\.[^\/]*)?$|(^|\/)\.envrc$|\.(env|sh|bash|zsh|ksh|ini|cfg|conf|properties|toml)$/i;
// 바꾼 것 2: JSX·HTML 꼴 파일의 key="…"·on…="…" 속성은 비밀 이름으로 보지 않는다.
const MARKUP_FILE = /\.(jsx|tsx|js|mjs|cjs|html?|vue|svelte|astro|mdx)$/i;
const MARKUP_ATTR = /^(key|on[A-Za-z]+)$/;

function envAssignment(line, file) {
  const m = line.match(ENV_LINE);
  if (m && SECRET_NAME.test(m[1]) && (UPPER_NAME.test(m[1]) || CONFIG_FILE.test(file))) {
    let v = m[2].trim().replace(/\s+#.*$/, '');
    v = v.replace(/^(["'])(.*)\1$/, '$2').trim();
    if (v.length >= 8 && !PLACEHOLDER.test(v) && !ENV_READ.test(v)) return true;
  }
  for (const c of line.matchAll(CODE_LINE)) {
    const [, name, sep, quote, value] = c;
    const before = c.index > 0 ? line[c.index - 1] : '';
    if (MARKUP_FILE.test(file) && sep === '=' && quote !== '`' && MARKUP_ATTR.test(name) && !/[\w$.-]/.test(before)) continue;
    if (!PLACEHOLDER.test(value.trim()) && !ENV_READ.test(line) && !/\s/.test(value)) return true;
  }
  return false;
}

// 비밀 파일 이름 — 내용과 상관없이 올라가면 걸린다. 예시 파일은 뺀다.
const SECRET_FILE = /(^|\/)\.env(\.[^\/]*)?$|\.(pem|key|p12|pfx|jks|keystore)$|service-account[^\/]*\.json$|firebase-adminsdk[^\/]*\.json$/i;
const SAMPLE_FILE = /\.(example|sample|template|dist)$/i;

// --- 인자
const argv = process.argv.slice(2);
const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const repo = val('--repo');
const range = val('--range');
const staged = argv.includes('--staged');
if ((staged ? 1 : 0) + (range ? 1 : 0) !== 1 || (argv.includes('--range') && !range) || (argv.includes('--repo') && !repo)) {
  console.error('secret-scan: 쓰임 — --staged 또는 --range <base>...<head> 중 하나, 필요하면 --repo <경로>');
  process.exit(2);
}

const git = (...a) => {
  const r = spawnSync('git', [...(repo ? ['-C', repo] : []), '-c', 'core.quotepath=false', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) { console.error(`secret-scan: 검사 실패 — git ${a.join(' ')}: ${(r.stderr || r.error?.message || '').trim()}`); process.exit(2); }
  return r.stdout;
};
// 바꾼 것 4: 바뀐 파일 목록(지운 파일 뺌). 이름 규칙은 이 목록으로 본다.
const NAMES = ['--name-only', '-z', '--no-renames', '--diff-filter=d'];
const nameList = out => out.split('\0').map(s => s.replace(/^\n+/, '')).filter(Boolean);

// --- 볼 diff 모으기. 범위 모드는 커밋마다 본다 — 뒤 커밋에서 지운 비밀도 이력에는 남기 때문이다.
const units = [];
let header;
if (staged) {
  const head = spawnSync('git', [...(repo ? ['-C', repo] : []), 'rev-parse', '--verify', '-q', 'HEAD'], { encoding: 'utf8' });
  header = `staged · HEAD ${head.status === 0 ? head.stdout.trim() : '(첫 커밋 전)'}`;
  units.push({
    commit: null,
    names: nameList(git('diff', '--cached', ...NAMES)),
    diff: git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--no-renames'),
  });
} else {
  const [a, b] = range.includes('...') ? range.split('...') : range.split('..');
  if (!a || !b) { console.error('secret-scan: --range는 <base>...<head> 꼴이어야 한다'); process.exit(2); }
  const baseSha = git('merge-base', a, b).trim();
  const headSha = git('rev-parse', b).trim();
  header = `range ${range} · base ${baseSha} · HEAD ${headSha}`;
  const commits = git('rev-list', '--reverse', `${baseSha}..${headSha}`).split(/\r?\n/).filter(Boolean);
  for (const c of commits) units.push({
    commit: c.slice(0, 12),
    names: nameList(git('show', '--format=', ...NAMES, '-m', '--first-parent', c)),
    diff: git('show', '--format=', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '-m', '--first-parent', c),
  });
}

// --- 검사
const hits = [], allowed = [];
let files = new Set();
for (const { commit, names, diff } of units) {
  for (const f of names) {
    files.add(f);
    if (SECRET_FILE.test(f) && !SAMPLE_FILE.test(f)) hits.push({ rule: 'secret-file-name [자체]', where: f, commit });
  }
  // 바꾼 것 5: 머리줄(diff --git ~ 첫 @@)에서만 +++ 를 파일 이름으로 읽는다.
  let file = '', line = 0, inHeader = false;
  for (const l of diff.split(/\r?\n/)) {
    if (l.startsWith('diff --git ')) { inHeader = true; file = ''; continue; }
    const h = l.match(/^@@ [^+]*\+(\d+)/);
    if (h) { inHeader = false; line = Number(h[1]); continue; }
    if (inHeader) {
      if (l.startsWith('+++ ')) file = l.slice(4).replace(/\t$/, '').replace(/^"(.*)"$/, '$1').replace(/^b\//, '');
      continue;
    }
    if (!l.startsWith('+')) continue;
    const body = l.slice(1);
    const where = `${file}:${line}`;
    line++;
    let found = RULES.filter(([, re]) => re.test(body)).map(([n]) => n);
    if (!found.length) found = EXTRA_RULES.filter(([, re]) => re.test(body)).map(([n]) => n);
    if (!found.length && envAssignment(body, file)) found.push('env-assignment [자체]');
    if (!found.length) continue;
    if (/secret-scan:allow/.test(body)) { allowed.push({ rule: found.join(', '), where, commit }); continue; }
    for (const rule of found) hits.push({ rule, where, commit });
  }
}

console.log(`secret-scan: ${header} · 파일 ${files.size}개 · 걸림 ${hits.length}건 · 허용 ${allowed.length}건`);
for (const h of hits) console.log(`  걸림 ${h.rule} ${h.where}${h.commit ? ' @' + h.commit : ''}`);
for (const h of allowed) console.log(`  허용 ${h.rule} ${h.where}${h.commit ? ' @' + h.commit : ''}`);
process.exit(hits.length ? 1 : 0);
