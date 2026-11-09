import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runNotifyTick = vi.fn();
const createClient = vi.fn(() => ({ fakeAdmin: true }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (...a: unknown[]) => createClient(...(a as [])) }));
vi.mock("../../lib/push/tick", () => ({ runNotifyTick: (...a: unknown[]) => runNotifyTick(...a) }));
const sendPushSignal = vi.fn();
vi.mock("../../lib/push/send", () => ({ sendPushSignal: (...a: unknown[]) => sendPushSignal(...a) }));

import { GET, POST } from "../../app/api/notify/tick/route";

// 시험용 가짜 설정(비밀 아님). 이름과 값을 따로 둔다
const ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
];
const ENV_VALUES = ["https://x.supabase.co", "dummy-role-a1", "dummy-cron-b2", "dummy-pub-c3", "dummy-priv-d4", "mailto:duno@example.com"];
const FULL_ENV: Record<string, string> = Object.fromEntries(ENV_NAMES.map((name, i) => [name, ENV_VALUES[i]]));
function setEnv(env: Record<string, string>) {
  for (const key of Object.keys(FULL_ENV)) vi.stubEnv(key, "");
  vi.stubEnv("NOTIFY_TICK_MINUTES", "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}
const call = (handler: typeof GET, secret?: string) =>
  handler(new Request("http://localhost/api/notify/tick", { headers: secret === undefined ? {} : { authorization: `Bearer ${secret}` } }));

beforeEach(() => {
  runNotifyTick.mockReset();
  createClient.mockClear();
  sendPushSignal.mockReset();
  runNotifyTick.mockResolvedValue({ ok: true, data: { dueUsers: 1, sent: 1, gone: 0, failed: 0 } });
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/notify/tick (알림 예약 실행 주소)", () => {
  it("예약 비밀이 서버 설정에 없으면 어떤 값을 보내도 401이다(다른 설정이 있는지 없는지 알리지 않고, 아무것도 안 한다) (A9)", async () => {
    setEnv({});
    for (const secret of [undefined, "", "anything"]) {
      const res = await call(POST, secret);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    }
    expect(createClient).not.toHaveBeenCalled();
    expect(runNotifyTick).not.toHaveBeenCalled();
  });
  it("비밀이 맞고 서버 키·푸시 서명 키가 없으면 아무것도 안 하고 503 not_configured", async () => {
    setEnv({ CRON_SECRET: FULL_ENV.CRON_SECRET });
    const res = await call(POST, FULL_ENV.CRON_SECRET);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "not_configured" });
    expect(createClient).not.toHaveBeenCalled();
    expect(runNotifyTick).not.toHaveBeenCalled();
  });
  it("비밀이 틀리면 다른 설정이 없어도 401이다(설정이 있는지 알리지 않는다) (A9)", async () => {
    setEnv({ CRON_SECRET: FULL_ENV.CRON_SECRET });
    expect((await call(POST, "wrong")).status).toBe(401);
  });
  it("푸시 서명 키 하나만 빠져도 not_configured", async () => {
    setEnv({ ...FULL_ENV, VAPID_PRIVATE_KEY: "" });
    expect((await call(POST, FULL_ENV.CRON_SECRET)).status).toBe(503);
    expect(runNotifyTick).not.toHaveBeenCalled();
  });
  it("예약 비밀이 없거나 틀리면 401이고 서버 키 클라이언트도 만들지 않는다", async () => {
    setEnv(FULL_ENV);
    for (const secret of [undefined, "", "wrong", FULL_ENV.CRON_SECRET + "x", FULL_ENV.CRON_SECRET.slice(1)]) {
      const res = await call(POST, secret);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    }
    expect(createClient).not.toHaveBeenCalled();
    expect(runNotifyTick).not.toHaveBeenCalled();
  });
  it("맞는 비밀이면 실행하고 개수만 돌려준다(GET·POST 모두)", async () => {
    setEnv(FULL_ENV);
    for (const handler of [GET, POST]) {
      const res = await call(handler, FULL_ENV.CRON_SECRET);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: true, data: { dueUsers: 1, sent: 1, gone: 0, failed: 0 } });
    }
    expect(createClient).toHaveBeenCalledWith("https://x.supabase.co", FULL_ENV.SUPABASE_SERVICE_ROLE_KEY, expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }));
    expect(runNotifyTick.mock.calls[0][0]).toMatchObject({ windowMinutes: 15 });
  });
  it("간격 설정(NOTIFY_TICK_MINUTES)은 1~120의 정수일 때만 쓰고 아니면 15", async () => {
    setEnv({ ...FULL_ENV, NOTIFY_TICK_MINUTES: "30" });
    await call(POST, FULL_ENV.CRON_SECRET);
    expect(runNotifyTick.mock.calls[0][0]).toMatchObject({ windowMinutes: 30 });
    setEnv({ ...FULL_ENV, NOTIFY_TICK_MINUTES: "0" });
    await call(POST, FULL_ENV.CRON_SECRET);
    expect(runNotifyTick.mock.calls[1][0]).toMatchObject({ windowMinutes: 15 });
    setEnv({ ...FULL_ENV, NOTIFY_TICK_MINUTES: "abc" });
    await call(POST, FULL_ENV.CRON_SECRET);
    expect(runNotifyTick.mock.calls[2][0]).toMatchObject({ windowMinutes: 15 });
  });
  it("실행이 실패하거나 예외가 나도 짧은 코드만 돌려준다(원문 없음)", async () => {
    setEnv(FULL_ENV);
    runNotifyTick.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    const failed = await call(POST, FULL_ENV.CRON_SECRET);
    expect(failed.status).toBe(503);
    runNotifyTick.mockRejectedValueOnce(new Error("secret detail"));
    const thrown = await call(POST, FULL_ENV.CRON_SECRET);
    expect(thrown.status).toBe(503);
    expect(JSON.stringify(await thrown.json())).not.toContain("secret");
  });
});

