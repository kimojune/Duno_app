/**
 * 로그인 뒤 돌아갈 경로(next)를 검사한다.
 * 「슬래시 하나로 시작하는 상대 경로」만 받고, 그 밖은 모두 "/" 로 바꾼다.
 * - "//host", "/\host" (브라우저가 외부 주소로 읽음) → "/"
 * - "https://host" 같은 스킴이 있는 값 → "/"
 * - 제어 문자(탭·줄바꿈 등)가 섞인 값 → "/" (브라우저가 지우고 "//"로 읽을 수 있음)
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  try {
    const base = "http://safe-next.invalid";
    if (new URL(raw, base).origin !== base) return "/";
  } catch {
    return "/";
  }
  return raw;
}
