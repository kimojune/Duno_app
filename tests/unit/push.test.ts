import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getPushServerConfig, getTickConfig, getVapidPublicKey } from "../../lib/push/config";
import { deleteSubscriptionForUser, saveSubscriptionForUser } from "../../lib/push/core";
import { isDue, seoulMinuteOfDay } from "../../lib/push/due";
import { PUSH_SEND_TIMEOUT_MS, sendPushSignal } from "../../lib/push/send";
import { PUSH_SEND_CONCURRENCY, runNotifyTick, SETTINGS_PAGE_SIZE } from "../../lib/push/tick";
import { createVapidJwt, vapidAuthorization } from "../../lib/push/vapid";
import { FakeStore, fakeTablesClient, v2Rules, type TableRule } from "./fake-tables";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

/** 시험용 푸시 서명 키 한 쌍(비밀 아님): 공개 키는 비압축 점 65바이트, 비밀 키는 32바이트, base64url */
function vapidKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const priv = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x as string, "base64url"), Buffer.from(pub.y as string, "base64url")]);
  return { publicKey: raw.toString("base64url"), privateKey: priv.d as string, jwk: pub };
}

describe("VAPID 서명", () => {
  const keys = vapidKeys();
  const input = { endpoint: ENDPOINT, subject: "mailto:duno@example.com", publicKey: keys.publicKey, privateKey: keys.privateKey, nowSeconds: 1_800_000_000 };

  it("JWT는 ES256이고, 대상(aud)은 푸시 서비스 출처, 만료는 24시간 이하, 서명이 공개 키로 검증된다", () => {
    const jwt = createVapidJwt(input);
    const [h, p, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 12 * 3600, sub: "mailto:duno@example.com" });
    const publicKey = createPublicKey({ key: keys.jwk, format: "jwk" });
    const verify = createVerify("SHA256").update(`${h}.${p}`);
    expect(verify.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
    // 다른 내용으로는 검증이 안 된다
    const tampered = createVerify("SHA256").update(`${h}.${p}x`);
    expect(tampered.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(false);
  });
  it("만료 시간은 24시간을 넘기지 못한다", () => {
    const jwt = createVapidJwt({ ...input, ttlSeconds: 999_999 });
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload.exp - 1_800_000_000).toBe(24 * 3600);
  });
  it("Authorization 머리글은 vapid t=<JWT>, k=<공개 키>", () => {
    const header = vapidAuthorization(input);
    expect(header.startsWith("vapid t=")).toBe(true);
    expect(header.endsWith(`, k=${keys.publicKey}`)).toBe(true);
  });
  it("키 모양이 틀리면 던진다", () => {
    expect(() => createVapidJwt({ ...input, privateKey: "짧음" })).toThrow();
    expect(() => createVapidJwt({ ...input, publicKey: "AAAA" })).toThrow();
    expect(() => createVapidJwt({ ...input, endpoint: "아님" })).toThrow();
  });
});

