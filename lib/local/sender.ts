import { sendLocalOp } from "../../app/local/actions";
import type { MirrorSnapshot, QueuedOp, Sender, SendResult } from "./types";

/**
 * 보낼 줄의 쓰기 하나를 서버에 보낸다(브라우저 쪽). 서버 입구는 하나(app/local/actions.ts의 sendLocalOp)이고, 그 안에서 쓰기 종류마다
 * 기존 Server Action을 부른다. 서버가 모든 것을 다시 검사한다.
 * - 이 줄의 주인(기대 사용자 번호)을 함께 보낸다(고침 4바퀴): 서버의 세션 사용자가 다르면 account_mismatch로 거절된다.
 * - 쓰기를 누른 때(clientAt)를 함께 보내 서버가 하루 경계를 그 때로 정하게 한다(서버는 최근 72시간·미래 5분 범위만 검사).
 * 서버가 {ok:false}로 답하면 그 오류 코드를 그대로 돌려주고(분야 duplicate면 이미 있는 분야도), 서버에 닿지 못해 던져지면 network로 돌려준다.
 */
export function createSender(expectedUser: string): Sender {
  return async (queued: QueuedOp): Promise<SendResult> => {
    const { op, clientAt } = queued;
    try {
      const res = await sendLocalOp(expectedUser, op, clientAt);
      if (res.ok) return { ok: true };
      return res.existing ? { ok: false, error: res.error, existing: res.existing } : { ok: false, error: res.error };
    } catch {
      return { ok: false, error: "unavailable", network: true };
    }
  };
}

/** 서버 사본을 받을 때 이 기기 장치의 사용자 번호를 싣는 머리글(서버가 세션 사용자와 다르면 account_mismatch) */
export const EXPECTED_USER_HEADER = "x-duno-expected-user";

/** 서버 사본 받기(GET /mirror). 던지지 않고 짧은 코드로 돌려준다 */
export function createSnapshotFetcher(expectedUser: string): () => Promise<{ ok: true; data: MirrorSnapshot } | { ok: false; error: string }> {
  return async () => {
    try {
      const res = await fetch("/mirror", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", [EXPECTED_USER_HEADER]: expectedUser },
      });
      const body: unknown = await res.json();
      if (body !== null && typeof body === "object") {
        const v = body as { ok?: unknown; data?: unknown; error?: unknown };
        if (v.ok === true && v.data !== null && typeof v.data === "object") return { ok: true, data: v.data as MirrorSnapshot };
        if (v.ok === false && typeof v.error === "string") return { ok: false, error: v.error };
      }
      return { ok: false, error: "unavailable" };
    } catch {
      return { ok: false, error: "unavailable" };
    }
  };
}
