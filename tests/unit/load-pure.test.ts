import { describe, expect, it } from "vitest";
import {
  MASK,
  checkStages,
  checkTarget,
  countStatuses,
  decideStop,
  isLimitText,
  median,
  parseArgs,
  percentile,
  readEnvValue,
  redact,
  summarizeStage,
  type ContextResult,
} from "../load/pure";

const ok = (ms: number): ContextResult => ({ ok: true, enterMs: ms, failKind: null, limitHit: false });
const bad = (kind: ContextResult["failKind"] = "other"): ContextResult => ({ ok: false, enterMs: null, failKind: kind, limitHit: false });

describe("부하 시험 — 대상 주소 허용 목록", () => {
  it("운영 주소와 localhost:<포트>만 받는다", () => {
    expect(checkTarget("https://duno-app-iota.vercel.app")).toEqual({ ok: true, origin: "https://duno-app-iota.vercel.app" });
    expect(checkTarget("https://duno-app-iota.vercel.app/")).toMatchObject({ ok: true });
    expect(checkTarget("http://localhost:3100")).toEqual({ ok: true, origin: "http://localhost:3100" });
  });
  it.each([
    "https://example.com",
    "http://duno-app-iota.vercel.app",
    "https://duno-app-iota.vercel.app.evil.com",
    ["https://duno-app-iota.vercel.app", "evil.com"].join("@"), // 계정 정보 꼴
    "https://evil.com/https://duno-app-iota.vercel.app",
    "https://duno-app-iota.vercel.app/path",
    "http://localhost",
    "http://localhost:0",
    "http://localhost:99999",
    "http://localhost:3100/x",
    ["http://localhost:3100", "evil.com"].join("@"),
    "https://localhost:3100",
    "http://127.0.0.1:3100",
    "",
  ])("거절: %s", (raw) => {
    expect(checkTarget(raw).ok).toBe(false);
  });
});

describe("부하 시험 — 단계 상한", () => {
  it("기본 5,15,30,50 은 합 100으로 통과", () => {
    expect(checkStages("5,15,30,50", 100)).toEqual({ ok: true, stages: [5, 15, 30, 50], total: 100 });
  });
  it("합이 100을 넘으면 거절(50,50,50) · --max-total 로 올리면 통과", () => {
    expect(checkStages("50,50,50", 100).ok).toBe(false);
    expect(checkStages("50,50,50", 150)).toMatchObject({ ok: true, total: 150 });
  });
  it("양의 정수가 아니면 거절", () => {
    for (const raw of ["", "0", "-5", "1.5", "a", "5,,6", "5;6"]) expect(checkStages(raw, 100).ok).toBe(false);
  });
});

describe("부하 시험 — 인자 · 확인 한 줄", () => {
  it("--yes 가 없으면 yes=false(계획만)", () => {
    const r = parseArgs(["--target", "http://localhost:3100"]);
    expect(r.ok && r.args.yes).toBe(false);
    expect(r.ok && r.args.stages).toEqual([5, 15, 30, 50]);
  });
  it("--yes 가 있으면 yes=true", () => {
    const r = parseArgs(["--target", "http://localhost:3100", "--stages", "1,2", "--build", "abc1234", "--yes"]);
    expect(r).toMatchObject({ ok: true, args: { yes: true, total: 3, build: "abc1234" } });
  });
  it("다른 사이트 · 합 초과 · 모르는 인자 · 값 없음 · 이상한 판 해시는 거절", () => {
    expect(parseArgs(["--target", "https://example.com", "--yes"]).ok).toBe(false);
    expect(parseArgs(["--target", "http://localhost:3100", "--stages", "50,50,50", "--yes"]).ok).toBe(false);
    expect(parseArgs(["--target", "http://localhost:3100", "--foo"]).ok).toBe(false);
    expect(parseArgs(["--target"]).ok).toBe(false);
    expect(parseArgs([]).ok).toBe(false);
    expect(parseArgs(["--target", "http://localhost:3100", "--build", "a b;rm"]).ok).toBe(false);
  });
});

