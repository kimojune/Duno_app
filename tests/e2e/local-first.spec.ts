import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanupTodos } from "../integration/cleanup";
import { loadIntegrationEnv } from "../integration/load-env";
import { accountA, contextFor, markOnboardingDone, nodeClient, pollUntil, sessionCookies } from "./helpers";
import { fillWheel } from "./wheel";

/** 고침10 E: 할 일 머리의 「로그아웃」은 없다. 로그아웃은 내 정보 탭 맨 아래 단추 한 곳 — 누르면 할 일 탭의 로그아웃 흐름(확인 창 · 막힘)을 건다 */
async function logoutFromMe(page: import("@playwright/test").Page) {
  await page.getByRole("navigation", { name: "화면 이동" }).getByRole("button", { name: "내 정보" }).click();
  await page.locator("#me-logout-button").click();
}


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

/**
 * 이번 시험이 만든 저녁 기록만(고침 4바퀴): 시작 때 없던 행 가운데 기기 저장 시각(client_saved_at)이 이 시험 시작 뒤인 것.
 * 저녁 기록 표는 지울 수 없어(쌓기만 함) 앞 시험(latency 등)이 남긴 행이 늦게 도착해도 세지 않게 한다.
 */
async function freshLogs(client: SupabaseClient, before: Set<string>, sinceMs: number): Promise<string[]> {
  const res = await client.from("evening_logs").select("id, client_saved_at");
  if (res.error) throw new Error(`저녁 기록을 읽지 못했다: ${res.error.code ?? "unknown"}`);
  return ((res.data ?? []) as { id: string; client_saved_at: string | null }[])
    .filter((r) => !before.has(r.id) && r.client_saved_at !== null && Date.parse(r.client_saved_at) >= sinceMs)
    .map((r) => r.id);
}

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
  const startedMs = Date.now() - 1000; // 기기·서버 시계 차이를 조금 둔다
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
    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "나누지 않고 저장" })).toBeVisible({ timeout: 2_000 });
    // 그날 이미 남긴 기록이 있으면 그 값에서 시작하므로, 이번에 정한 시간을 직접 적는다(이번 실행마다 다른 값)
    await fillWheel(dialog, "시간", hours); // 고침9: 두 줄 휠 숫자 바로 쓰기
    await fillWheel(dialog, "분", 0);
    await dialog.getByRole("button", { name: "나누지 않고 저장" }).click();
    await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible({ timeout: 2_000 });
    await expect(dialog.locator(".after-save-card")).toBeVisible(); // 고침9: 저장 뒤 「이번 주」 카드(옛 「오늘 바뀐 분야별 시간」 줄)
    await dialog.getByRole("button", { name: "이전" }).click(); // 고침10 A: 오늘 기록 머리 「‹」(저장 뒤 = 닫기)
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 끊긴 동안 서버에는 아무것도 없다
    await page.waitForTimeout(1500);
    expect(fresh(await ids(nodeA, "todos"), beforeTodos)).toEqual([]);
    expect(await freshLogs(nodeA, beforeLogs, startedMs), "끊긴 동안 이번 시험의 저녁 기록은 서버에 없다(보내지 않는다)").toEqual([]);

    // 연결: 보낼 줄이 차례로 서버에 간다
    await ctx.setOffline(false);
    const arrived = await pollUntil(async () => fresh(await ids(nodeA, "todos"), beforeTodos).length === 1 && (await freshLogs(nodeA, beforeLogs, startedMs)).length === 1, 60_000, 250);
    expect(arrived, "연결 뒤 60초 안에 할 일 하나와 저녁 기록 하나가 서버에 들어간다").toBeGreaterThanOrEqual(0);

    // 서버에는 한 번씩만: 끝냄 표시도 들어갔고, 저녁 기록은 기기에서 정한 값 그대로
    const todoId = fresh(await ids(nodeA, "todos"), beforeTodos)[0];
    const todoRow = await nodeA.from("todos").select("done, day").eq("id", todoId).single();
    expect(todoRow.data?.done).toBe(true);
    const logId = (await freshLogs(nodeA, beforeLogs, startedMs))[0];
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
    expect(await freshLogs(nodeA, beforeLogs, startedMs)).toHaveLength(1);
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
  const startedMs = Date.now() - 1000;
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
    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "나누지 않고 저장" })).toBeVisible({ timeout: 1_500 });
    const t2 = Date.now();
    await dialog.getByRole("button", { name: "나누지 않고 저장" }).click();
    await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible({ timeout: 1_500 });
    const eveningMs = Date.now() - t2;
    await dialog.getByRole("button", { name: "이전" }).click(); // 고침10 A: 오늘 기록 머리 「‹」(저장 뒤 = 닫기)

    // 그동안 서버 요청은 붙잡혀 있었고 서버에는 아무것도 없다
    expect(held.length, "서버 Action 요청이 아직 답을 못 받은 채 붙잡혀 있다").toBeGreaterThan(0);
    expect(fresh(await ids(nodeA, "todos"), beforeTodos)).toEqual([]);
    expect(await freshLogs(nodeA, beforeLogs, startedMs)).toEqual([]);
    console.log(`LOCALFIRST held-request check: 적기 ${addMs}ms · 끝냄 ${doneMs}ms · 저녁 기록 저장 ${eveningMs}ms (서버 요청 ${held.length}개 붙잡힘)`);

    // 풀어 주면 차례로 서버에 한 번씩 들어간다
    holding = false;
    for (const route of held.splice(0)) await route.continue().catch(() => {});
    const arrived = await pollUntil(async () => fresh(await ids(nodeA, "todos"), beforeTodos).length === 1 && (await freshLogs(nodeA, beforeLogs, startedMs)).length === 1, 60_000, 250);
    expect(arrived).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(2000);
    expect(fresh(await ids(nodeA, "todos"), beforeTodos)).toHaveLength(1);
    expect(await freshLogs(nodeA, beforeLogs, startedMs)).toHaveLength(1);
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

    // 끊긴 채 로그아웃: 먼저 보내 보고(못 보냄), 확인 창 「로그아웃할까요?」(고침10 B)를 띄운다. 「계속 쓰기」면 그대로
    await logoutFromMe(page);
    const logoutConfirm = page.getByRole("alertdialog", { name: "로그아웃할까요?" });
    await expect(logoutConfirm).toBeVisible({ timeout: 15_000 });
    await expect(logoutConfirm.getByRole("button")).toHaveText(["로그아웃", "계속 쓰기"]);
    await logoutConfirm.getByRole("button", { name: "계속 쓰기" }).click();
    await expect(logoutConfirm).toHaveCount(0);
    await expect(page.getByText(`${marker} 못 보낸 글`, { exact: true })).toBeVisible();

    // 연결되면 보내고, 그 뒤 로그아웃하면 확인 없이 로그아웃하고 기기 저장소가 비워진다
    await ctx.setOffline(false);
    const arrived = await pollUntil(async () => fresh(await ids(nodeA, "todos"), beforeTodos).length === 1, 60_000, 250);
    expect(arrived).toBeGreaterThanOrEqual(0);
    await logoutFromMe(page);
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
            // 거울·보낼 줄·고른 값·보냈다는 표시·받지 않은 글 보관(고침 4바퀴)
            req.onsuccess = () => resolve((req.result as string[]).filter((k) => ["base/", "op/", "pref/", "sent/", "rej/"].some((p) => k.startsWith(p))).length);
            req.onerror = () => resolve(-1);
          };
        }),
    );
    expect(left, "로그아웃 뒤 기기 저장소에 거울·보낼 줄·고른 값·보냈다는 표시·받지 않은 글 보관이 없다").toBe(0);
  } finally {
    await ctx.close();
    await cleanup(nodeA, beforeTodos);
  }
});

