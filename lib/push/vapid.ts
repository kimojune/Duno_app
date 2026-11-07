import "server-only";
import { createPrivateKey, createSign } from "node:crypto";

/**
 * 푸시 서명(VAPID, RFC 8292)을 새 패키지 없이 node:crypto로 만든다. 서버 전용.
 * 푸시 서비스는 이 서명으로 「이 서버가 이 앱의 알림을 보내도 되는가」를 본다. 비밀 키(VAPID_PRIVATE_KEY)는 여기서 읽지 않고 호출한 쪽이 넘긴다.
 * 키 모양: 공개 키는 비압축 점 65바이트(0x04 + x 32 + y 32), 비밀 키는 32바이트, 둘 다 base64url(패딩 없음).
 * 이번 틀에서는 본문이 없는 신호만 보낸다(본문 암호화는 새 패키지가 필요할 수 있어 임시값 목록에 적었다).
 */

const b64url = (buf: Buffer) => buf.toString("base64url");

export type VapidInput = {
  /** 푸시 서비스 주소(구독의 endpoint) — 서명의 대상(aud)은 그 출처다 */
  endpoint: string;
  /** mailto: 또는 https:// 연락처 */
  subject: string;
  publicKey: string;
  privateKey: string;
  /** 서명 유효 시간(초). 푸시 서비스는 24시간 이하만 받는다. 기본 12시간 */
  ttlSeconds?: number;
  nowSeconds?: number;
};

/** VAPID 서명 JWT(ES256). 키가 이상하면 던진다(호출한 쪽이 잡는다) */
export function createVapidJwt(input: VapidInput): string {
  const aud = new URL(input.endpoint).origin;
  const nowSec = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = Math.min(input.ttlSeconds ?? 12 * 3600, 24 * 3600);
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(Buffer.from(JSON.stringify({ aud, exp: nowSec + ttl, sub: input.subject })));
  const signingInput = `${header}.${payload}`;

  const pub = Buffer.from(input.publicKey, "base64url");
  const priv = Buffer.from(input.privateKey, "base64url");
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) throw new RangeError("invalid vapid key");
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)), d: b64url(priv) },
    format: "jwk",
  });
  const signature = createSign("SHA256").update(signingInput).sign({ key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

/** Authorization 머리글 값: vapid t=<JWT>, k=<공개 키> */
export function vapidAuthorization(input: VapidInput): string {
  return `vapid t=${createVapidJwt(input)}, k=${input.publicKey}`;
}
