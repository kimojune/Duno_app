import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanupTodos } from "../integration/cleanup";
import { loadIntegrationEnv } from "../integration/load-env";
import { accountA, contextFor, markOnboardingDone, nodeClient, pollUntil, sessionCookies } from "./helpers";

/**
 * 기기 먼저 저장(고침 3바퀴)의 실제 흐름(운영 빌드 + duno_dev 시험 계정):
 *  1) 끊긴 채 할 일 적기·저녁 기록 저장 → 연결 → 서버에 한 번씩 들어간다.
 *  2) 누르면 서버 응답 전에 화면이 바뀐다(서버 Action 요청을 붙잡아 둔 채로 본다).
 *  3) 끊긴 채 못 보낸 기록이 있으면 로그아웃이 알리고, 연결 뒤 보내고 나면 기기 저장소를 지운다.
 * 저녁 기록 표는 지울 권한이 없어(쌓기만 함) 실행마다 시험 계정 A에 행이 남는다. 할 일은 이번 실행에서 만든 것을 지운다.
 */

async function ids(client: SupabaseClient, table: "todos" | "evening_logs"): Promise<Set<string>> {
  const res = await client.from(table).select("id");
  return new Set(((res.data ?? []) as { id: string }[]).map((r) => r.id));
}
const fresh = (now: Set<string>, before: Set<string>) => [...now].filter((id) => !before.has(id));

async function openApp(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByText(/\d+개 중 \d+개 끝냄/)).toBeVisible({ timeout: 30_000 });
  // 서버 사본이 한 번 도착해 기기 거울이 서버 것으로 맞춰질 때까지(첫 읽기 직후의 맞추기가 시험 중간에 끼어들지 않게)
  await page.waitForTimeout(1500);
  return page;
}

async function cleanup(nodeA: SupabaseClient, beforeTodos: Set<string>) {
  const created = fresh(await ids(nodeA, "todos"), beforeTodos);
  await cleanupTodos([{ label: "A", client: nodeA, ids: created }]);
}

