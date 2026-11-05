import { expect, test } from "@playwright/test";
import fs from "node:fs";

const BASE = "http://localhost:3100";

test("a. 360x800에서 로그인 단추가 보이고 가로 스크롤이 없다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  fs.mkdirSync("test-results/screens", { recursive: true });
  await page.screenshot({ path: "test-results/screens/home-360x800.png", fullPage: true });
});

test("b. manifest", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/json/);
  const m = await res.json();
  expect(m).toMatchObject({ name: "duno", short_name: "duno", id: "/", start_url: "/", display: "standalone" });
  const icons = m.icons as { sizes: string; purpose?: string }[];
  expect(icons.some((i) => i.sizes === "192x192" && i.purpose === "any")).toBe(true);
  expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
  expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
});

test("c. sw.js 헤더", async ({ request }) => {
  const res = await request.get("/sw.js", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/javascript/);
  expect(res.headers()["cache-control"]).toContain("no-cache");
});

test("d·e. 서비스 워커가 활성화되고, 화면 HTML·/auth/ 는 캐시에 없다", async ({ page }) => {
  await page.goto("/");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(`${BASE}/`);

  // 서비스 워커가 화면 탐색을 다루게 한 뒤(다시 열기), 캐시를 본다
  await page.reload();
  await page.goto("/auth/callback?code=x");
  await page.goto("/");
  const urls = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) out.push(req.url);
    }
    return out;
  });
  expect(urls.length).toBeGreaterThan(0);
  expect(urls).toContain(`${BASE}/offline.html`); // 오프라인 화면은 저장돼 있다
  expect(urls).not.toContain(`${BASE}/`);
  expect(urls.filter((u) => new URL(u).pathname.startsWith("/auth/"))).toEqual([]);
  expect(urls.filter((u) => new URL(u).pathname === "/" || new URL(u).searchParams.has("_rsc"))).toEqual([]);
});

test("e'. 연결이 끊기면 오프라인 안내 화면이 나온다", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  await page.reload(); // 이 시점부터 서비스 워커가 탐색을 다룬다
  await context.setOffline(true);
  await page.goto("/").catch(() => {});
  await expect(page.getByText("인터넷에 연결되지 않았어요.")).toBeVisible(); // 오프라인 화면 O1 문구
  await context.setOffline(false);
});

test("f. 콜백 next가 외부 호스트로 가지 않는다", async ({ request }) => {
  const nexts = ["//evil.example", "https://evil.example", String.raw`/\evil.example`,"/%09/evil.example"];
  for (const next of nexts) {
    const res = await request.get(`/auth/callback?code=wrong&next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers()["location"];
    expect(new URL(location, BASE).origin).toBe(BASE);
    expect(location).not.toContain("evil.example");
    // 오류 상세를 URL에 내지 않는다
    expect(new URL(location, BASE).search).toMatch(/^\?error=(login|config|cancelled)$/);
  }
  // code 없음
  const res = await request.get("/auth/callback", { maxRedirects: 0 });
  expect(new URL(res.headers()["location"], BASE).origin).toBe(BASE);
});

test("f'. 콜백: Google 취소는 cancelled, 그 밖의 오류는 login (D2)", async ({ request }) => {
  const cases: [string, RegExp][] = [
    ["error=access_denied", /^\?error=(cancelled|config)$/],
    ["error=server_error&error_description=x", /^\?error=(login|config)$/],
    ["error=access_denied&next=%2F%2Fevil.example", /^\?error=(cancelled|config)$/],
  ];
  for (const [query, expected] of cases) {
    const res = await request.get(`/auth/callback?${query}`, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers()["location"];
    expect(new URL(location, BASE).origin).toBe(BASE);
    expect(location).not.toContain("evil.example");
    expect(new URL(location, BASE).search).toMatch(expected);
  }
});

test("g. 아이콘이 로그인으로 리다이렉트되지 않고 200", async ({ request }) => {
  for (const p of ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/offline.html"]) {
    const res = await request.get(p, { maxRedirects: 0 });
    expect(res.status(), p).toBe(200);
  }
});

test("h. 개발용 상태 모음·방향 B 화면은 production 서버에 없다 (404)", async ({ request }) => {
  for (const p of ["/dev/states", "/dev/states?s=T3&d=B", "/dev"]) {
    const res = await request.get(p, { maxRedirects: 0 });
    expect(res.status(), p).toBe(404);
  }
});
