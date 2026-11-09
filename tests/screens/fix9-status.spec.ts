import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * 고침9(워커 J4): 상태보기·아래 탭 Figma 정합. 360×800 사진을 docs/oneshot-v2/고침9-J4/에 「최종 폰 목록」의 화면·상태 이름으로 두고,
 * 사진만 남는 시험이 되지 않게 순서·자리·실제 칠해진 값(계산된 스타일)을 같이 단언한다.
 * 개발 갤러리(/dev/v2) 화면이다(진짜 로그인 앱 화면 아님 — 부품은 앱과 같고 데이터만 가짜). 개발 서버에서 돈다: npm run screens(SCREENS_PORT)
 */
const OUT = path.resolve(__dirname, "../../docs/oneshot-v2/고침9-J4");

async function open(page: Page, s: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${s}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("tabpanel")).toBeVisible();
}
async function photo(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
async function noOverflow(page: Page) {
  const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
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
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

/** 맨 위(A5)와 아래 탭(A6)은 모든 상태보기 상태에서 같다 */
async function topAndTabbar(page: Page) {
  // 맨 위: 워드마크 → 목표 한 줄 → 탭(위에서 아래), 보이는 큰 제목 없음 · 숨은 h1 「상태보기」
  const mark = await box(page, ".growth .wordmark");
  const goal = await box(page, ".growth-goal-line");
  const tabs = await box(page, ".growth-tabs");
  expect(mark.y).toBeLessThan(goal.y);
  expect(goal.y + goal.height).toBeLessThanOrEqual(tabs.y + 0.5);
  expect(mark.height).toBeGreaterThanOrEqual(18);
  const ring = await box(page, ".growth .wordmark-ring");
  expect([Math.round(ring.width), Math.round(ring.height)]).toEqual([18, 18]);
  const markText = await page.locator(".growth .wordmark-text").evaluate((el) => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight, text: el.textContent }));
  expect(markText).toEqual({ size: "16px", weight: "700", text: "duno" });
  const h1 = page.getByRole("heading", { level: 1, name: "상태보기" });
  await expect(h1).toHaveCount(1);
  const h1Box = (await h1.boundingBox())!;
  expect(h1Box.width).toBeLessThanOrEqual(1); // 숨은 제목(sr-only)
  await expect(page.getByRole("heading")).toHaveCount(1);
  // 탭은 화면 끝에서 끝
  expect(Math.round(tabs.width)).toBe(360);

  // 아래 탭: 켜진 탭 위 굵은 선 없음(계산된 border-top·box-shadow), 켜진 탭 = Bold + 글자색, 꺼진 탭 = 보조색
  const text = await tokenColor(page, "--color-text");
  const sub = await tokenColor(page, "--color-text-sub");
  const btns = await page.$$eval(".tabbar-btn", (els) =>
    els.map((el) => {
      const c = getComputedStyle(el);
      const icon = el.querySelector(".tabbar-icon")!;
      const ir = icon.getBoundingClientRect();
      const lr = el.querySelector(".tabbar-label")!.getBoundingClientRect();
      return {
        name: el.textContent, current: el.getAttribute("aria-current"), btw: c.borderTopWidth, bts: c.borderTopStyle, shadow: c.boxShadow, color: c.color, weight: c.fontWeight, h: el.getBoundingClientRect().height,
        size: c.fontSize, icon: { w: ir.width, h: ir.height, color: getComputedStyle(icon).color, hidden: icon.getAttribute("aria-hidden"), above: ir.bottom <= lr.top + 0.5 },
      };
    }),
  );
  expect(btns.length).toBe(4);
  const on = btns.filter((b) => b.current === "page");
  expect(on.map((b) => b.name)).toEqual(["상태보기"]);
  for (const b of btns) {
    expect(b.btw === "0px" || b.bts === "none", `${b.name} 위 선 없음`).toBe(true);
    expect(b.shadow).toBe("none");
    expect(b.h).toBeGreaterThanOrEqual(64);
  }
  // 스킬 검토 O-6: 아이콘 24(위) + 글 12(아래), 아이콘 색 = 글 색(켜짐·꺼짐 그대로), 아이콘은 숨김
  for (const b of btns) {
    expect([Math.round(b.icon.w), Math.round(b.icon.h), b.icon.hidden, b.icon.above, b.size]).toEqual([24, 24, "true", true, "12px"]);
    expect(b.icon.color).toBe(b.color);
  }
  expect([on[0].color, on[0].weight]).toEqual([text, "700"]);
  for (const b of btns.filter((x) => x.current !== "page")) expect([b.color, b.weight]).toEqual([sub, "400"]);
}