test("끊긴 채 할 일 적기·저녁 기록 저장 → 연결 → 서버에 한 번씩 들어간다", async ({ browser }) => {
  test.setTimeout(150_000);
  const env = loadIntegrationEnv();
  const A = accountA(env);
  const nodeA = await nodeClient(env, A);
  await markOnboardingDone(nodeA, "A");
  const beforeTodos = await ids(nodeA, "todos");
  const beforeLogs = await ids(nodeA, "evening_logs");
  const ctx = await contextFor(browser, await sessionCookies(env, A));
  const marker = `off-${Date.now().toString(36)}`;
  const hours = 2 + (Date.now() % 20); // 2~21시간
  try {
    const page = await openApp(ctx);

    await ctx.setOffline(true);

    // 할 일 적기: 끊겼어도 막히지 않고, 안내 없이 목록에 들어가며 「저장하는 중」이 없다
    await page.getByRole("button", { name: "할 일 적기" }).click();
    const input = page.getByRole("textbox", { name: "할 일 적기" });
    await input.fill(`${marker} 끊긴 채 적음`);
    await page.getByRole("button", { name: "적기" }).click();
    await expect(page.getByText(`${marker} 끊긴 채 적음`, { exact: true })).toBeVisible({ timeout: 2_000 });
    await expect(input).toHaveValue("");
    await expect(page.getByText("저장하는 중")).toHaveCount(0);
    // 방금 적은 줄도 바로 끝냄 표시를 할 수 있다
    const box = page.getByRole("checkbox", { name: `${marker} 끊긴 채 적음` });
    await box.check();
    await expect(box).toBeChecked();
    await input.press("Escape");

    // 저녁 기록: 끊겨도 열리고(기기에서 읽는다) 저장되며 「바뀐 분야별 시간」이 보인다
    await page.getByRole("button", { name: "저녁 기록 남기기" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "나누지 않고 저장" })).toBeVisible({ timeout: 2_000 });
    // 그날 이미 남긴 기록이 있으면 그 값에서 시작하므로, 이번에 정한 시간을 직접 적는다(이번 실행마다 다른 값)
    await dialog.getByLabel("시간", { exact: true }).fill(String(hours));
    await dialog.getByLabel("분", { exact: true }).fill("0");
    await dialog.getByRole("button", { name: "나누지 않고 저장" }).click();
    await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible({ timeout: 2_000 });
    await expect(dialog.getByText("오늘 바뀐 분야별 시간")).toBeVisible();
    await dialog.getByRole("button", { name: "닫기" }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 끊긴 동안 서버에는 아무것도 없다
    await page.waitForTimeout(1500);
    expect(fresh(await ids(nodeA, "todos"), beforeTodos)).toEqual([]);
    expect(fresh(await ids(nodeA, "evening_logs"), beforeLogs)).toEqual([]);

    // 연결: 보낼 줄이 차례로 서버에 간다
    await ctx.setOffline(false);
    const arrived = await pollUntil(async () => fresh(await ids(nodeA, "todos"), beforeTodos).length === 1 && fresh(await ids(nodeA, "evening_logs"), beforeLogs).length === 1, 60_000, 250);
    expect(arrived, "연결 뒤 60초 안에 할 일 하나와 저녁 기록 하나가 서버에 들어간다").toBeGreaterThanOrEqual(0);

    // 서버에는 한 번씩만: 끝냄 표시도 들어갔고, 저녁 기록은 기기에서 정한 값 그대로
    const todoId = fresh(await ids(nodeA, "todos"), beforeTodos)[0];
    const todoRow = await nodeA.from("todos").select("done, day").eq("id", todoId).single();
    expect(todoRow.data?.done).toBe(true);
    const logId = fresh(await ids(nodeA, "evening_logs"), beforeLogs)[0];
    const logRow = await nodeA.from("evening_logs").select("total_minutes, save_mode, target_day, items, client_saved_at").eq("id", logId).single();
    expect(logRow.data).toMatchObject({ total_minutes: hours * 60, save_mode: "not_split", items: [{ categoryId: null, minutes: hours * 60 }] });
    expect(logRow.data?.client_saved_at).not.toBeNull();
    expect(logRow.data?.target_day).toBe(todoRow.data?.day);

    // 더 기다리고 새로고침해도 다시 들어가지 않는다(같은 id는 한 번만)
    await page.waitForTimeout(3000);
    await page.reload();
    await expect(page.getByText(`${marker} 끊긴 채 적음`, { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    expect(fresh(await ids(nodeA, "todos"), beforeTodos)).toHaveLength(1);
    expect(fresh(await ids(nodeA, "evening_logs"), beforeLogs)).toHaveLength(1);
    await expect(page.getByRole("checkbox", { name: `${marker} 끊긴 채 적음` })).toBeChecked();
  } finally {
    await ctx.close();
    await cleanup(nodeA, beforeTodos);
  }
});

test("누르면 서버 응답 전에 화면이 바뀐다(서버 Action 요청을 붙잡아 둔 채로)", async ({ browser }) => {
  test.setTimeout(120_000);
  const env = loadIntegrationEnv();
  const A = accountA(env);
  const nodeA = await nodeClient(env, A);
  await markOnboardingDone(nodeA, "A");
  const beforeTodos = await ids(nodeA, "todos");
  const beforeLogs = await ids(nodeA, "evening_logs");
  const ctx = await contextFor(browser, await sessionCookies(env, A));
  const marker = `hold-${Date.now().toString(36)}`;
  try {
    const page = await openApp(ctx);

    // 서버 Action(POST, next-action 머리글) 요청은 풀어 줄 때까지 붙잡아 둔다. 읽기(GET)는 그대로 보낸다
    const held: Route[] = [];
    let holding = true;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (holding && request.method() === "POST" && request.headers()["next-action"] !== undefined) {
        held.push(route);
        return;
      }
      await route.continue();
    });

    // 할 일 적기: 서버가 답하기 전에 줄이 보인다
    await page.getByRole("button", { name: "할 일 적기" }).click();
    const input = page.getByRole("textbox", { name: "할 일 적기" });
    await input.fill(`${marker} 붙잡힌 채 적음`);
    const t0 = Date.now();
    await page.getByRole("button", { name: "적기" }).click();
    await expect(page.getByText(`${marker} 붙잡힌 채 적음`, { exact: true })).toBeVisible({ timeout: 1_500 });
    const addMs = Date.now() - t0;
    // 끝냄 표시도 서버 답 없이 바뀐다
    const box = page.getByRole("checkbox", { name: `${marker} 붙잡힌 채 적음` });
    const t1 = Date.now();
    await box.check();
    await expect(box).toBeChecked();
    const doneMs = Date.now() - t1;
    await input.press("Escape");

    // 저녁 기록 저장도 서버 답 없이 끝난다
    await page.getByRole("button", { name: "저녁 기록 남기기" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "나누지 않고 저장" })).toBeVisible({ timeout: 1_500 });
    const t2 = Date.now();
    await dialog.getByRole("button", { name: "나누지 않고 저장" }).click();
    await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible({ timeout: 1_500 });
    const eveningMs = Date.now() - t2;
    await dialog.getByRole("button", { name: "닫기" }).last().click();

    // 그동안 서버 요청은 붙잡혀 있었고 서버에는 아무것도 없다
    expect(held.length, "서버 Action 요청이 아직 답을 못 받은 채 붙잡혀 있다").toBeGreaterThan(0);
    expect(fresh(await ids(nodeA, "todos"), beforeTodos)).toEqual([]);
    expect(fresh(await ids(nodeA, "evening_logs"), beforeLogs)).toEqual([]);
    console.log(`LOCALFIRST held-request check: 적기 ${addMs}ms · 끝냄 ${doneMs}ms · 저녁 기록 저장 ${eveningMs}ms (서버 요청 ${held.length}개 붙잡힘)`);

    // 풀어 주면 차례로 서버에 한 번씩 들어간다
    holding = false;
    for (const route of held.splice(0)) await route.continue().catch(() => {});
    const arrived = await pollUntil(async () => fresh(await ids(nodeA, "todos"), beforeTodos).length === 1 && fresh(await ids(nodeA, "evening_logs"), beforeLogs).length === 1, 60_000, 250);
    expect(arrived).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(2000);
    expect(fresh(await ids(nodeA, "todos"), beforeTodos)).toHaveLength(1);
    expect(fresh(await ids(nodeA, "evening_logs"), beforeLogs)).toHaveLength(1);
  } finally {
    await ctx.close();
    await cleanup(nodeA, beforeTodos);
  }
});

