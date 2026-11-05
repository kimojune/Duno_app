import fs from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Cookie } from "@playwright/test";
import { cleanupTodos } from "../integration/cleanup";
import { loadIntegrationEnv, type IntegrationEnv } from "../integration/load-env";

/**
 * 실제 흐름(production 빌드 + duno_dev 시험 계정): A로 로그인한 세션에서 적기 → 새로고침 뒤 남음 → 체크 → 새로고침 뒤 남음
 * → B 세션에서 A의 할 일이 안 보임 → 시험 데이터 정리.
 *
 * 로그인은 화면(OAuth)으로 하지 않는다. Node에서 @supabase/ssr 서버 클라이언트로 signInWithPassword를 하고,
 * 그때 쓰려던 쿠키를 받아 브라우저 컨텍스트에 넣는다. 비밀번호·토큰을 page.evaluate·addInitScript로 브라우저에 넘기지 않는다.
 * 다른 시험(a~g)과 독립이다: 이 파일이 실패해도 다른 파일 시험은 그대로 돈다(건너뛰기 없음).
 */

type Account = { label: "A" | "B"; email: string; password: string };

/** Node에서 로그인하고, @supabase/ssr이 쓰려던 쿠키를 Playwright 쿠키로 바꿔 돌려준다. */
async function sessionCookies(env: IntegrationEnv, account: Account): Promise<Cookie[]> {
  const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, c]) => ({ name, value: c.value })),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) jar.set(name, { value, options: options ?? {} });
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error(`${account.label} 로그인 실패 (status=${error.status ?? "?"}, code=${error.code ?? "?"})`);
  return [...jar.entries()]
    .filter(([, c]) => c.value !== "")
    .map(([name, c]) => {
      const maxAge = typeof c.options.maxAge === "number" ? c.options.maxAge : undefined;
      return {
        name,
        value: c.value,
        domain: "localhost",
        path: "/",
        expires: maxAge ? Math.floor(Date.now() / 1000) + maxAge : -1,
        httpOnly: Boolean(c.options.httpOnly),
        secure: false,
        sameSite: "Lax",
      } satisfies Cookie;
    });
}

async function contextFor(browser: import("@playwright/test").Browser, cookies: Cookie[]): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  await context.addCookies(cookies);
  return context;
}

async function nodeClient(env: IntegrationEnv, account: Account): Promise<SupabaseClient> {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error(`${account.label} 시험 정리용 로그인 실패 (code=${error.code ?? "?"})`);
  return client;
}

