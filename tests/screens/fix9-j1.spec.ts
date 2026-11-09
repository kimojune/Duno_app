import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { COLOR_TOKENS } from "../../lib/design-tokens";
import { fillWheel } from "../e2e/wheel";
import { photoDir } from "./photo-dir";

/**
 * 고침9 J1(발표 뒤 판: PM 1·6, ⑬, Figma 정합 A1~A4): 360×800 사진을 docs/oneshot-v2/고침9-J1/에 두고(이름 = 23 최종 폰 목록의 화면 이름),
 * 사진만 남는 시험이 되지 않게 치수·글·순서를 같이 단언한다. 개발 갤러리(/dev/v2)의 화면이다(컴포넌트는 앱과 같고 데이터만 가짜). npm run screens
 * - S1-1~S1-4(Figma 49:178·49:194·49:232·50:4): 2~4단계 왼쪽 위 「‹」 누름 48·첫 포커스, 아래 주 단추 폭 가득·아래 여백 36, 「이전」 글 단추 없음, ⑬ 글
 * - S5-2(87:2): 나누기 머리 「‹ 오늘 기록 닫기」 한 줄
 * - S8(50:641) · S8-a(81:380) · S8-b(102:314) · 바꾼 뒤 「‹」 → 확인 창(121:389·121:449 = 98:278 꼴: 종이색·폭 312·제목 18 Bold·뒤 막 먹남색 45%)
 */
const OUT = photoDir("고침9-J1"); // 기본 test-results/photos/, SAVE_PHOTOS=1일 때만 docs/oneshot-v2/ (tests/screens/photo-dir.ts)
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

