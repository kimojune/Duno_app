// 로그인 화면 문구와 주소의 오류 코드 → 안내 종류. 서버·클라이언트 어디서나 쓰는 순수 모듈.

/** 로그인 안내의 종류. L3 failed, L4 cancelled, L5 offline, 개발용 config. */
export type LoginNotice = "failed" | "cancelled" | "offline" | "config";

export const LOGIN_TEXT = {
  name: "duno",
  sentence: "로그인하면 할 일을 어느 기기에서나 볼 수 있어요.",
  button: "Google로 로그인",
  busy: "Google로 이동하는 중",
  failed: "로그인하지 못했어요. 다시 눌러 주세요.",
  cancelled: "로그인을 마치지 않았어요. 로그인하려면 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 로그인할 수 있어요.",
  config: "설정 값이 없어요. 환경 변수를 넣고 다시 열어 주세요.",
} as const;

/** 주소의 짧은 오류 코드(?error=)를 안내 종류로 바꾼다. 모르는 값은 L3. 값 자체는 화면에 내지 않는다. */
export function noticeFromErrorParam(error: string | string[] | undefined): LoginNotice | null {
  if (error === undefined) return null;
  const value = Array.isArray(error) ? error[0] : error;
  if (value === "cancelled") return "cancelled";
  if (value === "config") return "config";
  return "failed";
}
