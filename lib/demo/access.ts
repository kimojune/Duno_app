import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 시연 체험 코드 확인(서버 전용). PM d-162 가: 「코드 입력받아서 가는 식」.
 * - 코드는 서버에서만 비교한다. 화면(클라이언트)은 「켜짐 여부」 boolean만 받는다.
 * - 비교는 일정 시간 비교: 두 값을 SHA-256으로 같은 길이(32바이트)로 만든 뒤 timingSafeEqual. 길이가 달라도 던지지 않고 같은 시간이 든다.
 * - 화면은 칸에서 대문자로 바꿔 보이지만, 서버는 화면을 믿지 않고 받은 값과 환경 변수 값을 같은 규칙(normalizeDemoCode)으로 맞춘 뒤 비교한다.
 * 이 파일은 코드 값·쓴 값을 로그에 남기지 않는다.
 */

/** 받는 글 상한(이보다 길면 비교하지 않고 틀린 코드로 본다) */
export const DEMO_CODE_MAX_LENGTH = 64;

/** 앞뒤 공백을 지우고 대문자로(23 S0: 칸은 영문·숫자, 대문자로 받음). 한 규칙을 화면과 서버가 같이 쓴다. */
export function normalizeDemoCode(value: string): string {
  return value.trim().toUpperCase();
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** 일정 시간 비교. 길이가 달라도(빈 값 포함) 예외 없이 false. expected가 비면 늘 false(꺼진 입구). */
export function demoCodeMatches(input: unknown, expected: string | null): boolean {
  if (expected === null || expected === "") return false;
  if (typeof input !== "string" || input.length > DEMO_CODE_MAX_LENGTH) {
    // 형식이 틀려도 비교 한 번은 해서 걸리는 시간을 맞춘다
    timingSafeEqual(digest(""), digest(normalizeDemoCode(expected)));
    return false;
  }
  const a = digest(normalizeDemoCode(input));
  const b = digest(normalizeDemoCode(expected));
  const same = timingSafeEqual(a, b);
  // 빈 입력은 기대값이 비지 않은 이상 같을 수 없지만, 정규화 뒤 빈 값끼리 같아지는 길을 막는다
  return same && normalizeDemoCode(input).length > 0;
}

/**
 * 틀린 코드 한도(앱 수준, 임시값 — 결정 필요): 같은 IP 또는 같은 기기 쿠키에서 10분 안에 틀린 코드 5번이면 그 창이 끝날 때까지 막는다.
 * 한계(보고에 적음): 서버리스는 인스턴스마다 메모리가 따로라 인스턴스가 여럿이면 실제 한도는 그 배수가 된다. 재시작하면 셈이 지워진다.
 * IP는 Vercel이 덮어쓰는 x-forwarded-for의 첫 값을 쓴다. Vercel 밖(로컬·다른 프록시)에서는 그 헤더를 보내는 쪽이 정할 수 있다(위조 가능).
 * 기기 쿠키는 지우면 새로 받으므로 IP 한도가 함께 걸린다.
 */
export const DEMO_LIMIT_MAX_FAILURES = 5; // 임시, 결정 필요
export const DEMO_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 임시, 결정 필요
/** 메모리가 끝없이 늘지 않게 기억하는 열쇠 수 상한(넘으면 끝난 창부터 지우고, 그래도 넘으면 가장 오래된 것부터) */
const DEMO_LIMIT_MAX_KEYS = 10_000;

type Bucket = { windowStart: number; failures: number };

export class DemoAttemptLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  constructor(maxFailures = DEMO_LIMIT_MAX_FAILURES, windowMs = DEMO_LIMIT_WINDOW_MS) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  private live(key: string, now: number): Bucket | null {
    const bucket = this.buckets.get(key);
    if (!bucket) return null;
    if (now - bucket.windowStart >= this.windowMs) {
      this.buckets.delete(key);
      return null;
    }
    return bucket;
  }

  /** 열쇠 가운데 하나라도 한도에 닿았으면 true(막음) */
  isBlocked(keys: string[], now: number): boolean {
    return keys.some((key) => (this.live(key, now)?.failures ?? 0) >= this.maxFailures);
  }

  /** 틀린 코드 한 번을 모든 열쇠에 센다 */
  recordFailure(keys: string[], now: number): void {
    for (const key of keys) {
      const bucket = this.live(key, now);
      if (bucket) bucket.failures += 1;
      else this.buckets.set(key, { windowStart: now, failures: 1 });
    }
    this.prune(now);
  }

  size(): number {
    return this.buckets.size;
  }

  private prune(now: number) {
    if (this.buckets.size <= DEMO_LIMIT_MAX_KEYS) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(key);
    }
    while (this.buckets.size > DEMO_LIMIT_MAX_KEYS) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

/** x-forwarded-for의 첫 값(Vercel이 덮어쓴다). 없거나 이상하면 "unknown" — 이 열쇠를 모두가 나눠 쓰게 되어 막는 쪽으로 기운다. */
export function clientIpFrom(forwardedFor: string | null, realIp: string | null = null): string {
  const first = (forwardedFor ?? "").split(",")[0]?.trim() ?? "";
  const candidate = first || (realIp ?? "").trim();
  if (!candidate || candidate.length > 64 || !/^[0-9A-Fa-f:.]+$/.test(candidate)) return "unknown";
  return candidate;
}

/** 기기 쿠키 이름과 값 모양(서버가 만든 uuid). 모양이 다르면 새로 만든다. */
export const DEMO_DEVICE_COOKIE = "duno_demo_device";
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID.test(value);
}
