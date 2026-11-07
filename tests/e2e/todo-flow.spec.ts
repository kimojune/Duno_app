import fs from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Cookie } from "@playwright/test";
import { cleanupTodos } from "../integration/cleanup";
import { loadIntegrationEnv, type IntegrationEnv } from "../integration/load-env";

/**
 * 실제 흐름(production 빌드 + duno_dev 시험 계정, 방향 C): A로 로그인한 세션에서 적는 창 열기 → 「+ 분야」로 분야 더하기
 * → 그 분야를 고르고 적기 → 새로고침 뒤 글과 분야 표시가 남음 → 체크 → 새로고침 뒤 남음 → B 세션에서 A의 할 일·분야가 안 보임
 * → 시험 데이터 정리.
 *
 * 분야 정리: categories는 지우는 권한(delete grant)이 없어 시험이 지울 수 없다. 그래서 실행마다 고유 접미사를 붙인 이름
 * (「e2e분야<시각 36진수>」, 20자 안)으로 A에 분야 하나를 만들고 남긴다 — 실행마다 A의 분야가 1행 는다(상한 50, 임시).
 * 할 일은 이번 실행에서 생긴 A의 행을 cleanupTodos로 지운다. 쌓인 시험 분야는 사람이 SQL 편집기에서 지운다
 * (정리 SQL은 tests/integration/categories-rls.test.ts 머리 주석).
 * 아직 돌리지 않는다(새 표가 개발 DB에 없다). 마이그레이션을 적용한 뒤 npm run e2e.
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

/**
 * 시험 계정의 처음 설정을 마친 것으로 만든다(B10). 원샷 v2부터 설정 행이 없거나 처음 설정을 안 마친 사용자는 처음 설정 화면부터 보게 되어,
 * 이 시험이 기대하는 할 일 화면(「오늘」 머리·목록)이 뜨지 않는다. 사용자 세션으로 자기 행만 upsert한다(RLS).
 * user_settings는 지우는 권한이 없어 시험이 지우지 않는다: 한 번 마친 계정은 그대로 두고, 다시 돌려도 같은 값(마친 시각만 새로 적힌다).
 * 마이그레이션(20261107100200_user_settings.sql)이 개발 DB에 적용된 뒤에만 된다.
 */
