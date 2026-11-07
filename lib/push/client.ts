/**
 * 브라우저 알림 허락(클라이언트). 새 패키지 없이 Notification API만 쓴다.
 * 푸시 구독과 서명 키 쪽은 lib/push/subscribe.ts(⑦)에 있다.
 */
export type PermissionState = "granted" | "denied" | "default" | "unsupported";

export function notificationPermission(): PermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** 허락을 묻는다. 지원하지 않거나 예외가 나면 unsupported(던지지 않는다) */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return "unsupported";
  }
}
