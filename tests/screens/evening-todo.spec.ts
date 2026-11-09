import { expect, test } from "@playwright/test";
import fs from "node:fs";

/**
 * 고침 5바퀴 E2: 오늘 기록 시간 단계의 「오늘 할 일 n/m ›」 줄과 「오늘 할 일」 시트(명세 ⑩ PM 11) 사진·치수. /dev/v2?s=evening-todo
 * 사진은 docs/oneshot-v2/고침5-E2/에 둔다(360px).
 */

const OUT = "docs/oneshot-v2/고침5-E2";

test("evening-todo 360x800: 줄 누름 48 이상·가로 넘침 없음, 시트 사진(목록 · 「+ 할 일」 펼침), 뒤로 가기는 시트만 닫는다", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dev/v2?s=evening-todo");
  await page.waitForLoadState("networkidle");
  const line = page.getByRole("button", { name: /^오늘 할 일 2\/4/ });
  await expect(line).toBeVisible();
  await expect(page.getByText("타이머 2시간 30분", { exact: true })).toBeVisible();
  const box = (await line.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(48);
  expect(box.width).toBeGreaterThan(200);
  const sizes = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sizes.sw).toBeLessThanOrEqual(sizes.cw);
  await page.screenshot({ path: `${OUT}/time-step-line-360x800.png` });

  await line.click();
  const sheet = page.getByRole("dialog", { name: "오늘 할 일" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("checkbox")).toHaveCount(4);
  await page.screenshot({ path: `${OUT}/sheet-list-360x800.png` });

  await sheet.getByRole("button", { name: "+ 할 일" }).click();
  await expect(sheet.getByRole("textbox", { name: "할 일" })).toBeFocused();
  await sheet.getByRole("textbox", { name: "할 일" }).fill("발음 연습 20분");
  await sheet.getByRole("button", { name: "어학" }).click();
  await page.screenshot({ path: `${OUT}/sheet-add-open-360x800.png` });
  const sheetBox = (await sheet.boundingBox())!;
  expect(sheetBox.width).toBeLessThanOrEqual(360);

  await sheet.getByRole("button", { name: "적기" }).click();
  await expect(sheet.getByText("발음 연습 20분")).toBeVisible();
  await sheet.getByRole("checkbox", { name: "운영체제 3장 읽기" }).check();
  await page.goBack(); // 안드로이드 뒤로 가기: 시트만 닫힌다
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "오늘 몇 시간 썼어요?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^오늘 할 일 3\/5/ })).toBeFocused();
  await page.screenshot({ path: `${OUT}/time-step-line-after-360x800.png` });
});