describe("sendPushSignal", () => {
  const keys = vapidKeys();
  const config = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:duno@example.com" };
  const fetchWith = (status: number) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;

  it("서명 키 설정이 없으면 보내지 않는다(not_configured)", async () => {
    const f = fetchWith(201);
    expect(await sendPushSignal({ endpoint: ENDPOINT, config: null, fetchFn: f })).toEqual({ ok: false, error: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });
  it("201은 ok, 본문 없이 서명 머리글과 TTL을 달아 보낸다", async () => {
    const f = fetchWith(201);
    expect(await sendPushSignal({ endpoint: ENDPOINT, config, fetchFn: f })).toEqual({ ok: true });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization.startsWith("vapid t=")).toBe(true);
    expect(headers.TTL).toBe("3600");
  });
  it("푸시 서비스에 보내는 요청에는 5초 시간 제한(AbortSignal)이 붙는다 (A5)", async () => {
    const f = fetchWith(201);
    await sendPushSignal({ endpoint: ENDPOINT, config, fetchFn: f });
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(PUSH_SEND_TIMEOUT_MS).toBe(5000);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });
  it("시간 제한에 걸려 요청이 끊기면 던지지 않고 network (A5)", async () => {
    const aborted = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    expect(await sendPushSignal({ endpoint: ENDPOINT, config, fetchFn: aborted })).toEqual({ ok: false, error: "network" });
  });
  it("404·410은 구독이 사라진 것(gone), 그 밖은 rejected, 네트워크 오류는 network", async () => {
    expect(await sendPushSignal({ endpoint: ENDPOINT, config, fetchFn: fetchWith(410) })).toEqual({ ok: false, error: "gone" });
    expect(await sendPushSignal({ endpoint: ENDPOINT, config, fetchFn: fetchWith(404) })).toEqual({ ok: false, error: "gone" });
    expect(await sendPushSignal({ endpoint: ENDPOINT, config, fetchFn: fetchWith(429) })).toEqual({ ok: false, error: "rejected" });
    expect(await sendPushSignal({ endpoint: ENDPOINT, config, fetchFn: fetchWith(500) })).toEqual({ ok: false, error: "rejected" });
    const boom = vi.fn(async () => {
      throw new Error("secret detail");
    }) as unknown as typeof fetch;
    expect(await sendPushSignal({ endpoint: ENDPOINT, config, fetchFn: boom })).toEqual({ ok: false, error: "network" });
  });
  it("키가 이상하면 던지지 않고 rejected", async () => {
    const f = fetchWith(201);
    expect(await sendPushSignal({ endpoint: ENDPOINT, config: { ...config, privateKey: "x" }, fetchFn: f })).toEqual({ ok: false, error: "rejected" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("알림 설정 읽기", () => {
  it("서버 설정은 세 값이 모두 있고 연락처가 mailto:나 https://일 때만", () => {
    const base = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@b.c" };
    expect(getPushServerConfig(base)).toEqual({ publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.c" });
    expect(getPushServerConfig({ ...base, VAPID_SUBJECT: "https://example.com" })).not.toBeNull();
    expect(getPushServerConfig({ ...base, VAPID_SUBJECT: "a@b.c" })).toBeNull();
    expect(getPushServerConfig({ ...base, VAPID_PRIVATE_KEY: " " })).toBeNull();
    expect(getPushServerConfig({})).toBeNull();
  });
  it("예약 실행 설정은 서버 키·예약 비밀·주소가 모두 있을 때만", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "s", CRON_SECRET: "c" };
    expect(getTickConfig(env)).toEqual({ supabaseUrl: "https://x.supabase.co", serviceRoleKey: "s", cronSecret: "c" });
    expect(getTickConfig({ ...env, CRON_SECRET: "" })).toBeNull();
    expect(getTickConfig({})).toBeNull();
  });
  it("화면용 공개 키는 없으면 null", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    expect(getVapidPublicKey()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", " abc ");
    expect(getVapidPublicKey()).toBe("abc");
    vi.unstubAllEnvs();
  });
});

describe("보낼 때가 됐는가", () => {
  it("서울 시각의 자정부터 분", () => {
    expect(seoulMinuteOfDay(new Date("2026-11-07T10:30:00.000Z"))).toBe(19 * 60 + 30); // 서울 19:30
    expect(seoulMinuteOfDay(new Date("2026-11-07T15:00:00.000Z"))).toBe(0); // 서울 자정
  });
  it("정한 시각 뒤 창(분) 안이면 보낸다: 하루 한 번만 걸린다", () => {
    expect(isDue(1170, 1170, 15)).toBe(true);
    expect(isDue(1170, 1184, 15)).toBe(true);
    expect(isDue(1170, 1185, 15)).toBe(false);
    expect(isDue(1170, 1169, 15)).toBe(false);
  });
  it("자정을 넘는 창도 맞는다", () => {
    expect(isDue(1435, 5, 15)).toBe(true); // 23:55에 정했고 지금 00:05
    expect(isDue(1435, 15, 15)).toBe(false);
  });
  it("간격 15분으로 도는 예약이 하루에 정확히 한 번 걸린다", () => {
    let hits = 0;
    for (let minute = 0; minute < 1440; minute += 15) if (isDue(1190, minute, 15)) hits += 1;
    expect(hits).toBe(1);
  });
});

function adminStore(): FakeStore {
  const store = new FakeStore();
  const open: Record<string, TableRule> = { user_settings: { primaryKey: ["user_id"], noUser: true }, push_subscriptions: { noUser: true, allowDelete: true } };
  store.rules = open;
  return store;
}

describe("runNotifyTick (예약 실행)", () => {
  const NOW = new Date("2026-11-07T10:35:00.000Z"); // 서울 19:35
  const settings = (store: FakeStore, user: string, over: Record<string, unknown> = {}) =>
    store.seed("user_settings", { user_id: user, notify_evening_enabled: true, notify_evening_minute: 1170, notify_morning_enabled: false, notify_morning_minute: 600, ...over });
  const sub = (store: FakeStore, user: string, endpoint: string) => store.seed("push_subscriptions", { id: `${user}-${endpoint}`, user_id: user, endpoint });

  it("저녁 알림 때가 된 사용자의 구독으로만 보내고, 개수만 돌려준다", async () => {
    const store = adminStore();
    settings(store, ME);
    settings(store, OTHER, { notify_evening_minute: 1260 }); // 21:00 — 아직
    sub(store, ME, "https://a.example/1");
    sub(store, ME, "https://a.example/2");
    sub(store, OTHER, "https://b.example/1");
    const send = vi.fn(async (endpoint: string) => {
      void endpoint;
      return { ok: true as const };
    });
    const res = await runNotifyTick({ admin: fakeTablesClient(store, { sub: null }), now: NOW, send });
    expect(res).toEqual({ ok: true, data: { dueUsers: 1, sent: 2, gone: 0, failed: 0 } });
    expect(send.mock.calls.map((c) => c[0]).sort()).toEqual(["https://a.example/1", "https://a.example/2"]);
  });
  it("꺼 둔 알림은 보내지 않고, 아침 알림도 때가 되면 보낸다", async () => {
    const store = adminStore();
    settings(store, ME, { notify_evening_enabled: false });
    settings(store, OTHER, { notify_evening_enabled: false, notify_morning_enabled: true, notify_morning_minute: 1170 });
    sub(store, ME, "https://a.example/1");
    sub(store, OTHER, "https://b.example/1");
    const send = vi.fn(async () => ({ ok: true as const }));
    const res = await runNotifyTick({ admin: fakeTablesClient(store, { sub: null }), now: NOW, send });
    expect(res.ok && res.data).toMatchObject({ dueUsers: 1, sent: 1 });
    expect(send).toHaveBeenCalledWith("https://b.example/1");
  });
  it("저녁과 아침이 둘 다 때가 된 사용자도 한 번만 센다(구독마다 한 번 보낸다)", async () => {
    const store = adminStore();
    settings(store, ME, { notify_morning_enabled: true, notify_morning_minute: 1170 });
    sub(store, ME, "https://a.example/1");
    const send = vi.fn(async () => ({ ok: true as const }));
    const res = await runNotifyTick({ admin: fakeTablesClient(store, { sub: null }), now: NOW, send });
    expect(res.ok && res.data).toMatchObject({ dueUsers: 1, sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("사라진 구독은 지우고 세고, 실패한 것은 실패로 센다", async () => {
    const store = adminStore();
    settings(store, ME);
    sub(store, ME, "https://gone.example/1");
    sub(store, ME, "https://bad.example/1");
    const send = vi.fn(async (endpoint: string) => (endpoint.includes("gone") ? { ok: false as const, error: "gone" as const } : { ok: false as const, error: "rejected" as const }));
    const res = await runNotifyTick({ admin: fakeTablesClient(store, { sub: null }), now: NOW, send });
    expect(res.ok && res.data).toEqual({ dueUsers: 1, sent: 0, gone: 1, failed: 1 });
    expect(store.table("push_subscriptions").map((r) => r.endpoint)).toEqual(["https://bad.example/1"]);
  });
  it("동시에 보내는 수는 10을 넘지 않고 모두 보낸다 (A5)", async () => {
    const store = adminStore();
    for (let i = 0; i < 25; i++) {
      const user = `u${String(i).padStart(2, "0")}`;
      settings(store, user);
      sub(store, user, `https://p.example/${i}`);
    }
    let running = 0;
    let peak = 0;
    const send = vi.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return { ok: true as const };
    });
    const res = await runNotifyTick({ admin: fakeTablesClient(store, { sub: null }), now: NOW, send });
    expect(res.ok && res.data).toEqual({ dueUsers: 25, sent: 25, gone: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(25);
    expect(peak).toBeLessThanOrEqual(PUSH_SEND_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });
  it("보내다 던져도 그 구독만 실패로 세고 나머지는 보낸다 (A5)", async () => {
    const store = adminStore();
    settings(store, ME);
    sub(store, ME, "https://a.example/1");
    sub(store, ME, "https://a.example/2");
    const send = vi.fn(async (endpoint: string) => {
      if (endpoint.endsWith("/1")) throw new Error("boom");
      return { ok: true as const };
    });
    const res = await runNotifyTick({ admin: fakeTablesClient(store, { sub: null }), now: NOW, send });
    expect(res.ok && res.data).toEqual({ dueUsers: 1, sent: 1, gone: 0, failed: 1 });
  });
  it("설정은 쪽으로 읽고, 한 쪽을 넘는 사용자도 놓치지 않는다 (A5)", async () => {
    const store = adminStore();
    const total = SETTINGS_PAGE_SIZE + 5;
    for (let i = 0; i < total; i++) {
      const user = `u${String(i).padStart(5, "0")}`;
      settings(store, user, i >= SETTINGS_PAGE_SIZE ? {} : { notify_evening_minute: 0 });
      if (i >= SETTINGS_PAGE_SIZE) sub(store, user, `https://p.example/${i}`);
    }
    const send = vi.fn(async () => ({ ok: true as const }));
    const res = await runNotifyTick({ admin: fakeTablesClient(store, { sub: null }), now: NOW, send });
    expect(res.ok && res.data).toMatchObject({ dueUsers: 5, sent: 5 });
    expect(store.calls.filter((c) => c.table === "user_settings")).toHaveLength(2);
  });
  it("보낼 사람이 없으면 구독을 읽지도 않는다. DB 오류는 unavailable", async () => {
    const store = adminStore();
    settings(store, ME, { notify_evening_minute: 0 });
    const send = vi.fn(async () => ({ ok: true as const }));
    const none = await runNotifyTick({ admin: fakeTablesClient(store, { sub: null }), now: NOW, send });
    expect(none).toEqual({ ok: true, data: { dueUsers: 0, sent: 0, gone: 0, failed: 0 } });
    expect(store.calls.some((c) => c.table === "push_subscriptions")).toBe(false);
    store.alwaysError = { code: "XX000", message: "secret" };
    expect(await runNotifyTick({ admin: fakeTablesClient(store, { sub: null }), now: NOW, send })).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("푸시 구독 저장·삭제", () => {
  const deps = (store: FakeStore, sub: string | null = ME) => ({ supabase: fakeTablesClient(store, { sub }) });
  const valid = { endpoint: ENDPOINT, p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
  function setup() {
    const store = new FakeStore();
    store.rules = v2Rules();
    return store;
  }
  it("내 구독을 저장하고, 같은 주소를 다시 보내도 한 행", async () => {
    const store = setup();
    expect(await saveSubscriptionForUser(deps(store), valid)).toEqual({ ok: true, data: { saved: true } });
    await saveSubscriptionForUser(deps(store), valid);
    expect(store.table("push_subscriptions")).toHaveLength(1);
    expect(store.table("push_subscriptions")[0]).toMatchObject({ user_id: ME, endpoint: ENDPOINT });
  });
  it("https가 아닌 주소·모르는 키·이상한 키 값은 거절하고 DB를 부르지 않는다", async () => {
    const store = setup();
    const before = store.calls.length;
    expect(await saveSubscriptionForUser(deps(store), { ...valid, endpoint: "http://fcm.googleapis.com/x" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveSubscriptionForUser(deps(store), { ...valid, endpoint: "javascript:alert(1)" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveSubscriptionForUser(deps(store), { ...valid, userId: OTHER })).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveSubscriptionForUser(deps(store), { ...valid, auth: "가나다" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveSubscriptionForUser(deps(store), { endpoint: ENDPOINT })).toEqual({ ok: false, error: "invalid_input" });
    expect(store.calls.length).toBe(before);
  });
  it("구독 개수 상한(20)에 걸리면 limit, 로그인이 없으면 unauthenticated", async () => {
    const store = setup();
    for (let i = 0; i < 20; i++) store.seed("push_subscriptions", { id: `0000000${i}`, user_id: ME, endpoint: `https://x.example/${i}` });
    expect(await saveSubscriptionForUser(deps(store), valid)).toEqual({ ok: false, error: "limit" });
    expect(await saveSubscriptionForUser(deps(store, null), valid)).toEqual({ ok: false, error: "unauthenticated" });
  });
  it("삭제는 내 구독만, 없는 것을 지워도 성공, 남의 구독은 남는다", async () => {
    const store = setup();
    store.seed("push_subscriptions", { id: "1", user_id: OTHER, endpoint: ENDPOINT });
    await saveSubscriptionForUser(deps(store), valid);
    expect(await deleteSubscriptionForUser(deps(store), ENDPOINT)).toEqual({ ok: true, data: { deleted: true } });
    expect(await deleteSubscriptionForUser(deps(store), ENDPOINT)).toEqual({ ok: true, data: { deleted: true } });
    expect(store.table("push_subscriptions").map((r) => r.user_id)).toEqual([OTHER]);
    expect(await deleteSubscriptionForUser(deps(store), "")).toEqual({ ok: false, error: "invalid_input" });
  });
});
