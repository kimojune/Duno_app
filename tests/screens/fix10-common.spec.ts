import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { COLOR_TOKENS } from "../../lib/design-tokens";
import { photoDir } from "./photo-dir";

/**
 * 고침10 공통 부품 둘(23 목록 1절 A·B, Figma 146:10 · 146:11 · 147:2 · 상태 150:58)의 화면 시험. 개발 갤러리 /dev/v2(app/dev/v2/confirm-gallery.dev.tsx).
 * 사진(360×800)은 다음 화면 워커·사진 워커가 같은 자리에서 다시 찍는다. 사진만 남는 시험이 되지 않게 치수·색·초점을 같이 단언한다. npm run screens
 *  - head-back · head-close: 머리 단추 두 변형 — 판 왼쪽 4 · 위 10, 누름 48×48, 아이콘 24 선 2 글색, 초점 링 2px 2px 틈 모서리 12, 눌림 #E7E1D6
 *  - confirm-leave · confirm-note · confirm-todo · confirm-goal · confirm-logout: 확인 창 쓰는 곳 다섯(글 = 147:2)
 *  - confirm-busy: 「지우는 중」 + 두 단추 막힘(흐림 0.45)
 */
const OUT = photoDir("고침10-공통");
// 폰 배율 2(360×800 · 23 검수 사진과 같음). 배율 1에서는 Chrome이 1.5px 테두리를 1px로 맞춰 그린다
test.use({ deviceScaleFactor: 2 });
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const TEXT = rgb(COLOR_TOKENS["--color-text"]);