async function markOnboardingDone(client: SupabaseClient, label: string): Promise<void> {
  const { data } = await client.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error(`${label} 사용자 번호를 읽지 못했다`);
  const { error } = await client
    .from("user_settings")
    .upsert({ user_id: userId, onboarding_done_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`${label} 처음 설정 마침 표시 실패 (code=${error.code ?? "?"}) — 새 마이그레이션이 적용됐는지 본다`);
}

test("실제 흐름: A가 적고 체크하면 새로고침 뒤에도 남고, B에게는 보이지 않으며, 시험 데이터를 정리한다", async ({ browser }) => {
  test.setTimeout(120_000);
  const env = loadIntegrationEnv();
  const A: Account = { label: "A", email: env.DUNO_TEST_A_EMAIL, password: env.DUNO_TEST_A_PASSWORD };
  const B: Account = { label: "B", email: env.DUNO_TEST_B_EMAIL, password: env.DUNO_TEST_B_PASSWORD };

  const nodeA = await nodeClient(env, A);
  await markOnboardingDone(nodeA, "A");
  await markOnboardingDone(await nodeClient(env, B), "B");
  const before = await nodeA.from("todos").select("id");
  const beforeIds = new Set((before.data ?? []).map((r: { id: string }) => r.id));

  const marker = `e2e-${Date.now().toString(36)}`;
  const short = `${marker} 짧은 글`; // 분야 없음(기타): 줄 높이 56 확인용
  const plain = `${marker} 이력서 고치기`; // 새로 더한 분야를 붙인다
  const tagged = `${marker} <b>굵게</b> <img src=x onerror="window.__xss=1">`;
  const categoryName = `e2e분야${Date.now().toString(36)}`; // 고유 접미사, 20자 안(지울 수 없는 표라 겹치지 않게)
  expect([...categoryName].length).toBeLessThanOrEqual(20);

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

    // 적는 창 열기(C5): 단추를 누르면 포커스가 할 일 칸
    await page.getByRole("button", { name: "할 일 적기" }).click();
    const todoInput = page.getByRole("textbox", { name: "할 일 적기" });
    await expect(todoInput).toBeFocused();

    // 「+ 분야」로 분야 더하기(C12~C14): 새 칩이 생기고 골라진 채, 포커스는 할 일 칸
    await expect(page.getByRole("button", { name: "+ 분야" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "+ 분야" }).click();
    await page.getByRole("textbox", { name: "새 분야 이름" }).fill(categoryName);
    await page.getByRole("button", { name: "더하기" }).click();
    const chip = page.getByRole("group", { name: "분야 (고르지 않으면 기타)" }).getByRole("button", { name: categoryName });
    await expect(chip).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(todoInput).toBeFocused();

    // 고른 분야로 적기(C7): 창은 열린 채, 칸은 비고, 고름은 풀리고, 새 줄 아래 분야 표시
    await todoInput.fill(plain);
    await page.getByRole("button", { name: "적기" }).click();
    await expect(todoInput).toHaveValue("");
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    const plainRow = page.locator("li.todo-row", { has: page.getByText(plain, { exact: true }) });
    await expect(plainRow.locator(".category-tag")).toHaveText(`분야 ${categoryName}`);

    // 분야 없이 적기: 짧은 글과, 꺾쇠·스크립트가 든 글
    for (const text of [short, tagged]) {
      await todoInput.fill(text);
      await page.getByRole("button", { name: "적기" }).click();
      await expect(todoInput).toHaveValue(""); // 첫 누름에 칸이 빈다
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      if (text === short) {
        // P1: 새 줄 높이가 적은 직후와 저장 뒤 모두 56px(「저장하는 중」이 1초 안에는 자리를 차지하지 않는다).
        // 원샷 v2의 「자세히」는 줄 오른쪽의 작은 단추(누르는 면 48px, 줄 위아래 4px씩)라 저장 뒤에도 줄 높이가 늘지 않는다(B16)
        const rowBox = page.locator("li.todo-row", { has: page.getByText(text, { exact: true }) });
        const heightNow = (await rowBox.boundingBox())!.height;
        await expect(page.getByText("저장하는 중")).toHaveCount(0, { timeout: 20_000 });
        const heightSaved = (await rowBox.boundingBox())!.height;
        expect([heightNow, heightSaved]).toEqual([56, 56]);
      }
    }
    await expect(page.getByText("저장하는 중")).toHaveCount(0, { timeout: 20_000 });

    // 새로고침 뒤에도 남는다. 분야 표시도 남는다(D-135). 꺾쇠 글은 글자 그대로 보이고 요소가 생기지 않는다.
    await page.reload();
    await expect(page.getByText(plain, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator("li.todo-row", { has: page.getByText(plain, { exact: true }) }).locator(".category-tag"),
    ).toHaveText(`분야 ${categoryName}`);
    await expect(
      page.locator("li.todo-row", { has: page.getByText(short, { exact: true }) }).locator(".category-tag"),
    ).toHaveCount(0); // 기타는 표시하지 않는다
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
    // B에게는 A의 분야도 보이지 않는다: 목록 분야 표시에도, B의 적는 창 칩에도
    await expect(pageB.getByText(categoryName, { exact: false })).toHaveCount(0);
    await pageB.getByRole("button", { name: "할 일 적기" }).click();
    await expect(pageB.getByRole("button", { name: "+ 분야" })).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByRole("button", { name: categoryName })).toHaveCount(0);

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
    // 이 화면이 서비스 워커의 손을 거쳤는지(controller)부터 본다. ready만으로는 이 페이지가 서비스 워커에 묶였다는 보장이 없다.
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { message: "화면이 서비스 워커에 묶였다" })
      .toBe(true);
    const readCache = () =>
      page.evaluate(async () => {
        const urls: string[] = [];
        for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
        return urls;
      });
    // MO-17 LOW: 예전에는 「캐시가 비어 있지 않음」을 기다렸는데, 설치 때 미리 넣는 항목(offline.html 등)만으로 바로 참이라
    // 아무것도 기다리지 않았다. 서비스 워커가 화면을 그리며 가로챈 요청을 실제로 저장한 흔적(/_next/static 항목)이 생길 때까지
    // 기다린 뒤, 화면 HTML·RSC가 없는지 본다.
    await expect
      .poll(async () => (await readCache()).filter((u) => new URL(u).pathname.startsWith("/_next/static/")).length, {
        message: "서비스 워커가 이 화면의 정적 파일을 캐시에 넣을 때까지 기다린다",
      })
      .toBeGreaterThan(0);
    const cached = await readCache();
    expect(cached.filter((u) => new URL(u).pathname === "/" || new URL(u).searchParams.has("_rsc"))).toEqual([]);
    // 읽기 길(GET /todos/today, 사용자 데이터)도 캐시에 없다(악용 10)
    expect(cached.filter((u) => new URL(u).pathname.startsWith("/todos/"))).toEqual([]);
  } finally {
    await ctxA?.close();
    await ctxB?.close();
    // 시험 데이터 정리: 이번 실행에서 새로 생긴 A의 행을 지우고 0행인지 확인한다
    const after = await nodeA.from("todos").select("id");
    const created = (after.data ?? []).map((r: { id: string }) => r.id).filter((id) => !beforeIds.has(id));
    await cleanupTodos([{ label: "A", client: nodeA, ids: created }]);
  }
});