// d-214: 예약 비밀 입구를 넓게 못 박는다(GET·POST 모두, 아무것도 안 불린다)
describe("/api/notify/tick 예약 비밀 입구 (d-214)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const nothingCalled = () => {
    expect(createClient).not.toHaveBeenCalled();
    expect(runNotifyTick).not.toHaveBeenCalled();
    expect(sendPushSignal).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  };

  it("서버 설정에 예약 비밀이 없거나·빈칸·공백뿐이면 어떤 값을 보내도 GET·POST 모두 401이고 아무것도 안 불린다", async () => {
    for (const configured of ["", "   "]) {
      setEnv({ ...FULL_ENV, CRON_SECRET: configured });
      for (const handler of [GET, POST]) {
        for (const sent of [undefined, "", " ", "   ", "anything", FULL_ENV.CRON_SECRET]) {
          const res = await call(handler, sent);
          expect(res.status).toBe(401);
          expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
        }
      }
    }
    nothingCalled();
  });
  it("보낸 값이 없거나·빈칸·틀리거나·한 글자 더하거나 빼면 GET·POST 모두 401이고 아무것도 안 불린다", async () => {
    setEnv(FULL_ENV);
    const secret = FULL_ENV.CRON_SECRET;
    const wrong = [undefined, "", " ", "wrong", secret + "x", secret.slice(1), secret.slice(0, -1), "x" + secret, secret.toUpperCase(), ` ${secret}`];
    for (const handler of [GET, POST]) {
      for (const sent of wrong) {
        const res = await call(handler, sent);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
      }
      // Bearer 꼴이 아닌 머리글도 거절
      for (const raw of [secret, `Basic ${secret}`, `bearer ${secret}`]) {
        const res = await handler(new Request("http://localhost/api/notify/tick", { headers: { authorization: raw } }));
        expect(res.status).toBe(401);
      }
    }
    nothingCalled();
  });
  it("양성 대조: 맞는 비밀과 설정이면 실행하고 200이다(GET·POST 모두)", async () => {
    setEnv(FULL_ENV);
    for (const handler of [GET, POST]) {
      const res = await call(handler, FULL_ENV.CRON_SECRET);
      expect(res.status).toBe(200);
    }
    expect(runNotifyTick).toHaveBeenCalledTimes(2);
    expect(createClient).toHaveBeenCalledTimes(2);
  });
});
