// 알림에 쓸 키를 한 번 만들어 표준 출력에만 보여 주는 스크립트(PM이 자기 컴퓨터에서 돌린다).
//   node scripts/notify-keys.mjs      (또는 npm run notify:keys)
// 값은 화면에만 나온다. 파일로 저장하지 않는다. 채팅·문서·커밋에 붙이지 않는다.
// node:crypto만 쓴다(새 패키지 없음). 푸시 서명 키(VAPID, P-256)와 예약 비밀을 만든다.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

/** JWK 좌표(base64url)를 정확히 32바이트로 맞춘다. 모자라면 앞을 0으로 채우고, 넘치거나 비면 던진다 */
function toBytes32(value) {
  const raw = Buffer.from(typeof value === "string" ? value : "", "base64url");
  if (raw.length === 0 || raw.length > 32) throw new RangeError("invalid key component");
  return Buffer.concat([Buffer.alloc(32 - raw.length), raw]);
}

/** 공개 키(비압축 점 65바이트, base64url) · 비밀 키(32바이트, base64url) · 예약 비밀(무작위 32바이트, base64url) */
export function generateNotifyKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), toBytes32(jwk.x), toBytes32(jwk.y)]);
  return {
    publicKey: point.toString("base64url"),
    privateKey: toBytes32(jwk.d).toString("base64url"),
    cronSecret: randomBytes(32).toString("base64url"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keys = generateNotifyKeys();
  process.stdout.write(
    [
      "아래 값은 지금 화면에만 나옵니다. 파일·채팅·커밋에 붙이지 마세요.",
      "",
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY (Vercel 일반 값)",
      keys.publicKey,
      "",
      "VAPID_PRIVATE_KEY (Vercel Sensitive)",
      keys.privateKey,
      "",
      "CRON_SECRET (Vercel Sensitive · Supabase Vault duno_cron_secret에도 같은 값)",
      keys.cronSecret,
      "",
    ].join("\n"),
  );
}
