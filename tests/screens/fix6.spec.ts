import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * 고침6(23 「발표 판 고침6」 ①·②·③·④-①): 360×800 사진을 docs/oneshot-v2/고침6/에 두고, 사진만 남는 시험이 되지 않게 치수·글·순서를 같이 단언한다.
 * 개발 갤러리(/dev/v2)의 화면이다(진짜 로그인 앱 화면 아님 — 컴포넌트는 앱과 같은 것, 데이터만 가짜). 개발 서버(3200)에서 돈다: npm run screens
 * - ① 목표 없는 주에 처음 열면 「목표 비율」 탭 · ② 「이번 주 목표」 탭 카드: 이름표 → 막대 → 보조 줄 → 단추(간격 16·6·12·16·16, 단추 폭 = 카드 안쪽 폭)
 * - ④-① 오늘 기록 저장 직후: 남은 분야만 이름 아래 「n시간 더」, 「채울」 없음
 * - ③ 내 정보 첫 카드(목표 있음·없음) · S8-b · 나가기 확인 · 진짜 브라우저 뒤로 가기(page.goBack)
 */
const OUT = path.resolve(__dirname, "../../docs/oneshot-v2/고침6");

async function open(page: Page, s: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${s}`);
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

test("① 목표 없는 주 처음 = 「목표 비율」 탭 · ② 「이번 주 목표」 탭 카드 순서·간격·단추 폭", async ({ page }) => {
  await open(page, "growth-week");
  await expect(page.getByRole("tab", { name: "목표 비율" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "이번 주 목표" })).toHaveAttribute("aria-selected", "false");
  await expect(page.locator(".growth-band")).toHaveCount(2);
  await noOverflow(page);
  await photo(page, "상태보기-목표없는주-처음-목표비율탭");

  await page.getByRole("tab", { name: "이번 주 목표" }).click();
  const card = page.locator(".growth-goal-set");
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("button", { name: "이번 주 목표 정하기" })).toBeVisible();
  const m = await card.evaluate((root) => {
    const box = (el: Element) => el.getBoundingClientRect();
    const label = root.querySelector(".growth-example-label")!;
    const items = Array.from(root.querySelectorAll(".growth-example-item"));
    const hint = root.querySelector(".growth-goal-hint")!;
    const button = root.querySelector("button")!;
    const cs = getComputedStyle(root);
    const after = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const ls = getComputedStyle(label);
    const hs = getComputedStyle(hint);
    const probe = document.createElement("span");
    probe.style.color = "var(--color-text-sub)";
    document.body.appendChild(probe);
    const sub = getComputedStyle(probe).color;
    probe.remove();
    return {
      count: items.length,
      order: after(label, items[0]) && after(items[items.length - 1], hint) && after(hint, button) && root.lastElementChild === button,
      buttons: root.querySelectorAll("button").length,
      cardTopToLabel: box(label).top - box(root).top,
      labelToBars: box(items[0]).top - box(label).bottom,
      barsToHint: box(hint).top - box(items[items.length - 1]).bottom,
      hintToButton: box(button).top - box(hint).bottom,
      buttonToCardBottom: box(root).bottom - box(button).bottom,
      buttonWidth: box(button).width,
      innerWidth: root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      buttonHeight: box(button).height,
      cardBg: cs.backgroundColor,
      label: { text: label.textContent, size: ls.fontSize, weight: ls.fontWeight, color: ls.color },
      hint: { text: hint.textContent, size: hs.fontSize, align: hs.textAlign, color: hs.color },
      sub,
    };
  });
  expect(m.count).toBe(2);
  expect(m.order, "이름표 < 막대 < 보조 줄 < 단추(카드 끝)").toBe(true);
  expect(m.buttons, "주 단추는 하나").toBe(1);
  expect(m.cardTopToLabel).toBeCloseTo(16, 0);
  expect(m.labelToBars).toBeCloseTo(6, 0);
  expect(m.barsToHint).toBeCloseTo(12, 0);
  expect(m.hintToButton).toBeCloseTo(16, 0);
  expect(m.buttonToCardBottom).toBeCloseTo(16, 0);
  expect(m.innerWidth).toBeGreaterThan(200);
  expect(Math.abs(m.buttonWidth - m.innerWidth), "단추 폭 = 카드 안쪽 폭").toBeLessThanOrEqual(0.5);
  expect(m.buttonHeight).toBeGreaterThanOrEqual(48);
  expect(m.cardBg).toBe("rgb(255, 255, 255)");
  expect(m.label).toEqual({ text: "예시", size: "12px", weight: "500", color: m.sub });
  expect(m.hint).toEqual({ text: "분야마다 시간 · 1시간 단위", size: "12px", align: "center", color: m.sub });
  // d-125 그대로: 막대만 흐림
  const barOpacity = await page.locator(".growth-example-item .growth-goal-bar").evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
  expect(barOpacity).toEqual(["0.4", "0.4"]);
  await noOverflow(page);
  await card.scrollIntoViewIfNeeded();
  await photo(page, "상태보기-목표없는주-이번주목표탭");
});

test("④-① 오늘 기록 저장 직후: 남은 분야만 이름 아래 「n시간 더」(12 보조), 「채울」 없음", async ({ page }) => {
  await open(page, "after-save");
  await page.locator("#dev-open-window").click();
  const dialog = page.getByRole("dialog", { name: "오늘 몇 시간 썼어요?" });
  await dialog.getByLabel("시간", { exact: true }).fill("1");
  await dialog.getByRole("button", { name: "나누지 않고 저장" }).click();
  const short = page.locator(".after-save-short");
  await expect(short).toBeVisible();
  const rows = await short.locator(".after-save-row").evaluateAll((els) =>
    els.map((li) => {
      const name = li.querySelector(".after-save-name")!;
      const more = li.querySelector(".after-save-more")!;
      const ms = getComputedStyle(more);
      return { name: name.textContent, more: more.textContent, below: more.getBoundingClientRect().top >= name.getBoundingClientRect().bottom - 0.5, size: ms.fontSize, color: ms.color };
    }),
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.map((r) => [r.name, r.more])).toEqual([
    ["어학", "3시간 더"],
    ["CS 공부", "1시간 40분 더"],
  ]);
  for (const r of rows) {
    expect(r.below, `${r.name}: 「n시간 더」는 이름 줄 아래`).toBe(true);
    expect(r.size).toBe("12px");
    expect(r.color).toBe("rgb(94, 100, 120)");
  }
  expect(await page.evaluate(() => document.body.innerText.includes("채울"))).toBe(false);
  await noOverflow(page);
  await short.scrollIntoViewIfNeeded();
  await photo(page, "저장직후-n시간더");
});

test("③ 내 정보 첫 카드(목표 있음·없음) · S8-b · 나가기 확인", async ({ page }) => {
  await open(page, "me-goal");
  const card = page.getByRole("button", { name: "이루고 싶은 것, 올해 안에 토익 900점 넘기고 포트폴리오 끝내기, 고치기" });
  await expect(card).toBeVisible();
  const c = await card.evaluate((btn) => {
    const text = btn.querySelector(".me-goal-text")!;
    const label = btn.querySelector(".me-goal-label")!;
    const ts = getComputedStyle(text);
    const ls = getComputedStyle(label);
    const lines = Math.round(text.getBoundingClientRect().height / parseFloat(ts.lineHeight));
    return {
      height: btn.getBoundingClientRect().height,
      first: btn.closest(".growth-body")!.querySelector("section")!.contains(btn),
      text: { size: ts.fontSize, line: ts.lineHeight, weight: ts.fontWeight, breakWord: ts.wordBreak, overflow: ts.textOverflow, clamp: ts.webkitLineClamp, lines },
      label: { size: ls.fontSize, weight: ls.fontWeight, color: ls.color },
      chevron: btn.querySelector(".me-goal-chevron")!.textContent,
      inputs: document.querySelectorAll("#me-goal").length,
    };
  });
  expect(c.first).toBe(true);
  expect(c.height).toBeGreaterThanOrEqual(48);
  expect(c.text).toEqual({ size: "20px", line: "28px", weight: "700", breakWord: "keep-all", overflow: "clip", clamp: "none", lines: 2 });
  expect(c.label).toEqual({ size: "12px", weight: "500", color: "rgb(94, 100, 120)" });
  expect(c.chevron).toBe("›");
  expect(c.inputs).toBe(0);
  await expect(page.getByRole("button", { name: "목표 저장" })).toHaveCount(0);
  await noOverflow(page);
  await photo(page, "내정보-첫카드-목표있음");

  await card.click();
  const dlg = page.getByRole("dialog", { name: "목표" });
  await expect(dlg).toBeVisible();
  const field = dlg.getByRole("textbox", { name: "목표" });
  await expect(field).toHaveValue("올해 안에 토익 900점 넘기고 포트폴리오 끝내기");
  await expect(dlg.getByText("예: 포트폴리오 끝내고 토익 800점 넘기기")).toBeVisible();
  const back = dlg.getByRole("button", { name: "이전" });
  const b = (await back.boundingBox())!;
  expect(b.width).toBeGreaterThanOrEqual(48);
  expect(b.height).toBeGreaterThanOrEqual(48);
  expect(b.x).toBeLessThan(40); // 왼쪽 위
  expect(b.y).toBeLessThan(40);
  const tabbarCovered = await page.evaluate(() => {
    const bar = document.querySelector(".tabbar")!.getBoundingClientRect();
    const top = document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2);
    return !document.querySelector(".tabbar")!.contains(top);
  });
  expect(tabbarCovered, "아래 탭 없음(겹친 창이 덮음)").toBe(true);
  await noOverflow(page);
  await photo(page, "S8-b-목표");

  await field.fill("포트폴리오 끝내기");
  await back.click();
  const confirm = page.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button")).toHaveText(["저장", "나가기"]);
  await expect(confirm.getByRole("button", { name: "저장" })).toBeFocused();
  await photo(page, "S8-b-나가기확인");
  await confirm.getByRole("button", { name: "저장" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByRole("button", { name: "이루고 싶은 것, 포트폴리오 끝내기, 고치기" })).toBeFocused();

  await open(page, "me-goal-empty");
  const empty = page.getByRole("button", { name: "이루고 싶은 것, 목표 적기" });
  await expect(empty).toBeVisible();
  const e = await empty.evaluate((btn) => {
    const s = getComputedStyle(btn.querySelector(".me-goal-empty")!);
    return { size: s.fontSize, weight: s.fontWeight, text: btn.querySelector(".me-goal-empty")!.textContent };
  });
  expect(e).toEqual({ size: "16px", weight: "500", text: "목표 적기" });
  await noOverflow(page);
  await photo(page, "내정보-첫카드-목표없음");
});

test("③ S8-b 진짜 브라우저 뒤로 가기(page.goBack): 안 바꿨으면 닫힘 · 바꿨으면 확인, 확인을 닫고 다시 뒤로 → 다시 확인, 저장 실패면 열린 채, 「나가기」면 닫히고 갤러리에 남음", async ({ page }) => {
  await open(page, "me-goal-fail");
  const url = page.url();
  const card = page.locator(".me-goal-card");
  const dlg = page.getByRole("dialog", { name: "목표" });
  const confirm = page.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });

  await card.click();
  await expect(dlg).toBeVisible();
  await page.goBack();
  await expect(dlg).toHaveCount(0);
  expect(page.url()).toBe(url);

  await card.click();
  await dlg.getByRole("textbox", { name: "목표" }).fill("바꾼 목표");
  await page.goBack();
  await expect(confirm).toBeVisible();
  await expect(dlg).toBeVisible();
  await page.keyboard.press("Escape"); // 확인만 닫는다
  await expect(confirm).toHaveCount(0);
  await expect(dlg.getByRole("textbox", { name: "목표" })).toHaveValue("바꾼 목표");
  await page.goBack();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "저장" }).click(); // 이 갤러리는 저장이 늘 실패한다
  await expect(dlg.getByRole("alert")).toHaveText("저장하지 못했어요. 다시 눌러 주세요.");
  await expect(dlg).toBeVisible();
  await page.goBack();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "나가기" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(card).toBeFocused();
  expect(page.url()).toBe(url);
  await expect(page.getByRole("button", { name: /^이루고 싶은 것, 올해 안에 토익/ })).toBeVisible(); // 저장하지 않았다
});
