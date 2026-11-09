import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { photoDir } from "./photo-dir";

/**
 * 고침9 워커 J2(할 일·할 일 페이지·타이머, 23 최종 폰 목록): 360×800 사진을 docs/oneshot-v2/고침9-J2/에 두고,
 * 사진만 남는 시험이 되지 않게 글·순서·자리·실제 칠해진 색을 같이 단언한다.
 * 개발 갤러리(/dev/states · /dev/v2)의 화면이다(컴포넌트는 앱과 같은 것, 데이터만 가짜). npm run screens(SCREENS_PORT로 포트를 바꿀 수 있다)
 * 사진 이름 = 23 최종 폰 목록의 화면 · 상태(괄호 안 Figma 노드)
 */
const OUT = photoDir("고침9-J2"); // 기본 test-results/photos/, SAVE_PHOTOS=1일 때만 docs/oneshot-v2/ (tests/screens/photo-dir.ts)

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
/** 토큰 이름의 실제 계산 색(rgb) */
async function tokenColor(page: Page, name: string) {
  return page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${n})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}

test("S2 할 일 · 빈 목록(50:28): 이름표 「예시」 + 예시 줄 둘, 흐림은 모양에만·글은 보조 글 색, 누를 것 없음", async ({ page }) => {
  await open(page, "/dev/states?s=C3");
  const example = page.getByRole("region", { name: "예시" });
  await expect(example).toBeVisible();
  const rows = example.locator("li");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("토익 단어 50개");
  await expect(rows.nth(0)).toContainText("어학");
  await expect(rows.nth(1)).toContainText("포트폴리오 2장 고치기");
  await expect(rows.nth(1)).toContainText("포트폴리오");
  await expect(page.getByText("아래 단추를 눌러 적어 보세요.")).toHaveCount(0);
  await expect(example.locator("button, input, a")).toHaveCount(0);
  const sub = await tokenColor(page, "--color-text-sub");
  const painted = await example.evaluate((el) => {
    const text = el.querySelector(".todo-example-text")!;
    const check = el.querySelector(".todo-example-check")!;
    const dot = el.querySelector<HTMLElement>(".todo-example-dot")!;
    return {
      textColor: getComputedStyle(text).color,
      textOpacity: getComputedStyle(text).opacity,
      checkOpacity: getComputedStyle(check).opacity,
      checkBorder: getComputedStyle(check).borderTopStyle,
      dotOpacity: getComputedStyle(dot).opacity,
      dotBg: getComputedStyle(dot).backgroundColor,
      dotW: dot.getBoundingClientRect().width,
    };
  });
  expect(painted.textColor, "예시 글 = 보조 글 색(d-125)").toBe(sub);
  expect(painted.textOpacity, "글은 흐리지 않는다").toBe("1");
  expect(painted.checkOpacity, "체크 점선 흐림 40%").toBe("0.4");
  expect(painted.checkBorder).toBe("dashed");
  expect(painted.dotOpacity, "분야 점 흐림 40%").toBe("0.4");
  expect(painted.dotBg, "첫 예시 점 = 분야 색 2(어학, Figma #2DBE8C)").toBe("rgb(45, 190, 140)");
  expect(painted.dotW).toBeGreaterThanOrEqual(9.5);
  await noOverflow(page);
  await photo(page, "S2-빈목록(50-28)");
});

