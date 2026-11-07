import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * 원샷 v2 화면 사진과 치수 확인(고침 1바퀴 B10). 개발 서버(next dev, 3200 포트)의 /dev/v2에서만 돈다: npm run screens
 * 대상: 아래 탭 줄 + 내 정보 탭(B1·B8·B9), 상태보기 빈 안내의 「저녁 기록 남기기」(B17), 새 전체 화면 창 넷(B6·B7).
 * 파일 이름: v2-<상태>-<크기>.png. 글자 200%는 screens.spec.ts와 같은 방법으로 흉내 낸다(토큰의 px를 두 배로).
 * 이 파일은 작성만 했다: 이번 바퀴에서는 Playwright를 돌리지 않았다(창구가 다음에 돌린다). 처음 돌릴 때 단언이 실제와 어긋나면
 * 사진을 먼저 보고 단언이 틀린 것인지 화면이 틀린 것인지 가린다.
 */

const OUT = "test-results/screens";
const SIZES = {
  "360x640": { width: 360, height: 640, text200: false },
  "360x800": { width: 360, height: 800, text200: false },
  "320x640": { width: 320, height: 640, text200: false },
  "text200-sim": { width: 360, height: 800, text200: true },
} as const;
type SizeTag = keyof typeof SIZES;

const TEXT200_CSS = `:root{
  --font-name: 700 64px/80px var(--font-family);
  --font-title: 700 48px/64px var(--font-family);
  --font-body: 400 32px/48px var(--font-family);
  --font-sub: 400 28px/40px var(--font-family);
  --font-google: 500 28px/40px var(--font-family);
}`;

async function open(page: Page, state: string, size: SizeTag) {
  const s = SIZES[size];
  await page.setViewportSize({ width: s.width, height: s.height });
  await page.goto(`/dev/v2?s=${state}`);
  if (s.text200) await page.addStyleTag({ content: TEXT200_CSS });
  await page.waitForLoadState("networkidle");
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/v2-${name}.png`, fullPage: false });
}

async function scrollSizes(page: Page) {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
}

const ALL_SIZES: SizeTag[] = ["360x640", "360x800", "320x640", "text200-sim"];

// ---- 아래 탭 줄 + 내 정보 (B1·B8·B9) ----
for (const size of ALL_SIZES) {
  test(`tabbar ${size}: 맨 아래까지 내려도 저장 단추·로그아웃이 탭 줄에 가려지지 않고, 탭 글이 칸을 넘치지 않는다`, async ({ page }) => {
    await open(page, "tabbar", size);
    await shot(page, `tabbar-top-${size}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await shot(page, `tabbar-bottom-${size}`);

    const bar = (await page.locator(".tabbar").boundingBox())!;
    const save = (await page.getByRole("button", { name: "알림 설정 저장" }).boundingBox())!;
    const logout = (await page.getByRole("button", { name: "로그아웃" }).boundingBox())!;
    // B1: 맨 아래에서 저장 단추와 로그아웃의 아래 끝이 탭 줄의 위 끝보다 위에 있다
    expect(save.y + save.height, "알림 설정 저장 단추가 탭 줄에 가려지지 않는다").toBeLessThanOrEqual(bar.y + 0.5);
    expect(logout.y + logout.height, "로그아웃이 탭 줄에 가려지지 않는다").toBeLessThanOrEqual(bar.y + 0.5);

    // B9: 탭 글이 자기 칸을 넘치지 않고(두 줄로 내려갈 수 있다), 가로 스크롤이 없다
    const overflow = await page.$$eval(".tabbar-btn", (buttons) => buttons.map((b) => b.scrollWidth - b.clientWidth));
    expect(Math.max(...overflow)).toBeLessThanOrEqual(1);
    const sw = await scrollSizes(page);
    expect(sw.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(sw.clientWidth);
    // 각 탭의 누르는 면은 높이 48 이상
    const heights = await page.$$eval(".tabbar-btn", (buttons) => buttons.map((b) => b.getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(48);
  });
}

test("tabbar: 내 정보 안 포커스가 탭 줄 밑으로 들어가지 않는다(scroll-padding-bottom에 탭 줄 높이, B8)", async ({ page }) => {
  await open(page, "tabbar", "360x640");
  const padding = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom);
  const bar = (await page.locator(".tabbar").boundingBox())!;
  expect(parseFloat(padding), "스크롤 여백이 탭 줄 높이보다 크다").toBeGreaterThan(bar.height);
  await page.getByRole("button", { name: "알림 설정 저장" }).focus();
  const save = (await page.getByRole("button", { name: "알림 설정 저장" }).boundingBox())!;
  expect(save.y + save.height).toBeLessThanOrEqual(bar.y + 0.5);
});

// ---- 상태보기 빈 안내 (B17) ----
for (const size of ["360x800", "text200-sim"] as SizeTag[]) {
  test(`growth-empty ${size}: 빈 안내 아래에 「저녁 기록 남기기」`, async ({ page }) => {
    await open(page, "growth-empty", size);
    await shot(page, `growth-empty-${size}`);
    const text = page.getByText(/아직 이번 주 저녁 기록이 없어요/);
    const button = page.getByRole("button", { name: "저녁 기록 남기기" });
    await expect(button).toBeVisible();
    const t = (await text.boundingBox())!;
    const b = (await button.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(t.y + t.height - 0.5);
    expect(b.height).toBeGreaterThanOrEqual(48);
  });
}

// ---- 새 전체 화면 창 넷 (B6·B7) ----
const WINDOWS: { id: string; title: string }[] = [
  { id: "goal", title: "이번 주 목표" },
  { id: "evening", title: "저녁 기록" },
  { id: "category", title: "어학" },
  { id: "detail", title: "할 일 자세히" },
];
for (const w of WINDOWS) {
  for (const size of ["360x800", "text200-sim"] as SizeTag[]) {
    test(`${w.id} 창 ${size}: 사진, 밖은 inert, 뒤로 가기는 창만 닫고, 닫으면 연 단추로 포커스`, async ({ page }) => {
      await open(page, w.id, size);
      const opener = page.locator("#dev-open-window");
      const startUrl = page.url();
      await opener.focus();
      await opener.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("heading", { name: w.title, level: 2 }).first()).toBeVisible();
      await shot(page, `${w.id}-window-${size}`);

      // B7: 창 밖(본문·탭 줄)은 inert
      expect(await page.evaluate(() => document.querySelector(".tabbar")!.closest("[inert]") !== null)).toBe(true);
      expect(await page.evaluate(() => document.getElementById("dev-behind")!.closest("[inert]") !== null)).toBe(true);
      expect(await page.evaluate(() => document.querySelector("[role=dialog]")!.closest("[inert]") === null)).toBe(true);
      const sw = await scrollSizes(page);
      expect(sw.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(sw.clientWidth);

      // B6: 뒤로 가기는 창만 닫는다(앱·문서를 떠나지 않는다)
      await page.goBack();
      await expect(dialog).toHaveCount(0);
      expect(page.url()).toBe(startUrl);
      expect(await page.evaluate(() => document.querySelector(".tabbar")!.closest("[inert]") === null)).toBe(true);

      // B7: 닫으면 연 단추로 포커스가 돌아온다(Esc로 닫는 경우도)
      await opener.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    });
  }
}