describe("부하 시험 — 통계", () => {
  it("가운데값: 홀수 · 짝수 · 빈 목록", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("95%: 가까운 순위", () => {
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(v, 95)).toBe(19);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBeNull();
  });
  it("단계 요약: 성공 시간만 재고 실패 종류를 센다", () => {
    const s = summarizeStage([ok(100), ok(300), bad("timeout"), bad("screen_error")]);
    expect(s).toMatchObject({ size: 4, ok: 2, failed: 2, enterMedianMs: 200, failKinds: { timeout: 1, screen_error: 1, http_status: 0, other: 0 } });
  });
  it("응답 코드 세기: 4xx·5xx만, 호스트+경로로(쿼리 문자열 없음)", () => {
    const c = countStatuses([
      { status: 500, url: "https://a.example/x/y?token=SECRET" },
      { status: 500, url: "https://a.example/x/y?other=1" },
      { status: 200, url: "https://a.example/ok" },
      { status: 429, url: "https://b.example/auth/v1/signup" },
    ]);
    expect(c).toEqual({ "500 a.example/x/y": 2, "429 b.example/auth/v1/signup": 1 });
    expect(JSON.stringify(c)).not.toContain("SECRET");
  });
});

describe("부하 시험 — 멈춤 규칙", () => {
  it("전부 성공이면 계속", () => {
    expect(decideStop([ok(1), ok(2), ok(3)]).stop).toBe(false);
  });
  it("실패가 정확히 10%면 계속, 10%를 넘으면 멈춤", () => {
    const nine = Array.from({ length: 9 }, () => ok(1));
    expect(decideStop([...nine, bad()]).stop).toBe(false); // 1/10
    expect(decideStop([...Array.from({ length: 8 }, () => ok(1)), bad(), bad()]).stop).toBe(true); // 2/10
    expect(decideStop([ok(1), ok(1), ok(1), ok(1), bad()]).stop).toBe(true); // 1/5 = 20%
  });
  it("한도 초과 신호가 하나라도 있으면 성공이 많아도 멈춤", () => {
    const r = decideStop([...Array.from({ length: 49 }, () => ok(1)), { ok: true, enterMs: 1, failKind: null, limitHit: true }]);
    expect(r.stop).toBe(true);
    expect(r.reason).toContain("한도");
  });
  it("결과가 없으면 멈춤", () => {
    expect(decideStop([]).stop).toBe(true);
  });
  it("한도 글 판별", () => {
    expect(isLimitText("여러 번 틀려서 잠시 막았어요. 10분 뒤에 다시 해 주세요.")).toBe(true);
    expect(isLimitText("Request rate limit reached")).toBe(true);
    expect(isLimitText("체험을 시작하지 못했어요.")).toBe(false);
  });
});

describe("부하 시험 — 값 가리기", () => {
  const code = "AbC123xyz"; // 시험용 가짜 값
  it("값이 든 오류 글 → 가려짐(그대로 · 대문자 · 소문자 · 주소 인코딩)", () => {
    const text = `locator.fill: Timeout. call log: fill("${code}") / ${code.toUpperCase()} / ${code.toLowerCase()} / ?c=${encodeURIComponent(code)}`;
    const out = redact(text, code);
    expect(out).not.toContain(code);
    expect(out.toLowerCase()).not.toContain(code.toLowerCase());
    expect(out).toContain(MASK);
  });
  it("값이 여러 번 나와도 모두 가려지고, 다른 글은 그대로", () => {
    expect(redact(`${code} 그리고 ${code}`, code)).toBe(`${MASK} 그리고 ${MASK}`);
    expect(redact("아무 값도 없음", code)).toBe("아무 값도 없음");
  });
  it("값이 비면 글을 바꾸지 않는다", () => {
    expect(redact("abc", "")).toBe("abc");
    expect(redact("abc", "   ")).toBe("abc");
  });
  it("JSON 전체 문자열에도 쓸 수 있다", () => {
    const json = JSON.stringify({ a: { message: `bad ${code}` }, list: [`x${code}y`] });
    expect(redact(json, code)).not.toContain(code);
  });
  it(".env 줄에서 값을 읽는다(따옴표 · 공백 · 없음)", () => {
    expect(readEnvValue("A=1\nDEMO_ACCESS_CODE=\"Q1\"\n", "DEMO_ACCESS_CODE")).toBe("Q1");
    expect(readEnvValue("DEMO_ACCESS_CODE= \r\nB=2", "DEMO_ACCESS_CODE")).toBe("");
    expect(readEnvValue("B=2", "DEMO_ACCESS_CODE")).toBe("");
  });
});