test("S2 할 일 · 목록 있음(50:52): 작업 기록 아이콘 = 할 일 글 바로 뒤 6px, 16, 먹남색 1.5 선", async ({ page }) => {
  await open(page, "/dev/states?s=C1-notes");
  const icons = page.getByRole("img", { name: "작업 기록 있음" });
  await expect(icons).toHaveCount(2);
  const first = await page.locator("#todo-text-r1").evaluate((span) => {
    const icon = span.nextElementSibling as SVGElement;
    const t = span.getBoundingClientRect();
    const i = icon.getBoundingClientRect();
    const path = icon.querySelector("path")!;
    return {
      gap: i.left - t.right,
      w: i.width,
      h: i.height,
      sameLine: Math.abs(i.top + i.height / 2 - (t.top + t.height / 2)) < 8,
      stroke: getComputedStyle(path).stroke,
      strokeWidth: getComputedStyle(path).strokeWidth,
    };
  });
  expect(first.gap, "글 바로 뒤 6px(하한)").toBeGreaterThanOrEqual(5.5);
  expect(first.gap, "글 바로 뒤 6px(상한)").toBeLessThanOrEqual(6.5);
  expect(first.w).toBe(16);
  expect(first.h).toBe(16);
  expect(first.sameLine).toBe(true);
  expect(first.stroke, "먹남색 선").toBe(await tokenColor(page, "--color-text"));
  expect(first.strokeWidth).toBe("1.5px");
  // 긴 글: 아이콘은 마지막 줄 끝에 붙는다(글의 마지막 글자 줄과 같은 높이)
  const long = await page.locator("#todo-text-r2").evaluate((span) => {
    const icon = span.nextElementSibling as SVGElement;
    const rects = [...span.getClientRects()];
    const last = rects[rects.length - 1];
    const i = icon.getBoundingClientRect();
    return { lines: rects.length, gap: i.left - last.right, iconMid: i.top + i.height / 2, lastTop: last.top, lastBottom: last.bottom };
  });
  expect(long.lines, "긴 글은 여러 줄").toBeGreaterThan(1);
  expect(long.iconMid).toBeGreaterThanOrEqual(long.lastTop);
  expect(long.iconMid).toBeLessThanOrEqual(long.lastBottom);
  // 기록 없는 줄에는 아이콘이 없다
  await expect(page.locator("#row-r3 .todo-note-icon")).toHaveCount(0);
  await expect(page.getByText("기록 있음", { exact: true })).toHaveCount(0);
  await noOverflow(page);
  await photo(page, "S2-목록(50-52)");
});

