import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown) => void;

// public/sw.js를 가짜 self 위에서 실행해 알림(push·notificationclick) 처리를 본다.
function load() {
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
  new Function("self", "caches", "fetch", "Response", "URL", src)(self, caches, async () => new Response("ok"), Response, URL);
  return {
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

describe("sw.js 알림 (7-8, ⑦)", () => {
  it("저녁(서울 오후 3시 이후)에 신호가 오면 「오늘 기록」을 보이고, 누르면 저녁 기록 주소를 연다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T10:30:00.000Z")); // 서울 19:30
    const sw = load();
    await fire(sw.handlers.push, {});
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe("오늘 기록");
    expect(sw.shown[0].options).toMatchObject({ body: "오늘 몇 시간 썼어요?", tag: "duno-evening", data: { url: "/?open=evening" } });
  });
  it("아침(서울 오후 3시 전)에 신호가 오면 아침 알림을 보이고, 누르면 앱 처음 화면을 연다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T01:00:00.000Z")); // 서울 10:00
    const sw = load();
    await fire(sw.handlers.push, {});
    expect(sw.shown[0].title).toBe("오늘 먼저 할 일");
    expect(sw.shown[0].options).toMatchObject({ tag: "duno-morning", data: { url: "/" } });
  });
  it("알림 글에 재촉·평가하는 말이 없다", async () => {
    vi.useFakeTimers();
    for (const iso of ["2026-11-07T01:00:00.000Z", "2026-11-07T10:30:00.000Z"]) {
      vi.setSystemTime(new Date(iso));
      const sw = load();
      await fire(sw.handlers.push, {});
      expect(`${sw.shown[0].title} ${sw.shown[0].options.body}`).not.toMatch(/빨리|꼭|안 하면|밀렸|부족|놓치/);
    }
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
    expect(sw.opened).toEqual(["/", "/"]);
  });
});
