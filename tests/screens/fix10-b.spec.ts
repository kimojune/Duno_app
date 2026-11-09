import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { COLOR_TOKENS } from "../../lib/design-tokens";
import { photoDir } from "./photo-dir";

/**
 * 고침10 W2b(23 목록 1절 E·F·J · 동작 · PM d-173~d-175 · d-180~183)의 화면 시험. 개발 갤러리 /dev/v2(app/dev/v2/fix10-b-gallery.dev.tsx).
 * 사진(360×800, 배율 2)은 사진 묶음이 같은 자리에서 다시 찍는다. 사진만 남는 시험이 되지 않게 치수·색을 같이 단언한다. npm run screens
 */
const OUT = photoDir("고침10-할일");
test.use({ deviceScaleFactor: 2 });
const rgb = (hex: string, alpha?: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  return alpha === undefined ? `rgb(${c})` : `rgba(${c}, ${alpha})`;
};
const TEXT = rgb(COLOR_TOKENS["--color-text"]);
/** Chrome은 color-mix 결과를 color(srgb r g b / a)로 돌려준다 — rgba(r, g, b, a)로 바꿔 견준다 */
const norm = (c: string) => {
  const m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(c);
  if (!m) return c;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 255));
  return m[4] === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${m[4]})`;
};
const SURFACE = rgb(COLOR_TOKENS["--color-surface"]);

async function open(page: Page, s: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${s}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500); // 갤러리의 자동 동작(눌러야 나오는 상태)이 끝나길 기다린다
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
const box = async (l: Locator) => (await l.boundingBox())!;
const css = (l: Locator, props: string[]) =>
  l.evaluate((el, ps) => {
    const s = getComputedStyle(el);
    return Object.fromEntries(ps.map((p) => [p, s.getPropertyValue(p)]));
  }, props);

test("S2 할 일(50:52 · 50:55 · 50:56 · 56:8): 머리에 「로그아웃」 없음 · 날짜 줄 원 단추 「‹」(보이는 32 · 누름 48) · 이번 주 목표 카드 48 · 오늘 기록 카드 통째 누름", async ({ page }) => {
  await open(page, "todo-s2");
  await expect(page.getByText("로그아웃")).toHaveCount(0);
  const past = page.getByRole("button", { name: "지난 날 보기" });
  await expect(past).toHaveCount(1);
  const pb = await box(past);
  expect([Math.round(pb.width), Math.round(pb.height)]).toEqual([48, 48]);
  const face = await box(past.locator(".step-btn-face"));
  expect([Math.round(face.width), Math.round(face.height)]).toEqual([32, 32]);
  expect((await css(past.locator(".step-btn-face"), ["border-radius"]))["border-radius"]).toBe("50%");
  // 원 단추는 날짜 줄 오른쪽 끝(페이지 옆 여백 16에 보이는 원이 닿는다)
  expect(Math.round(360 - (face.x + face.width))).toBe(16);
  // 워드마크 → 「오늘」 글자 사이
  const wm = await box(page.locator(".today-wordmark"));
  const title = await box(page.locator(".today-title"));
  expect(Math.round(title.y - (wm.y + wm.height)), "상자 사이 10(글자 사이 약 18)").toBe(10);
  // 이번 주 목표 카드: 흰 바탕 · 테두리 없음 · 높이 48 · 글 14 Bold
  const goal = page.locator(".goal-line");
  const g = await box(goal);
  expect(Math.round(g.height)).toBe(48);
  const gs = await css(goal, ["background-color", "border-top-width", "font-size", "font-weight", "border-radius"]);
  expect(gs["background-color"]).toBe(SURFACE);
  expect(gs["border-top-width"]).toBe("0px");
  expect([gs["font-size"], gs["font-weight"]]).toEqual(["14px", "700"]);
  await expect(goal.locator(".goal-line-go")).toHaveText("›");
  // 오늘 기록 카드: 통째 하나의 단추, 알약 없음
  const entry = page.locator("#evening-entry");
  await expect(entry).toHaveCount(1);
  await expect(entry.locator(".entry-go")).toHaveText("›");
  await expect(page.locator(".entry-card .btn")).toHaveCount(0);
  // 목록: 지난 날 보기 글 단추는 없다
  await expect(page.locator("main").getByText("지난 날 보기")).toHaveCount(0);
  await noOverflow(page);
  await photo(page, "S2-할일");
});

test("S2 빈 목록 예시(50:28): 점선 원 24, 「글 한 편 초고 쓰기」, 「+ 할 일 적기」 144×48", async ({ page }) => {
  await open(page, "todo-empty");
  const check = page.locator(".todo-example-check").first();
  const c = await box(check);
  expect([Math.round(c.width), Math.round(c.height)]).toEqual([24, 24]);
  const s = await css(check, ["border-top-style", "border-top-left-radius"]);
  expect(s["border-top-style"]).toBe("dashed");
  expect(s["border-top-left-radius"]).toBe("50%");
  await expect(page.locator(".todo-example-row").nth(1)).toContainText("글 한 편 초고 쓰기");
  await expect(page.getByText("포트폴리오")).toHaveCount(0);
  const add = await box(page.locator("#add-todo-button"));
  expect([Math.round(add.width), Math.round(add.height)]).toEqual([144, 48]);
  await photo(page, "S2-빈목록");
});

test("어제 못 끝낸 할 일 펼침(148:108) · 접은 줄(50:69) · 모두 풂", async ({ page }) => {
  await open(page, "carry-open");
  const checks = page.locator(".carry-list input[type=checkbox]");
  await expect(checks).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) await expect(checks.nth(i)).toBeChecked(); // 처음엔 모두 고른 채
  const bx = await box(page.locator(".carry-list .check-box").first());
  expect([Math.round(bx.width), Math.round(bx.height)]).toEqual([24, 24]);
  expect((await css(page.locator(".carry-list .check-box").first(), ["border-top-left-radius"]))["border-top-left-radius"]).toBe("50%"); // 원
  await expect(page.getByRole("button", { name: "3개 가져오기" })).toBeVisible();
  await expect(page.getByText(/오늘로 가져올 것을 골라요/)).toHaveCount(0);
  const close = await box(page.getByRole("button", { name: "접기" }));
  expect(Math.round(close.width)).toBeGreaterThanOrEqual(48);
  expect(Math.round(close.height)).toBe(48 - 4); // 누름 44
  await photo(page, "어제못끝낸-펼침");
  await open(page, "carry-none");
  await expect(page.getByText("고른 할 일 없음")).toBeVisible();
  await expect(page.getByRole("button", { name: /가져오기/ })).toHaveCount(0);
  const none = await css(page.getByText("고른 할 일 없음"), ["font-size", "color"]);
  expect(none["font-size"]).toBe("14px");
  expect(none.color).toBe(rgb(COLOR_TOKENS["--color-text-sub"]));
  await photo(page, "어제못끝낸-모두풂");
  // 접힌 줄: 카드 줄 40
  await page.goto(`/dev/v2?s=todo-s2`);
  await page.waitForLoadState("networkidle");
  await photo(page, "S2-접힌줄");
});

test("할 일 페이지(147:58 · 51:55): 머리 저장됨 · 제목 위 74 · 작업 기록 0개 · 쓰기 칸 96 · 「남기기」 80×44", async ({ page }) => {
  await open(page, "note-0");
  await expect(page.locator(".detail-status")).toHaveText("저장됨");
  const title = await box(page.locator("#detail-text"));
  expect(Math.round(title.y), "제목 위 74").toBe(74);
  expect((await css(page.locator("#detail-text"), ["font-size", "font-weight"]))["font-size"]).toBe("24px");
  const ta = page.locator("#note-input");
  const t = await box(ta);
  expect(Math.round(t.height)).toBe(96);
  const s = await css(ta, ["border-top-width", "border-top-color", "border-top-left-radius", "background-color", "resize"]);
  expect(s).toEqual({ "border-top-width": "1px", "border-top-color": rgb(COLOR_TOKENS["--color-border-input"]), "border-top-left-radius": "12px", "background-color": SURFACE, resize: "none" });
  expect(await ta.getAttribute("placeholder")).toBeNull();
  // 이름표 「작업 기록」 바로 아래가 쓰기 칸(작업 기록 카드 없음)
  const label = await box(page.locator("#notes-title"));
  expect(Math.round(t.y - (label.y + label.height)), "이름표와 칸 사이").toBeLessThanOrEqual(8);
  const add = await box(page.getByRole("button", { name: "남기기" }));
  expect(Math.round(add.width)).toBeGreaterThanOrEqual(80);
  expect(Math.round(add.height)).toBe(48 - 4);
  expect(Math.abs(add.x + add.width - (t.x + t.width)), "칸 오른쪽 끝에 맞춘다").toBeLessThanOrEqual(1);
  await photo(page, "할일페이지-기록0");
  await open(page, "note-many");
  const card = page.locator(".note-card").first();
  const cs = await css(card, ["background-color", "border-top-left-radius", "padding-top", "padding-left"]);
  expect(cs).toEqual({ "background-color": SURFACE, "border-top-left-radius": "12px", "padding-top": "12px", "padding-left": "16px" });
  await expect(card.locator(".note-day")).toHaveText("11월 6일");
  expect((await css(card.locator(".note-day"), ["font-size", "font-weight"]))["font-weight"]).toBe("500");
  const del = await box(card.getByRole("button", { name: /^지우기/ }));
  expect(Math.round(del.height)).toBe(44);
  await photo(page, "할일페이지-기록카드");
});

test("할 일 페이지 상태: 빈 칸 안내 · 남기는 중 · ⋯ 메뉴 막(58:92)", async ({ page }) => {
  await open(page, "note-hint");
  await expect(page.getByText("작업 기록을 적어 주세요")).toBeVisible();
  expect((await css(page.getByText("작업 기록을 적어 주세요"), ["font-size", "font-weight"]))["font-size"]).toBe("12px");
  await expect(page.locator("#note-input")).toBeFocused();
  await photo(page, "할일페이지-빈칸안내");
  await open(page, "note-busy");
  const busy = page.getByRole("button", { name: "남기는 중" });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");
  await photo(page, "할일페이지-남기는중");
  await open(page, "note-menu");
  const scrim = page.locator(".detail-menu-scrim");
  await expect(scrim).toHaveCount(1);
  const sb = await box(scrim);
  expect([Math.round(sb.width), Math.round(sb.height)]).toEqual([360, 800]);
  expect(norm((await css(scrim, ["background-color"]))["background-color"])).toBe(rgb(COLOR_TOKENS["--color-text"], 0.45));
  await expect(page.getByRole("menuitem")).toHaveCount(3);
  await photo(page, "할일페이지-메뉴막");
});

test("지난 날(148:56 · 148:95): 이름표 · 날짜 24 Bold · 원 단추 ‹ › · 할 일 카드(채운 원/빈 원) · 이날 기록 · 빈 날", async ({ page }) => {
  await open(page, "past-days");
  await expect(page.getByText("보기만 할 수 있어요.")).toHaveCount(0);
  const older = page.getByRole("button", { name: "이전 날" });
  const newer = page.getByRole("button", { name: "다음 날" });
  for (const b of [older, newer]) {
    const r = await box(b);
    expect([Math.round(r.width), Math.round(r.height)]).toEqual([48, 48]);
    const f = await box(b.locator(".step-btn-face"));
    expect([Math.round(f.width), Math.round(f.height)]).toEqual([32, 32]);
  }
  await expect(newer).toBeDisabled(); // 어제에서는 › 막힘
  const dots = page.locator(".past-dot");
  await expect(dots).toHaveCount(3);
  expect((await css(dots.nth(0), ["background-color"]))["background-color"]).toBe(TEXT); // 끝냄 = 채운 원
  expect((await css(dots.nth(2), ["background-color"]))["background-color"]).toBe("rgba(0, 0, 0, 0)"); // 안 끝냄 = 빈 원
  await expect(page.locator(".past-todos").locator("button, a, input")).toHaveCount(0);
  await expect(page.locator(".past-record-total")).toHaveText("2시간 30분");
  expect((await css(page.locator(".past-date"), ["font-size", "font-weight"]))["font-size"]).toBe("24px");
  await photo(page, "지난날");
  await open(page, "past-empty");
  await expect(page.getByText("할 일 0개")).toBeVisible();
  await photo(page, "지난날-빈날");
});

test("시트 넷(위 모서리 16 · 손잡이 40×4 #E7E1D6 · 막 45%): 적는 창 · 이번 주 목표 · 분야 고르기", async ({ page }) => {
  const handle = (l: Locator, pseudo: string) =>
    l.evaluate(
      (el, p) => {
        const st = getComputedStyle(el, p);
        return { w: st.width, h: st.height, bg: st.backgroundColor };
      },
      pseudo,
    );
  await open(page, "sheet-add");
  const sheet = page.locator(".todo-sheet");
  expect((await css(sheet, ["border-top-left-radius", "border-top-right-radius"]))["border-top-left-radius"]).toBe("16px");
  const h = await handle(sheet, "::before");
  expect(h).toEqual({ w: "40px", h: "4px", bg: rgb(COLOR_TOKENS["--color-divider"]) });
  expect(norm((await css(page.locator(".todo-sheet-scrim"), ["background-color"]))["background-color"])).toBe(rgb(COLOR_TOKENS["--color-text"], 0.45));
  const input = await box(page.locator("#todo-input"));
  const addBtn = await box(page.getByRole("button", { name: "적기" }));
  expect([Math.round(input.width), Math.round(input.height)]).toEqual([236, 52]);
  expect(Math.round(addBtn.width)).toBe(76);
  await photo(page, "시트-적는창");
  await open(page, "sheet-goal");
  const goalPanel = page.locator(".goal-sheet .detail-inner");
  expect((await css(goalPanel, ["border-top-left-radius"]))["border-top-left-radius"]).toBe("16px");
  expect(await handle(goalPanel, "::before")).toEqual({ w: "40px", h: "4px", bg: rgb(COLOR_TOKENS["--color-divider"]) });
  expect(norm((await css(page.locator(".goal-sheet"), ["background-color"]))["background-color"])).toBe(rgb(COLOR_TOKENS["--color-text"], 0.45));
  await photo(page, "시트-이번주목표");
  await open(page, "sheet-category");
  const cat = page.locator(".category-sheet");
  expect((await css(cat, ["border-top-left-radius"]))["border-top-left-radius"]).toBe("16px");
  expect(await handle(cat, "::before")).toEqual({ w: "40px", h: "4px", bg: rgb(COLOR_TOKENS["--color-divider"]) });
  const check = await box(page.locator(".category-sheet-check").first());
  expect([Math.round(check.width), Math.round(check.height)]).toEqual([24, 24]);
  const add = await css(page.locator("#category-sheet-add"), ["font-size", "font-weight"]);
  expect([add["font-size"], add["font-weight"]]).toEqual(["14px", "700"]);
  await photo(page, "시트-분야고르기");
});

test("분야 줄은 한 줄(점 12 + 이름 말줄임 + −/숫자/+ 고정): 긴 이름도 두세 줄이 되지 않는다. 숫자 칸 글 가운데", async ({ page }) => {
  await open(page, "ratio-onboarding-many");
  await page.getByRole("button", { name: "다음" }).click();
  await page.getByRole("button", { name: "다음" }).click();
  const rows = page.locator(".ratio-row");
  const n = await rows.count();
  expect(n).toBeGreaterThan(3);
  for (let i = 0; i < n; i += 1) {
    const r = await box(rows.nth(i));
    expect(Math.round(r.height), `줄 ${i} 높이(한 줄)`).toBeLessThanOrEqual(56);
  }
  const long = page.locator(".ratio-name", { hasText: "아주아주아주긴분야이름" }).first();
  const clipped = await long.evaluate((el) => ({ over: el.scrollWidth > el.clientWidth, overflow: getComputedStyle(el).textOverflow }));
  expect(clipped).toEqual({ over: true, overflow: "ellipsis" });
  const field = page.locator(".num-field .stepper-input").first();
  expect((await css(field, ["text-align", "font-size", "font-weight"]))).toEqual({ "text-align": "center", "font-size": "16px", "font-weight": "500" });
  await noOverflow(page);
  await photo(page, "분야줄-긴이름");
});

test("오늘 기록 나누기(PM d-180): 칩 둘 · 칩 셋 · 타이머 분야 + 칩 하나가 똑같이 나뉜다", async ({ page }) => {
  const values = async () => Object.fromEntries(await page.locator(".evening-row").evaluateAll((rows) => rows.map((r) => [r.getAttribute("data-row-key"), (r.querySelector("input") as HTMLInputElement | null)?.value ?? (r.querySelector(".ratio-value")?.textContent ?? "")])));
  await open(page, "split-two");
  await page.getByRole("button", { name: "분야마다 나누기" }).click();
  await expect(page.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
  const two = await values();
  expect(Object.values(two).slice(0, 2)).toEqual(["60", "60"]);
  await photo(page, "나누기-칩둘");
  await open(page, "split-three");
  await page.getByRole("button", { name: "분야마다 나누기" }).click();
  expect(Object.values(await values()).slice(0, 3)).toEqual(["40", "40", "40"]);
  await photo(page, "나누기-칩셋");
  await open(page, "split-timer-one");
  await page.getByRole("button", { name: "분야마다 나누기" }).click();
  expect(Object.values(await values()).slice(0, 2)).toEqual(["30", "90"]); // 타이머 어학 30 그대로 · 글쓰기 = 남은 90
  await photo(page, "나누기-타이머분야+칩하나");
});