/** 목록 줄마다 오른쪽 「›」(카드 안 여백 자리, 보조색) */
async function chevrons(page: Page) {
  const sub = await tokenColor(page, "--color-text-sub");
  const card = await box(page, ".growth-card");
  const rows = await page.$$eval(".growth-item > button", (els) =>
    els.map((el) => {
      const ch = el.querySelector(".growth-chevron")!;
      const r = ch.getBoundingClientRect();
      return { text: ch.textContent, hidden: ch.getAttribute("aria-hidden"), right: r.right, color: getComputedStyle(ch).color, rowRight: el.getBoundingClientRect().right };
    }),
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect([r.text, r.hidden, r.color]).toEqual(["›", "true", sub]);
    expect(r.right).toBeLessThanOrEqual(card.x + card.width); // 카드 밖으로 나가지 않는다
    expect(r.right).toBeGreaterThan(r.rowRight); // 줄 단추 오른쪽 끝 너머 카드 안 여백 자리(Figma 333)
  }
}

/** 카드 아래 연속 기록 줄 */
async function streak(page: Page, weeks: number | null) {
  if (weeks === null) {
    await expect(page.locator(".growth-streak")).toHaveCount(0);
    return;
  }
  const line = page.locator(".growth-streak");
  await expect(line).toHaveText(`${weeks}주 이어서 기록`);
  const card = await box(page, ".growth-card");
  const l = (await line.boundingBox())!;
  expect(l.y).toBeGreaterThanOrEqual(card.y + card.height + 8); // 카드 → 줄 12(±)
  expect(l.y).toBeLessThanOrEqual(card.y + card.height + 16);
  const st = await line.evaluate((el) => ({ color: getComputedStyle(el).color, strong: getComputedStyle(el.querySelector("strong")!).fontWeight, ring: el.querySelector("svg")!.getBoundingClientRect().width }));
  expect(st.color).toBe(await tokenColor(page, "--color-text-sub"));
  expect(st.strong).toBe("700");
  expect(Math.round(st.ring)).toBe(14);
}