async function open(page: Page, s: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${s}`);
  await page.waitForLoadState("networkidle");
}
async function photo(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
async function noOverflow(page: Page) {
  const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(s.sw, "가로 스크롤 없음").toBeLessThanOrEqual(s.cw);
}

/** 머리 단추 꼴(146:10): 판 왼쪽 4 · 위 10, 48×48, 아이콘 24 가운데, 선 2 글색 */
async function checkHeadButton(button: Locator, panel: Locator) {
  const b = (await button.boundingBox())!;
  const p = (await panel.boundingBox())!;
  expect(Math.round(b.width)).toBe(48);
  expect(Math.round(b.height)).toBe(48);
  expect(Math.round(b.x - p.x), "판 왼쪽 4").toBe(4);
  expect(Math.round(b.y - p.y), "판 위 10").toBe(10);
  const icon = (await button.locator("svg").boundingBox())!;
  expect([Math.round(icon.width), Math.round(icon.height)]).toEqual([24, 24]);
  expect(Math.round(icon.x + 12 - (b.x + 24)), "아이콘 가운데(가로)").toBe(0);
  expect(Math.round(icon.y + 12 - (b.y + 24)), "아이콘 가운데(세로)").toBe(0);
  const s = await button.evaluate((el) => {
    const path = el.querySelector("path")!;
    return { color: getComputedStyle(el).color, stroke: path.getAttribute("stroke-width"), radius: getComputedStyle(el).borderRadius, bg: getComputedStyle(el).backgroundColor };
  });
  expect(s).toEqual({ color: TEXT, stroke: "2", radius: "12px", bg: "rgba(0, 0, 0, 0)" });
}

/** 초점(키보드) = 2px 글색 링, 2px 틈 */
async function checkFocusRing(el: Locator) {
  const f = await el.evaluate((e) => {
    const s = getComputedStyle(e);
    return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, offset: s.outlineOffset };
  });
  expect(f).toEqual({ style: "solid", width: "2px", color: TEXT, offset: "2px" });
}

for (const kind of ["back", "close"] as const) {
  test(`머리 단추 ${kind === "back" ? "돌아가기 「‹」(이전)" : "닫기 「✕」(닫기)"} — 146:10 · 150:58`, async ({ page }) => {
    await open(page, `head-${kind}`);
    const name = kind === "back" ? "이전" : "닫기";
    const button = page.getByRole("button", { name });
    await expect(button).toHaveCount(1);
    await expect(button).toHaveText("");
    const panel = page.locator(kind === "back" ? ".detail" : ".category-sheet");
    await checkHeadButton(button, panel);
    await noOverflow(page);
    await photo(page, `머리 단추 ${kind === "back" ? "돌아가기" : "닫기"}`);
    // 초점(Tab으로) — 링이 보인다
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await checkFocusRing(button);
    await photo(page, `머리 단추 ${kind === "back" ? "돌아가기" : "닫기"} · 초점`);
    // 눌림 = 틀 바탕 #E7E1D6
    const b = (await button.boundingBox())!;
    await page.mouse.move(b.x + 24, b.y + 24);
    await page.mouse.down();
    expect(await button.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(rgb(COLOR_TOKENS["--color-secondary-pressed"]));
    await photo(page, `머리 단추 ${kind === "back" ? "돌아가기" : "닫기"} · 눌림`);
    await page.mouse.up();
  });
}

const CONFIRMS = [
  { s: "confirm-leave", title: "저장하지 않고 나갈까요?", desc: null, top: "나가기", bottom: "계속 적기", photo: "확인 창 1 저장하지 않고 나갈까요" },
  { s: "confirm-note", title: "이 작업 기록을 지울까요?", desc: null, top: "지우기", bottom: "그대로 두기", photo: "확인 창 2 작업 기록 지우기" },
  { s: "confirm-todo", title: "이 할 일을 지울까요?", desc: "작업 기록도 함께 지워져요.", top: "지우기", bottom: "그대로 두기", photo: "확인 창 3 할 일 지우기" },
  { s: "confirm-goal", title: "이번 주 목표를 없앨까요?", desc: null, top: "없애기", bottom: "그대로 두기", photo: "확인 창 4 이번 주 목표 없애기" },
  { s: "confirm-logout", title: "로그아웃할까요?", desc: "아직 저장되지 않은 기록은 이 기기에서 지워져요.", top: "로그아웃", bottom: "계속 쓰기", photo: "확인 창 5 로그아웃" },
] as const;

for (const c of CONFIRMS) {
  test(`확인 창 ${c.s} 「${c.title}」 — 146:11 꼴 · 147:2 글 · 초점 · Esc · Tab`, async ({ page }) => {
    await open(page, c.s);
    const dialog = page.getByRole("alertdialog", { name: c.title });
    await expect(dialog).toBeVisible();
    const title = dialog.getByRole("heading", { name: c.title });
    await expect(title, "뜨면 초점은 제목").toBeFocused();
    const buttons = dialog.getByRole("button");
    await expect(buttons).toHaveText([c.top, c.bottom]);
    // 창 꼴: 312 · 가운데 · 흰 바탕 · 모서리 16 · 안 여백 위 28 / 옆 24 / 아래 24
    const box = await dialog.evaluate((e) => {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return { w: Math.round(r.width), cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), bg: s.backgroundColor, radius: s.borderRadius, pt: s.paddingTop, pl: s.paddingLeft, pr: s.paddingRight, pb: s.paddingBottom };
    });
    expect(box).toEqual({ w: 312, cx: 180, cy: 400, bg: rgb(COLOR_TOKENS["--color-surface"]), radius: "16px", pt: "28px", pl: "24px", pr: "24px", pb: "24px" });
    const scrim = await page.locator(".close-confirm-backdrop").evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(scrim.replace(/\s/g, ""), "막 = 먹남색 45%").toMatch(/^(rgba\(28,35,64,0\.45\)|color\(srgb[^)]*0\.45\))$/);
    // 제목 18 Bold 글색
    expect(await title.evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight, getComputedStyle(e).color])).toEqual(["18px", "700", TEXT]);
    // 보조 글: 있을 때만 14 Regular 보조색
    const desc = dialog.locator(".close-confirm-desc");
    if (c.desc) {
      await expect(desc).toHaveText(c.desc);
      expect(await desc.evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight, getComputedStyle(e).color])).toEqual(["14px", "400", rgb(COLOR_TOKENS["--color-text-sub"])]);
    } else {
      await expect(desc).toHaveCount(0);
    }
    // 단추 둘 세로 · 폭 가득(312 − 48 = 264) · 높이 48 · 사이 12 · 글 16 Bold
    const [top, bottom] = [buttons.nth(0), buttons.nth(1)];
    const [t, b] = [(await top.boundingBox())!, (await bottom.boundingBox())!];
    expect([Math.round(t.width), Math.round(b.width)]).toEqual([264, 264]);
    expect([Math.round(t.height), Math.round(b.height)]).toEqual([48, 48]);
    expect(Math.round(b.y - (t.y + t.height)), "단추 사이 12").toBe(12);
    const st = (el: Locator) =>
      el.evaluate((e) => {
        const s = getComputedStyle(e);
        return { fs: s.fontSize, fw: s.fontWeight, color: s.color, bg: s.backgroundColor, line: s.boxShadow };
      });
    expect(await st(top), "위 = 선 1.5 글색(안쪽 그림자 — Chrome은 1.5px 테두리를 1px로 그린다) · 바탕 없음").toEqual({ fs: "16px", fw: "700", color: TEXT, bg: "rgba(0, 0, 0, 0)", line: `${TEXT} 0px 0px 0px 1.5px inset` });
    const bs = await st(bottom);
    expect({ fs: bs.fs, fw: bs.fw, color: bs.color, bg: bs.bg }, "아래 = 글색 채움 · 흰 글").toEqual({ fs: "16px", fw: "700", color: rgb(COLOR_TOKENS["--color-on-primary"]), bg: TEXT });
    await noOverflow(page);
    await photo(page, c.photo);

    // Tab은 창 안에서만 돈다 · 초점 링 2px 2px 틈
    await page.keyboard.press("Tab");
    await expect(top).toBeFocused();
    await checkFocusRing(top);
    await page.keyboard.press("Tab");
    await expect(bottom).toBeFocused();
    await checkFocusRing(bottom);
    await photo(page, `${c.photo} · 초점`);
    await page.keyboard.press("Tab");
    await expect(top, "끝에서 Tab → 처음(창 밖으로 나가지 않음)").toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(bottom).toBeFocused();
    // 눌림: 주 단추 #2E3350 · 보조 단추 바탕 #E7E1D6
    const press = async (el: Locator) => {
      const r = (await el.boundingBox())!;
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      await page.mouse.down();
      const bg = await el.evaluate((e) => getComputedStyle(e).backgroundColor);
      await page.mouse.move(0, 0); // 누른 채 밖으로 — 놓아도 누르지 않는다
      await page.mouse.up();
      return bg;
    };
    expect(await press(bottom)).toBe(rgb(COLOR_TOKENS["--color-primary-pressed"]));
    expect(await press(top)).toBe(rgb(COLOR_TOKENS["--color-secondary-pressed"]));
    await expect(dialog).toBeVisible();

    // Esc = 아래 단추(창이 닫히고 「다시 열기」가 남는다) → 다시 열면 닫힌 뒤 초점은 연 단추
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    const reopen = page.getByRole("button", { name: "다시 열기" });
    await reopen.focus();
    await reopen.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(title).toBeFocused();
    await page.locator(".close-confirm-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(dialog, "막 누름 = 아래 단추").toHaveCount(0);
    await expect(reopen, "닫히면 초점은 연 단추").toBeFocused();
  });
}

test("확인 창 막힘(confirm-busy) — 「지우는 중」 + 두 단추 막힘(흐림 0.45, aria-busy) · 150:58", async ({ page }) => {
  await open(page, "confirm-busy");
  const dialog = page.getByRole("alertdialog", { name: "이 작업 기록을 지울까요?" });
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  const buttons = dialog.getByRole("button");
  await expect(buttons).toHaveText(["지우는 중", "그대로 두기"]);
  for (const i of [0, 1]) {
    await expect(buttons.nth(i)).toBeDisabled();
    await expect(buttons.nth(i)).toHaveAttribute("aria-busy", "true");
    expect(await buttons.nth(i).evaluate((e) => getComputedStyle(e).opacity)).toBe("0.45");
  }
  await page.keyboard.press("Escape");
  await expect(dialog, "막힌 동안 Esc는 아무것도 하지 않는다").toBeVisible();
  await photo(page, "확인 창 막힘 지우는 중");
});

test("안드로이드 뒤로 가기(page.goBack) — 로그아웃 확인은 「계속 쓰기」와 같다(갤러리를 떠나지 않는다)", async ({ page }) => {
  await open(page, "confirm-logout");
  const dialog = page.getByRole("alertdialog", { name: "로그아웃할까요?" });
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/dev\/v2\?s=confirm-logout$/);
  await expect(page.getByRole("button", { name: "다시 열기" })).toBeVisible();
});
