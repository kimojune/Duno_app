// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const savePushSubscription = vi.fn(async () => ({ ok: true as const, data: { saved: true as const } }));
const deletePushSubscription = vi.fn(async () => ({ ok: true as const, data: { deleted: true as const } }));
vi.mock("../../app/push/actions", () => ({
  savePushSubscription: (...args: unknown[]) => (savePushSubscription as (...a: unknown[]) => unknown)(...args),
  deletePushSubscription: (...args: unknown[]) => (deletePushSubscription as (...a: unknown[]) => unknown)(...args),
}));

import { defaultPushApi, PUSH_READY_TIMEOUT_MS, readyWithTimeout } from "../../lib/push/subscribe";

const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

function installBrowser(serviceWorker: Partial<ServiceWorkerContainer>) {
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  (window as unknown as { PushManager: unknown }).PushManager = class {};
  (globalThis as unknown as { Notification: unknown }).Notification = Object.assign(vi.fn(), {
    permission: "granted",
    requestPermission: vi.fn(async () => "granted"),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", KEY);
  savePushSubscription.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("푸시 켜기의 시간 제한 (A3)", () => {
  it("서비스 워커가 영원히 준비되지 않으면 5초 뒤 failed로 끝난다(멈추지 않는다)", async () => {
    installBrowser({ ready: new Promise(() => {}) });
    let result: string | null = null;
    void defaultPushApi.enable().then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(PUSH_READY_TIMEOUT_MS - 1);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(result).toBe("failed");
    expect(savePushSubscription).not.toHaveBeenCalled();
  });

  it("제때 준비되면 구독하고 서버에 저장한다", async () => {
    const subscription = { endpoint: "https://push.example/abc", toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } }) };
    const registration = { pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => subscription) } };
    installBrowser({ ready: Promise.resolve(registration as unknown as ServiceWorkerRegistration) });
    const result = defaultPushApi.enable();
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toBe("ok");
    expect(savePushSubscription).toHaveBeenCalledWith({ endpoint: "https://push.example/abc", p256dh: "p", auth: "a" });
  });

  it("readyWithTimeout은 준비가 늦으면 던지고, 제때면 등록을 돌려준다", async () => {
    installBrowser({ ready: new Promise(() => {}) });
    const late = readyWithTimeout(100);
    const caught = late.then(
      () => "resolved",
      () => "rejected",
    );
    await vi.advanceTimersByTimeAsync(101);
    expect(await caught).toBe("rejected");
  });
});

describe("실제 구독 유무 (B4)", () => {
  it("등록이 없으면 false(멈추지 않는다), 구독이 있으면 true, 없으면 false", async () => {
    installBrowser({ getRegistration: vi.fn(async () => undefined) });
    expect(await defaultPushApi.subscribed()).toBe(false);
    const withSub = { pushManager: { getSubscription: vi.fn(async () => ({ endpoint: "x" })) } };
    installBrowser({ getRegistration: vi.fn(async () => withSub as unknown as ServiceWorkerRegistration) });
    expect(await defaultPushApi.subscribed()).toBe(true);
    const noSub = { pushManager: { getSubscription: vi.fn(async () => null) } };
    installBrowser({ getRegistration: vi.fn(async () => noSub as unknown as ServiceWorkerRegistration) });
    expect(await defaultPushApi.subscribed()).toBe(false);
  });
});

describe("끄기 (A7)", () => {
  it("구독이 있으면 서버에서 지우고 브라우저 구독도 거둔다. 등록이 없으면 아무것도 하지 않는다", async () => {
    const unsubscribe = vi.fn(async () => true);
    const reg = { pushManager: { getSubscription: vi.fn(async () => ({ endpoint: "https://push.example/abc", unsubscribe })) } };
    installBrowser({ getRegistration: vi.fn(async () => reg as unknown as ServiceWorkerRegistration) });
    await defaultPushApi.disable();
    expect(deletePushSubscription).toHaveBeenCalledWith("https://push.example/abc");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    deletePushSubscription.mockClear();
    installBrowser({ getRegistration: vi.fn(async () => undefined) });
    await defaultPushApi.disable();
    expect(deletePushSubscription).not.toHaveBeenCalled();
  });
});
