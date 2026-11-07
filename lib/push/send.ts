import "server-only";
import type { PushServerConfig } from "./config";
import { vapidAuthorization } from "./vapid";

/**
 * 푸시 신호 보내기(서버 전용, 본문 없음). 서명 키가 없으면 보내지 않는다(not_configured). 네트워크·키 오류는 던지지 않고 짧은 코드로 돌려준다.
 * 푸시 서비스의 답: 201(받음)은 ok, 404·410은 구독이 사라진 것(gone, 호출한 쪽이 구독을 지운다), 그 밖은 rejected.
 * 본문이 없으니 알림 글은 서비스 워커(public/sw.js)가 정한다.
 */
/** 푸시 서비스의 답을 기다리는 시간 상한(밀리초). 넘으면 network로 센다(A5). 예약 실행이 한 구독에 걸려 멈추지 않게 */
export const PUSH_SEND_TIMEOUT_MS = 5000;

export type PushSendResult = { ok: true } | { ok: false; error: "not_configured" | "gone" | "rejected" | "network" };

export async function sendPushSignal(args: {
  endpoint: string;
  config: PushServerConfig | null;
  fetchFn?: typeof fetch;
  nowSeconds?: number;
  /** 푸시 서비스가 알림을 쥐고 있는 시간(초). 기본 1시간 */
  ttlSeconds?: number;
}): Promise<PushSendResult> {
  if (!args.config) return { ok: false, error: "not_configured" };
  let authorization: string;
  try {
    authorization = vapidAuthorization({
      endpoint: args.endpoint,
      subject: args.config.subject,
      publicKey: args.config.publicKey,
      privateKey: args.config.privateKey,
      nowSeconds: args.nowSeconds,
    });
  } catch {
    return { ok: false, error: "rejected" };
  }
  try {
    const res = await (args.fetchFn ?? fetch)(args.endpoint, {
      method: "POST",
      headers: { Authorization: authorization, TTL: String(args.ttlSeconds ?? 3600), Urgency: "normal" },
      signal: AbortSignal.timeout(PUSH_SEND_TIMEOUT_MS),
    });
    if (res.status === 200 || res.status === 201 || res.status === 202) return { ok: true };
    if (res.status === 404 || res.status === 410) return { ok: false, error: "gone" };
    return { ok: false, error: "rejected" };
  } catch {
    return { ok: false, error: "network" };
  }
}