async function open(page: Page, s: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${s}`);
  await page.waitForLoadState("networkidle");
}
async function photo(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  // O-11: 겹친 창·확인 창이 서서히 나타나는 중(불투명도)에 찍지 않게, 도는 애니메이션이 끝날 때까지 기다린다
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
async function noOverflow(page: Page) {
  const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(s.sw, "가로 스크롤 없음").toBeLessThanOrEqual(s.cw);
}
/** 「‹」: 보이는 자리 48×48, 화면 왼쪽 끝 가까이(누름 틀이 안쪽 여백 밖으로 12 나감), 이름 「이전」 */
async function checkBack(page: Page, scope = page.locator("body")) {
  const back = scope.getByRole("button", { name: "이전" });
  await expect(back).toHaveCount(1);
  await expect(back).toHaveText("‹");
  const b = (await back.boundingBox())!;
  expect(b.width, "「‹」 누름 폭 48").toBeGreaterThanOrEqual(48);
  expect(b.height, "「‹」 누름 높이 48").toBeGreaterThanOrEqual(48);
  expect(b.x, "왼쪽 위").toBeLessThanOrEqual(8);
  expect(b.y, "맨 위 줄").toBeLessThanOrEqual(40);
  return back;
}
/** 아래 주 단추: 폭 = 화면 폭 − 좌우 16, 높이 48 이상, 아래 끝이 화면 아래에서 36 위 */
async function checkBottomPrimary(page: Page, name: string, scope = page.locator("body")) {
  const btn = scope.locator(".bottom-actions .btn-primary");
  await expect(btn).toHaveText(name);
  const b = (await btn.boundingBox())!;
  expect(Math.round(b.width), "폭 가득(360 − 32)").toBe(328);
  expect(Math.round(b.x)).toBe(16);
  expect(b.height).toBeGreaterThanOrEqual(48);
  expect(Math.round(800 - (b.y + b.height)), "아래 여백 36").toBe(36);
}

test("S1-1~S1-4 처음 설정: 「‹」(2~4단계) · 진행 막대 · 이름표 · ⑬ 글 · 주 단추 하나(아래 고정)", async ({ page }) => {
  await open(page, "ratio-onboarding");
  // S1-1
  await expect(page.getByText("4단계 중 1단계")).toBeVisible();
  await expect(page.getByRole("button", { name: "이전" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "목표" })).toBeVisible();
  await expect(page.getByText("예: 포트폴리오 끝내고 토익 800점 넘기기")).toBeVisible();
  await expect(page.locator(".screen-head-bar.is-done")).toHaveCount(1);
  await checkBottomPrimary(page, "다음");
  await expect(page.locator(".bottom-actions button")).toHaveText(["건너뛰기", "다음"]);
  await noOverflow(page);
  await photo(page, "S1-1 목표(1of4)");
  // S1-2
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "분야" })).toBeVisible();
  await expect(page.getByText("시간을 나눠 쓸 곳 · 여러 개")).toBeVisible();
  await expect(page.getByText(/적고 넓게/)).toHaveCount(0);
  const back = await checkBack(page);
  await page.keyboard.press("Shift+Tab"); // 제목(포커스) 앞 = 「‹」(포커스 순서 첫째)
  await expect(back).toBeFocused();
  await expect(page.locator(".screen-head-bar.is-done")).toHaveCount(2);
  await checkBottomPrimary(page, "다음");
  await noOverflow(page);
  await photo(page, "S1-2 분야(2of4)");
  // S1-3
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "목표 비율" })).toBeVisible();
  const caption = page.locator(".onboarding-title-row .ratio-caption");
  await expect(caption).toHaveText("분야마다 쓰고 싶은 몫 · 합 100%");
  const h = (await page.getByRole("heading", { name: "목표 비율" }).boundingBox())!;
  const c = (await caption.boundingBox())!;
  expect(c.x, "보조 글은 이름표 옆").toBeGreaterThan(h.x + h.width);
  await expect(page.getByText(/대략이면|^합계/)).toHaveCount(0);
  const card = (await page.locator("ul.ratio-list.card-box").boundingBox())!;
  expect(Math.round(card.width)).toBe(328);
  expect(await page.locator("ul.ratio-list.card-box").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(rgb(COLOR_TOKENS["--color-surface"]));
  // A3: −/+ 보이는 원 32 + 1px 먹남색, 숫자 칸 안에 「%」
  const face = await page.locator(".ratio-btn .step-btn-face").first().evaluate((e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return { w: r.width, h: r.height, bw: s.borderTopWidth, bc: s.borderTopColor };
  });
  expect(face).toEqual({ w: 32, h: 32, bw: "1px", bc: rgb(COLOR_TOKENS["--color-text"]) });
  const btnBox = (await page.locator(".ratio-btn").first().boundingBox())!;
  expect(btnBox.width).toBeGreaterThanOrEqual(48);
  const field = page.locator(".num-field-ratio").first();
  expect(Math.round((await field.boundingBox())!.width)).toBe(54);
  await expect(field.locator(".stepper-unit")).toHaveText("%");
  await checkBack(page);
  await checkBottomPrimary(page, "다음");
  await noOverflow(page);
  await photo(page, "S1-3 목표 비율(3of4)");
  // S1-4
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "알림" })).toBeVisible();
  // PM d-157 · 명세 ⑲(Figma 50:4 고침): 이름 아래 시각 칸 → 그 아래 실제 알림 글 미리 보기
  const eveningTime = page.getByLabel("오늘 기록 알림 시각");
  await expect(eveningTime).toHaveValue("1170");
  await expect(page.getByLabel("아침 알림 시각")).toHaveValue("600");
  await expect(page.getByText("“오늘 몇 시간 썼는지 적어 둘까요?”")).toBeVisible();
  await expect(page.getByText("“오늘 먼저 할 일”", { exact: true })).toBeVisible();
  const timeBox = await eveningTime.evaluate((e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return { h: Math.round(r.height), bw: s.borderTopWidth, radius: s.borderTopLeftRadius, bg: s.backgroundColor, w: r.width };
  });
  expect(timeBox).toMatchObject({ bw: "1px", radius: "8px", bg: rgb(COLOR_TOKENS["--color-surface"]) });
  // 이음매(22 팀장, 명세 ⑲ 「누름 44」): 시각 칸 높이 = 누름 44(전에 32). 하한 44 · 글 한 줄 칸이 늘어나지 않게 상한 48
  expect(timeBox.h, "시각 칸 누름 44 이상").toBeGreaterThanOrEqual(44);
  expect(timeBox.h, "시각 칸이 늘어나지 않음").toBeLessThanOrEqual(48);
  expect(timeBox.w, "시각 칸은 글 폭만큼").toBeLessThan(160);
  const nameY = (await page.locator(".notify-name", { hasText: "오늘 기록 알림" }).boundingBox())!.y;
  const timeY = (await eveningTime.boundingBox())!.y;
  const previewY = (await page.getByText("“오늘 몇 시간 썼는지 적어 둘까요?”").boundingBox())!.y;
  expect(nameY < timeY && timeY < previewY, "이름 → 시각 칸 → 미리 보기").toBe(true);
  for (const name of ["오늘 기록 알림", "아침 알림"]) await expect(page.getByRole("checkbox", { name })).toBeChecked();
  const sw = (await page.locator(".notify-switch").first().boundingBox())!;
  expect([Math.round(sw.width), Math.round(sw.height)], "스위치 44×26").toEqual([44, 26]);
  await expect(page.getByRole("button", { name: /허락하고 시작하기|나중에 하고 시작하기/ })).toHaveCount(0);
  await checkBack(page);
  await checkBottomPrimary(page, "시작하기");
  await expect(page.locator(".bottom-actions button")).toHaveCount(1);
  await noOverflow(page);
  await photo(page, "S1-4 알림(4of4)");
  // 「‹」로 앞 단계
  await page.getByRole("button", { name: "이전" }).click();
  await expect(page.getByText("4단계 중 3단계")).toBeVisible();
});

test("S5-2 나누기 · 들어간 처음: 머리 한 줄 「‹」 · 가운데 「오늘 기록」 · 오른쪽 「닫기」, 큰 제목은 머리 아래, 아래 「이전」 글 단추 없음", async ({ page }) => {
  await open(page, "evening-split-blank");
  await page.locator("#dev-open-window").click();
  const dlg = page.getByRole("dialog");
  await fillWheel(page, "시간", 3); // 고침9 J3: 쓴 시간 = 두 줄 휠(숫자 바로 쓰기)
  await page.getByRole("button", { name: "분야마다 나누기" }).click();
  const heading = page.getByRole("heading", { name: "분야마다 나눠 주세요" });
  await expect(heading).toBeVisible();
  const back = await checkBack(page, dlg);
  const title = dlg.locator(".screen-head-title");
  await expect(title).toHaveText("오늘 기록");
  const close = dlg.locator(".screen-head-close");
  await expect(close).toHaveText("닫기");
  const [b, t, x, hd] = await Promise.all([back.boundingBox(), title.boundingBox(), close.boundingBox(), heading.boundingBox()]);
  expect(Math.abs(b!.y + b!.height / 2 - (t!.y + t!.height / 2)), "한 줄").toBeLessThanOrEqual(2);
  expect(Math.abs(t!.x + t!.width / 2 - 180), "제목 가운데").toBeLessThanOrEqual(2);
  expect(x!.x + x!.width, "닫기 오른쪽 끝").toBeGreaterThan(340);
  expect(x!.height, "닫기 누름 높이 44(O-2)").toBeGreaterThanOrEqual(44);
  expect(hd!.y, "큰 제목은 머리 아래").toBeGreaterThan(b!.y + b!.height - 1);
  expect(await title.evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight])).toEqual(["16px", "700"]);
  await expect(dlg.getByRole("button", { name: "이전" })).toHaveCount(1);
  await noOverflow(page);
  await photo(page, "S5-2 나누기 · 들어간 처음(기타 100%)");
  await back.click();
  await expect(page.getByRole("button", { name: "분야마다 나누기" })).toBeVisible();
});

test("S8 내 정보 · S8-a 목표 비율 설정 · 바꾼 뒤 「‹」 → 확인 창", async ({ page }) => {
  await open(page, "me-goal");
  const card = page.getByRole("button", { name: /^목표 비율, / });
  await expect(card).toBeVisible();
  const cells = await page.$$eval(".me-ratio-cell", (els) =>
    els.map((e) => {
      const s = getComputedStyle(e);
      return { h: e.getBoundingClientRect().height, bw: s.borderTopWidth, bg: s.backgroundColor };
    }),
  );
  expect(cells.length, "띠 칸이 있다").toBeGreaterThan(0);
  for (const cell of cells) {
    expect(cell.h, "띠 높이 8").toBe(8);
    expect(cell.bw).toBe("1px");
    expect(cell.bg).not.toBe(rgb(COLOR_TOKENS["--color-surface"]));
  }
  expect(await page.locator(".me-ratio-band").textContent()).toBe("");
  await expect(page.locator(".me-ratio-card .me-chevron")).toHaveText("›");
  await expect(page.getByRole("button", { name: "비율 저장" })).toHaveCount(0);
  await expect(page.getByText(/저녁에 오늘 쓴 시간을 남기도록|아침에 앱을 열도록/)).toHaveCount(0);
  await expect(page.locator(".me .wordmark")).toHaveCount(1);
  await noOverflow(page);
  await photo(page, "S8 내 정보");

  await card.click();
  const dlg = page.getByRole("dialog", { name: "목표 비율" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("heading", { name: "목표 비율" })).toBeFocused();
  await checkBack(page, dlg);
  await checkBottomPrimary(page, "저장", dlg);
  await expect(dlg.getByText(/단계|분야마다 쓰고 싶은 몫|대략이면/)).toHaveCount(0);
  // 아래 탭 없음: 창이 화면 전체(360×800)를 덮어 탭 줄이 가려진다
  const d = (await dlg.boundingBox())!;
  expect([Math.round(d.width), Math.round(d.height)]).toEqual([360, 800]);
  await noOverflow(page);
  await photo(page, "S8-a 목표 비율 설정");

  await dlg.getByRole("button", { name: /5% 줄이기$/ }).first().click();
  await dlg.getByRole("button", { name: "이전" }).click();
  const confirm = page.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button")).toHaveText(["계속 적기", "나가기"]);
  await expect(confirm.getByRole("button", { name: "계속 적기" })).toBeFocused();
  const box = await confirm.evaluate((e) => {
    const s = getComputedStyle(e);
    const t = getComputedStyle(e.querySelector("h2")!);
    return { w: e.getBoundingClientRect().width, bg: s.backgroundColor, pt: s.paddingTop, pl: s.paddingLeft, pb: s.paddingBottom, fs: t.fontSize, fw: t.fontWeight };
  });
  expect(box).toEqual({ w: 312, bg: rgb(COLOR_TOKENS["--color-bg"]), pt: "28px", pl: "24px", pb: "24px", fs: "18px", fw: "700" });
  const scrim = await page.locator(".close-confirm-backdrop").evaluate((e) => getComputedStyle(e).backgroundColor);
  const [r, g, b] = [0x1c, 0x23, 0x40];
  expect(scrim.replace(/\s/g, ""), "뒤 막 = 먹남색 45%").toMatch(new RegExp(`^(rgba\\(${r},${g},${b},0\\.45\\)|color\\(srgb[^)]*0\\.45\\))$`));
  await photo(page, "S8-a 목표 비율 설정 · 바꾼 뒤 「‹」 → 확인 창");
  await confirm.getByRole("button", { name: "나가기" }).click();
  await expect(dlg).toHaveCount(0);
});

test("S8-b 목표 고치기 · 바꾼 뒤 「‹」 → 확인 창(같은 꼴), 「저장」 아래 고정", async ({ page }) => {
  await open(page, "me-goal");
  await page.locator(".me-goal-card").click();
  const dlg = page.getByRole("dialog", { name: "목표" });
  await expect(dlg).toBeVisible();
  await checkBack(page, dlg);
  await checkBottomPrimary(page, "저장", dlg);
  // 목표 칸은 한 줄 칸 높이(세로 flex에 늘어나지 않음 — Figma 102:314 칸 56)
  const fieldH = (await dlg.getByRole("textbox", { name: "목표" }).boundingBox())!.height;
  expect(fieldH, "목표 칸 높이 48~56").toBeGreaterThanOrEqual(48);
  expect(fieldH).toBeLessThanOrEqual(56);
  await noOverflow(page);
  await photo(page, "S8-b 목표 고치기");
  await dlg.getByRole("textbox", { name: "목표" }).fill("포트폴리오 끝내기");
  await dlg.getByRole("button", { name: "이전" }).click();
  const confirm = page.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
  await expect(confirm).toBeVisible();
  expect(Math.round((await confirm.boundingBox())!.width)).toBe(312);
  await photo(page, "S8-b 목표 고치기 · 바꾼 뒤 「‹」 → 확인 창");
  await confirm.getByRole("button", { name: "계속 적기" }).click();
  await expect(dlg).toBeVisible();
});

test("S8 내 정보 · 알림 바로 저장(O-5): 「알림 설정 저장」 없음, 스위치를 바꾸면 카드 아래 「✓ 저장했어요」", async ({ page }) => {
  await open(page, "me-goal");
  await expect(page.getByRole("button", { name: "알림 설정 저장" })).toHaveCount(0);
  const morning = page.getByRole("checkbox", { name: "아침 알림" });
  await expect(morning).not.toBeChecked();
  await page.locator(".notify-toggle", { hasText: "아침 알림" }).click();
  await expect(morning).toBeChecked();
  const status = page.locator(".me-notify-status");
  await expect(status).toHaveText("✓ 저장했어요");
  await expect(status).toHaveAttribute("role", "status");
  await expect(page.getByLabel("아침 알림 시각")).toBeEnabled();
  await status.scrollIntoViewIfNeeded();
  await noOverflow(page);
  await photo(page, "S8 내 정보 · 알림 바로 저장");
});