// ── 고침 4바퀴: 원형 다이얼·처음 정한 비율(0% 분야는 저장 목록에서 뺌)도 끊긴 채 저장 → 연결 → 서버에 한 번씩 ─────────────
// 시험 계정 A만 쓴다. 처음 설정(온보딩)이 실제 서버로 가는 흐름은 시험 계정의 상태를 바꾸므로 이 파일에서 하지 않는다(확인 못 함).

type RatioRows = { category_id: string; percent: number }[];
type RatioState = { rows: RatioRows; other: number | null };

async function readRatios(client: SupabaseClient): Promise<RatioState> {
  const rows = await client.from("category_ratios").select("category_id, percent");
  const other = await client.from("user_settings").select("ratio_other_percent");
  return {
    rows: ((rows.data ?? []) as RatioRows).map((r) => ({ category_id: r.category_id, percent: r.percent })),
    other: ((other.data ?? []) as { ratio_other_percent: number | null }[])[0]?.ratio_other_percent ?? null,
  };
}

/** 시험이 바꾼 처음 정한 비율을 시험 전 모습으로 되돌린다(시험 계정 A의 자기 행만) */
async function restoreRatios(client: SupabaseClient, before: RatioState) {
  const { data } = await client.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("A 사용자 번호를 읽지 못했다");
  const keep = new Set(before.rows.map((r) => r.category_id));
  const now = await readRatios(client);
  const extra = now.rows.map((r) => r.category_id).filter((id) => !keep.has(id));
  // 되돌리기가 실패하면 시험 계정이 바뀐 채 남는다: 오류는 던진다(고침 4바퀴)
  const fail = (step: string, error: { code?: string; message?: string } | null) => {
    if (error) throw new Error(`처음 정한 비율 되돌리기 실패(${step}): ${error.code ?? error.message ?? "unknown"}`);
  };
  if (extra.length > 0) fail("delete", (await client.from("category_ratios").delete().eq("user_id", userId).in("category_id", extra)).error);
  if (before.rows.length > 0) {
    const upserted = await client.from("category_ratios").upsert(
      before.rows.map((r) => ({ user_id: userId, ...r })),
      { onConflict: "user_id,category_id" },
    );
    fail("upsert", upserted.error);
  }
  fail("update", (await client.from("user_settings").update({ ratio_other_percent: before.other }).eq("user_id", userId)).error);
}

