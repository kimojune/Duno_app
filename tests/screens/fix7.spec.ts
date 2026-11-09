import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * 고침7(23 「발표 판 고침7 S6 빈 상태」, PM 15:1x): 상태보기 목표 비율 뷰의 빈 상태 셋. 360×800 사진을 docs/oneshot-v2/고침7/에 두고,
 * 사진만 남는 시험이 되지 않게 글·순서·자리·실제 칠해진 색을 같이 단언한다.
 * 개발 갤러리(/dev/v2)의 화면이다(진짜 로그인 앱 화면 아님 — 컴포넌트는 앱과 같은 것, 데이터만 가짜). 개발 서버(3200)에서 돈다: npm run screens
 * - 경우 1(growth-week-zero: 이번 주 0 + 쌓인 60시간): 「총 시간」으로 시작, 머리 아래 「이번 주 0시간」, 카드 끝 「오늘 기록」 — 띠 · 원
 * - 경우 2(growth-empty: 기록 하나도 없음): 머리 「0시간」 · 칩 셋 · 「원그래프로 보기」 — 띠, 경우 3: 원(오른쪽 회색 빈 고리 + 「0시간」)
 * 고침9(J4): 기간은 칩 하나 「이번 주 ▾」(메뉴 단추 — 열면 이번 주 / 총 시간 / 비교), 보기 바꾸기는 같은 머리 줄 오른쪽 끝, 카드 밖 안내 글 없음.
 * 이 시험의 사진 자리(docs/oneshot-v2/고침7)는 고침7 기록이라 고침9 사진은 fix9-status(고침9-J4)에 둔다
 */
const OUT = path.resolve(__dirname, "../../docs/oneshot-v2/고침7");

