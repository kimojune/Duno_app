import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanupTodos } from "../integration/cleanup";
import { loadIntegrationEnv } from "../integration/load-env";
import { offerCopyId } from "../../lib/offers/copy-id";
import { todoDayFor } from "../../lib/todos/day";
import { addDays, weekStartFor } from "../../lib/week";
import { accountA, contextFor, markOnboardingDone, nodeClient, pollUntil, sessionCookies } from "./helpers";

/**
 * 고침 11: 먼저 할 일 카드 「오늘 할 일에 추가」의 실제 흐름(운영 빌드 + duno_dev 시험 계정 A).
 *  - 어제 적은 할 일이 카드로 건너오고(「어제 적은 할 일」), 누르면(연타해도) 오늘 할 일이 하나만 생기고 타이머 탭에서 골라져 있다. 타이머는 켜지지 않는다(focus_sessions 그대로).
 *  - 할 일 탭으로 돌아오면 카드는 그 사본의 「30분 시작」 꼴이고 카드 제시 줄은 늘지 않는다. /?open=offer로 열면 할 일 탭 맨 위에 카드가 있다.
 * 시험이 만드는 것: 어제 날짜의 할 일 하나(오늘 쓴 시험 글의 암호문을 복사), 이번 주 목표 한 줄(분야 하나) — 끝나면 지우고 되돌린다.
 * 제시 줄·타이머 기록은 쌓기만 하는 표라 지울 수 없다(제시는 넘김으로 닫는다). 이 시험은 타이머를 켜지 않는다.
 */

async function ids(client: SupabaseClient, table: "todos"): Promise<Set<string>> {
  const res = await client.from(table).select("id");
  return new Set(((res.data ?? []) as { id: string }[]).map((r) => r.id));
}
async function count(client: SupabaseClient, table: "focus_sessions"): Promise<number> {
  const res = await client.from(table).select("id");
  if (res.error) throw new Error(`${table} 읽기 실패 (code=${res.error.code ?? "?"})`);
  return (res.data ?? []).length;
}