test("끊긴 채 저녁 기록 「분야마다 나누기」(칩으로 넣고 Stepper로 나눔) 저장 → 연결 → 서버에 한 번, 나눈 값 그대로", async ({ browser }) => {
  test.setTimeout(150_000);
  const env = loadIntegrationEnv();
  const A = accountA(env);
  const nodeA = await nodeClient(env, A);
  await markOnboardingDone(nodeA, "A");
  const beforeTodos = await ids(nodeA, "todos");
  const beforeLogs = await ids(nodeA, "evening_logs");
  const ctx = await contextFor(browser, await sessionCookies(env, A));
  const hours = 2 + (Date.now() % 20); // 2~21시간
  const total = hours * 60;
  const piece = 65; // 첫 분야에 나누는 분(5의 배수)
  const startedMs = Date.now() - 1000;
  try {
    const page = await openApp(ctx);
    await ctx.setOffline(true);

    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "분야마다 나누기" })).toBeVisible({ timeout: 2_000 });
    await fillWheel(dialog, "시간", hours); // 고침9: 두 줄 휠 숫자 바로 쓰기
    await fillWheel(dialog, "분", 0);
    await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
    await expect(dialog.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible({ timeout: 2_000 });
    await expect(dialog.locator("svg.dial")).toBeVisible(); // 다이얼이 같이 보인다

    // 고침 5바퀴(PM 10): 줄은 칩으로 고른 분야에만 있다. 처음 골라진 칩(타이머·끝낸 할 일·그날 이미 남긴 기록의 분야)을 모두 풀어
    // 기타 100%로 만든 뒤, 첫 분야 칩을 골라 줄을 만들고 그 줄의 Stepper에 piece분(그날 이미 남긴 기록이 있어도 같은 결과)
    const chips = dialog.locator(".evening-chips button.chip[aria-pressed]"); // 「+ 분야」는 aria-pressed가 없다
    expect(await chips.count(), "시험 계정 A에 분야가 하나 이상 있어야 나누기를 시험할 수 있다").toBeGreaterThan(0);
    const pressedChips = dialog.locator('.evening-chips button.chip[aria-pressed="true"]');
    for (let n = await pressedChips.count(); n > 0; n = await pressedChips.count()) await pressedChips.first().click();
    const categoryRows = dialog.locator('.ratio-list li.evening-row:not([data-row-key="other"])');
    await expect(categoryRows).toHaveCount(0);
    const firstChip = chips.first();
    await firstChip.click();
    await expect(firstChip).toHaveAttribute("aria-pressed", "true");
    await expect(categoryRows).toHaveCount(1);
    const fields = categoryRows.locator("input.stepper-input");
    await expect(fields).toHaveCount(1);
    await expect(fields.first()).toHaveValue("30"); // 새 칩 = 기타에서 30분
    await fields.first().fill(String(piece));
    await expect(fields.first()).toHaveValue(String(piece));
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible({ timeout: 2_000 });
    await dialog.getByRole("button", { name: "이전" }).click(); // 고침10 A: 오늘 기록 머리 「‹」(저장 뒤 = 닫기)

    // 끊긴 동안 서버에는 아무것도 없다
    await page.waitForTimeout(1500);
    expect(await freshLogs(nodeA, beforeLogs, startedMs)).toEqual([]);

    // 연결: 서버에 한 번 들어가고, 나눈 값 그대로다
    await ctx.setOffline(false);
    const arrived = await pollUntil(async () => (await freshLogs(nodeA, beforeLogs, startedMs)).length === 1, 60_000, 250);
    expect(arrived, "연결 뒤 60초 안에 저녁 기록 하나가 서버에 들어간다").toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(3000);
    const logIds = await freshLogs(nodeA, beforeLogs, startedMs);
    expect(logIds, "서버에는 한 번만").toHaveLength(1);
    const row = await nodeA.from("evening_logs").select("total_minutes, save_mode, items").eq("id", logIds[0]).single();
    expect(row.data?.total_minutes).toBe(total);
    expect(row.data?.save_mode).toBe("edited");
    const items = (row.data?.items ?? []) as { categoryId: string | null; minutes: number }[];
    expect(items.reduce((s, i) => s + i.minutes, 0), "나눈 합 = 쓴 시간").toBe(total);
    expect(items.filter((i) => i.categoryId !== null).map((i) => i.minutes)).toEqual([piece]);
    expect(items.filter((i) => i.categoryId === null).map((i) => i.minutes)).toEqual([total - piece]);
  } finally {
    await ctx.close();
    await cleanup(nodeA, beforeTodos);
  }
});

