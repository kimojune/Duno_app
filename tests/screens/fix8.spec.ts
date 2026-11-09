import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * 고침8(23 「발표 판 고침8 분야 페이지」 안 A, PM 「141 나」 · Figma 50:616): 분야 페이지 요약 카드(고리) + 날짜별 시간 막대.
 * 360×800 사진을 docs/oneshot-v2/고침8/에 두고, 사진만 남는 시험이 되지 않게 글·치수·순서·실제 칠해진 색을 같이 단언한다.
 * 개발 갤러리(/dev/v2)의 화면이다(진짜 로그인 앱 화면 아님 — 컴포넌트는 앱과 같은 것, 데이터만 가짜). npm run screens(SCREENS_PORT)
 * - category: 어학(누적 40시간 중 67% · 이번 주 7시간 · 목표 비율 50%), 날짜 넷(1시간 30분 · 2시간(가장 긴 날) · 45분 시간만 · 0분 할 일만)
 * - category-other: 기타(Figma 121:468 — 목표 비율 줄 없음, 기타 색), category-empty: 빈 분야(Figma 121:527 — 0% · 「할 일 0개」)
 */
const OUT = path.resolve(__dirname, "../../docs/oneshot-v2/고침8");

async function openWindow(page: Page, s: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${s}`);
  await page.waitForLoadState("networkidle");
  await page.locator("#dev-open-window").click();
  await expect(page.locator(".category-summary")).toBeVisible();
}
async function photo(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
async function noOverflow(page: Page) {
  const s = await page.evaluate(() => {
    const d = document.querySelector(".detail")!;
    return { sw: Math.max(document.documentElement.scrollWidth, d.scrollWidth), cw: Math.min(document.documentElement.clientWidth, d.clientWidth) };
  });
  expect(s.sw, "가로 스크롤 없음").toBeLessThanOrEqual(s.cw);
}
async function tokenColor(page: Page, name: string) {
  return page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${n})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);
}

test("분야 페이지: 요약 카드(고리 88 · 세 줄) + 날짜별 시간 막대(가장 긴 날 = 폭 전체, 시간만 있는 날 포함)", async ({ page }) => {
  await openWindow(page, "category");
  const card = page.locator(".category-summary");
  await expect(card).toHaveAttribute("aria-label", "어학, 총 40시간, 전체 중 67%, 이번 주 7시간, 목표 비율 50%");
  await expect(page.locator(".category-summary-lines p")).toHaveText(["총 40시간", "이번 주 7시간", "목표 비율 50%"]);
  await expect(page.locator(".category-ring-percent")).toHaveText("67%");
  await expect(page.locator(".category-ring-caption")).toHaveText("전체 중");

  const m = await page.evaluate(() => {
    const rect = (el: Element) => el.getBoundingClientRect();
    const cardEl = document.querySelector(".category-summary")!;
    const cs = getComputedStyle(cardEl);
    const ring = document.querySelector(".category-ring svg")!;
    const slice = document.querySelector(".category-ring-slice")!;
    const track = document.querySelector(".category-ring-track")!;
    const days = [...document.querySelectorAll(".category-day")];
    const fills = days.map((d) => d.querySelector(".category-day-fill"));
    const barBox = days[0].querySelector(".category-day-bar")!;
    return {
      cardRadius: cs.borderRadius,
      cardPadding: cs.paddingTop,
      cardBg: cs.backgroundColor,
      ring: { w: rect(ring).width, h: rect(ring).height },
      sliceFill: getComputedStyle(slice).fill,
      sliceStroke: getComputedStyle(slice).stroke,
      trackFill: getComputedStyle(track).fill,
      dates: days.map((d) => d.querySelector(".category-day-date")!.textContent),
      minutes: days.map((d) => d.querySelector(".category-day-minutes")?.textContent ?? null),
      fillWidths: fills.map((f) => (f ? Math.round(rect(f).width) : null)),
      fillBg: fills[1] ? getComputedStyle(fills[1]).backgroundColor : null,
      fillShadow: fills[1] ? getComputedStyle(fills[1]).boxShadow : null,
      fillHeight: fills[1] ? rect(fills[1]).height : null,
      barWidth: Math.round(rect(barBox).width),
      cards: days.map((d) => d.querySelector(".category-day-card") !== null),
      gapSummaryToDays: rect(document.querySelector(".category-days")!).top - rect(cardEl).bottom,
      gapBetweenDays: days.length > 1 ? rect(days[1]).top - rect(days[0]).bottom : null,
    };
  });
  expect(m.cardRadius).toBe("16px");
  expect(m.cardPadding).toBe("16px");
  expect(m.cardBg).toBe(await tokenColor(page, "--color-surface"));
  expect(m.ring).toEqual({ w: 88, h: 88 });
  expect(m.sliceFill).toBe(await tokenColor(page, "--color-category-1"));
  expect(m.sliceStroke).toBe(await tokenColor(page, "--color-chart-outline"));
  expect(m.trackFill).toBe(await tokenColor(page, "--color-notice-bg"));
  expect(m.dates).toEqual(["11월 7일 토요일", "11월 6일 금요일", "11월 5일 목요일", "11월 4일 수요일"]);
  expect(m.minutes).toEqual(["1시간 30분", "2시간", "45분", null]);
  // 막대: 가장 긴 날(2시간) = 폭 전체(328 근처, 본문 폭), 1시간 30분 = 75%, 45분 = 37.5%, 0분 = 없음
  expect(m.barWidth).toBeGreaterThan(300);
  expect(m.fillWidths[1]).toBe(m.barWidth);
  expect(Math.abs(m.fillWidths[0]! - m.barWidth * 0.75)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.fillWidths[2]! - m.barWidth * 0.375)).toBeLessThanOrEqual(1);
  expect(m.fillWidths[3]).toBeNull();
  expect(m.fillHeight).toBe(8);
  expect(m.fillBg).toBe(await tokenColor(page, "--color-category-1"));
  expect(m.fillShadow).toContain("inset");
  expect(m.cards).toEqual([true, true, false, true]); // 11-05는 시간만(머리·막대만)
  expect(Math.round(m.gapSummaryToDays)).toBe(20);
  expect(Math.round(m.gapBetweenDays!)).toBe(20);
  await expect(page.getByRole("heading", { level: 3, name: "11월 6일 금요일, 2시간" })).toBeVisible();
  await noOverflow(page);
  // 날짜 넷(시간만 있는 날 · 할 일만 있는 날 포함)이 한 화면(800) 안에 든다
  expect(await page.locator(".category-day").nth(3).evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(800);
  await photo(page, "category-page");
});

test("기타 페이지(Figma 121:468): 같은 꼴, 「목표 비율」 줄 없음, 기타 색 고리·막대", async ({ page }) => {
  await openWindow(page, "category-other");
  await expect(page.locator(".category-summary-lines p")).toHaveText(["총 4시간", "이번 주 1시간"]);
  await expect(page.locator(".category-summary")).toHaveAttribute("aria-label", "기타, 총 4시간, 전체 중 8%, 이번 주 1시간");
  await expect(page.locator(".category-ring-percent")).toHaveText("8%");
  const other = await tokenColor(page, "--color-category-other");
  expect(await page.locator(".category-ring-slice").evaluate((el) => getComputedStyle(el).fill)).toBe(other);
  await expect(page.locator(".category-day")).toHaveCount(3);
  const m = await page.evaluate(() => {
    const days = [...document.querySelectorAll(".category-day")];
    const bar = days[0].querySelector(".category-day-bar")!.getBoundingClientRect().width;
    return { bar, fills: days.map((d) => d.querySelector(".category-day-fill")!.getBoundingClientRect().width), bg: getComputedStyle(days[0].querySelector(".category-day-fill")!).backgroundColor };
  });
  expect(m.bg).toBe(other);
  expect(m.fills[1]).toBeCloseTo(m.bar, 0);
  expect(Math.abs(m.fills[0] - m.bar / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.fills[2] - m.bar / 2)).toBeLessThanOrEqual(1);
  await noOverflow(page);
  await photo(page, "category-other");
});

test("빈 분야(Figma 121:527): 요약 카드(바탕 고리만 · 0%) + 「할 일 0개」(카드 아래 20)", async ({ page }) => {
  await openWindow(page, "category-empty");
  await expect(page.locator(".category-ring-percent")).toHaveText("0%");
  await expect(page.locator(".category-ring-slice")).toHaveCount(0);
  await expect(page.locator(".category-ring-track")).toHaveCount(1);
  await expect(page.locator(".category-summary-lines p")).toHaveText(["총 0시간", "이번 주 0시간", "목표 비율 30%"]);
  await expect(page.getByText("할 일 0개", { exact: true })).toBeVisible();
  const gap = await page.evaluate(() => document.querySelector(".category-empty")!.getBoundingClientRect().top - document.querySelector(".category-summary")!.getBoundingClientRect().bottom);
  expect(Math.round(gap)).toBe(20);
  await expect(page.locator(".category-day")).toHaveCount(0);
  await noOverflow(page);
  await photo(page, "category-empty");
});
