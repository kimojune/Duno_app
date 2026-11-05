/**
 * 화면용 공개 환경 변수. 반드시 process.env.이름 꼴의 정적 참조로만 읽는다
 * (동적 접근은 브라우저 번들에서 치환되지 않는다).
 * 값이 없으면 null을 돌려준다. 빌드·테스트가 .env.local 없이도 돌아야 해서 여기서 터뜨리지 않는다.
 */
export type PublicEnv = { url: string; key: string };

export function getPublicEnv(): PublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  return { url, key };
}