/** 목표 비율 뷰 카드 머리 한 줄: 합계 · 칩(보이는 24, 누름 48) · 오른쪽 끝 보기 바꾸기(누름 48) */
async function ratioHead(page: Page, total: string, periodText: string, switchText: string | null) {
  await expect(page.locator(".growth-card-total")).toHaveText(total);
  const chip = page.getByRole("button", { name: /^기간, / });
  await expect(chip).toHaveText(`${periodText} ▾`);
  const m = await page.locator(".growth-card").evaluate((card) => {
    const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    const face = card.querySelector(".growth-period-chip-face")!;
    const fc = getComputedStyle(face);
    return {
      card: r(card)!.toJSON(),
      total: r(card.querySelector(".growth-card-total"))!.toJSON(),
      chip: r(card.querySelector(".growth-period-chip"))!.toJSON(),
      face: r(face)!.toJSON(),
      faceFont: fc.fontSize,
      faceRadius: parseFloat(fc.borderTopLeftRadius),
      sw: card.querySelector(".growth-switch") ? r(card.querySelector(".growth-switch"))!.toJSON() : null,
      totalSize: getComputedStyle(card.querySelector(".growth-card-total")!).fontSize,
    };
  });
  expect(m.totalSize).toBe("16px");
  expect(Math.round(m.face.height)).toBe(24);
  expect(m.faceFont).toBe("11px");
  expect(m.faceRadius).toBeGreaterThanOrEqual(12);
  expect(m.chip.height).toBeGreaterThanOrEqual(48);
  expect(m.chip.width).toBeGreaterThanOrEqual(48);
  // 칩은 합계 바로 옆(같은 줄, 합계 오른쪽)
  expect(Math.abs(m.face.y + m.face.height / 2 - (m.total.y + m.total.height / 2))).toBeLessThanOrEqual(3);
  expect(m.face.x).toBeGreaterThan(m.total.x + m.total.width);
  if (switchText === null) {
    expect(m.sw).toBeNull();
    return;
  }
  await expect(page.locator(".growth-switch")).toHaveText(switchText);
  // 같은 머리 줄의 오른쪽 끝(카드 오른쪽 안 여백 16 안팎), 누름 48
  expect(Math.abs(m.sw!.y + m.sw!.height / 2 - (m.face.y + m.face.height / 2))).toBeLessThanOrEqual(3);
  expect(m.sw!.height).toBeGreaterThanOrEqual(48);
  expect(m.card.x + m.card.width - (m.sw!.x + m.sw!.width)).toBeLessThanOrEqual(16);
  expect(m.card.x + m.card.width - (m.sw!.x + m.sw!.width)).toBeGreaterThanOrEqual(0);
}

/** 빈 상태 「오늘 기록」: 카드 안 끝, 폭 가득(카드 안쪽 폭), 보이는 면 높이 40 · 테두리 --color-border-input, 누름 48 */
async function eveningButton(page: Page) {
  const btn = page.getByRole("button", { name: "오늘 기록", exact: true });
  await expect(btn).toBeVisible();
  const m = await page.locator(".growth-card").evaluate((card) => {
    const b = card.querySelector(".growth-evening-button")!;
    const f = card.querySelector(".growth-evening-face")!;
    const fc = getComputedStyle(f);
    return {
      last: card.lastElementChild!.contains(b),
      card: card.getBoundingClientRect().toJSON(),
      btn: b.getBoundingClientRect().toJSON(),
      face: f.getBoundingClientRect().toJSON(),
      border: `${fc.borderTopWidth} ${fc.borderTopStyle} ${fc.borderTopColor}`,
      after: card.nextElementSibling?.className ?? null,
    };
  });
  expect(m.last).toBe(true);
  expect(Math.round(m.face.height)).toBe(40);
  expect(m.btn.height).toBeGreaterThanOrEqual(48);
  expect(Math.round(m.face.width)).toBe(Math.round(m.card.width - 32));
  expect(m.border).toBe(`1px solid ${await tokenColor(page, "--color-border-input")}`);
  // 카드 밖 안내 글 없음(카드 다음은 연속 기록 줄이거나 없음)
  expect(m.after === null || m.after === "growth-streak").toBe(true);
  await expect(page.getByText(/아직 (이번 주 )?오늘 기록이 없어요/)).toHaveCount(0);
}

