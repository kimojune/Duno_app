import "server-only";

/**
 * 서버 전용 설정 자리. 접두어 없는 환경 변수는 여기서만 읽는다.
 * (lib/env.ts는 브라우저 클라이언트(lib/supabase/client.ts)도 읽는 공개 값 자리라, 비밀값은 이 파일에 둔다.)
 */
export function getServerConfig(): { todoEncryptionKey: string | null } {
  return { todoEncryptionKey: process.env.TODO_ENCRYPTION_KEY ?? null };
}

/**
 * 시연 체험 코드(DEMO_ACCESS_CODE, 서버 전용 — NEXT_PUBLIC_ 아님). 비었거나 없으면 null = 체험 입구가 꺼짐
 * (로그인 화면에 칸을 그리지 않고, 서버 행동도 거절한다). 값은 로그·응답·화면에 내지 않는다.
 */
export function getDemoAccessCode(): string | null {
  const raw = process.env.DEMO_ACCESS_CODE?.trim();
  return raw ? raw : null;
}

/** 체험 입구가 켜졌는가. 화면(클라이언트)에는 이 boolean만 넘긴다. */
export function isDemoEnabled(): boolean {
  return getDemoAccessCode() !== null;
}
