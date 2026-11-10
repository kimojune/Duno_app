/**
 * 체험 시작의 시간 상한(임시값, docs/oneshot-v2/임시값.md). 서버·화면이 같이 읽는다(비밀 없음).
 * 화면이 서버보다 먼저 풀려야 해서 화면 20초 < 서버 25초다: 화면이 「시작하지 못했어요」로 풀고, 서버는 뒤에서 정리한다.
 */
export const DEMO_CLIENT_TIMEOUT_MS = 20_000;
export const DEMO_SERVER_TIMEOUT_MS = 25_000;
