/**
 * 화면(브라우저)이 읽는 알림 설정: 푸시 서명 공개 키 하나. 공개해도 되는 값이라 이 파일은 브라우저 번들에 들어가도 된다.
 * 서버 비밀(서명 비밀 키·서버 키·예약 비밀)을 읽는 곳은 lib/push/config.ts(server-only)다. 둘을 한 파일에 두지 않는다(A8).
 */

/** 화면용 공개 키. 반드시 process.env.이름 꼴의 정적 참조로만 읽는다(브라우저 번들에서 치환된다). 없으면 null */
export function getVapidPublicKey(): string | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  return key ? key : null;
}
