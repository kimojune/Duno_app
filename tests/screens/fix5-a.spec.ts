import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { CATEGORY_COLOR_TOKENS, COLOR_TOKENS, RADIUS_TOKENS } from "../../lib/design-tokens";

/**
 * 고침 5바퀴 A: 디자인 값이 실제 화면에 칠해졌는지 360px에서 본다(「CSS 값 = 출처 값」은 unit 시험, 여기는 「실제 요소가 그 값으로 칠해짐」).
 * 사진: docs/oneshot-v2/고침5-A/ (할 일 · 처음 설정 목표 비율 단계 · 내 정보). 개발 서버(3200)에서 돈다: npm run screens
 */
const OUT = path.resolve(__dirname, "../../docs/oneshot-v2/고침5-A");
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

async function open(page: Page, url: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}
async function photo(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}-360x800.png`), fullPage: false });
}

test("할 일 360px: 바탕·글자색이 새 값이고 주 단추는 먹남색 채움 알약이다", async ({ page }) => {
  await open(page, "/dev/states?s=C1&sheet=closed");
  const body = await page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return { bg: s.backgroundColor, color: s.color };
  });
  expect(body).toEqual({ bg: rgb(COLOR_TOKENS["--color-bg"]), color: rgb(COLOR_TOKENS["--color-text"]) });
  expect(rgb(COLOR_TOKENS["--color-bg"])).toBe("rgb(250, 247, 242)");
  const primary = page.locator(".btn-primary").first();
  await expect(primary).toBeVisible();
  const style = await primary.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, radius: s.borderTopLeftRadius };
  });
  expect(style.bg).toBe(rgb(COLOR_TOKENS["--color-primary"]));
  expect(style.color).toBe(rgb(COLOR_TOKENS["--color-on-primary"]));
  expect(style.radius).toBe(RADIUS_TOKENS["--radius-pill"]);
  await photo(page, "할일");
});

test("처음 설정 목표 비율 단계 360px: 균등 배분 단추, 다이얼 조각은 분야 색 + 1px 먹남색 윤곽이고 바탕·면 색과 다르다", async ({ page }) => {
  await open(page, "/dev/v2?s=ratio-onboarding");
  await page.getByRole("button", { name: "다음" }).click();
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByText("합계 100%")).toBeVisible();
  await expect(page.getByRole("button", { name: "균등 배분" })).toBeVisible();
  const slices = await page.$$eval(".dial-slice", (els) =>
    els.map((e) => {
      const s = getComputedStyle(e);
      return { fill: s.fill, stroke: s.stroke, width: s.strokeWidth };
    }),
  );
  expect(slices.length).toBeGreaterThan(0);
  const categoryRgb = [...Object.values(CATEGORY_COLOR_TOKENS)].map(rgb);
  for (const s of slices) {
    expect(categoryRgb, `조각 색 ${s.fill}`).toContain(s.fill);
    expect(s.fill).not.toBe(rgb(COLOR_TOKENS["--color-bg"]));
    expect(s.fill).not.toBe(rgb(COLOR_TOKENS["--color-surface"]));
    expect(s.stroke).toBe(rgb(COLOR_TOKENS["--color-chart-outline"]));
    expect(s.width).toBe("1px");
  }
  await photo(page, "처음설정-목표비율");
});

test("내 정보 360px: 목표 비율 이름과 균등 배분 단추, 아래 탭 순서", async ({ page }) => {
  await open(page, "/dev/v2?s=me-ratio");
  await expect(page.getByRole("heading", { name: "목표 비율" })).toBeVisible();
  await expect(page.getByRole("button", { name: "균등 배분" })).toBeVisible();
  await expect(page.getByText("오늘 기록 알림")).toBeVisible();
  const tabs = await page.$$eval(".tabbar-btn", (els) => els.map((e) => e.textContent));
  expect(tabs).toEqual(["상태보기", "할 일", "타이머", "내 정보"]);
  await page.getByRole("heading", { name: "목표 비율" }).scrollIntoViewIfNeeded();
  await photo(page, "내정보");
});