test("끊긴 채 내 정보 「비율 고치기」 저장 → 연결 → 서버에 한 번, 0% 분야는 저장 목록에 없다", async ({ browser }) => {
  test.setTimeout(150_000);
  const env = loadIntegrationEnv();
  const A = accountA(env);
  const nodeA = await nodeClient(env, A);
  await markOnboardingDone(nodeA, "A");
  const beforeTodos = await ids(nodeA, "todos");
  const before = await readRatios(nodeA);
  const ctx = await contextFor(browser, await sessionCookies(env, A));
  try {
    const page = await openApp(ctx);
    // 내 정보 탭을 연결된 채 열어 분야 목록을 받아 둔다
    await page.getByRole("navigation", { name: "화면 이동" }).getByRole("button", { name: "내 정보" }).click();
    // 고침9(PM 6): 내 정보 「목표 비율」 카드 → S8-a 겹침 화면에서 고치고 「저장」
    await page.getByRole("button", { name: /^목표 비율, / }).click({ timeout: 30_000 });
    const ratioDialog = page.getByRole("dialog", { name: "목표 비율" });
    const fields = ratioDialog.locator("input.ratio-field");
    await expect(fields.first()).toBeVisible({ timeout: 30_000 });
    const readFields = async () => (await fields.evaluateAll((els) => els.map((e) => Number((e as HTMLInputElement).value)))) as number[];
    const initial = await readFields();
    expect(initial.length, "분야 하나 이상 + 기타 줄").toBeGreaterThanOrEqual(2);
    expect(initial.reduce((s, v) => s + v, 0), "열 때 합 100").toBe(100);
    await page.waitForTimeout(1500);

    await ctx.setOffline(true);
    const next = initial[0] === 35 ? 40 : 35;
    await fields.first().fill(String(next));
    await fields.first().press("Enter");
    const shown = await readFields();
    expect(shown[0]).toBe(next);
    expect(shown.reduce((s, v) => s + v, 0), "고친 뒤에도 합 100").toBe(100);
    await ratioDialog.getByRole("button", { name: "저장" }).click();
    await expect(ratioDialog).toHaveCount(0);
    await expect(page.getByText("저장했어요", { exact: true })).toBeVisible({ timeout: 2_000 });

    // 끊긴 동안 서버 값은 그대로
    await page.waitForTimeout(1500);
    expect(await readRatios(nodeA)).toEqual(before);

    // 연결: 화면에 보이던 값이 서버에 그대로 가고(0%인 분야는 행이 없다), 합이 100이다
    await ctx.setOffline(false);
    const otherShown = shown[shown.length - 1];
    const wantRows = shown
      .slice(0, -1)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const match = (now: RatioState) =>
      JSON.stringify(now.rows.map((r) => r.percent).sort((a, b) => a - b)) === JSON.stringify(wantRows) && (now.other ?? 0) === otherShown;
    const arrived = await pollUntil(async () => match(await readRatios(nodeA)), 60_000, 250);
    expect(arrived, "연결 뒤 60초 안에 고친 비율이 서버에 들어간다").toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(3000);
    const after = await readRatios(nodeA);
    expect(match(after), "더 기다려도 같은 값(한 번만, 다시 쓰지 않는다)").toBe(true);
    expect(
      after.rows.every((r) => r.percent > 0),
      "0% 분야는 저장 목록에 없다",
    ).toBe(true);
    expect(after.rows.reduce((s, r) => s + r.percent, 0) + (after.other ?? 0), "서버 합 100").toBe(100);
  } finally {
    await ctx.close();
    await restoreRatios(nodeA, before);
    await cleanup(nodeA, beforeTodos);
  }
});
