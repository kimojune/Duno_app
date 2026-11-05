import "server-only";

/**
 * 서버 전용 설정 자리. 접두어 없는 환경 변수는 여기서만 읽는다.
 * 이번에는 이름만 읽고, 암호화는 만들지 않는다(다음 작업).
 */
export function getServerConfig(): { todoEncryptionKey: string | null } {
  return { todoEncryptionKey: process.env.TODO_ENCRYPTION_KEY ?? null };
}
