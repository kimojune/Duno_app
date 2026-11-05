import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// public/sw.js를 가짜 self·caches 위에서 실행해, /_next/static 항목이 쌓이지 않는지 본다.
function load() {
  const store = new Map<string, Response>();
  const cache = {
    keys: async () => [...store.keys()].map((u) => new Request(u)),
    match: async (r: Request | string) => store.get(typeof r === "string" ? new URL(r, "http://x").href : r.url),
    put: async (r: Request, res: Response) => void store.set(r.url, res),
    delete: async (r: Request) => store.delete(r.url),
    addAll: async () => {},
  };
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = { location: { origin: "http://x" }, addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = h) };
  const caches = { open: async () => cache, keys: async () => ["duno-v1"], match: async () => undefined, delete: async () => true };
  const fetchFn = async () => new Response("ok");
  const src = fs.readFileSync(path.join(__dirname, "../../public/sw.js"), "utf8");
  new Function("self", "caches", "fetch", "Response", "URL", src)(self, caches, fetchFn, Response, URL);
  return { store, handlers };
}

describe("sw.js 정적 파일 캐시", () => {
  it("해시 파일이 계속 늘어도 개수가 묶이고, 아이콘·오프라인 항목은 지워지지 않는다", async () => {
    const { store, handlers } = load();
    store.set("http://x/offline.html", new Response("o"));
    for (let i = 0; i < 150; i++) {
      let done: Promise<unknown> = Promise.resolve();
      handlers.fetch({
        request: new Request(`http://x/_next/static/chunks/h${i}.js`),
        respondWith: (p: Promise<unknown>) => (done = p),
      });
      await done;
    }
    const statics = [...store.keys()].filter((u) => u.includes("/_next/static/"));
    expect(statics.length).toBeLessThanOrEqual(60);
    expect(statics).toContain("http://x/_next/static/chunks/h149.js"); // 최신은 남는다
    expect(statics).not.toContain("http://x/_next/static/chunks/h0.js"); // 오래된 것은 사라진다
    expect(store.has("http://x/offline.html")).toBe(true);
  });
});
