import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TodoKey } from "../todos/crypto";
import { demoCodeMatches, type DemoAttemptLimiter } from "./access";
import { DemoSeedError, type DemoSeedCounts, type DemoSeedInput } from "./seed";

/**
 * 「체험 코드로 시작」의 서버 쪽 순서(app/demo/actions.ts가 재료를 넣어 부른다). 서버 전용.
 * 1) 체험 입구가 꺼졌으면(DEMO_ACCESS_CODE 없음) 거절 — 아무것도 세지도 부르지도 않는다
 * 2) 틀린 코드 한도에 걸렸으면 거절(코드 비교도 하지 않는다)
 * 3) 코드가 틀리면 한도에 한 번 세고 거절
 * 4) 이미 익명(체험) 세션이면 그 사용자로, 아니면 signInAnonymously(세션 쿠키는 SSR 클라이언트가 쓴다)
 *    — 「시작」을 다시 눌러도(앞에서 예시 데이터가 실패한 뒤 등) 익명 사용자가 하나 더 생기지 않는다.
 *    정식 계정(익명 아님)으로 이미 로그인돼 있으면 예시 데이터를 넣지 않고 그대로 들여보낸다(남의 실제 계정에 예시가 섞이지 않게).
 * 5) 그 사용자 자기 세션으로 예시 데이터(처음 설정 끝 표시 포함)
 * 로그에는 정해진 짧은 코드와 Supabase 오류 status·code만 남긴다(코드 값·쓴 값·사용자 번호 없음).
 */

export type DemoStartError = "off" | "wrong_code" | "rate_limited" | "failed";
export type DemoStartResult = { ok: true } | { ok: false; error: DemoStartError };

export type DemoStartDeps = {
  /** 서버 환경 변수의 체험 코드(없으면 null = 꺼짐) */
  expectedCode: string | null;
  limiter: DemoAttemptLimiter;
  /** 한도를 셀 열쇠(IP·기기 쿠키) */
  limitKeys: string[];
  now: () => number;
  getSupabase: () => Promise<SupabaseClient | null>;
  key: TodoKey | null;
  /** 오늘 두노 하루(새벽 4시 경계) */
  today: () => string;
  seed: (input: DemoSeedInput) => Promise<DemoSeedCounts>;
};

const uuid = z.guid();

function log(event: string, detail?: { status?: unknown; code?: unknown }) {
  const status = typeof detail?.status === "number" ? ` status=${detail.status}` : "";
  const code = typeof detail?.code === "string" && /^[a-z0-9_]{1,64}$/i.test(detail.code) ? ` code=${detail.code}` : "";
  console.warn(`[demo] ${event}${status}${code}`);
}

export async function startDemoCore(deps: DemoStartDeps, input: unknown): Promise<DemoStartResult> {
  if (deps.expectedCode === null) return { ok: false, error: "off" };
  const now = deps.now();
  if (deps.limiter.isBlocked(deps.limitKeys, now)) {
    log("rate_limited");
    return { ok: false, error: "rate_limited" };
  }
  if (!demoCodeMatches(input, deps.expectedCode)) {
    deps.limiter.recordFailure(deps.limitKeys, now);
    return { ok: false, error: "wrong_code" };
  }

  try {
    const supabase = await deps.getSupabase();
    if (!supabase || !deps.key) {
      log("config");
      return { ok: false, error: "failed" };
    }

    let userId: string | null = null;
    const { data: claimsData } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;
    if (claims?.sub) {
      if (claims.is_anonymous !== true) return { ok: true }; // 정식 계정: 예시 없이 그대로
      userId = claims.sub;
    } else {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        // 익명 로그인이 꺼졌거나(anonymous_provider_disabled) CAPTCHA가 켜져 토큰이 없거나(captcha_failed) 한도(429)
        log("sign_in_failed", { status: error.status, code: error.code });
        return { ok: false, error: "failed" };
      }
      userId = data.user?.id ?? null;
    }
    if (!userId || !uuid.safeParse(userId).success) {
      log("no_user");
      return { ok: false, error: "failed" };
    }

    await deps.seed({ supabase, userId, key: deps.key, today: deps.today() });
    return { ok: true };
  } catch (e) {
    if (e instanceof DemoSeedError) log(`seed_failed_${e.step}`, { code: e.code ?? undefined });
    else log("unavailable");
    return { ok: false, error: "failed" };
  }
}