test("S6-1 이번 주 목표 뷰 · 목표 세운 주 (Figma 50:137)", async ({ page }) => {
  await open(page, "growth-goal");
  await topAndTabbar(page);
  await expect(page.getByRole("tab", { name: "이번 주 목표" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".growth-card-title")).toHaveText("목표 15시간 중 12시간");
  const head = await page.locator(".growth-card-title").evaluate((el) => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight }));
  expect(head).toEqual({ size: "16px", weight: "700" });
  await expect(page.getByRole("button", { name: /^기간, / })).toHaveCount(0); // 이 뷰에는 칩 없음
  // 줄 사이 선 없음(계산된 border-bottom), 이름 14 Medium
  const rows = await page.$$eval(".growth-item", (els) => els.map((el) => ({ bb: getComputedStyle(el).borderBottomStyle, name: getComputedStyle(el.querySelector(".growth-name")!).fontWeight, size: getComputedStyle(el.querySelector(".growth-name")!).fontSize })));
  expect(rows.length).toBe(5);
  expect(rows.every((r) => r.bb === "none" && r.name === "500" && r.size === "14px")).toBe(true);
  await chevrons(page);
  await streak(page, 3);
  await noOverflow(page);
  await photo(page, "S6-1 이번 주 목표 뷰 · 목표 세운 주");
});

test("S6-1 이번 주 목표 뷰 · 목표 세운 주, 기록 없음 (Figma 51:107)", async ({ page }) => {
  await open(page, "growth-goal-norecord");
  await topAndTabbar(page);
  await expect(page.locator(".growth-card-title")).toHaveText("목표 15시간 중 0시간");
  await expect(page.locator(".growth-goal-fill")).toHaveCount(0);
  await expect(page.locator(".growth-goal-gap")).toHaveCount(4);
  await expect(page.locator(".growth-row-value")).toHaveText(["0시간 · 5시간 더", "0시간 · 6시간 더", "0시간 · 3시간 더", "0시간 · 1시간 더"]);
  await chevrons(page);
  await streak(page, null);
  await eveningButton(page);
  await noOverflow(page);
  await photo(page, "S6-1 이번 주 목표 뷰 · 목표 세운 주, 기록 없음");
});

test("S6-1 이번 주 목표 뷰 · 목표 없는 주 (Figma 50:741)", async ({ page }) => {
  await open(page, "growth-nogoal");
  await topAndTabbar(page);
  await expect(page.getByRole("tab", { name: "이번 주 목표" })).toHaveAttribute("aria-selected", "true");
  const sub = await tokenColor(page, "--color-text-sub");
  const m = await page.locator(".growth-goal-set").evaluate((card) => {
    const ex = card.querySelector(".growth-example")!;
    const bars = Array.from(ex.querySelectorAll(".growth-goal-bar")).map((b) => {
      const gap = b.querySelector(".growth-goal-gap")!;
      const gc = getComputedStyle(gap);
      return { fills: b.querySelectorAll(".growth-goal-fill").length, gapBg: gc.backgroundColor, gapStyle: gc.borderTopStyle, gapLeft: gap.getBoundingClientRect().left - b.getBoundingClientRect().left, opacity: getComputedStyle(b).opacity, h: b.getBoundingClientRect().height };
    });
    const texts = Array.from(ex.querySelectorAll(".growth-example-item")).map((li) => getComputedStyle(li).color);
    const order = Array.from(card.children).map((el) => el.className.split(" ").pop());
    return { bars, texts, order, itemOpacity: getComputedStyle(ex.querySelector(".growth-example-item")!).opacity };
  });
  expect(m.bars.length).toBe(2);
  for (const b of m.bars) {
    expect(b.fills).toBe(0); // 채움 없음
    expect(b.gapBg).toBe("rgba(0, 0, 0, 0)");
    expect(b.gapStyle).toBe("dashed");
    expect(Math.round(b.gapLeft)).toBe(0); // 점선이 처음부터
    expect(b.opacity).toBe("0.4"); // 흐림은 모양에만
    expect(Math.round(b.h)).toBe(12);
  }
  expect(m.itemOpacity).toBe("1");
  expect(m.texts.every((c) => c === sub)).toBe(true);
  expect(m.order).toEqual(["growth-example", "growth-goal-hint", "growth-goal-set-button"]);
  await noOverflow(page);
  await photo(page, "S6-1 이번 주 목표 뷰 · 목표 없는 주");
});

