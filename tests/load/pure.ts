/**
 * 체험 코드 부하 시험의 순수 부분(네트워크·파일·브라우저 없음). 실행 스크립트(run.ts)와 단위 시험(tests/unit/load-pure.test.ts)이 같이 쓴다.
 * 이 파일은 Node의 타입 지우기로도 돌아야 하므로 enum·parameter property를 쓰지 않는다.
 */

export const PROD_TARGET = "https://duno-app-iota.vercel.app";
/** 체험 코드를 담은 환경 변수 이름(앱 코드 lib/server-config.ts 가 쓰는 이름 그대로). 값은 어디에도 적지 않는다. */
export const CODE_ENV_NAME = "DEMO_ACCESS_CODE";
/** 단계 문맥 수 합의 기본 상한(임시, PM 결정 필요: Supabase 익명 로그인 한도 시간당 100) */
export const DEFAULT_MAX_TOTAL = 100;
export const DEFAULT_STAGES = [5, 15, 30, 50];
/** 단계 실패 비율이 이 값을 넘으면(10%보다 많으면) 다음 단계로 가지 않는다 */
export const FAIL_RATE_STOP = 0.1;
/** 문맥 하나의 총 시간 상한(밀리초, 임시). 넘으면 그 문맥은 시간 초과 실패이고 재시도하지 않는다 */
export const CONTEXT_TIMEOUT_MS = 90_000;
export const MASK = "[가림]";

// ---------- 인자 ----------

export type TargetCheck = { ok: true; origin: string } | { ok: false; reason: string };

/** 허용 목록: 운영 주소와 http://localhost:<포트>. 그 밖은 모두 거절(경로·쿼리·계정 정보 포함). 끝의 슬래시 하나만 봐준다. */
export function checkTarget(raw: string): TargetCheck {
  const text = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (text === PROD_TARGET) return { ok: true, origin: PROD_TARGET };
  const m = /^http:\/\/localhost:(\d{1,5})$/.exec(text);
  if (m) {
    const port = Number(m[1]);
    if (port >= 1 && port <= 65535) return { ok: true, origin: `http://localhost:${port}` };
  }
  return { ok: false, reason: `허용하지 않는 주소예요. 운영(${PROD_TARGET}) 또는 http://localhost:<포트> 만 받아요.` };
}

export type StagesCheck = { ok: true; stages: number[]; total: number } | { ok: false; reason: string };

/** "5,15,30,50" → 단계 목록. 양의 정수만, 단계는 1~20개, 합이 maxTotal을 넘으면 거절. */
export function checkStages(raw: string, maxTotal: number): StagesCheck {
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.length < 1 || parts.length > 20) return { ok: false, reason: "단계는 1~20개예요." };
  const stages: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,4}$/.test(p)) return { ok: false, reason: `단계 값이 양의 정수가 아니에요: ${p.slice(0, 20)}` };
    const n = Number(p);
    if (n < 1) return { ok: false, reason: "단계 값은 1 이상이에요." };
    stages.push(n);
  }
  const total = stages.reduce((a, b) => a + b, 0);
  if (total > maxTotal) return { ok: false, reason: `문맥 수 합 ${total}이 상한 ${maxTotal}을 넘어요(익명 로그인 한도).` };
  return { ok: true, stages, total };
}

export type CliArgs = {
  target: string;
  stages: number[];
  total: number;
  yes: boolean;
  build: string;
  maxTotal: number;
};

export type ParsedArgs = { ok: true; args: CliArgs } | { ok: false; reason: string };

/** 판 해시 칸: 짧은 글자·숫자·점·밑줄·붙임표만(결과 파일에 그대로 적히므로) */
export function checkBuild(raw: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(raw);
}

/**
 * 인자 읽기. 모르는 인자·값 없는 인자는 거절. --yes 가 없으면 args.yes=false(계획만 찍고 끝나라는 뜻).
 * 인자는 데이터로만 쓴다(명령으로 풀지 않는다).
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let target = "";
  let stagesRaw = DEFAULT_STAGES.join(",");
  let yes = false;
  let build = "";
  let maxTotal = DEFAULT_MAX_TOTAL;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes") {
      yes = true;
      continue;
    }
    if (a === "--target" || a === "--stages" || a === "--build" || a === "--max-total") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return { ok: false, reason: `${a} 뒤에 값이 없어요.` };
      i += 1;
      if (a === "--target") target = v;
      else if (a === "--stages") stagesRaw = v;
      else if (a === "--build") build = v;
      else {
        if (!/^\d{1,4}$/.test(v) || Number(v) < 1) return { ok: false, reason: "--max-total 은 1 이상의 정수예요." };
        maxTotal = Number(v);
      }
      continue;
    }
    return { ok: false, reason: `모르는 인자: ${a.slice(0, 30)}` };
  }
  if (target === "") return { ok: false, reason: "--target 이 필요해요(운영 주소 또는 http://localhost:<포트>)." };
  const t = checkTarget(target);
  if (!t.ok) return { ok: false, reason: t.reason };
  const s = checkStages(stagesRaw, maxTotal);
  if (!s.ok) return { ok: false, reason: s.reason };
  if (build !== "" && !checkBuild(build)) return { ok: false, reason: "--build 는 글자·숫자·점·밑줄·붙임표 64자까지예요." };
  return { ok: true, args: { target: t.origin, stages: s.stages, total: s.total, yes, build, maxTotal } };
}

// ---------- 비밀값 가리기 ----------

/**
 * 글 안의 체험 코드 값을 모두 가린다(결과·요약·콘솔에 쓰기 전에 모든 문자열이 지난다).
 * 값 그대로 · 대문자 · 소문자 · 주소 인코딩 꼴을 가린다. 값이 비었으면 아무것도 하지 않는다(호출 쪽이 시작 전에 막는다).
 */
