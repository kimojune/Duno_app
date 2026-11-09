// 로그인 화면 문구와 주소의 오류 코드 → 안내 종류. 서버·클라이언트 어디서나 쓰는 순수 모듈.

/** 로그인 안내의 종류. L3 failed, L4 cancelled, L5 offline, 개발용 config. */
export type LoginNotice = "failed" | "cancelled" | "offline" | "config";

export const LOGIN_TEXT = {
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

/**
 * 체험 코드(시연, PM d-162 가 · 23 S0 49:169·141:13·141:31). 화면 읽기 이름: 칸 「체험 코드」, 단추 「체험 코드로 시작」.
 * 오류 종류는 서버 행동(app/demo/actions.ts)의 짧은 코드와 화면이 스스로 정하는 empty·offline.
 */
export const DEMO_TEXT = {
  label: "체험 코드",
  button: "시작",
  buttonName: "체험 코드로 시작",
  busy: "시작 중",
  empty: "체험 코드를 적어 주세요.",
  wrong_code: "코드가 맞지 않아요. 받은 코드를 다시 확인해 주세요.",
  rate_limited: "여러 번 틀려서 잠시 막았어요. 10분 뒤에 다시 해 주세요.",
  failed: "체험을 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요.",
  off: "지금은 체험 코드로 시작할 수 없어요.",
  offline: "인터넷에 연결되면 체험을 시작할 수 있어요.",
} as const;

export type DemoNotice = "empty" | "wrong_code" | "rate_limited" | "failed" | "off" | "offline";

/** 칸에 쓰는 대로 바꾸기: 대문자로(23 S0). 서버는 이 값을 믿지 않고 같은 규칙으로 다시 맞춘다(lib/demo/access.ts normalizeDemoCode). */
export function toDemoCodeInput(value: string): string {
  return value.toUpperCase();
}
