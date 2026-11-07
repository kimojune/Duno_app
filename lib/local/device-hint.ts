/**
 * 「이 기기에 이 사용자의 거울이 있다」는 표시(쿠키 하나, 고침 3바퀴). 서버가 첫 화면을 그릴 때 읽는다:
 * - 표시가 있으면(이 기기에서 다시 여는 것) 서버는 개인 데이터를 HTML에 싣지 않는다. 화면이 기기 저장소에서 바로 그린다.
 * - 표시가 없으면(이 기기에서 처음, 로그인 직후 포함) 서버가 서버 사본을 읽어 HTML과 함께 넘긴다. 그래야 처음 여는 사람도
 *   JS를 내려받고 다시 서버 사본을 받으러 가는 왕복 없이 목록을 본다(예전 방식과 같은 속도).
 * 값은 사용자 번호뿐이다(HTML에 이미 있는 값). 기기 저장소와 같이 로그아웃 때 지운다. 쿠키 이름은 서버와 화면이 같이 쓴다.
 * 이 파일은 localStorage·IndexedDB를 쓰지 않는다(document.cookie만).
 */
export const DEVICE_HINT_COOKIE = "duno-device";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** 이 기기에 이 사용자의 거울이 있다고 표시한다. 쿠키를 못 쓰면 조용히 넘어간다 */
export function markDeviceHint(userKey: string): void {
  try {
    if (typeof document === "undefined") return;
    document.cookie = `${DEVICE_HINT_COOKIE}=${encodeURIComponent(userKey)}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  } catch {
    // 표시를 못 해도 앱은 그대로 돈다(다음에 열 때 서버가 사본을 한 번 더 싣는다)
  }
}

/** 표시를 지운다(로그아웃) */
export function clearDeviceHint(): void {
  try {
    if (typeof document === "undefined") return;
    document.cookie = `${DEVICE_HINT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // 조용히 둔다
  }
}
