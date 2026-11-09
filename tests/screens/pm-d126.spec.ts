import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * PM d-126: 오늘 기록 · 오늘 할 일 시트의 「닫기」로 입력 잃음 막기 — 진짜 브라우저의 뒤로 가기(page.goBack)로 겹친 창 규칙을 한 번 본다.
 * 바꾼 것이 있으면 「닫기」·뒤로 가기가 확인 「저장하지 않고 나갈까요?」(PM d-135 글 — 「계속 적기」·「나가기」)를 띄우고, 「계속 적기」 뒤 뒤로 가기를 다시 누르면 다시 확인이 뜬다
 * (history 칸이 어긋나 앱 밖으로 나가거나 뒤로 가기가 먹히지 않으면 안 된다). 사진 360×800은 docs/oneshot-v2/고침5/.
 * 개발 갤러리(/dev/v2?s=evening-todo)의 화면이다. 개발 서버(3200)에서 돈다: npm run screens
 */
const OUT = path.resolve(__dirname, "../../docs/oneshot-v2/고침5");

async function open(page: Page) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dev/v2?s=evening-todo");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("dialog", { name: "오늘 몇 시간 썼어요?" })).toBeVisible();
}
async function photo(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
async function noOverflow(page: Page) {
  const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(s.sw, "가로 스크롤 없음").toBeLessThanOrEqual(s.cw);
}

test("PM d-126 오늘 기록 360x800: 쓴 시간을 바꾸면 「닫기」·뒤로 가기가 같은 확인, 「계속 적기」 뒤 뒤로 가기 다시 → 다시 확인, 「나가기」면 창만 닫힘", async ({ page }) => {
  await open(page);
  const startUrl = page.url();
  const record = page.getByRole("dialog", { name: "오늘 몇 시간 썼어요?" });
  const total = record.locator(".ratio-total");
  const before = await total.textContent();
  await page.getByRole("button", { name: "시간 1시간 늘리기" }).click();
  const after = await total.textContent();
  expect(after).not.toBe(before);

  const close = record.getByRole("button", { name: "닫기" }).first();
  await close.click();
  const confirm = page.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "계속 적기" })).toBeFocused();
  await expect(confirm.getByRole("button")).toHaveText(["계속 적기", "나가기"]);
  const keepBg = await confirm.getByRole("button", { name: "계속 적기" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(keepBg).toBe("rgb(28, 35, 64)"); // 주 단추 먹남색(--color-primary #1C2340)
  const box = (await confirm.boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await noOverflow(page);
  await photo(page, "PM-d126-오늘기록-닫기확인");

  await confirm.getByRole("button", { name: "계속 적기" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(close).toBeFocused();
  await expect(total).toHaveText(after ?? "");

  // 진짜 브라우저 뒤로 가기: 같은 확인, 창은 열린 채, 문서·주소 그대로
  await page.goBack();
  await expect(confirm).toBeVisible();
  await expect(record).toBeVisible();
  expect(page.url()).toBe(startUrl);
  await confirm.getByRole("button", { name: "계속 적기" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(total).toHaveText(after ?? "");

  // 한 번 더 뒤로 가기 → 다시 확인(먹히지 않고, 앱 밖으로 나가지 않는다)
  await page.goBack();
  await expect(confirm).toBeVisible();
  await expect(record).toBeVisible();
  expect(page.url()).toBe(startUrl);
  await confirm.getByRole("button", { name: "나가기" }).click();
  await expect(record).toHaveCount(0);
  await expect(confirm).toHaveCount(0);
  expect(page.url()).toBe(startUrl);
});

test("PM d-126 시트 360x800: 「+ 할 일」에 글이 있으면 「닫기」·뒤로 가기가 시트 확인만 띄운다, 「나가기」면 시트만 닫히고 할 일은 늘지 않는다", async ({ page }) => {
  await open(page);
  const startUrl = page.url();
  const record = page.getByRole("dialog", { name: "오늘 몇 시간 썼어요?" });
  await page.getByRole("button", { name: /^오늘 할 일 2\/4/ }).click();
  const sheet = page.getByRole("dialog", { name: "오늘 할 일" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "+ 할 일" }).click();
  const input = sheet.getByRole("textbox", { name: "할 일" });
  await input.fill("발음 연습 20분");

  await sheet.getByRole("button", { name: "닫기" }).click();
  const confirm = page.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
  await expect(confirm).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await expect(confirm.getByRole("button", { name: "계속 적기" })).toBeFocused();
  await noOverflow(page);
  await photo(page, "PM-d126-시트-닫기확인");

  await confirm.getByRole("button", { name: "계속 적기" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(input).toHaveValue("발음 연습 20분");

  // 뒤로 가기: 시트 확인만(오늘 기록 확인과 겹치지 않는다), 「계속 적기」 뒤 다시 → 다시 확인
  await page.goBack();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await expect(sheet).toBeVisible();
  await confirm.getByRole("button", { name: "계속 적기" }).click();
  await expect(input).toHaveValue("발음 연습 20분");
  await page.goBack();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await confirm.getByRole("button", { name: "나가기" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(record).toBeVisible();
  // 적기를 부르지 않았다: 할 일 수 그대로
  await expect(page.getByRole("button", { name: /^오늘 할 일 2\/4/ })).toBeVisible();
  expect(page.url()).toBe(startUrl);

  // 오늘 기록은 바꾼 것이 없으니 뒤로 가기에 확인 없이 닫힌다(예전 그대로)
  await page.goBack();
  await expect(record).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(page.url()).toBe(startUrl);
});
