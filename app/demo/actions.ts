"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { clientIpFrom, DEMO_DEVICE_COOKIE, DemoAttemptLimiter, isDeviceId } from "../../lib/demo/access";
import { seedDemoData } from "../../lib/demo/seed";
import { startDemoCore, type DemoStartResult } from "../../lib/demo/start";
import { getDemoAccessCode } from "../../lib/server-config";
import { createClient } from "../../lib/supabase/server";
import { getTodoKeyFromEnv } from "../../lib/todos/crypto";
import { todoDayFor } from "../../lib/todos/day";

// 틀린 코드 한도의 셈(이 서버 인스턴스의 메모리). 인스턴스마다 따로라 완전하지 않다 — lib/demo/access.ts 머리 설명.
const limiter = new DemoAttemptLimiter();

/**
 * 「체험 코드로 시작」(로그인 화면 S0). 코드는 여기서만 확인한다. 성공하면 { ok: true } — 화면이 첫 화면을 다시 연다(할 일 탭).
 * DEMO_ACCESS_CODE가 없으면 언제나 { ok: false, error: "off" }(화면에 칸이 없어도 이 행동을 직접 부르는 길을 막는다).
 */
export async function startDemo(code: unknown): Promise<DemoStartResult> {
  const expectedCode = getDemoAccessCode();
  if (expectedCode === null) return { ok: false, error: "off" };

  const jar = await cookies();
  let device = jar.get(DEMO_DEVICE_COOKIE)?.value;
  if (!isDeviceId(device)) {
    device = randomUUID();
    jar.set(DEMO_DEVICE_COOKIE, device, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  const h = await headers();
  const ip = clientIpFrom(h.get("x-forwarded-for"), h.get("x-real-ip"));

  return startDemoCore(
    {
      expectedCode,
      limiter,
      limitKeys: [`ip:${ip}`, `device:${device}`],
      now: () => Date.now(),
      getSupabase: createClient,
      key: getTodoKeyFromEnv(),
      today: () => todoDayFor(new Date()),
      seed: seedDemoData,
    },
    code,
  );
}
