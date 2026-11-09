import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientIpFrom,
  DEMO_LIMIT_DEVICE_MAX,
  DEMO_LIMIT_IP_MAX,
  DEMO_LIMIT_WINDOW_MS,
  DemoAttemptLimiter,
  demoCodeMatches,
  demoLimitChecks,
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

describe("틀린 코드 한도(임시: 기기 10분 5번 · IP 10분 30번 · unknown IP는 세지 않음)", () => {
  const IP = "203.0.113.7";
  const DEV_A = "0b5f6c1e-3a1b-4c2d-8e9f-00000000000a";
  const DEV_B = "0b5f6c1e-3a1b-4c2d-8e9f-00000000000b";
  const dev = (i: number) => "0b5f6c1e-3a1b-4c2d-8e9f-" + String(i).padStart(12, "0");

  it("값: 기기 5, IP 30, 창 10분(임시)", () => {
    expect(DEMO_LIMIT_DEVICE_MAX).toBe(5);
    expect(DEMO_LIMIT_IP_MAX).toBe(30);
    expect(DEMO_LIMIT_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it("한도 목록: 기기 열쇠(5) + 아는 IP 열쇠(30), IP가 unknown이면 기기 열쇠만", () => {
    expect(demoLimitChecks(IP, DEV_A)).toEqual([
      { key: "device:" + DEV_A, max: 5 },
      { key: "ip:" + IP, max: 30 },
    ]);
    expect(demoLimitChecks("unknown", DEV_A)).toEqual([{ key: "device:" + DEV_A, max: 5 }]);
  });

  it("같은 기기가 5번 틀리면 그 기기는 막힌다(5번째 전까지는 안 막힘)", () => {
    const limiter = new DemoAttemptLimiter();
    const checks = demoLimitChecks(IP, DEV_A);
    for (let i = 0; i < DEMO_LIMIT_DEVICE_MAX; i += 1) {
      expect(limiter.isBlocked(checks, i), String(i)).toBe(false);
      limiter.recordFailure(checks, i);
    }
    expect(limiter.isBlocked(checks, 10)).toBe(true);
  });

  it("같은 IP의 다른 기기는 한 기기가 5번 틀려도 막히지 않는다(발표장 Wi-Fi)", () => {
    const limiter = new DemoAttemptLimiter();
    for (let i = 0; i < DEMO_LIMIT_DEVICE_MAX; i += 1) limiter.recordFailure(demoLimitChecks(IP, DEV_A), i);
    expect(limiter.isBlocked(demoLimitChecks(IP, DEV_A), 10)).toBe(true);
    expect(limiter.isBlocked(demoLimitChecks(IP, DEV_B), 10)).toBe(false);
  });

  it("같은 IP에서 30번 틀리면(쿠키를 지워 기기를 바꿔 가며여도) 그 IP의 모든 기기가 막힌다, 다른 IP는 그대로", () => {
    const limiter = new DemoAttemptLimiter();
    for (let i = 0; i < DEMO_LIMIT_IP_MAX; i += 1) {
      expect(limiter.isBlocked(demoLimitChecks(IP, dev(i)), i), String(i)).toBe(false);
      limiter.recordFailure(demoLimitChecks(IP, dev(i)), i);
    }
    expect(limiter.isBlocked(demoLimitChecks(IP, DEV_B), 100)).toBe(true);
    expect(limiter.isBlocked(demoLimitChecks("198.51.100.9", DEV_B), 100)).toBe(false);
  });

  it("IP를 모르면 서로 막지 않는다: unknown 기기 여럿이 틀려도 다른 기기는 그대로", () => {
    const limiter = new DemoAttemptLimiter();
    for (let i = 0; i < 40; i += 1) limiter.recordFailure(demoLimitChecks("unknown", dev(i)), i);
    expect(limiter.isBlocked(demoLimitChecks("unknown", DEV_B), 50)).toBe(false);
  });

  it("창이 끝나면(10분) 다시 된다 — 기기 한도·IP 한도 모두", () => {
    const limiter = new DemoAttemptLimiter();
    for (let i = 0; i < DEMO_LIMIT_IP_MAX; i += 1) limiter.recordFailure(demoLimitChecks(IP, DEV_A), 0);
    expect(limiter.isBlocked(demoLimitChecks(IP, DEV_A), DEMO_LIMIT_WINDOW_MS - 1)).toBe(true);
    expect(limiter.isBlocked(demoLimitChecks(IP, DEV_B), DEMO_LIMIT_WINDOW_MS - 1)).toBe(true);
    expect(limiter.isBlocked(demoLimitChecks(IP, DEV_A), DEMO_LIMIT_WINDOW_MS)).toBe(false);
    expect(limiter.isBlocked(demoLimitChecks(IP, DEV_B), DEMO_LIMIT_WINDOW_MS)).toBe(false);
  });

  it("기억하는 열쇠 수가 끝없이 늘지 않는다(상한 10000)", () => {
    const limiter = new DemoAttemptLimiter();
    for (let i = 0; i < 10_050; i += 1) limiter.recordFailure([{ key: "ip:" + i, max: 30 }], i);
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

  it("없거나 IP 꼴이 아니면 unknown(그때 IP 한도는 세지 않는다)", () => {
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