test("S6-2 목표 비율 뷰 · 띠그래프(처음 보기) (Figma 50:193) — 기간 칩 메뉴(마우스·키보드·Esc·바깥)", async ({ page }) => {
  await open(page, "growth-ratio");
  await topAndTabbar(page);
  await ratioHead(page, "20시간", "이번 주", "원그래프로 보기");
  // 띠 높이 36, 범례 아래 선 하나, 줄 사이 선 없음
  expect(Math.round((await box(page, ".growth-band")).height)).toBe(36);
  const list = await page.locator(".growth-graph + .growth-list").evaluate((el) => ({ bt: getComputedStyle(el).borderTopStyle, rows: Array.from(el.querySelectorAll(".growth-item")).map((li) => getComputedStyle(li).borderBottomStyle) }));
  expect(list.bt).toBe("solid");
  expect(list.rows.length).toBe(5);
  expect(list.rows.every((s) => s === "none")).toBe(true);
  await chevrons(page);
  await streak(page, 3);
  // 스킬 검토 O-10: 시간과 %는 고정폭 숫자(계산값)
  const nums = await page.$$eval(".growth-card-total, .growth-row-value, .growth-seg-label, .growth-streak", (els) => els.map((el) => getComputedStyle(el).fontVariantNumeric));
  expect(nums.length).toBeGreaterThan(5);
  expect(nums.every((v) => v.includes("tabular-nums"))).toBe(true);
  await noOverflow(page);
  await photo(page, "S6-2 목표 비율 뷰 · 띠그래프(처음 보기)");

  // 칩 메뉴: 마우스로 열기 → 목록은 칩 아래, 화면 안 → 고르기
  const chip = page.getByRole("button", { name: /^기간, / });
  await chip.click();
  const menu = page.getByRole("menu", { name: "기간" });
  await expect(menu).toBeVisible();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitemradio")).toHaveText(["이번 주", "총 시간", "비교"]);
  await expect(menu.getByRole("menuitemradio", { name: "이번 주" })).toBeFocused();
  const mb = (await menu.boundingBox())!;
  expect(mb.x + mb.width).toBeLessThanOrEqual(360);
  const items = await menu.getByRole("menuitemradio").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(Math.min(...items)).toBeGreaterThanOrEqual(48);
  await menu.getByRole("menuitemradio", { name: "총 시간" }).click();
  await expect(menu).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(page.getByRole("button", { name: "기간, 총 시간" })).toHaveText("총 시간 ▾");
  await expect(page.locator(".growth-card-total")).toHaveText("79시간"); // 화면 모음 GOAL_GROWTH 쌓인 시간 4,740분

  // 키보드: Enter로 열고 ↓·Enter로 고르기, Esc는 고르지 않고 닫기
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitemradio", { name: "총 시간" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "비교" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "기간, 비교" })).toBeFocused();
  await expect(page.locator(".growth-list.is-compare")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "비교" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("menuitemradio", { name: "이번 주" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "기간, 비교" })).toBeFocused();
  // 바깥을 누르면 닫힌다(고르지 않음)
  await page.getByRole("button", { name: "기간, 비교" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.locator(".growth-goal-line").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "기간, 비교" })).toBeVisible();
});

test("S6-2 목표 비율 뷰 · 원그래프 (Figma 50:260)", async ({ page }) => {
  await open(page, "growth-pie");
  await topAndTabbar(page);
  await ratioHead(page, "20시간", "이번 주", "띠그래프로 보기");
  await expect(page.locator("svg.growth-pie")).toHaveCount(2);
  // 가운데 구멍(카드 바탕 원)
  const holes = await page.$$eval(".growth-pie-hole", (els) => els.map((el) => ({ fill: getComputedStyle(el).fill, w: el.getBoundingClientRect().width, pie: el.closest("svg")!.getBoundingClientRect().width })));
  expect(holes.length).toBe(2);
  expect(holes.every((h) => h.fill === "rgb(255, 255, 255)" && h.w > 0.15 * h.pie && h.w < 0.35 * h.pie)).toBe(true);
  await chevrons(page);
  await streak(page, 3);
  await noOverflow(page);
  await photo(page, "S6-2 목표 비율 뷰 · 원그래프");
});

