import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { photoDir } from "./photo-dir";

/**
 * 고침10 W2a 화면 시험(23 목록 1절 D · G · H · I): 로그인(큰 고리 · Google 알약 · 체험 코드 세 상태) · 타이머 · 상태보기 칩 · 내 정보 로그아웃 줄.
 * 개발 갤러리: /dev/states?s=L1 · D1 · D2 · D3(로그인), /dev/v2?s=timer-many · growth-week · tabbar. 사진 워커가 같은 자리에서 다시 찍는다. npm run screens
 */
const OUT = photoDir("고침10-A");
test.use({ deviceScaleFactor: 2 });

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

test("S0 로그인 L1: 큰 고리 120(가운데 · 윗면 236) · 「duno」 32 Bold 가운데 · 안내 14 보조색 가운데 · Google 알약 320×48", async ({ page }) => {
  await open(page, "/dev/states?s=L1");
  const ring = (await page.locator("svg.login-ring").boundingBox())!;
  expect([Math.round(ring.width), Math.round(ring.height)]).toEqual([120, 120]);
  expect(Math.round(ring.x + 60), "가운데 x 180").toBe(180);
  expect(Math.round(ring.y), "윗면 y 236(Figma 54:14)").toBe(236);
  const strokes = await page.evaluate(() => ({
    body: getComputedStyle(document.querySelector(".login-ring-body")!).stroke,
    piece: getComputedStyle(document.querySelector(".login-ring-piece")!).stroke,
    width: document.querySelector(".login-ring-body")!.getAttribute("stroke-width"),
  }));
  expect(strokes).toEqual({ body: "rgb(28, 35, 64)", piece: "rgb(255, 138, 87)", width: "24" });
  const name = page.locator(".login-name");
  const nb = (await name.boundingBox())!;
  expect(Math.round(nb.y), "「duno」 윗면 404").toBe(404);
  const ns = await name.evaluate((el) => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight, align: getComputedStyle(el.parentElement!).textAlign }));
  expect(ns).toEqual({ size: "32px", weight: "700", align: "center" });
  const sentence = page.locator(".login-sentence");
  const sb = (await sentence.boundingBox())!;
  expect(Math.round(sb.y), "안내 글 y 452").toBe(452);
  expect(Math.round(sb.x + sb.width / 2), "가운데").toBe(180);
  const ss = await sentence.evaluate((el) => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight, color: getComputedStyle(el).color }));
  expect(ss).toEqual({ size: "14px", weight: "400", color: "rgb(94, 100, 120)" });
  const g = (await page.locator(".google-btn").boundingBox())!;
  expect([Math.round(g.width), Math.round(g.height)]).toEqual([320, 48]);
  expect(Math.round(g.x)).toBe(20);
  await noOverflow(page);
  await photo(page, "S0-L1-로그인");
});

test("S0 체험 코드 D1 기본: 이름표 12 보조색 · 칸 232×48 모서리 12 테두리 1 #7D8299 · 시작 80×48 14 Bold", async ({ page }) => {
  await open(page, "/dev/states?s=D1");
  const label = page.locator(".demo-form .input-label");
  await expect(label).toHaveText("체험 코드");
  expect(await label.evaluate((el) => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight, color: getComputedStyle(el).color }))).toEqual({ size: "12px", weight: "400", color: "rgb(94, 100, 120)" });
  const input = page.locator(".demo-input");
  const ib = (await input.boundingBox())!;
  expect([Math.round(ib.width), Math.round(ib.height)]).toEqual([232, 48]);
  expect(await input.evaluate((el) => ({ r: getComputedStyle(el).borderTopLeftRadius, w: getComputedStyle(el).borderTopWidth, c: getComputedStyle(el).borderTopColor }))).toEqual({ r: "12px", w: "1px", c: "rgb(125, 130, 153)" });
  const start = page.getByRole("button", { name: "체험 코드로 시작" });
  const bb = (await start.boundingBox())!;
  expect([Math.round(bb.width), Math.round(bb.height)]).toEqual([80, 48]);
  expect(Math.round(bb.x - (ib.x + ib.width)), "칸과 단추 간격 8").toBe(8);
  expect(await start.evaluate((el) => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight }))).toEqual({ size: "14px", weight: "700" });
  await expect(start).toHaveText("시작");
  await noOverflow(page);
  await photo(page, "S0-D1-체험코드-기본");
});

test("S0 체험 코드 D2 틀린 코드(141:13): 칸 테두리 2px · 값 남음 · 아래 「!」 + 오류 글(role=alert), 칸 aria-describedby", async ({ page }) => {
  await open(page, "/dev/states?s=D2");
  const input = page.locator(".demo-input");
  expect(await input.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("2px");
  await expect(input).toHaveValue("DUNO-2025");
  const alert = page.locator(".demo-error");
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("코드가 맞지 않아요");
  await expect(alert.locator(".demo-error-icon")).toHaveText("!");
  const id = await alert.getAttribute("id");
  await expect(input).toHaveAttribute("aria-describedby", id!);
  expect((await alert.boundingBox())!.y, "오류 글은 칸 아래").toBeGreaterThan((await input.boundingBox())!.y + 40);
  await noOverflow(page);
  await photo(page, "S0-D2-체험코드-틀림");
});

test("고침10 QA1 ① 틀린 코드: 오류가 나와도 칸·Google 단추가 안 움직이고 오류 글은 12 Medium 한 줄", async ({ page }) => {
  await open(page, "/dev/states?s=D1");
  const baseInput = (await page.locator(".demo-input").boundingBox())!.y;
  const baseGoogle = (await page.locator(".google-btn").boundingBox())!.y;
  await open(page, "/dev/states?s=D2");
  expect((await page.locator(".demo-input").boundingBox())!.y, "칸이 밀리지 않는다").toBe(baseInput);
  expect((await page.locator(".google-btn").boundingBox())!.y, "Google 단추가 밀리지 않는다").toBe(baseGoogle);
  const error = page.locator(".demo-error");
  expect(await error.evaluate((el) => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight, height: el.getBoundingClientRect().height }))).toEqual({ size: "12px", weight: "500", height: 16 });
  await noOverflow(page);
});