test("S2 할 일 · 저장 대기(50:52 · 128:87): 16px 도는 원(글 줄 세로 가운데), 동작 줄이기면 멈춤, 숨은 글 「저장 대기」, 실패 글은 그대로", async ({ page }) => {
  await open(page, "/dev/states?s=T-pending");
  const mark = page.locator("#row-q1 .save-pending");
  await expect(mark).toHaveCount(1);
  await expect(page.locator(".save-pending")).toHaveCount(1); // 저장된 줄·실패 줄에는 없다
  await expect(mark.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(mark.locator(".sr-only")).toHaveText("저장 대기");
  await expect(page.getByText("연결되면 저장해요")).toHaveCount(0);
  const geo = await page.locator("#row-q1").evaluate((li) => {
    const svg = li.querySelector(".save-pending svg")!;
    const text = li.querySelector("#todo-text-q1")!.getBoundingClientRect();
    // 도는 원의 상자는 돌면서 커진다 — 돌지 않는 감싸개(.save-pending)로 잰다
    const r = li.querySelector(".save-pending")!.getBoundingClientRect();
    const arc = getComputedStyle(li.querySelector(".save-pending-arc")!);
    const track = getComputedStyle(li.querySelector(".save-pending-track")!);
    return {
      w: r.width,
      h: r.height,
      midDiff: Math.abs(r.top + r.height / 2 - (text.top + text.height / 2)),
      right: r.left > text.right,
      animation: getComputedStyle(svg).animationName,
      duration: getComputedStyle(svg).animationDuration,
      timing: getComputedStyle(svg).animationTimingFunction,
      arcStroke: arc.stroke,
      arcWidth: arc.strokeWidth,
      trackStroke: track.stroke,
    };
  });
  expect(geo.w).toBe(16);
  expect(geo.h).toBe(16);
  expect(geo.midDiff, "할 일 글 줄 세로 가운데").toBeLessThanOrEqual(2);
  expect(geo.right, "글 오른쪽").toBe(true);
  expect(geo.animation).toBe("save-pending-spin");
  expect(geo.duration).toBe("1s");
  expect(geo.timing).toBe("linear");
  expect(geo.arcStroke, "호 = 먹남색").toBe(await tokenColor(page, "--color-text"));
  expect(geo.arcWidth).toBe("2px");
  expect(geo.trackStroke, "바탕 고리 = --color-divider").toBe(await tokenColor(page, "--color-divider"));
  // 실패 줄은 글 그대로
  await expect(page.locator("#row-f1")).toContainText("저장하지 못했어요.");
  await expect(page.locator("#row-f1").getByRole("button", { name: "다시" })).toBeVisible();
  await noOverflow(page);
  await photo(page, "S2-목록-저장대기(128-87)");
  // 동작 줄이기: 돌지 않는다(계산값 animation none)
  await page.emulateMedia({ reducedMotion: "reduce" });
  const still = await mark.locator("svg").evaluate((el) => getComputedStyle(el).animationName);
  expect(still).toBe("none");
});

test("S2-a 적는 창(50:103): 이름표 「분야」, 맨 앞 「기타」 골라짐(흰 면 + 2px 테두리 + 체크), 칩에 색 점", async ({ page }) => {
  await open(page, "/dev/states?s=C5");
  await expect(page.locator("#category-label")).toHaveText("분야");
  await expect(page.getByText(/고르지 않으면 기타/)).toHaveCount(0);
  const group = page.getByRole("group", { name: "분야" });
  const chips = group.locator("button[aria-pressed]");
  expect(await chips.count()).toBeGreaterThan(1);
  await expect(chips.first()).toHaveText("기타");
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  expect(await group.locator('button[aria-pressed="true"]').count()).toBe(1);
  const face = await chips.first().evaluate((el) => {
    const f = getComputedStyle(el.querySelector(".chip-face")!);
    return { bg: f.backgroundColor, border: f.borderTopWidth, borderColor: f.borderTopColor, check: el.querySelector(".chip-check") !== null, dot: el.querySelector(".chip-dot") !== null };
  });
  expect(face.bg, "고른 칩 = 흰 면").toBe("rgb(255, 255, 255)");
  expect(face.border).toBe("2px");
  expect(face.borderColor).toBe(await tokenColor(page, "--color-primary"));
  expect(face.check).toBe(true);
  expect(face.dot).toBe(true);
  await expect(page.locator(".todo-sheet .sheet-head .sheet-label")).toHaveCSS("font-weight", "700");
  await noOverflow(page);
  await photo(page, "S2-a-적는창(50-103)");
});

test("S2-b 할 일 페이지(51:55) · S2-b′ 분야 고르기 시트(77:18): 분야 한 줄 → 시트, 고르면 닫힘, 「+ 분야」", async ({ page }) => {
  await open(page, "/dev/v2?s=detail");
  await page.locator("#dev-open-window").click();
  const dialog = page.getByRole("dialog", { name: "할 일 자세히" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("group", { name: "분야" })).toHaveCount(0);
  const line = dialog.locator("#detail-category-line");
  await expect(line).toBeVisible();
  await expect(dialog.getByText(/하는 중에, 끝낸 뒤에/)).toHaveCount(0);
  const lineBox = await line.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const dot = el.querySelector(".detail-category-dot")!.getBoundingClientRect();
    const dotStyle = getComputedStyle(el.querySelector(".detail-category-dot")!);
    return { h: r.height, dotW: dot.width, dotBorder: dotStyle.borderTopWidth, go: el.querySelector(".detail-category-go")!.textContent };
  });
  expect(lineBox.h, "누름 48").toBeGreaterThanOrEqual(48);
  expect(lineBox.dotW, "색 원 12").toBe(12);
  expect(lineBox.dotBorder, "1px 윤곽").toBe("1px");
  expect(lineBox.go).toBe("›");
  await noOverflow(page);
  await photo(page, "S2-b-할일페이지(51-55)");

  await line.click();
  const sheet = page.getByRole("dialog", { name: "분야 고르기" });
  await expect(sheet).toBeVisible();
  const rows = sheet.getByRole("list").getByRole("button");
  expect(await rows.count()).toBeGreaterThan(2);
  await expect(rows.last()).toHaveText("+ 분야");
  await expect(sheet.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expect(sheet.locator('button[aria-pressed="true"] .category-sheet-check')).toHaveCount(1);
  const rowH = await rows.first().evaluate((el) => el.getBoundingClientRect().height);
  expect(rowH, "줄 48").toBeGreaterThanOrEqual(48);
  const sheetBox = await sheet.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { bottom: r.bottom, w: r.width, radius: getComputedStyle(el).borderTopLeftRadius };
  });
  expect(sheetBox.bottom, "아래에서 올라온 판").toBeGreaterThanOrEqual(799);
  expect(sheetBox.radius).toBe("24px");
  await noOverflow(page);
  await photo(page, "S2-b′-분야고르기시트(77-18)");

  // 고르면 바로 닫힌다(저장 단추 없음). Esc는 시트만 닫는다
  await sheet.getByRole("button", { name: "기타" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(line).toContainText("기타");
  await line.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(line).toBeFocused();
});

test("S2-d 이번 주 목표 시트(50:332): 「1시간 단위 · 0시간은 목표에 안 넣음」, 흰 카드 목록, 폭 가득 「저장」", async ({ page }) => {
  await open(page, "/dev/v2?s=goal");
  await page.locator("#dev-open-window").click();
  const dialog = page.getByRole("dialog", { name: "이번 주 목표" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("1시간 단위 · 0시간은 목표에 안 넣음", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/쓰고 싶은 시간을 1시간 단위로 정해요/)).toHaveCount(0);
  const card = await dialog.locator(".goal-list").evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderTopLeftRadius, rows: el.querySelectorAll("li").length }));
  expect(card.bg).toBe("rgb(255, 255, 255)");
  expect(card.radius).toBe("16px");
  expect(card.rows).toBeGreaterThan(0);
  const save = dialog.getByRole("button", { name: "저장" });
  const w = await save.evaluate((el) => ({ btn: el.getBoundingClientRect().width, parent: el.parentElement!.getBoundingClientRect().width }));
  expect(w.btn, "폭 가득").toBeGreaterThanOrEqual(w.parent - 1);
  await noOverflow(page);
  await photo(page, "S2-d-이번주목표시트(50-332)");
});

