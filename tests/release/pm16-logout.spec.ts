import { expect, test } from "@playwright/test";
import { forgetSession, ids, openA, openHome, removeTodos, tab } from "./release";

/**
 * 고침10 합친 뒤 확인 둘(시험 계정 A, 운영 빌드). 둘 다 앱 코드를 고치지 않고 본 것만 남긴다.
 *  1) PM 16: 내 정보 → 목표 → 바꿔 저장 → 상태보기 탭의 맨 위 줄이 새 문장인가
 *  2) 로그아웃 확인 창: 기기에 보낼 줄이 있을 때 확인 창 「로그아웃」 → 로그인 화면 · 「로그아웃하지 못했어요」 없음 · 뒤로 가기 한 번에 앱 밖으로 안 감
 * 실행: DUNO_DIST_DIR=<다른 빌드 폴더> E2E_PORT=<포트> npx playwright test --config playwright.release.config.ts tests/release/pm16-logout.spec.ts
 */

test("PM 16: 목표 한 문장을 바꿔 저장하면 상태보기 맨 위 줄이 바로 새 문장이다", async ({ browser }) => {
  test.setTimeout(120_000);
  const s = await openA(browser);
  const { page } = s;
  try {
    await openHome(s);
    await tab(page, "내 정보");
    await expect(page.getByRole("heading", { name: "내 정보" })).toBeVisible({ timeout: 20_000 });
    const openGoal = () => page.getByRole("button", { name: /^목표,/ }).first().click();
    await openGoal();
    const dialog = page.getByRole("dialog", { name: "목표" });
    const before = await dialog.getByRole("textbox").inputValue();
    const next = `${before.replace(/ ?\(PM16 \d+\)$/, "")} (PM16 ${Date.now() % 1000})`.slice(0, 60);
    try {
      await dialog.getByRole("textbox").fill(next);
      await dialog.getByRole("button", { name: "저장" }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await tab(page, "상태보기");
      // 같은 세션(새로 열지 않음)의 상태보기 맨 위 줄
      await expect(page.locator(".growth-goal-line"), "상태보기 맨 위 목표 줄이 바로 새 문장").toContainText(next, { timeout: 10_000 });
    } finally {
      // 시험 전 문장으로 되돌린다
      await tab(page, "내 정보");
      await openGoal();
      await dialog.getByRole("textbox").fill(before);
      await dialog.getByRole("button", { name: "저장" }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    }
  } finally {
    await s.context.close();
  }
});

test("PM 16 다른 길: 「‹」 → 확인 「계속 적기」 → 「저장」 뒤에도 상태보기 맨 위 줄이 새 문장이고 눈에 보인다(K2 S-07 ①과 같은 길)", async ({ browser }) => {
  test.setTimeout(120_000);
  const s = await openA(browser);
  const { page } = s;
  try {
    await openHome(s);
    await tab(page, "내 정보");
    await expect(page.getByRole("heading", { name: "내 정보" })).toBeVisible({ timeout: 20_000 });
    const openGoal = () => page.getByRole("button", { name: /^목표,/ }).first().click();
    await openGoal();
    const dialog = page.getByRole("dialog", { name: "목표" });
    const before = await dialog.getByRole("textbox").inputValue();
    const next = `${before.replace(/ ?\(PM16 \d+\)$/, "")} (PM16 ${Date.now() % 1000})`.slice(0, 60);
    try {
      await dialog.getByRole("textbox").fill(next);
      await dialog.getByRole("button", { name: "이전" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "계속 적기" }).click();
      await dialog.getByRole("button", { name: "저장" }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await tab(page, "상태보기");
      await expect(page.locator(".growth-goal-line")).toContainText(next, { timeout: 10_000 });
      await expect(page.locator(".growth-goal-line"), "맨 위 줄이 눈에 보인다").toBeVisible();
    } finally {
      await tab(page, "내 정보");
      await openGoal();
      await dialog.getByRole("textbox").fill(before);
      await dialog.getByRole("button", { name: "저장" }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    }
  } finally {
    await s.context.close();
  }
});

test("로그아웃 확인 창: 보낼 줄이 있는 채 「로그아웃」 → 로그인 화면 · 실패 안내 없음 · 뒤로 가기가 앱 밖으로 안 튄다", async ({ browser }) => {
  test.setTimeout(120_000);
  const s = await openA(browser);
  const { page } = s;
  const before = await ids(s.client, "todos");
  const marker = `lo-${Date.now().toString(36)}`;
  try {
    await page.goto("/offline.html"); // 앱 앞에 같은 출처의 쪽 하나 — 뒤로 가기가 어디로 가는지 알아보려는 발판
    await openHome(s);
    // 이 글을 담은 서버 요청만 막아 줄이 기기에 남게 한다(로그아웃 요청은 그대로 간다 — 연결은 끊지 않는다)
    await page.route("**/*", (route) => {
      const req = route.request();
      if (req.method() === "POST" && (req.postData() ?? "").includes(marker)) return route.abort();
      return route.continue();
    });
    await page.getByRole("button", { name: "할 일 적기" }).click();
    const input = page.getByRole("textbox", { name: "할 일 적기" });
    await input.fill(`${marker} 못 보낸 글`);
    await page.getByRole("button", { name: "적기" }).click();
    await expect(page.getByText(`${marker} 못 보낸 글`, { exact: true })).toBeVisible({ timeout: 5_000 });
    await input.press("Escape");

    await tab(page, "내 정보");
    await page.locator("#me-logout-button").click();
    const confirm = page.getByRole("alertdialog", { name: "로그아웃할까요?" });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await expect(confirm.getByRole("button")).toHaveText(["로그아웃", "계속 쓰기"]);
    const origin = new URL(page.url()).origin;
    await confirm.getByRole("button", { name: "로그아웃", exact: true }).click();

    await expect(page.getByRole("button", { name: "Google로 로그인" }), "로그인 화면으로 간다").toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("로그아웃하지 못했어요"), "실패 안내가 보이지 않는다").toHaveCount(0);
    expect(await page.getByRole("alertdialog").count(), "확인 창이 남지 않는다").toBe(0);

    // 뒤로 가기 한 번: 확인이 쌓은 history 칸이 남아 있지 않다 = 앱 앞의 쪽(발판)으로 한 칸만 간다. 앱의 로그인 전 화면을 되살리지도, 앱 밖으로 튀지도 않는다
    await page.goBack({ waitUntil: "commit" });
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    expect(new URL(page.url()).origin).toBe(origin);
    expect(new URL(page.url()).pathname, "뒤로 가기 한 번 = 앱 앞의 쪽").toBe("/offline.html");
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await s.context.close();
    forgetSession(); // 로그아웃으로 세션이 끝났다 — 다음 시험이 A로 다시 로그인한다
    const now = await ids(s.client, "todos").catch(() => new Set<string>());
    await removeTodos(s.client, [...now].filter((id) => !before.has(id))).catch(() => undefined);
  }
});
