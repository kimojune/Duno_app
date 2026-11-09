import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { fillWheel } from "../e2e/wheel";

/**
 * 휴대폰 다이얼 끌기 고침(보고 19절, a130bd2)을 「체험 코드」 계정·운영 빌드에서 사진 넉 장으로 남긴다(22 팀장 지시).
 * 체험으로 들어가는 것은 한 번(세션 하나로 넉 장). 저장하지 않고 닫으므로 체험 계정 데이터를 바꾸지 않는다.
 * 끌기는 tests/screens/dial-touch.spec.ts와 같은 CDP Input.dispatchTouchEvent 손가락 끌기(isMobile·hasTouch).
 * 실행: DUNO_DIST_DIR=<다른 빌드 폴더> E2E_PORT=<포트> npx playwright test --config playwright.release.config.ts tests/release/dial-touch-demo.spec.ts
 * 체험 코드는 .env.local에서 이 안에서만 읽는다 — 출력·저장하지 않는다.
 */

const OUT = "docs/oneshot-v2/다이얼-터치-사진-체험";

function demoCode(): string {
  const file = path.resolve(__dirname, "../../.env.local");
  const env = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};
  const value = (env.DEMO_ACCESS_CODE ?? process.env.DEMO_ACCESS_CODE)?.trim();
  if (!value) throw new Error("DEMO_ACCESS_CODE 없음");
  return value;
}

type Pt = { x: number; y: number };
const frame = (page: Page) => page.waitForTimeout(16);

async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", p?: Pt) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [] });
}
async function swipe(page: Page, cdp: CDPSession, points: Pt[]) {
  await touch(cdp, "touchStart", points[0]);
  await frame(page);
  for (const p of points.slice(1)) {
    await touch(cdp, "touchMove", p);
    await frame(page);
  }
  await touch(cdp, "touchEnd");
  await page.waitForTimeout(150);
}
async function geometry(svg: Locator, handle: Locator) {
  const s = (await svg.boundingBox())!;
  const h = (await handle.boundingBox())!;
  const c = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  const k = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  return { c, r: Math.hypot(k.x - c.x, k.y - c.y), t0: Math.atan2(k.y - c.y, k.x - c.x) };
}
function arc(g: Awaited<ReturnType<typeof geometry>>, turn: number): Pt[] {
  const steps = Math.max(8, Math.ceil((Math.abs(turn) * 2 * Math.PI * g.r) / 4));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = g.t0 + (turn * 2 * Math.PI * i) / steps;
    return { x: g.c.x + g.r * Math.cos(a), y: g.c.y + g.r * Math.sin(a) };
  });
}
async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: "disabled" });
}
/** 손잡이를 끌고 값 전후를 돌려준다(끌기 동안 pointercancel 없음도 본다) */
async function drag(page: Page, cdp: CDPSession, handlePrefix: string, turn: number) {
  const svg = page.locator("svg.dial");
  await svg.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const w = window as unknown as { __cancel: number };
    w.__cancel = 0;
    window.addEventListener("pointercancel", () => (w.__cancel += 1), true);
  });
  const handle = page.locator(`[id^='${handlePrefix}']`).first();
  const side = (await handle.getAttribute("id"))!.replace(handlePrefix, "");
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await shot(page, `__tmp`); // 위치 안정용이 아니라 쓰지 않는다 — 아래에서 지운다
  fs.rmSync(path.join(OUT, "__tmp.png"), { force: true });
  const g = await geometry(svg, handle);
  return { before, side, run: async () => {
    await swipe(page, cdp, arc(g, side === "start" ? -turn : turn));
    const after = Number(await page.locator(`[id^='${handlePrefix}']`).first().getAttribute("aria-valuenow"));
    const cancels = await page.evaluate(() => (window as unknown as { __cancel: number }).__cancel);
    return { after, cancels };
  } };
}

test("체험 계정(운영 빌드) 다이얼 사진 넉 장: 분야마다 나누기 · 목표 비율, 끌기 전·후", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  let entered = 0;
  try {
    await page.goto("/");
    await page.getByRole("textbox", { name: "체험 코드" }).fill(demoCode());
    await page.getByRole("button", { name: "체험 코드로 시작" }).click();
    entered += 1;
    await expect(page.getByRole("button", { name: "할 일 적기" })).toBeVisible({ timeout: 60_000 });
    console.log(`[dial-demo] 체험으로 들어간 횟수: ${entered}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const cdp = await context.newCDPSession(page);

    // ---- 오늘 기록 「분야마다 나누기」 ----
    const dialog = page.getByRole("dialog", { name: "오늘 기록" });
    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    await dialog.getByRole("button", { name: "분야마다 나누기" }).waitFor({ timeout: 20_000 });
    await fillWheel(dialog, "시간", 3);
    await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
    await expect(dialog.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
    const group = dialog.getByRole("group", { name: "분야 · 여러 개" });
    const more = group.getByRole("button", { name: /^분야 \d+개 더 보기$/ });
    if (await more.isVisible().catch(() => false)) await more.click();
    const pressed = await group.getByRole("button", { name: /, 다이얼에 넣기$/, pressed: true }).count();
    for (let i = pressed; i < 2; i++) await group.getByRole("button", { name: /, 다이얼에 넣기$/, pressed: false }).first().click();
    await page.waitForTimeout(400);
    const d1 = await drag(page, cdp, "evening-dial-handle-", 0.25);
    await shot(page, "1 나누기 다이얼 · 끌기 전");
    const r1 = await d1.run();
    await shot(page, "2 나누기 다이얼 · 끈 뒤");
    console.log(`[dial-demo] 나누기 다이얼: 값 ${d1.before} → ${r1.after} · pointercancel ${r1.cancels}`);
    expect(r1.cancels, "끌기 동안 pointercancel 없음").toBe(0);
    expect(r1.after, "끈 뒤 값이 달라진다").not.toBe(d1.before);
    await dialog.getByRole("button", { name: "닫기" }).first().click();
    const confirm = page.getByRole("alertdialog");
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.getByRole("button", { name: /나가기|저장하지 않고/ }).first().click();
    await expect(dialog).toHaveCount(0);

    // ---- 내 정보 → 목표 비율 ----
    await page.getByRole("navigation", { name: "화면 이동" }).getByRole("button", { name: "내 정보" }).click();
    await page.getByRole("button", { name: /^목표 비율, / }).click();
    const rdialog = page.getByRole("dialog", { name: "목표 비율" });
    await expect(rdialog.getByRole("button", { name: "균등 배분" })).toBeVisible();
    await page.waitForTimeout(400);
    const d2 = await drag(page, cdp, "ratio-dial-handle-", 0.25);
    await shot(page, "3 목표 비율 다이얼 · 끌기 전");
    const r2 = await d2.run();
    await shot(page, "4 목표 비율 다이얼 · 끈 뒤");
    console.log(`[dial-demo] 목표 비율 다이얼: 값 ${d2.before} → ${r2.after} · pointercancel ${r2.cancels}`);
    expect(r2.cancels, "끌기 동안 pointercancel 없음").toBe(0);
    expect(r2.after, "끈 뒤 값이 달라진다").not.toBe(d2.before);
    // 저장하지 않고 나간다
    await rdialog.getByRole("button", { name: /^‹|뒤로|닫기/ }).first().click().catch(() => undefined);
    const confirm2 = page.getByRole("alertdialog");
    if (await confirm2.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm2.getByRole("button", { name: /나가기|저장하지 않고/ }).first().click();
  } finally {
    await context.close();
  }
});
