import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown) => void;
type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<Response>;

// public/sw.js를 가짜 self 위에서 실행해 알림(push·notificationclick) 처리를 본다.
// fetchFn은 서비스 워커가 서버에 「지금 보낼 알림이 무엇인가」를 묻는 요청의 가짜 답이다(기본: 끊김).
function load(fetchFn: FetchLike = async () => Promise.reject(new Error("offline"))) {
  const handlers: Record<string, Handler> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  let windows: unknown[] = [];
  const self = {
    location: { origin: "http://x" },
    addEventListener: (type: string, handler: Handler) => (handlers[type] = handler),
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  const caches = { open: async () => ({}), keys: async () => [], match: async () => undefined, delete: async () => true };
  const src = fs.readFileSync(path.join(__dirname, "../../public/sw.js"), "utf8");
  const fetched: { url: string; init?: Record<string, unknown> }[] = [];
  const fetchSpy: FetchLike = async (url, init) => {
    fetched.push({ url, init });
    return fetchFn(url, init);
  };
  new Function("self", "caches", "fetch", "Response", "URL", src)(self, caches, fetchSpy, Response, URL);
  return {
    fetched,
    handlers,
    shown,
    opened,
    navigated,
    setWindows: (list: unknown[]) => (windows = list),
  };
}

async function fire(handler: Handler, event: Record<string, unknown>) {
  let done: Promise<unknown> = Promise.resolve();
  handler({ ...event, waitUntil: (p: Promise<unknown>) => (done = p) });
  await done;
}

afterEach(() => vi.useRealTimers());

const answer = (items: unknown) => async () => Response.json({ ok: true, data: { items } });
const EVENING_ITEM = { kind: "evening", title: "오늘 기록", body: "오늘 몇 시간 썼는지 적어 둘까요?", tag: "duno-evening", url: "/?open=evening" };
const MORNING_ITEM = { kind: "morning", title: "오늘 먼저 할 일", body: "앱을 열어 오늘 할 일을 시작해 보세요", tag: "duno-morning", url: "/" };
const BAD_WORDS = /빨리|꼭|안 하면|밀렸|부족|놓치/;

describe("sw.js 알림 (7-8, ⑦, 고침 3바퀴: 서버에 묻는다)", () => {
  it("신호가 오면 서버에 지금 보낼 알림을 묻는다(로그인 쿠키로, 저장 없이)", async () => {
    const sw = load(answer([EVENING_ITEM]));
    await fire(sw.handlers.push, {});
    expect(sw.fetched).toHaveLength(1);
    expect(sw.fetched[0].url).toBe("/api/notify/next");
    expect(sw.fetched[0].init).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  });
  it("서버가 저녁 알림이라 하면 「오늘 기록」을 보이고, 누르면 오늘 기록 주소를 연다", async () => {
    const sw = load(answer([EVENING_ITEM]));
    await fire(sw.handlers.push, {});
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe("오늘 기록");
    expect(sw.shown[0].options).toMatchObject({ body: "오늘 몇 시간 썼는지 적어 둘까요?", tag: "duno-evening", data: { url: "/?open=evening" } });
  });
  it("서버가 아침 알림이라 하면 아침 알림을 보이고, 누르면 앱 처음 화면을 연다", async () => {
    const sw = load(answer([MORNING_ITEM]));
    await fire(sw.handlers.push, {});
    expect(sw.shown[0].title).toBe("오늘 먼저 할 일");
    expect(sw.shown[0].options).toMatchObject({ tag: "duno-morning", data: { url: "/" } });
  });
  it("알림 종류는 시각이 아니라 서버의 답을 따른다: 서울 오전 10시에도 저녁 알림이 나온다(시각 범위를 막지 않는다)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T01:00:00.000Z")); // 서울 10:00
    const sw = load(answer([EVENING_ITEM]));
    await fire(sw.handlers.push, {});
    expect(sw.shown[0].title).toBe("오늘 기록");
    vi.setSystemTime(new Date("2026-11-07T10:30:00.000Z")); // 서울 19:30
    const sw2 = load(answer([MORNING_ITEM]));
    await fire(sw2.handlers.push, {});
    expect(sw2.shown[0].title).toBe("오늘 먼저 할 일");
  });
  it("두 알림이 같은 때면 둘 다 따로 보인다(태그가 달라 하나로 합쳐지지 않는다)", async () => {
    const sw = load(answer([EVENING_ITEM, MORNING_ITEM]));
    await fire(sw.handlers.push, {});
    expect(sw.shown.map((n) => n.options.tag)).toEqual(["duno-evening", "duno-morning"]);
  });
  it("서버에 닿지 못하거나 거절하거나 보낼 알림이 없다 하면 시각을 짐작하지 않고 중립 알림 하나를 보인다", async () => {
    const cases: FetchLike[] = [
      async () => Promise.reject(new Error("offline")),
      async () => Response.json({ ok: false, error: "unauthenticated" }, { status: 401 }),
      async () => new Response("<html>", { status: 200 }),
      answer([]),
      answer([{ title: 1 }, null, "x"]),
    ];
    for (const fetchFn of cases) {
      const sw = load(fetchFn);
      await fire(sw.handlers.push, {});
      expect(sw.shown).toHaveLength(1);
      expect(sw.shown[0].title).toBe("두노");
      expect(sw.shown[0].options).toMatchObject({ tag: "duno-neutral", data: { url: "/" } });
    }
  });
  it("서버가 준 주소가 앱 안(/로 시작, //가 아님)이 아니면 처음 화면으로만 간다", async () => {
    const sw = load(answer([{ ...EVENING_ITEM, url: "https://evil.example/" }, { ...MORNING_ITEM, tag: "t2", url: "//evil.example/" }]));
    await fire(sw.handlers.push, {});
    expect(sw.shown.map((n) => (n.options.data as { url: string }).url)).toEqual(["/", "/"]);
  });
  it("알림 글에 재촉·평가하는 말이 없다", async () => {
    for (const item of [EVENING_ITEM, MORNING_ITEM]) {
      const sw = load(answer([item]));
      await fire(sw.handlers.push, {});
      expect(`${sw.shown[0].title} ${sw.shown[0].options.body}`).not.toMatch(BAD_WORDS);
    }
    const neutral = load();
    await fire(neutral.handlers.push, {});
    expect(`${neutral.shown[0].title} ${neutral.shown[0].options.body}`).not.toMatch(BAD_WORDS);
  });
  it("알림을 누르면 알림을 닫고, 열린 창이 없으면 새 창을 연다", async () => {
    const sw = load();
    const closed = vi.fn();
    await fire(sw.handlers.notificationclick, { notification: { close: closed, data: { url: "/?open=evening" } } });
    expect(closed).toHaveBeenCalled();
    expect(sw.opened).toEqual(["/?open=evening"]);
  });
  it("열린 창이 있으면 그 창을 그 주소로 옮기고 앞으로 가져온다", async () => {
    const sw = load();
    const focus = vi.fn(async () => {});
    const navigate = vi.fn(async () => ({ focus }));
    sw.setWindows([{ navigate, focus }]);
    await fire(sw.handlers.notificationclick, { notification: { close: vi.fn(), data: { url: "/?open=evening" } } });
    expect(navigate).toHaveBeenCalledWith("/?open=evening");
    expect(focus).toHaveBeenCalled();
    expect(sw.opened).toEqual([]);
  });
  it("주소가 앱 안(/로 시작)이 아니면 처음 화면으로만 간다", async () => {
    const sw = load();
    await fire(sw.handlers.notificationclick, { notification: { close: vi.fn(), data: { url: "https://evil.example/" } } });
    await fire(sw.handlers.notificationclick, { notification: { close: vi.fn(), data: null } });
    await fire(sw.handlers.notificationclick, { notification: { close: vi.fn(), data: { url: "//evil.example/" } } });
    expect(sw.opened).toEqual(["/", "/", "/"]);
  });
});