async function open(page: Page, s: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${s}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("tab", { name: "목표 비율" })).toHaveAttribute("aria-selected", "true");
}
async function photo(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
async function noOverflow(page: Page) {
  const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(s.sw, "가로 스크롤 없음").toBeLessThanOrEqual(s.cw);
}
/** 카드 위 끝에서 보기 바꾸기 글 단추 위 끝까지(px) — 데이터 있는 판과 빈 판이 같은 자리인지 본다 */
async function switchOffset(page: Page) {
  return page.locator(".growth-card").evaluate((card) => {
    const sw = card.querySelector(".growth-switch")!;
    return { top: sw.getBoundingClientRect().top - card.getBoundingClientRect().top, right: card.getBoundingClientRect().right - sw.getBoundingClientRect().right };
  });
}
/** 기간 칩(고침9)을 열어 목록의 기간 이름들을 읽고 Esc로 닫는다 */
async function periodOptions(page: Page) {
  await page.getByRole("button", { name: /^기간, / }).click();
  const names = await page.getByRole("menu", { name: "기간" }).getByRole("menuitemradio").allTextContents();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  return names;
}
/** 토큰 이름의 실제 계산 색(rgb) */
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

test("경우 1: 이번 주 0 + 쌓인 시간 → 「총 시간」으로 시작 · 머리 아래 「이번 주 0시간」 · 띠 둘 · 카드 끝 「오늘 기록」, 원으로 바꾸면 「총 시간」 원", async ({ page }) => {
  // 같은 자리 기준: 데이터 있는 판(growth-week)의 보기 바꾸기 단추 자리
  await open(page, "growth-week");
  const withData = await switchOffset(page);

  await open(page, "growth-week-zero");
  await expect(page.getByRole("button", { name: "기간, 총 시간" })).toHaveText("총 시간 ▾");
  expect(await periodOptions(page)).toEqual(["이번 주", "총 시간", "비교"]);
  await expect(page.locator(".growth-card-total")).toHaveText("60시간");
  const note = page.locator(".growth-card > .growth-week-zero");
  await expect(note).toHaveText("이번 주 0시간");
  await expect(page.locator(".growth-band-line .growth-line-caption")).toHaveText(["목표 비율", "총 시간"]);
  await expect(page.locator(".growth-legend-item")).toHaveText(["목표 비율", "총 시간"]);
  const m = await page.locator(".growth-card").evaluate((card) => {
    const box = (sel: string) => card.querySelector(sel)!.getBoundingClientRect();
    const n = card.querySelector(".growth-week-zero")!;
    const cs = getComputedStyle(n);
    return {
      // 머리 한 줄의 보이는 아래 끝(칩 면). 칩·글 단추의 누름 영역 48은 카드 안 여백으로 넘어간다(고침9)
      switchBottom: box(".growth-period-chip-face").bottom,
      noteTop: box(".growth-week-zero").top,
      noteBottom: box(".growth-week-zero").bottom,
      graphTop: box(".growth-graph").top,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: cs.color,
      lastIsEvening: card.lastElementChild?.textContent === "오늘 기록",
      ratioBorder: getComputedStyle(card.querySelector('.growth-band[data-line="ratio"] .growth-band-cell')!).borderTopStyle,
      spentBorder: getComputedStyle(card.querySelector('.growth-band[data-line="spent"] .growth-band-cell')!).borderTopStyle,
    };
  });
  // 머리(합계·칩·보기 바꾸기) 바로 아래 한 줄 → 그 아래 그림
  expect(m.noteTop).toBeGreaterThanOrEqual(m.switchBottom - 0.5);
  expect(m.noteTop - m.switchBottom).toBeLessThanOrEqual(8);
  expect(m.graphTop).toBeGreaterThanOrEqual(m.noteBottom - 0.5);
  expect(m.fontSize).toBe("12px");
  expect(m.fontWeight).toBe("500");
  expect(m.color).toBe(await tokenColor(page, "--color-text-sub"));
  expect(m.lastIsEvening, "카드 끝 「오늘 기록」").toBe(true);
  expect([m.ratioBorder, m.spentBorder]).toEqual(["dashed", "solid"]);
  expect(await switchOffset(page), "보기 바꾸기 단추가 데이터 있는 판과 같은 자리").toEqual(withData);
  await expect(page.getByRole("button", { name: "오늘 기록", exact: true })).toBeVisible();
  await noOverflow(page);
  await photo(page, "경우1-이번주0-총시간-띠");

  await page.getByRole("button", { name: "원그래프로 보기" }).click();
  await expect(page.locator("svg.growth-pie")).toHaveCount(2);
  await expect(page.locator(".growth-pie-box .growth-line-caption")).toHaveText(["목표 비율", "총 시간"]);
  expect(await page.locator(".growth-pie-box").nth(1).locator("path.growth-pie-slice").count(), "총 시간 원 조각").toBeGreaterThanOrEqual(2);
  await expect(page.locator(".growth-pie-ring")).toHaveCount(0);
  await noOverflow(page);
  await photo(page, "경우1-이번주0-총시간-원");
});

test("경우 2: 기록 하나도 없음 → 머리 「0시간」 · 칩 셋 · 「원그래프로 보기」(같은 자리) · 띠 · 안내 글 · 「오늘 기록」 / 경우 3: 원 = 오른쪽 회색 빈 고리 1px + 「0시간」", async ({ page }) => {
  await open(page, "growth-week");
  const withData = await switchOffset(page);

  await open(page, "growth-empty");
  await expect(page.getByRole("button", { name: "기간, 이번 주" })).toHaveText("이번 주 ▾");
  expect(await periodOptions(page)).toEqual(["이번 주", "총 시간", "비교"]);
  await expect(page.locator(".growth-card-total")).toHaveText("0시간");
  await expect(page.locator(".growth-band.is-empty")).toHaveText("0시간");
  await expect(page.locator(".growth-week-zero")).toHaveCount(0);
  // 고침9(⑬ 20, PM d-143 가): 카드 밖 안내 글은 없앴다. 「오늘 기록」은 카드 안 끝
  await expect(page.getByText(/아직 이번 주 오늘 기록이 없어요/)).toHaveCount(0);
  await expect(page.locator(".growth-card .growth-evening-button")).toHaveText("오늘 기록");
  expect(await switchOffset(page), "보기 바꾸기 단추가 데이터 있는 판과 같은 자리").toEqual(withData);
  await noOverflow(page);
  await photo(page, "경우2-기록없음-띠");

  await page.getByRole("button", { name: "원그래프로 보기" }).click();
  await expect(page.locator(".growth-pie-box .growth-line-caption")).toHaveText(["목표 비율", "이번 주"]);
  const ring = await page.locator(".growth-pie-box").nth(1).evaluate((box) => {
    const c = box.querySelector("circle.growth-pie-ring")!;
    const cs = getComputedStyle(c);
    const t = box.querySelector("text")!;
    const cb = c.getBoundingClientRect();
    const tb = t.getBoundingClientRect();
    return {
      paths: box.querySelectorAll("path").length,
      stroke: cs.stroke,
      strokeWidth: cs.strokeWidth,
      fill: cs.fill,
      text: t.textContent,
      ringWidth: cb.width,
      centerDx: Math.abs(tb.left + tb.width / 2 - (cb.left + cb.width / 2)),
      centerDy: Math.abs(tb.top + tb.height / 2 - (cb.top + cb.height / 2)),
    };
  });
  expect(ring.paths).toBe(0);
  expect(ring.stroke).toBe(await tokenColor(page, "--color-border-input"));
  expect(ring.strokeWidth).toBe("1px");
  expect(ring.fill).toBe("none");
  expect(ring.text).toBe("0시간");
  expect(ring.ringWidth).toBeGreaterThan(80);
  expect(ring.centerDx).toBeLessThanOrEqual(2);
  expect(ring.centerDy).toBeLessThanOrEqual(2);
  expect(await page.locator(".growth-pie-box").first().locator("path.growth-pie-slice").count(), "왼쪽 목표 비율 원 조각").toBeGreaterThanOrEqual(2);
  await noOverflow(page);
  await photo(page, "경우2-3-기록없음-원-빈고리");

  await page.getByRole("button", { name: "띠그래프로 보기" }).click();
  await expect(page.locator(".growth-band.is-empty")).toHaveText("0시간");
});