export function redact(text: string, secret: string): string {
  const s = secret.trim();
  if (s === "") return text;
  const variants = new Set([s, s.toUpperCase(), s.toLowerCase(), encodeURIComponent(s), encodeURIComponent(s.toUpperCase())]);
  let out = text;
  // 긴 것부터 바꿔 한 변형이 다른 변형의 일부를 남기지 않게
  for (const v of [...variants].sort((a, b) => b.length - a.length)) {
    if (v !== "") out = out.split(v).join(MASK);
  }
  return out;
}

/** 값을 가리는 쪽에서 쓰는 한 줄 줄이기: 첫 줄만, 길이 상한 */
export function oneLine(text: string, max = 200): string {
  const first = text.split(/\r?\n/)[0] ?? "";
  return first.length > max ? first.slice(0, max) + "…" : first;
}

/**
 * .env 글에서 NAME 값을 꺼낸다. 처리: 앞 공백 · `export ` 앞머리 · 앞뒤 따옴표(짝이 맞을 때, 안의 #은 값) ·
 * 따옴표 없는 값의 줄 끝 주석(공백 뒤 #). 없거나 비면 "". 값을 돌려줄 뿐 어디에도 쓰지 않는다.
 */
export function readEnvValue(fileText: string, name: string): string {
  for (const raw of fileText.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line.startsWith(`${name}=`)) continue;
    let v = line.slice(name.length + 1).trim();
    const q = v[0];
    if (q === '"' || q === "'") {
      const end = v.indexOf(q, 1);
      return end === -1 ? v.slice(1).trim() : v.slice(1, end);
    }
    const hash = v.search(/\s#/);
    if (hash !== -1) v = v.slice(0, hash);
    return v.trim();
  }
  return "";
}

/** 체험 화면의 오류 글이 정말 있는가: 글이 공백뿐이거나 비면(Next 경로 안내기 같은 빈 알림) 실패로 보지 않는다. */
export function isScreenErrorText(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim() !== "";
}

// ---------- 응답 코드 ----------

/** 응답 주소 → 「호스트 경로」(쿼리 문자열·조각 없음). 읽을 수 없으면 "(알 수 없는 주소)". */
export function pathKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "(알 수 없는 주소)";
  }
}

export function isErrorStatus(status: number): boolean {
  return status >= 400 && status <= 599;
}

export function isLimitStatus(status: number): boolean {
  return status === 429;
}

const LIMIT_TEXT = /한도|잠시 막|rate.?limit|too many|over_request/i;
/** 화면 글이 한도 초과를 가리키는가(앱 문구 「여러 번 틀려서 잠시 막았어요」 포함) */
export function isLimitText(text: string): boolean {
  return LIMIT_TEXT.test(text);
}

// ---------- 통계 ----------

/** 가까운 순위(nearest-rank) 백분위. 빈 목록은 null. p는 0~100. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type FailKind = "screen_error" | "http_status" | "timeout" | "other";

export type ContextResult = {
  ok: boolean;
  /** 들어가기까지 시간(밀리초). 실패면 null */
  enterMs: number | null;
  failKind: FailKind | null;
  limitHit: boolean;
};

export type StageStop = { stop: boolean; reason: string | null };

/** 멈춤 규칙: 한도 초과가 하나라도 있으면, 또는 실패가 10%보다 많으면 멈춘다. 한도 초과를 먼저 본다. */
export function decideStop(results: ContextResult[]): StageStop {
  if (results.some((r) => r.limitHit)) return { stop: true, reason: "한도 초과 신호(429 · 한도 글)가 보여 멈춤" };
  if (results.length === 0) return { stop: true, reason: "결과가 없어 멈춤" };
  const failed = results.filter((r) => !r.ok).length;
  if (failed / results.length > FAIL_RATE_STOP) {
    return { stop: true, reason: `실패 ${failed}/${results.length}(${Math.round((failed / results.length) * 100)}%)가 10%를 넘어 멈춤` };
  }
  return { stop: false, reason: null };
}

export type StageSummary = {
  size: number;
  ok: number;
  failed: number;
  failKinds: Record<FailKind, number>;
  enterMedianMs: number | null;
  enterP95Ms: number | null;
};

export function summarizeStage(results: ContextResult[]): StageSummary {
  const failKinds: Record<FailKind, number> = { screen_error: 0, http_status: 0, timeout: 0, other: 0 };
  for (const r of results) if (!r.ok && r.failKind) failKinds[r.failKind] += 1;
  const times = results.filter((r) => r.ok && r.enterMs !== null).map((r) => r.enterMs as number);
  return {
    size: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    failKinds,
    enterMedianMs: median(times),
    enterP95Ms: percentile(times, 95),
  };
}

/** 응답 코드 세기: 「status 호스트/경로」 → 횟수 */
export function countStatuses(list: { status: number; url: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of list) {
    if (!isErrorStatus(r.status)) continue;
    const key = `${r.status} ${pathKey(r.url)}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
