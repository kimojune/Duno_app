"use server";

import { getDeps } from "../../lib/deps";
import { endFocusForUser, startFocusForUser } from "../../lib/focus/core";
import type { EndedFocus, StartedFocus } from "../../lib/focus/types";
import type { RecordResult } from "../../lib/records/common";

/**
 * 타이머 시작·끝내기 Server Action(PRD ④). 공개 HTTP 엔드포인트라 인자는 unknown으로 받아 서버에서 다시 검증한다.
 * user_id·서버 시각·반대편 여부는 받지 않는다(서버가 정한다). 예상 못 한 예외는 unavailable로 바꾸고 원문을 내지 않는다.
 */
export async function startFocus(input: unknown): Promise<RecordResult<StartedFocus>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await startFocusForUser(deps, input);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function endFocus(id: unknown, clientEndedAt?: unknown): Promise<RecordResult<EndedFocus>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    // clientEndedAt(기기가 끝낸 때)은 기기 먼저 저장이 보낸다. 없으면 옛 호출 꼴 그대로 부른다
    return clientEndedAt === undefined ? await endFocusForUser(deps, id) : await endFocusForUser(deps, id, clientEndedAt);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
