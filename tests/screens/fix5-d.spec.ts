import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fillWheel } from "../e2e/wheel";

/**
 * 고침 5바퀴 D(합치기·이음매): PM이 보는 화면 사진 열 장, 360×800. docs/oneshot-v2/고침5/ 에 화면 이름으로 둔다.
 * 개발 갤러리(/dev/v2, /dev/states)의 화면이다(진짜 로그인 앱 화면 아님 — 그 길은 e2e의 todo-flow). 개발 서버(3200)에서 돈다: npm run screens
 * 사진을 찍는 김에 「가로로 넘치지 않는다」·「칩 줄이 한 줄」 같은 치수를 같이 단언한다(사진만 남는 시험이 되지 않게).
 */
const OUT = path.resolve(__dirname, "../../docs/oneshot-v2/고침5");

async function open(page: Page, url: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}
async function photo(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
async function noOverflow(page: Page) {
  const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(s.sw, "가로 스크롤 없음").toBeLessThanOrEqual(s.cw);
}

test("상태보기: 이번 주 목표 뷰 · 목표 비율 뷰(띠) · 목표 비율 뷰(원) · 빈 상태", async ({ page }) => {
  await open(page, "/dev/v2?s=growth-goal");
  await expect(page.locator(".growth-goal-fill").first()).toBeVisible();
  await noOverflow(page);
  await photo(page, "상태보기-이번주목표");
  await open(page, "/dev/v2?s=growth-ratio");
  await expect(page.locator(".growth-band")).toHaveCount(2);
  await noOverflow(page);
  await photo(page, "상태보기-목표비율-띠");
  await open(page, "/dev/v2?s=growth-pie");
  await expect(page.locator("svg.growth-pie")).toHaveCount(2);
  await noOverflow(page);
  await photo(page, "상태보기-목표비율-원");
  await open(page, "/dev/v2?s=growth-empty");
  await expect(page.getByRole("button", { name: "오늘 기록", exact: true })).toBeVisible();
  await noOverflow(page);
  await photo(page, "상태보기-빈상태");
});

test("오늘 기록: 시간 단계(오늘 할 일 n/m ›) · 오늘 할 일 시트", async ({ page }) => {
  await open(page, "/dev/v2?s=evening-todo");
  const line = page.getByRole("button", { name: /^오늘 할 일 2\/4/ });
  await expect(line).toBeVisible();
  await noOverflow(page);
  await photo(page, "오늘기록-시간단계");
  await line.click();
  const sheet = page.getByRole("dialog", { name: "오늘 할 일" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("checkbox")).toHaveCount(4);
  await photo(page, "오늘할일-시트");
});

test("오늘 기록 나누기: 칩이 골라진 채(조각 3px·빛)", async ({ page }) => {
  await open(page, "/dev/v2?s=evening-split");
  await page.locator("#dev-open-window").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await fillWheel(page, "시간", 2); // 고침9: 두 줄 휠
  await page.getByRole("button", { name: "분야마다 나누기" }).click();
  await expect(page.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
  const group = page.getByRole("group", { name: "분야 · 여러 개" });
  // 갤러리의 처음 값: 타이머·끝낸 할 일 분야 칩이 골라진 채 시작한다(조각이 여럿)
  await expect(group.locator('button[aria-pressed="true"]').first()).toBeVisible();
  expect(await page.locator(".dial-slice").count(), "조각이 둘 이상").toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.locator(".dial-slice.is-picked").count(), "고른 조각이 있다").toBeGreaterThan(0);
  // 고른 조각은 3px 나오고 뒤에 빛(.dial-glow, 같은 분야 색)이 깔린다
  expect(await page.locator("path.dial-glow").count(), "빛 번짐").toBe(1);
  const lifted = await page.locator(".dial-slice.is-picked").first().evaluate((el) => getComputedStyle(el).transform);
  expect(lifted, "고른 조각이 밖으로 나옴").not.toBe("none");
  await page.locator("svg.dial").scrollIntoViewIfNeeded();
  await photo(page, "오늘기록-나누기");
});

test("처음 설정 목표 비율 · 할 일(적는 창 칩 줄) · 내 정보", async ({ page }) => {
  await open(page, "/dev/v2?s=ratio-onboarding");
  await page.getByRole("button", { name: "다음" }).click();
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "목표 비율" })).toBeVisible(); // 고침9: 「합계」 줄 없앰
  await photo(page, "처음설정-목표비율");
  await open(page, "/dev/states?s=C24&sheet=open");
  const row = page.getByRole("group", { name: "분야" });
  await expect(row).toBeVisible();
  await noOverflow(page);
  await photo(page, "할일-적는창-칩줄");
  await open(page, "/dev/v2?s=me-ratio");
  await expect(page.locator(".me-ratio-card .me-card-title")).toHaveText("목표 비율"); // 고침9: 카드 단추 → S8-a
  await page.locator(".me-ratio-card").scrollIntoViewIfNeeded();
  await photo(page, "내정보");
});