test("S6 빈 상태 · 기록이 하나도 없음 / 「이번 주」를 고름 (Figma 50:598)", async ({ page }) => {
  await open(page, "growth-empty");
  await ratioHead(page, "0시간", "이번 주", "원그래프로 보기");
  const zero = await page.locator(".growth-band.is-zero").evaluate((el) => {
    const c = getComputedStyle(el);
    const label = getComputedStyle(el.querySelector(".growth-zero-label")!);
    return { bg: c.backgroundColor, border: `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`, h: el.getBoundingClientRect().height, text: el.textContent, size: label.fontSize, weight: label.fontWeight, color: label.color };
  });
  expect(zero.bg).toBe(await tokenColor(page, "--color-notice-bg"));
  expect(zero.border).toBe(`1px dashed ${await tokenColor(page, "--color-border-input")}`);
  expect(Math.round(zero.h)).toBe(28);
  expect([zero.text, zero.size, zero.weight, zero.color]).toEqual(["0시간", "12px", "500", await tokenColor(page, "--color-text-sub")]);
  expect(Math.round((await box(page, '.growth-band[data-line="ratio"]')).height)).toBe(28);
  await eveningButton(page);
  await streak(page, null);
  await noOverflow(page);
  await photo(page, "S6 빈 상태 · 기록이 하나도 없음 · 「이번 주」를 고름");
});

test("S6-2 이번 주 0시간 · 지난 기록 있음(「총 시간」으로 시작) (Figma 111:79)", async ({ page }) => {
  await open(page, "growth-week-zero");
  await ratioHead(page, "60시간", "총 시간", "원그래프로 보기");
  await expect(page.locator(".growth-card > .growth-week-zero")).toHaveText("이번 주 0시간");
  await eveningButton(page);
  await streak(page, 3);
  await noOverflow(page);
  await photo(page, "S6-2 이번 주 0시간 · 지난 기록 있음(「총 시간」으로 시작)");
});

test("S6-2 목표 비율 뷰 · 원그래프 · 기록이 하나도 없음 / 「이번 주」를 고름 (Figma 121:240)", async ({ page }) => {
  await open(page, "growth-empty-pie");
  await ratioHead(page, "0시간", "이번 주", "띠그래프로 보기");
  await expect(page.locator(".growth-pie-ring")).toHaveCount(1);
  await expect(page.locator(".growth-item .growth-row-value")).toHaveText(["0% / 목표 50%", "0% / 목표 30%", "0% / 목표 20%", "0%"]);
  await chevrons(page);
  await eveningButton(page);
  await streak(page, null);
  await noOverflow(page);
  await photo(page, "S6-2 목표 비율 뷰 · 원그래프 · 기록이 하나도 없음 · 「이번 주」를 고름");
});

test("S6-2 목표 비율 뷰 · 원그래프 · 이번 주 0시간 + 지난 기록 있음(「총 시간」) (Figma 121:315)", async ({ page }) => {
  await open(page, "growth-week-zero-pie");
  await ratioHead(page, "60시간", "총 시간", "띠그래프로 보기");
  await expect(page.locator(".growth-pie-box .growth-line-caption")).toHaveText(["목표 비율", "총 시간"]);
  await expect(page.locator(".growth-pie-ring")).toHaveCount(0);
  await expect(page.locator(".growth-card > .growth-week-zero")).toHaveText("이번 주 0시간");
  await eveningButton(page);
  await noOverflow(page);
  await photo(page, "S6-2 목표 비율 뷰 · 원그래프 · 이번 주 0시간 + 지난 기록 있음(「총 시간」)");
});