test("끊긴 채 못 보낸 기록이 있으면 로그아웃이 알리고, 연결 뒤 보내고 나면 기기 저장소를 지운다", async ({ browser }) => {
  test.setTimeout(120_000);
  const env = loadIntegrationEnv();
  const A = accountA(env);
  const nodeA = await nodeClient(env, A);
  await markOnboardingDone(nodeA, "A");
  const beforeTodos = await ids(nodeA, "todos");
  const ctx = await contextFor(browser, await sessionCookies(env, A));
  const marker = `out-${Date.now().toString(36)}`;
  try {
    const page = await openApp(ctx);
    await ctx.setOffline(true);
    await page.getByRole("button", { name: "할 일 적기" }).click();
    await page.getByRole("textbox", { name: "할 일 적기" }).fill(`${marker} 못 보낸 글`);
    await page.getByRole("button", { name: "적기" }).click();
    await expect(page.getByText(`${marker} 못 보낸 글`, { exact: true })).toBeVisible({ timeout: 2_000 });
    await page.getByRole("textbox", { name: "할 일 적기" }).press("Escape");

    // 끊긴 채 로그아웃: 먼저 보내 보고(못 보냄), 「보내지 못한 기록이 있어요」를 알린다. 취소하면 그대로
    await page.getByRole("button", { name: "로그아웃" }).first().click();
    await expect(page.getByText(/보내지 못한 기록이 있어요/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "취소" }).click();
    await expect(page.getByText(/보내지 못한 기록이 있어요/)).toHaveCount(0);
    await expect(page.getByText(`${marker} 못 보낸 글`, { exact: true })).toBeVisible();

    // 연결되면 보내고, 그 뒤 로그아웃하면 확인 없이 로그아웃하고 기기 저장소가 비워진다
    await ctx.setOffline(false);
    const arrived = await pollUntil(async () => fresh(await ids(nodeA, "todos"), beforeTodos).length === 1, 60_000, 250);
    expect(arrived).toBeGreaterThanOrEqual(0);
    await page.getByRole("button", { name: "로그아웃" }).first().click();
    await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible({ timeout: 30_000 });
    const left = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open("duno-local", 1);
          open.onerror = () => resolve(-1);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("kv")) return resolve(0);
            const req = db.transaction("kv", "readonly").objectStore("kv").getAllKeys();
            req.onsuccess = () => resolve((req.result as string[]).filter((k) => k.startsWith("base/") || k.startsWith("op/")).length);
            req.onerror = () => resolve(-1);
          };
        }),
    );
    expect(left, "로그아웃 뒤 기기 저장소에 거울·보낼 줄이 없다").toBe(0);
  } finally {
    await ctx.close();
    await cleanup(nodeA, beforeTodos);
  }
});
