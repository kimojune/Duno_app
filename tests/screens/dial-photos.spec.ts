import { expect, test, type CDPSession, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fillWheel } from "../e2e/wheel";
import { photoDir } from "./photo-dir";

/**
 * 다이얼 고침(보고 19절) 디자인 QA 사진 넉 장: 오늘 기록 나누기 다이얼(칩 둘 고름)과 목표 비율 다이얼의 끌기 전·끈 뒤.
 * 360×800 · deviceScaleFactor 2 · 모바일(isMobile·hasTouch). 끌기는 재현 시험(dial-touch.spec.ts)과 같은 CDP 터치(Input.dispatchTouchEvent)다.
 * 개발 갤러리(/dev/v2)의 화면이다(컴포넌트는 앱과 같은 것, 데이터만 가짜 — 체험 계정 화면 아님). 갤러리 길은 개발 서버에만 있다.
 * 사진은 SAVE_PHOTOS=1일 때만 docs/oneshot-v2/다이얼-터치-사진/에 쓴다(tests/screens/photo-dir.ts).
 */
const OUT = photoDir("다이얼-터치-사진");
test.use({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

async function photo(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250); // 조각 나옴(120ms)이 끝나게
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", p?: { x: number; y: number }) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [] });
}
/** 손잡이를 원 둘레로 turn 바퀴(+ 시계 방향) 손가락으로 끈다 */
async function dragHandle(page: Page, handleSel: string, turn: number) {
  const s = (await page.locator("svg.dial").boundingBox())!;
  const h = (await page.locator(handleSel).first().boundingBox())!;
  const c = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  const k = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  const r = Math.hypot(k.x - c.x, k.y - c.y);
  const t0 = Math.atan2(k.y - c.y, k.x - c.x);
  const steps = Math.ceil((Math.abs(turn) * 2 * Math.PI * r) / 4);
  const cdp = await page.context().newCDPSession(page);
  for (let i = 0; i <= steps; i++) {
    const a = t0 + (turn * 2 * Math.PI * i) / steps;
    await touch(cdp, i === 0 ? "touchStart" : "touchMove", { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
    await page.waitForTimeout(16);
  }
  await touch(cdp, "touchEnd");
}
const sideOf = async (page: Page, prefix: string) => ((await page.locator(`[id^='${prefix}']`).first().getAttribute("id")) ?? "").replace(prefix, "");

test("오늘 기록 나누기 다이얼(칩 둘 고름): 끌기 전 · 끈 뒤", async ({ page }) => {
  await page.goto("/dev/v2?s=evening-split-blank");
  await page.waitForLoadState("networkidle");
  await page.locator("#dev-open-window").click();
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await fillWheel(dialog, "시간", 3);
  await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
  await dialog.getByRole("button", { name: "글쓰기, 다이얼에 넣기" }).click();
  await dialog.getByRole("button", { name: "어학, 다이얼에 넣기" }).click();
  await page.locator("svg.dial").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const handle = page.locator("[id^='evening-dial-handle-']").first();
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await photo(page, "오늘 기록 나누기 다이얼 · 끌기 전");
  const side = await sideOf(page, "evening-dial-handle-");
  await dragHandle(page, "[id^='evening-dial-handle-']", side === "start" ? -0.15 : 0.15);
  const after = Number(await page.locator("[id^='evening-dial-handle-']").first().getAttribute("aria-valuenow"));
  expect(Math.abs(after - before), "끈 만큼 값이 바뀐다(15분 넘게)").toBeGreaterThan(15);
  await photo(page, "오늘 기록 나누기 다이얼 · 끈 뒤");
});

test("목표 비율 다이얼(내 정보): 끌기 전 · 끈 뒤", async ({ page }) => {
  await page.goto("/dev/v2?s=me-ratio");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^목표 비율, / }).click();
  await expect(page.getByRole("dialog", { name: "목표 비율" }).getByRole("button", { name: "균등 배분" })).toBeVisible();
  await page.locator("svg.dial").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const handle = page.locator("[id^='ratio-dial-handle-']").first();
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await photo(page, "목표 비율 다이얼 · 끌기 전");
  const side = await sideOf(page, "ratio-dial-handle-");
  await dragHandle(page, "[id^='ratio-dial-handle-']", side === "start" ? -0.2 : 0.2);
  const after = Number(await page.locator("[id^='ratio-dial-handle-']").first().getAttribute("aria-valuenow"));
  expect(Math.abs(after - before), "끈 만큼 값이 바뀐다(15% 넘게)").toBeGreaterThan(15);
  await photo(page, "목표 비율 다이얼 · 끈 뒤");
});
