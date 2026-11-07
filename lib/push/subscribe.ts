import { deletePushSubscription, savePushSubscription } from "../../app/push/actions";
import { getVapidPublicKey } from "./config";
import { notificationPermission, requestNotificationPermission, type PermissionState } from "./client";

/**
 * 브라우저에서 푸시를 켜고 끄는 길(클라이언트, 새 패키지 없이 Notification·Service Worker·Push API만). PRD 7-8, ⑦.
 * 켜기: 알림 허락을 묻고 → 서비스 워커로 푸시를 구독하고 → 구독을 서버에 저장한다. 서명 공개 키(NEXT_PUBLIC_VAPID_PUBLIC_KEY)가 없으면
 * 켜지 않고 missing_key를 돌려준다(보내는 쪽 설정이 아직 없다). 던지지 않는다.
 * 아이폰 알림(홈 화면 추가)은 실기기로 확인하지 못했다(기획서 9절).
 */
export type PushEnableResult = "ok" | "denied" | "unsupported" | "missing_key" | "failed";

export type PushApi = {
  /** 이 기기에서 알림 허락 상태 */
  permission(): PermissionState;
  /** 푸시 구독이 가능한 브라우저인가(서비스 워커·푸시 지원) */
  supported(): boolean;
  /** 서명 공개 키가 설정에 있는가 */
  hasKey(): boolean;
  enable(): Promise<PushEnableResult>;
  disable(): Promise<void>;
};

/** base64url 공개 키를 푸시 구독에 쓰는 바이트로 */
export function urlBase64ToBytes(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

export const defaultPushApi: PushApi = {
  permission: notificationPermission,
  supported: pushSupported,
  hasKey: () => getVapidPublicKey() !== null,
  enable: async () => {
    if (!pushSupported()) return "unsupported";
    const key = getVapidPublicKey();
    if (!key) return "missing_key";
    try {
      const permission = await requestNotificationPermission();
      if (permission !== "granted") return permission === "unsupported" ? "unsupported" : "denied";
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key).buffer as ArrayBuffer }));
      const json = subscription.toJSON();
      const saved = await savePushSubscription({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth });
      return saved.ok ? "ok" : "failed";
    } catch {
      return "failed";
    }
  },
  disable: async () => {
    if (!pushSupported()) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
      await deletePushSubscription(subscription.endpoint);
      await subscription.unsubscribe();
    } catch {
      // 끄기 실패는 조용히 둔다(설정은 이미 꺼진 것으로 저장된다)
    }
  },
};
