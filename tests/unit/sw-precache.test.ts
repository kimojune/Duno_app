import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// public/sw.js를 가짜 self·caches 위에서 실행해 install·activate·알림 아이콘을 본다(고침10 K).
type Handler = (e: unknown) => void;
function load(existingCaches: string[] = []) {
  const added: string[][] = [];
  const opened: string[] = [];
  const deleted: string[] = [];
  const shown: { title: string; options: { icon?: string } }[] = [];
  const handlers: Record<string, Handler> = {};
  const self = {
    location: { origin: "http://x" },
    addEventListener: (t: string, h: Handler) => (handlers[t] = h),
    registration: { showNotification: async (title: string, options: { icon?: string }) => void shown.push({ title, options }) },
  };
  const cache = { addAll: async (urls: string[]) => void added.push(urls), keys: async () => [], match: async () => undefined, put: async () => {}, delete: async () => true };
  const caches = {
    open: async (name: string) => (opened.push(name), cache),
    keys: async () => existingCaches,
    match: async () => undefined,
    delete: async (name: string) => (deleted.push(name), true),
  };
  const fetchFn = async () => new Response(JSON.stringify({ ok: true, data: { items: [] } }), { status: 200 });
  const src = fs.readFileSync(path.join(__dirname, "../../public/sw.js"), "utf8");
  new Function("self", "caches", "fetch", "Response", "URL", "AbortController", "setTimeout", "clearTimeout", src)(self, caches, fetchFn, Response, URL, AbortController, setTimeout, clearTimeout);
  return { handlers, added, opened, deleted, shown, src };
}
const run = async (handler: Handler, extra: Record<string, unknown> = {}) => {
  let done: Promise<unknown> = Promise.resolve();
  handler({ ...extra, waitUntil: (p: Promise<unknown>) => (done = p) });
  await done;
};

describe("sw.js 판·아이콘 (고침10 K)", () => {
  it("캐시 판은 v3보다 올라갔고, install이 새 이름 아이콘 셋을 미리 저장한다(옛 이름은 더 저장하지 않는다)", async () => {
    const { handlers, added, opened } = load();
    await run(handlers.install);
    expect(opened).toEqual(["duno-v4"]);
    expect(added[0]).toEqual(["/offline.html", "/manifest.webmanifest", "/icon-v2-192.png", "/icon-v2-512.png", "/icon-v2-maskable-512.png"]);
    expect(added[0].some((u) => /^\/icon-(192|512|maskable-512)\.png$/.test(u))).toBe(false);
  });

  it("activate는 자기 판(duno-v4)이 아닌 옛 duno-* 캐시만 지운다 — 남의 캐시는 건드리지 않는다", async () => {
    const { handlers, deleted } = load(["duno-v1", "duno-v3", "duno-v4", "other-app-v3"]);
    await run(handlers.activate);
    expect(deleted.sort()).toEqual(["duno-v1", "duno-v3"]);
  });

  it("아이콘 캐시 규칙이 새 이름(icon-v2-*.png)도 잡는다 — 캐시 먼저 응답", async () => {
    const { handlers } = load();
    for (const p of ["/icon-v2-192.png", "/icon-v2-512.png", "/icon-v2-maskable-512.png"]) {
      let responded = false;
      handlers.fetch({ request: new Request("http://x" + p), respondWith: () => (responded = true) });
      expect(responded, p).toBe(true);
    }
    let other = false;
    handlers.fetch({ request: new Request("http://x/icons/evil.png"), respondWith: () => (other = true) });
    expect(other).toBe(false);
  });

  it("sw 파일 주소는 그대로(/sw.js)이고 알림 아이콘은 새 이름이다", async () => {
    const { handlers, shown, src } = load();
    await run(handlers.push);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((n) => n.options.icon === "/icon-v2-192.png")).toBe(true);
    expect(src).not.toMatch(/"\/icon-(192|512|maskable-512)\.png"/);
    expect(fs.existsSync(path.join(__dirname, "../../public/sw.js"))).toBe(true);
  });
});
