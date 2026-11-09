import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { MirrorSnapshot } from "../../lib/local/types";
import { DEVICE_HINT_COOKIE } from "../../lib/local/device-hint";
import { loadIntegrationEnv } from "../integration/load-env";
import { accountA, nodeClient, sessionCookies } from "../e2e/helpers";

/**
 * 발표판 검수(K2) 공용: 시험 계정 A로 로그인한 진짜 앱(운영 빌드) · 사진 · 가짜 응답(GET /mirror만) · 정리.
 *
 * 가짜 응답: 이 앱은 기기 먼저 저장이라 화면 데이터가 모두 GET /mirror 한 길로 온다(lib/local/types.ts MirrorSnapshot).
 * 기기 표시 쿠키(duno-device)를 미리 두면 서버가 첫 화면에 사본을 싣지 않고 화면이 /mirror를 부른다. 그 응답을 route.fetch()로
 * 실제로 받은 뒤 필요한 칸만 바꿔 돌려준다(꼴 = 실제 응답 { ok, data: MirrorSnapshot } 그대로). 쓰기 길은 건드리지 않는다.
 */

export const PHOTO_DIR = process.env.SAVE_PHOTOS === "1" ? "docs/oneshot-v2/발표판-화면" : "test-results/photos/발표판-화면";
const LOG_DIR = "test-results/release";

export type PhotoRow = { name: string; node: string; file: string | null; fake: boolean; note?: string };

function logRow(kind: "photos" | "scenarios", row: unknown) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOG_DIR, `${kind}.jsonl`), JSON.stringify(row) + "\n", "utf8");
}

/** 파일 이름에 못 쓰는 글자(Windows: \ / : * ? " < > |)만 바꾼다 */
export function fileName(name: string, fake: boolean): string {
  // 「/」는 보기에 같은 전각 「／」로, 나머지 못 쓰는 글자는 「_」로
  const safe = name.replace(/\//g, "／").replace(/[\\:*?"<>|]/g, "_");
  return `${safe}${fake ? " (가짜 응답)" : ""}.png`;
}

/** 360×800 사진(나타남 애니메이션은 끝낸 뒤) + 사진 목록 줄 */
export async function shot(page: Page, name: string, node: string, opts: { fake?: boolean; note?: string } = {}) {
  const fake = opts.fake ?? false;
  const file = fileName(name, fake);
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  await page.screenshot({ path: path.join(PHOTO_DIR, file), animations: "disabled" });
  logRow("photos", { name, node, file, fake, note: opts.note } satisfies PhotoRow);
}

/** 찍지 못한 화면 */
export function missing(name: string, node: string, reason: string) {
  logRow("photos", { name, node, file: null, fake: false, note: reason } satisfies PhotoRow);
}

export type StepRow = { scenario: string; step: string; ac: string; pass: boolean; note?: string };
export function logStep(row: StepRow) {
  logRow("scenarios", row);
}

export type Session = { context: BrowserContext; page: Page; client: SupabaseClient; userId: string };

let cached: { cookies: Awaited<ReturnType<typeof sessionCookies>>; client: SupabaseClient; userId: string } | null = null;

/** A로 로그인한 360×800 창. fake가 있으면 GET /mirror 응답의 data를 그 함수로 바꾼다 */
export async function openA(browser: Browser, fake?: (snap: MirrorSnapshot) => MirrorSnapshot): Promise<Session> {
  if (!cached) {
    const env = loadIntegrationEnv();
    const account = accountA(env);
    const client = await nodeClient(env, account);
    const { data } = await client.auth.getUser();
    if (!data.user) throw new Error("A 사용자 번호를 읽지 못했다");
    cached = { cookies: await sessionCookies(env, account), client, userId: data.user.id };
  }
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  await context.addCookies([
    ...cached.cookies,
    { name: DEVICE_HINT_COOKIE, value: encodeURIComponent(cached.userId), domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
  ]);
  const page = await context.newPage();
  if (fake) {
    await page.route("**/mirror", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as { ok: boolean; data?: MirrorSnapshot };
      if (body.ok && body.data) body.data = fake(body.data);
      await route.fulfill({ response, json: body });
    });
  }
  return { context, page, client: cached.client, userId: cached.userId };
}

/** 할 일 탭이 그려질 때까지(첫 화면 = 할 일, D-165) */
export async function openHome(s: Session) {
  await s.page.goto("/");
  await expect(s.page.getByRole("button", { name: "할 일 적기" })).toBeVisible({ timeout: 30_000 });
}

/** 오늘 기록 나누기에서 안 고른 분야 칩 하나를 고른다(칩 줄이 「+n」으로 접혔으면 먼저 펼친다) */
export async function pickSplitChip(dialog: import("@playwright/test").Locator) {
  const group = dialog.getByRole("group", { name: "분야 · 여러 개" });
  const more = group.getByRole("button", { name: /^분야 \d+개 더 보기$/ });
  if (await more.isVisible()) await more.click();
  await group.getByRole("button", { name: /, 다이얼에 넣기$/, pressed: false }).first().click();
}

export const pressedSplitChips = (dialog: import("@playwright/test").Locator) =>
  dialog.getByRole("group", { name: "분야 · 여러 개" }).getByRole("button", { name: /, 다이얼에 넣기$/, pressed: true });

export async function tab(page: Page, name: "상태보기" | "할 일" | "타이머" | "내 정보") {
  await page.getByRole("navigation", { name: "화면 이동" }).getByRole("button", { name }).click();
}

/** 이번 주 월요일(서울, YYYY-MM-DD) */
export function weekStartSeoul(now = new Date()): string {
  const seoul = new Date(now.getTime() + 9 * 3600_000);
  const dow = (seoul.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate() - dow));
  return monday.toISOString().slice(0, 10);
}

export async function ids(client: SupabaseClient, table: "todos" | "categories" | "focus_sessions"): Promise<Set<string>> {
  const res = await client.from(table).select("id");
  if (res.error) throw new Error(`${table} 읽기 실패 (code=${res.error.code ?? "?"})`);
  return new Set((res.data ?? []).map((r: { id: string }) => r.id));
}

/** 이번 실행에서 만든 할 일(과 그 작업 기록)을 지운다 */
export async function removeTodos(client: SupabaseClient, created: string[]) {
  if (created.length === 0) return;
  await client.from("todo_notes").delete().in("todo_id", created);
  const del = await client.from("todos").delete().in("id", created);
  if (del.error) throw new Error(`할 일 지우기 실패 (code=${del.error.code ?? "?"})`);
}

export async function goalRow(client: SupabaseClient, weekStart: string): Promise<boolean> {
  const res = await client.from("weekly_goals").select("week_start").eq("week_start", weekStart);
  if (res.error) throw new Error(`이번 주 목표 읽기 실패 (code=${res.error.code ?? "?"})`);
  return (res.data ?? []).length > 0;
}

export async function removeGoal(client: SupabaseClient, weekStart: string) {
  const del = await client.from("weekly_goals").delete().eq("week_start", weekStart);
  if (del.error) throw new Error(`이번 주 목표 지우기 실패 (code=${del.error.code ?? "?"})`);
}
