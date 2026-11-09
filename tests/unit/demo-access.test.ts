import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientIpFrom,
  DEMO_LIMIT_MAX_FAILURES,
  DEMO_LIMIT_WINDOW_MS,
  DemoAttemptLimiter,
  demoCodeMatches,
  isDeviceId,
  normalizeDemoCode,
} from "../../lib/demo/access";
import { getDemoAccessCode, isDemoEnabled } from "../../lib/server-config";

afterEach(() => vi.unstubAllEnvs());

// 시험용 코드(진짜 값이 아니다)
const CODE = "TEST-CODE-42";

describe("체험 코드 켜짐 스위치(DEMO_ACCESS_CODE)", () => {
  it("없거나 비었거나 공백뿐이면 꺼짐", () => {
    vi.stubEnv("DEMO_ACCESS_CODE", "");
    expect(getDemoAccessCode()).toBeNull();
    expect(isDemoEnabled()).toBe(false);
    vi.stubEnv("DEMO_ACCESS_CODE", "   ");
    expect(isDemoEnabled()).toBe(false);
    vi.stubEnv("DEMO_ACCESS_CODE", undefined as unknown as string);
    expect(isDemoEnabled()).toBe(false);
  });

  it("값이 있으면 켜짐(값은 앞뒤 공백을 지운 그대로)", () => {
    vi.stubEnv("DEMO_ACCESS_CODE", `  ${CODE} `);
    expect(isDemoEnabled()).toBe(true);
    expect(getDemoAccessCode()).toBe(CODE);
  });
});

describe("일정 시간 비교", () => {
  it("같은 코드는 맞음 — 대소문자·앞뒤 공백은 같은 규칙으로 맞춘 뒤 비교", () => {
    expect(normalizeDemoCode("  test-code-42 ")).toBe(CODE);
    expect(demoCodeMatches(CODE, CODE)).toBe(true);
    expect(demoCodeMatches("test-code-42", CODE)).toBe(true);
    expect(demoCodeMatches(" TEST-CODE-42\n", "test-code-42")).toBe(true);
  });

  it("길이가 달라도 던지지 않고 틀림(짧은 값·긴 값·한 글자 차이)", () => {
    expect(() => demoCodeMatches("T", CODE)).not.toThrow();
    expect(demoCodeMatches("T", CODE)).toBe(false);
    expect(demoCodeMatches(`${CODE}X`, CODE)).toBe(false);
    expect(demoCodeMatches("TEST-CODE-43", CODE)).toBe(false);
    expect(demoCodeMatches(CODE.slice(0, -1), CODE)).toBe(false);
  });

  it("빈 값·문자열 아님·너무 긴 값은 틀림", () => {
    expect(demoCodeMatches("", CODE)).toBe(false);
    expect(demoCodeMatches("   ", CODE)).toBe(false);
    expect(demoCodeMatches(undefined, CODE)).toBe(false);
    expect(demoCodeMatches(null, CODE)).toBe(false);
    expect(demoCodeMatches(42, CODE)).toBe(false);
    expect(demoCodeMatches({ toString: () => CODE }, CODE)).toBe(false);
    expect(demoCodeMatches("A".repeat(65), "A".repeat(65))).toBe(false);
  });

  it("기대값이 없거나 비면(꺼짐) 무엇을 넣어도 틀림 — 빈 값끼리도", () => {
    expect(demoCodeMatches("", null)).toBe(false);
    expect(demoCodeMatches("", "")).toBe(false);
    expect(demoCodeMatches(CODE, null)).toBe(false);
  });
});

describe("틀린 코드 한도(임시 10분에 5번)", () => {
  const keys = ["ip:1.2.3.4", "device:a"];

  it("5번 틀릴 때까지는 막지 않고, 5번째 뒤로 막는다", () => {
    const limiter = new DemoAttemptLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < DEMO_LIMIT_MAX_FAILURES; i += 1) {
      expect(limiter.isBlocked(keys, t0 + i), `${i}번째 전`).toBe(false);
      limiter.recordFailure(keys, t0 + i);
    }
    expect(limiter.isBlocked(keys, t0 + 10)).toBe(true);
  });

  it("열쇠 하나만 한도에 닿아도 막는다(같은 IP의 다른 기기, 같은 기기의 다른 IP)", () => {
    const limiter = new DemoAttemptLimiter();
    for (let i = 0; i < DEMO_LIMIT_MAX_FAILURES; i += 1) limiter.recordFailure(["ip:1.2.3.4", `device:${i}`], 0);
    expect(limiter.isBlocked(["ip:1.2.3.4", "device:new"], 1)).toBe(true);
    expect(limiter.isBlocked(["ip:9.9.9.9", "device:new"], 1)).toBe(false);
  });

  it("창이 끝나면(10분) 다시 된다", () => {
    const limiter = new DemoAttemptLimiter();
    for (let i = 0; i < DEMO_LIMIT_MAX_FAILURES; i += 1) limiter.recordFailure(keys, 0);
    expect(limiter.isBlocked(keys, DEMO_LIMIT_WINDOW_MS - 1)).toBe(true);
    expect(limiter.isBlocked(keys, DEMO_LIMIT_WINDOW_MS)).toBe(false);
    expect(DEMO_LIMIT_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it("기억하는 열쇠 수가 끝없이 늘지 않는다(상한 10000)", () => {
    const limiter = new DemoAttemptLimiter();
    for (let i = 0; i < 10_050; i += 1) limiter.recordFailure([`ip:${i}`], i);
    expect(limiter.size()).toBeGreaterThan(9_000);
    expect(limiter.size()).toBeLessThanOrEqual(10_000);
  });
});

describe("IP·기기 열쇠", () => {
  it("x-forwarded-for의 첫 값을 쓴다(Vercel이 덮어쓴 값)", () => {
    expect(clientIpFrom("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(clientIpFrom(" 2001:db8::1 ")).toBe("2001:db8::1");
    expect(clientIpFrom(null, "198.51.100.2")).toBe("198.51.100.2");
  });

  it("없거나 IP 꼴이 아니면 unknown(모두가 나눠 쓰는 열쇠 — 막는 쪽)", () => {
    expect(clientIpFrom(null)).toBe("unknown");
    expect(clientIpFrom("")).toBe("unknown");
    expect(clientIpFrom("<script>")).toBe("unknown");
    expect(clientIpFrom("1".repeat(65))).toBe("unknown");
  });

  it("기기 쿠키는 uuid 꼴만 믿는다", () => {
    expect(isDeviceId("0b5f6c1e-3a1b-4c2d-8e9f-001122334455")).toBe(true);
    expect(isDeviceId("x")).toBe(false);
    expect(isDeviceId(undefined)).toBe(false);
  });
});
