"use server";

import { applyBundleForUser, setRestartRequestedForUser } from "../../lib/bundles/core";
import type { BundleApplyResult, BundleErrorCode } from "../../lib/bundles/types";
import { getDeps } from "../../lib/deps";

/**
 * 목표 묶음 쓰기 Server Action(MO-46). 공개 HTTP 엔드포인트라 인자는 unknown으로 받아 서버에서 다시 검증한다.
 * user_id는 받지 않는다(세션에서 정한다). 이름·목표 글은 core가 암호화해 save_goal_bundle을 한 번 부른다.
 * 예상 못 한 예외는 unavailable로 바꾸고 원문을 내지 않는다.
 */

export async function applyBundle(input: unknown): Promise<BundleApplyResult> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await applyBundleForUser(deps, input);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** 다시 시작 표시(requested=true)·취소(false). 지금 표를 바꾸지 않는다 */
export async function setRestartRequested(requested: unknown): Promise<{ ok: true } | { ok: false; error: BundleErrorCode }> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await setRestartRequestedForUser(deps, requested);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