test("S4 타이머 · 고르기(50:390): 이름표 「분야」 + 맨 앞 「기타」 골라짐, 「오늘 시작한 타이머 0개」", async ({ page }) => {
  await open(page, "/dev/v2?s=timer-many");
  await expect(page.locator("#timer-category-label")).toHaveText("분야");
  await expect(page.getByText(/고르지 않으면 기타/)).toHaveCount(0);
  const group = page.getByRole("group", { name: "분야" });
  const chips = group.locator("button[aria-pressed]");
  expect(await chips.count()).toBeGreaterThan(1);
  await expect(chips.first()).toHaveText("기타");
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  await chips.nth(1).click();
  await expect(chips.first()).toHaveAttribute("aria-pressed", "false");
  await chips.nth(1).click();
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  const records = page.locator(".timer-records");
  await expect(records.getByRole("heading", { name: "오늘 시작한 타이머" })).toBeVisible();
  await expect(records.locator("p.todo-sub")).toHaveText("0개");
  const sameLine = await records.evaluate((el) => {
    const h = el.querySelector("h2")!.getBoundingClientRect();
    const p = el.querySelector("p")!.getBoundingClientRect();
    return Math.abs(h.top + h.height / 2 - (p.top + p.height / 2)) < 10 && p.left > h.right;
  });
  expect(sameLine, "「0개」는 제목 옆 한 줄").toBe(true);
  await noOverflow(page);
  await photo(page, "S4-타이머-고르기(50-390)");
});