test("S0 체험 코드 D3 시작 중(141:31): 「시작 중」 · 두 단추(시작 · Google) 막힘 흐림 0.45 · aria-busy", async ({ page }) => {
  await open(page, "/dev/states?s=D3");
  const start = page.getByRole("button", { name: "체험 코드로 시작" });
  await expect(start).toHaveText("시작 중");
  await expect(start).toBeDisabled();
  await expect(start).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".google-btn")).toBeDisabled();
  expect(await start.evaluate((el) => getComputedStyle(el).opacity)).toBe("0.45");
  expect(await page.locator(".google-btn").evaluate((el) => getComputedStyle(el).opacity)).toBe("0.45");
  const bb = (await start.boundingBox())!;
  expect(Math.round(bb.width)).toBe(80);
  expect(await start.evaluate((el) => el.getClientRects().length)).toBe(1);
  await noOverflow(page);
  await photo(page, "S0-D3-체험코드-시작중");
});

test("S4 타이머: 둥근 단추 24 — 고른 것 먹남색 채움 + 흰 점, 안 고른 것 빈 원 / 머리 워드마크", async ({ page }) => {
  await open(page, "/dev/v2?s=timer-many");
  const radios = page.locator(".timer-option input");
  expect(await radios.count()).toBeGreaterThan(0);
  const checked = page.locator(".timer-option input:checked").first();
  // 갤러리 상태에는 할 일이 없어 둥근 단추가 하나뿐이다: 안 고른 모양은 같은 클래스 자리에 하나 더해 본다
  await page.evaluate(() => {
    const extra = document.createElement("input");
    extra.type = "radio";
    extra.name = "timer-choice";
    extra.id = "probe-unchecked";
    document.querySelector(".timer-option")!.append(extra);
  });
  const unchecked = page.locator("#probe-unchecked");
  for (const r of [checked, unchecked]) {
    const b = (await r.boundingBox())!;
    expect([Math.round(b.width), Math.round(b.height)]).toEqual([24, 24]);
  }
  const c = await checked.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(c).toContain("radial-gradient");
  expect(c).toContain("rgb(28, 35, 64)");
  const u = await unchecked.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow, appearance: getComputedStyle(el).appearance }));
  expect(u.bg).toBe("rgb(255, 255, 255)");
  expect(u.shadow).toContain("rgb(125, 130, 153)");
  expect(u.shadow).toContain("1.5px");
  expect(u.appearance).toBe("none");
  await expect(page.locator(".timer .wordmark")).toBeVisible();
  await expect(page.getByText("오늘 시작한 타이머")).toHaveCount(0);
  await photo(page, "S4-타이머");
});

test("S6 상태보기: 기간 칩은 이번 주 · 총 시간 둘뿐(비교 없음)", async ({ page }) => {
  await open(page, "/dev/v2?s=growth-week");
  await page.getByRole("tab", { name: "목표 비율" }).click();
  await page.getByRole("button", { name: /^기간, / }).click();
  await expect(page.getByRole("menuitemradio")).toHaveText(["이번 주", "총 시간"]);
  await photo(page, "S6-기간-칩-메뉴");
});

test("S8 내 정보: 로그아웃 = 알림 카드 아래 흰 카드 줄 56 · 모서리 16 · 글 16 Regular 글색 · 탭 줄에 가리지 않음", async ({ page }) => {
  await open(page, "/dev/v2?s=tabbar");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const row = page.getByRole("button", { name: "로그아웃" });
  const b = (await row.boundingBox())!;
  expect(Math.round(b.height)).toBeGreaterThanOrEqual(56);
  const card = (await page.locator(".me-section.card-box").first().boundingBox())!;
  expect(Math.round(b.width), "다른 카드와 같은 폭").toBe(Math.round(card.width));
  const s = await row.evaluate((el) => ({ r: getComputedStyle(el).borderTopLeftRadius, bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight }));
  expect(s).toEqual({ r: "16px", bg: "rgb(255, 255, 255)", color: "rgb(28, 35, 64)", size: "16px", weight: "400" });
  const notify = (await page.locator("#me-notify-title").locator("xpath=ancestor::section[1]").boundingBox())!;
  expect(b.y, "알림 카드 아래").toBeGreaterThan(notify.y + notify.height - 1);
  const bar = (await page.locator(".tabbar").boundingBox())!;
  expect(b.y + b.height, "탭 줄에 가리지 않는다").toBeLessThanOrEqual(bar.y + 0.5);
  await photo(page, "S8-내정보-로그아웃줄");
});
