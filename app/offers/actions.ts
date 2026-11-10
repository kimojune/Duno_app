"use server";

import { getDeps } from "../../lib/deps";
import { addOfferTodoForUser, dismissOfferForUser, requestOfferForUser } from "../../lib/offers/core";
import type { AddOfferTodoResult, DismissedOffer, OfferRequestResult } from "../../lib/offers/types";
import type { RecordResult } from "../../lib/records/common";

/**
 * 오늘 먼저 할 일 건네기 Server Action(PRD ⑤). 공개 HTTP 엔드포인트라 인자는 unknown으로 받아 서버에서 다시 검증한다.
 * 건넬 분야·할 일·제시 기록·넘긴 시각은 모두 서버가 정한다(화면은 어느 자리인지만 보낸다). 예상 못 한 예외는 unavailable로 바꾸고 원문을 내지 않는다.
 */
export async function requestOffer(input: unknown): Promise<RecordResult<OfferRequestResult>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await requestOfferForUser(deps, input);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function dismissOffer(id: unknown): Promise<RecordResult<DismissedOffer>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await dismissOfferForUser(deps, id);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** 「오늘 할 일에 추가」: 카드로 건넨 지난 날 할 일을 오늘 할 일로 복사한다. 사본 id·날짜·권한은 모두 서버가 정하고 다시 확인한다(lib/offers/core.ts) */
export async function addOfferTodo(input: unknown): Promise<RecordResult<AddOfferTodoResult>> {
  try {
    const deps = await getDeps();
    if (!deps) return { ok: false, error: "config" };
    return await addOfferTodoForUser(deps, input);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