test("카드 「오늘 할 일에 추가」: 연타해도 오늘 할 일 하나 · 타이머 안 켜짐 · 돌아오면 「30분 시작」 · /?open=offer", async ({ browser }) => {
  test.setTimeout(240_000);
  const env = loadIntegrationEnv();
  const A = accountA(env);
  const nodeA = await nodeClient(env, A);
  const userId = await markOnboardingDone(nodeA, "A");
  const today = todoDayFor(new Date());
  const yesterday = addDays(today, -1);
  const weekStart = weekStartFor(today);
  const beforeTodos = await ids(nodeA, "todos");

  const goalBefore = await nodeA.from("weekly_goals").select("items").eq("week_start", weekStart);
  const hadGoal = ((goalBefore.data ?? []) as { items: unknown }[])[0]?.items ?? null;
  const focusBefore = await count(nodeA, "focus_sessions");
  const marker = `e2e-add-${Date.now().toString(36)}`;
  let offerId: string | null = null;
  let page: Page | null = null;
  const ctxs: { close(): Promise<void> }[] = [];
  try {
    // 1) 오늘 시험 글을 앱으로 적어 암호문을 만들고, 그 암호문을 어제 날짜 할 일(분야 지정)로 복사한 뒤 오늘 것은 지운다
    const ctx1 = await contextFor(browser, await sessionCookies(env, A));
    ctxs.push(ctx1);
    const first = await ctx1.newPage();
    await first.goto("/");
    await expect(first.getByText(/\d+개 중 \d+개 끝냄/)).toBeVisible({ timeout: 30_000 });
    // 카드가 늘 이 분야를 건네게 하려면: 앱이 읽을 수 있는 분야 가운데 지난 8일 안에 끝내지 않은 할 일이 없는 분야 하나가 필요하다
    const todayRead = (await (await first.request.get("/todos/today")).json()) as { categories?: { ok?: boolean; data?: { categories?: { id: string; readable: boolean }[] } } };
    const readable = (todayRead.categories?.data?.categories ?? []).filter((c) => c.readable).map((c) => c.id);
    const open = await nodeA.from("todos").select("category_id").eq("done", false).gte("day", addDays(today, -8));
    const busy = new Set(((open.data ?? []) as { category_id: string | null }[]).map((r) => r.category_id));
    const category = readable.find((id) => !busy.has(id));
    test.skip(!category, "시험 계정 A에 읽을 수 있고 지난 8일 안 끝내지 않은 할 일이 없는 분야가 없다(조건이 안 맞아 못 돌렸다)");
    if (!category) return;
    await first.getByRole("button", { name: "할 일 적기" }).click();
    await first.getByRole("textbox", { name: "할 일 적기" }).fill(marker);
    await first.getByRole("button", { name: "적기" }).click();
    await expect(first.getByText(marker, { exact: true })).toBeVisible({ timeout: 5_000 });
    let written: { id: string; text_encrypted: string } | null = null;
    expect(
      await pollUntil(async () => {
        const now = await nodeA.from("todos").select("id, text_encrypted, day");
        const fresh = ((now.data ?? []) as { id: string; text_encrypted: string; day: string }[]).filter((r) => !beforeTodos.has(r.id));
        written = fresh[0] ?? null;
        return written !== null;
      }, 30_000),
    ).toBeGreaterThanOrEqual(0);
    const row = written as { id: string; text_encrypted: string } | null;
    if (!row) throw new Error("앱이 적은 시험 글이 서버에 들어오지 않았다");
    const past = await nodeA.from("todos").insert({ user_id: userId, day: yesterday, text_encrypted: row.text_encrypted, category_id: category });
    expect(past.error, "어제 날짜 시험 할 일 넣기").toBeNull();
    await nodeA.from("todos").delete().eq("id", row.id);
    await ctx1.close();
    ctxs.pop();

    // 2) 이번 주 목표를 그 분야 하나로 두어 카드가 그 분야를 건네게 한다(끝나면 되돌린다)
    const goal = await nodeA.from("weekly_goals").upsert({ user_id: userId, week_start: weekStart, items: [{ categoryId: category, minutes: 600 }] }, { onConflict: "user_id,week_start" });
    expect(goal.error, "이번 주 목표 두기").toBeNull();
    const cardOffersBefore = ((await nodeA.from("todo_offers").select("id").eq("surface", "card").eq("day", today)).data ?? []).length;

    // 3) 새 창: 카드가 어제 적은 할 일을 건넨다
    const ctx = await contextFor(browser, await sessionCookies(env, A));
    ctxs.push(ctx);
    page = await ctx.newPage();
    await page.goto("/");
    const card = page.getByRole("region", { name: "오늘 먼저 할 일" });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText(marker, { exact: true })).toBeVisible();
    await expect(card.getByText("어제 적은 할 일")).toBeVisible();
    await expect(card.getByRole("button", { name: "30분 시작" })).toHaveCount(0);
    const add = card.getByRole("button", { name: "오늘 할 일에 추가" });
    const skip = card.getByRole("button", { name: "넘기기" });
    // 단추 줄: 「오늘 할 일에 추가」와 「넘기기」가 한 줄에 들어간다(d-227, 폭 360)
    const a = await add.boundingBox();
    const s = await skip.boundingBox();
    expect(a && s && Math.abs(a.y - s.y) < 8, "두 단추가 한 줄").toBe(true);

    // 4) 연타 → 타이머 탭, 골라져 있고 안내가 있다. 타이머는 안 켜진다
    // 연타: 같은 순간에 세 번 누른다(마우스를 세 번 옮겨 누르면 탭이 바뀐 뒤의 클릭이 다른 곳을 눌러 포커스를 흐리므로 DOM 클릭으로)
    await add.evaluate((el) => {
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
    });
    await expect(page.getByRole("button", { name: "타이머" })).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    await expect(page.getByRole("radio", { name: new RegExp(marker) })).toBeChecked();
    await expect(page.getByRole("status").filter({ hasText: `「${marker}」를 오늘 할 일에 넣었어요.` })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "타이머" })).toBeFocused();
    await expect(page.getByRole("timer")).toHaveCount(0);

    // 5) 서버: 오늘 할 일은 그 제시에서 정한 id로 하나, 제시 줄은 그대로, 먼저 한 기록은 늘지 않는다
    const offers = await nodeA.from("todo_offers").select("id, todo_id").eq("surface", "card").eq("day", today);
    const mine = ((offers.data ?? []) as { id: string; todo_id: string | null }[]).filter((o) => o.todo_id !== null);
    const origin = await nodeA.from("todos").select("id").eq("day", yesterday).eq("category_id", category);
    const originId = ((origin.data ?? []) as { id: string }[]).map((r) => r.id).find((id) => mine.some((o) => o.todo_id === id));
    expect(originId, "카드 제시가 어제 할 일을 가리킨다").toBeTruthy();
    offerId = mine.find((o) => o.todo_id === originId)!.id;
    const copyId = offerCopyId(offerId)!;
    expect(
      await pollUntil(async () => ((await nodeA.from("todos").select("id").eq("id", copyId)).data ?? []).length === 1, 30_000),
      "사본이 서버에 들어왔다",
    ).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(1500); // 연타가 뒤늦게 더 만들지 않았는지 잠시 더 본다
    const copies = await nodeA.from("todos").select("id, day, done").eq("day", today).eq("category_id", category);
    expect(((copies.data ?? []) as { id: string }[]).map((r) => r.id)).toEqual([copyId]);
    const cardOffersAfter = ((await nodeA.from("todo_offers").select("id").eq("surface", "card").eq("day", today)).data ?? []).length;
    expect(cardOffersAfter - cardOffersBefore, "카드 제시 줄은 한 줄만 늘었다(추가가 새 제시를 만들지 않는다)").toBe(1);
    expect(await count(nodeA, "focus_sessions"), "추가만으로는 먼저 한 기록이 남지 않는다").toBe(focusBefore);

    // 6) 할 일 탭으로 돌아오면 카드는 그 사본의 현행 「30분 시작」 꼴
    await page.getByRole("button", { name: "할 일", exact: true }).click();
    await expect(card.getByRole("button", { name: "30분 시작" })).toBeVisible();
    await expect(card.getByText("어제 적은 할 일")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "오늘 할 일에 추가" })).toHaveCount(0);
    await expect(card.getByText(marker, { exact: true })).toBeVisible();

    // 7) 새로 열어도(다른 기기처럼) 같은 제시가 그 사본으로 오고, 제시 줄은 늘지 않는다. /?open=offer는 할 일 탭 맨 위
    const ctx2 = await contextFor(browser, await sessionCookies(env, A));
    ctxs.push(ctx2);
    const second = await ctx2.newPage();
    await second.goto("/?open=offer");
    await expect(second.getByRole("button", { name: "할 일", exact: true })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    const card2 = second.getByRole("region", { name: "오늘 먼저 할 일" });
    await expect(card2.getByRole("button", { name: "30분 시작" })).toBeVisible({ timeout: 30_000 });
    expect(await second.evaluate(() => window.scrollY)).toBe(0);
    const offersEnd = await nodeA.from("todo_offers").select("id").eq("surface", "card").eq("day", today);
    expect((offersEnd.data ?? []).length).toBe(cardOffersAfter);
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
    // 정리: 시험이 만든 할 일을 지우고, 이번 주 목표를 되돌리고, 시험 제시는 넘김으로 닫는다
    const created = [...(await ids(nodeA, "todos"))].filter((id) => !beforeTodos.has(id));
    if (hadGoal === null) await nodeA.from("weekly_goals").delete().eq("user_id", userId).eq("week_start", weekStart);
    else await nodeA.from("weekly_goals").upsert({ user_id: userId, week_start: weekStart, items: hadGoal }, { onConflict: "user_id,week_start" });
    if (offerId) await nodeA.from("todo_offers").update({ dismissed_at: new Date().toISOString() }).eq("id", offerId);
    await cleanupTodos([{ label: "A", client: nodeA, ids: created }]);
  }
});