test("실제 흐름: A가 적고 체크하면 새로고침 뒤에도 남고, B에게는 보이지 않으며, 시험 데이터를 정리한다", async ({ browser }) => {
  test.setTimeout(120_000);
  const env = loadIntegrationEnv();
  const A: Account = { label: "A", email: env.DUNO_TEST_A_EMAIL, password: env.DUNO_TEST_A_PASSWORD };
  const B: Account = { label: "B", email: env.DUNO_TEST_B_EMAIL, password: env.DUNO_TEST_B_PASSWORD };

  const nodeA = await nodeClient(env, A);
  const before = await nodeA.from("todos").select("id");
  const beforeIds = new Set((before.data ?? []).map((r: { id: string }) => r.id));

  const marker = `e2e-${Date.now().toString(36)}`;
  const plain = `${marker} 이력서 고치기`;
  const tagged = `${marker} <b>굵게</b> <img src=x onerror="window.__xss=1">`;

  let ctxA: BrowserContext | undefined;
  let ctxB: BrowserContext | undefined;
  try {
    ctxA = await contextFor(browser, await sessionCookies(env, A));
    const page = await ctxA.newPage();
    await page.goto("/");

    // 할 일 화면이 떴고 목록이 불러와졌다. 여기서 막히면 원인(표 없음 등)이 T9 안내로 보인다.
    await expect(page.getByRole("heading", { name: "오늘" })).toBeVisible();
    await expect(
      page.getByText(/\d+개 중 \d+개 끝냄/),
      "목록 불러오기 실패(T9)면 원격 표가 아직 없는지부터 본다",
    ).toBeVisible({ timeout: 20_000 });

    // 진짜 앱 화면 스크린샷(360x800). 가짜 데이터 상태 모음과 따로, 파일 이름에 live를 붙인다
    fs.mkdirSync("test-results/screens", { recursive: true });
    await page.screenshot({ path: "test-results/screens/live-T2-empty-360x800.png" });

    // 적기: 일반 글과, 꺾쇠·스크립트가 든 글
    for (const text of [plain, tagged]) {
      await page.getByLabel("할 일 적기").fill(text);
      await page.getByRole("button", { name: "적기" }).click();
      await expect(page.getByLabel("할 일 적기")).toHaveValue(""); // 첫 누름에 칸이 빈다
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      if (text === plain) {
        // P1: 새 줄 높이가 적은 직후와 저장 뒤 모두 56px(「저장하는 중」이 1초 안에는 자리를 차지하지 않는다)
        const rowBox = page.locator("li.todo-row", { has: page.getByText(text, { exact: true }) });
        const heightNow = (await rowBox.boundingBox())!.height;
        await expect(page.getByText("저장하는 중")).toHaveCount(0, { timeout: 20_000 });
        const heightSaved = (await rowBox.boundingBox())!.height;
        expect([heightNow, heightSaved]).toEqual([56, 56]);
      }
    }
    await expect(page.getByText("저장하는 중")).toHaveCount(0, { timeout: 20_000 });

    // 새로고침 뒤에도 남는다. 꺾쇠 글은 글자 그대로 보이고 요소가 생기지 않는다.
    await page.reload();
    await expect(page.getByText(plain, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(tagged, { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/screens/live-T3-after-add-360x800.png" });
    expect(await page.locator("main b, main img").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

    // 체크 → 새로고침 뒤에도 남는다
    const box = page.getByRole("checkbox", { name: plain });
    await expect(box).not.toBeChecked();
    // setTodoDone를 특정한다: Server Action 요청은 Next-Action 헤더가 있고 본문에 [id, true]가 실린다
    const saved = page.waitForResponse((r) => {
      const req = r.request();
      return req.method() === "POST" && req.headers()["next-action"] !== undefined && (req.postData() ?? "").includes("true");
    });
    await box.check();
    await saved;
    await page.reload();
    await expect(page.getByRole("checkbox", { name: plain })).toBeChecked({ timeout: 20_000 });

    // 로그아웃 뒤 같은 기기에서: 로그인 화면이고, 서비스 워커 캐시에 할 일 화면·데이터가 없다
    // (로그아웃은 B 확인 뒤에 따로 한다)

    // B 세션에서는 A의 할 일이 보이지 않는다
    ctxB = await contextFor(browser, await sessionCookies(env, B));
    const pageB = await ctxB.newPage();
    await pageB.goto("/");
    await expect(pageB.getByText(/\d+개 중 \d+개 끝냄/)).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByText(marker, { exact: false })).toHaveCount(0);

    // 로그아웃 → 로그인 화면, 뒤로 가기·캐시에 할 일이 남지 않는다
    // 뒤로 갈 기록이 확실히 있게, 서로 다른 주소(?from=todo)의 할 일 화면에서 로그아웃한다
    await page.goto("/?from=todo");
    await expect(page.getByText(marker, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible({ timeout: 20_000 });
    expect(page.url()).not.toContain("from=todo"); // 로그아웃 뒤에는 "/"
    // 뒤로 가기: 실패를 삼키지 않는다. 실제로 이전 주소로 갔는지(history가 있었다는 것)를 먼저 본다.
    // (앱 안 이동은 같은 문서 기록이라 goBack의 반환값이 null일 수 있다. 반환값이 아니라 주소가 실제로 바뀌었는지 본다)
    await page.goBack();
    await expect(page, "이전 주소(?from=todo)로 실제로 돌아갔다").toHaveURL(/from=todo/);
    // 로그아웃 뒤라 뒤로 가도 로그인 화면이 보이고, 그다음에 할 일 글이 0이다
    await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(marker, { exact: false })).toHaveCount(0);
    await page.goto("/"); // 캐시를 읽을 수 있는 같은 출처 화면
    await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible();
    // 서비스 워커가 준비될 때까지 기다린 뒤(다시 열어 탐색을 맡게 하고) 캐시를 본다
    await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    await page.reload();
    // reload 직후에는 서비스 워커가 아직 캐시를 채우는 중일 수 있어, 목록이 찰 때까지 web-first로 기다린 뒤 단언한다
    const readCache = () =>
      page.evaluate(async () => {
        const urls: string[] = [];
        for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
        return urls;
      });
    await expect.poll(async () => (await readCache()).length, { message: "캐시 목록이 비어 있지 않아야 한다" }).toBeGreaterThan(0);
    const cached = await readCache();
    expect(cached.length, "캐시 목록이 비어 있지 않아야 아래 단언이 의미가 있다").toBeGreaterThan(0);
    expect(cached.filter((u) => new URL(u).pathname === "/" || new URL(u).searchParams.has("_rsc"))).toEqual([]);
  } finally {
    await ctxA?.close();
    await ctxB?.close();
    // 시험 데이터 정리: 이번 실행에서 새로 생긴 A의 행을 지우고 0행인지 확인한다
    const after = await nodeA.from("todos").select("id");
    const created = (after.data ?? []).map((r: { id: string }) => r.id).filter((id) => !beforeIds.has(id));
    await cleanupTodos([{ label: "A", client: nodeA, ids: created }]);
  }
});
