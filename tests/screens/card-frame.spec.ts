import { expect, test, type Page } from "@playwright/test";

/**
 * 고침11-2 틀(PM 11-10 「디자인 요소 반영해서 만들어야해」): 「오늘 먼저 할 일」 카드의 바깥 틀과 머리 두 줄을 Figma 값으로 잰다.
 * 값은 23 Figma r20FCKEGkp8pxEwO8lPzDX L1 166:150 · L3 166:348 · L5 166:550 · L6 166:668 · L8 166:900 · K7 157:795에서 읽은 것이다.
 *   바탕 #FFFFFF · 모서리 16 · 위 안쪽 8 · 왼쪽 16 · 분야 점 10×10(윤곽 1 #1C2340) · 제목 12 Regular 줄 16 #5E6478 · 건넨 할 일 16 Bold 줄 24 #1C2340
 *   위에서 점 15 · 제목 8 · 건넨 할 일 30(제목 아래 6) · 단추 줄은 적은 날 줄에서 16 · 카드 끝은 단추 아래 12
 *   높이: L1 142 · L3 198 · L5 142 · L6 142 · L8 120 · K7 144
 * x·너비(Figma 20·320, 앱 16·328)는 앱 전체 쪽 여백(--page-x) 문제라 여기서 20·320으로 단언하지 않는다. 대신 카드가 같은 탭의 다른 줄(이번 주 목표 줄)과 같은 x·너비인지 본다(결정 대기).
 * 상태 화면은 개발 갤러리(/dev/v2?s=fix11-…, /dev/states C31)에서 가짜 데이터로 잰다.
 */
const CARD = '.entry-card[aria-label="오늘 먼저 할 일"]';

async function open(page: Page, url: string, width = 360, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(CARD)).toBeVisible();
}

type Frame = {
  box: { x: number; y: number; w: number; h: number };
  bg: string;
  radius: string;
  padTop: number;
  padLeft: number;
  padBottom: number;
  dot: { x: number; y: number; w: number; h: number; bw: string; bc: string; bg: string };
  title: { x: number; y: number; h: number; font: string; color: string };
  text: { y: number; h: number; font: string; color: string };
  lastBottom: number;
  goal: { x: number; w: number } | null;
};

async function frame(page: Page): Promise<Frame> {
  return page.evaluate((sel) => {
    const card = document.querySelector<HTMLElement>(sel)!;
    const r = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const rect = (el: Element) => el.getBoundingClientRect();
    const font = (el: Element) => {
      const c = getComputedStyle(el);
      return `${c.fontSize}/${c.fontWeight}/${c.lineHeight}`;
    };
    const dotEl = card.querySelector<HTMLElement>(".offer-dot")!;
    const dot = rect(dotEl);
    const dcs = getComputedStyle(dotEl);
    const titleEl = card.querySelector<HTMLElement>(".entry-title")!;
    const textEl = card.querySelector<HTMLElement>(".offer-text")!;
    const kids = [...card.children].map((c) => rect(c));
    // 단추 상자는 위아래 투명 테두리 4px로 48이지만 보이는 꼴은 40이라, 카드 끝 간격은 단추 줄(.detail-actions) 아래끝으로 잰다
    const actions = card.querySelector(".detail-actions");
    const lastBottom = actions ? rect(actions).bottom : Math.max(...kids.map((k) => k.bottom));
    const goalEl = document.querySelector(".goal-line");
    const goal = goalEl ? { x: rect(goalEl).x, w: rect(goalEl).width } : null;
    return {
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      bg: cs.backgroundColor,
      radius: cs.borderTopLeftRadius,
      padTop: parseFloat(cs.paddingTop),
      padLeft: parseFloat(cs.paddingLeft),
      padBottom: parseFloat(cs.paddingBottom),
      dot: { x: dot.x - r.x, y: dot.y - r.y, w: dot.width, h: dot.height, bw: dcs.borderTopWidth, bc: dcs.borderTopColor, bg: dcs.backgroundColor },
      title: { x: rect(titleEl).x - r.x, y: rect(titleEl).y - r.y, h: rect(titleEl).height, font: font(titleEl), color: getComputedStyle(titleEl).color },
      text: { y: rect(textEl).y - r.y, h: rect(textEl).height, font: font(textEl), color: getComputedStyle(textEl).color },
      lastBottom: r.bottom - lastBottom,
      goal,
    };
  }, CARD);
}

// 카드 높이는 상태마다 Figma 노드 높이와 같다(글이 한 줄일 때). 같은 시험이 틀 값도 함께 단언한다
const STATES = [
  ["fix11-l1", "L1 166:150", 142],
  ["fix11-l3", "L3 166:348(오프라인 알림)", 198],
  ["fix11-l4", "L4(실패 알림)", 198],
  ["fix11-l5", "L5 166:550", 142],
  ["fix11-l6", "L6 166:668", 142],
  ["fix11-l8", "L8 166:900", 120],
  ["fix11-k7", "K7 157:795", 144],
] as const;

for (const [id, label, height] of STATES) {
  test(`카드 틀 ${label}: 높이 ${height} · 흰 바탕 · 모서리 16 · 안쪽 위 8 왼쪽 16 · 점 10 · 제목 12/16 · 건넨 할 일 16 Bold/24`, async ({ page }) => {
    await open(page, `/dev/v2?s=${id}`);
    const f = await frame(page);
    // K7 상태 글(157:799)은 Figma 노드가 288 안 한 줄(20)로 그려졌지만 앱 글(14px, 안쪽 296)은 두 줄로 감겨 한 줄(20)만큼 더 높다.
    // 글이 길어 줄이 느는 것이라 높이도 느는 것이 정상이다(보고에 적음). 한 줄로 들어가면 노드 값 144와 같아야 한다.
    const extra = await page.evaluate((sel) => {
      const el = document.querySelector(`${sel} > .todo-sub`);
      return el ? Math.round(el.getBoundingClientRect().height) - 20 : 0;
    }, CARD);
    expect(f.box.h, `${label} 카드 높이`).toBe(height + extra);
    expect(f.bg).toBe("rgb(255, 255, 255)");
    expect(f.radius).toBe("16px");
    expect(f.padTop).toBe(8);
    expect(f.padLeft).toBe(16);
    expect(f.padBottom).toBe(12);
    // 분야 점: 10×10 · 윤곽 1 #1C2340 · 위 15 · 왼쪽 16 · 분야 색(투명이 아님)
    expect(f.dot.w).toBe(10);
    expect(f.dot.h).toBe(10);
    expect(f.dot.bw).toBe("1px");
    expect(f.dot.bc).toBe("rgb(28, 35, 64)");
    expect(f.dot.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(f.dot.x).toBe(16);
    expect(f.dot.y).toBe(15);
    // 제목: 점 오른쪽 6(x 26+... = 카드 안 x 32), 위 8, 12 Regular 줄 16 #5E6478
    expect(f.title.x).toBe(32);
    expect(f.title.y).toBe(8);
    expect(f.title.h).toBe(16);
    expect(f.title.font).toBe("12px/400/16px");
    expect(f.title.color).toBe("rgb(94, 100, 120)");
    // 건넨 할 일: 제목 아래 6 · 16 Bold 줄 24 #1C2340
    expect(f.text.y).toBe(30);
    expect(f.text.h).toBe(24);
    expect(f.text.font).toBe("16px/700/24px");
    expect(f.text.color).toBe("rgb(28, 35, 64)");
    // 단추 줄 아래 12에서 카드가 끝난다
    expect(f.lastBottom).toBe(12);
  });
}

test("카드 틀: 같은 탭의 이번 주 목표 줄과 같은 x · 너비(쪽 여백을 따른다 · Figma 20·320 대 앱 16·328은 결정 대기)", async ({ page }) => {
  await open(page, "/dev/v2?s=fix11-l1");
  const f = await frame(page);
  expect(f.goal).not.toBeNull();
  expect(f.box.x).toBe(f.goal!.x);
  expect(f.box.w).toBe(f.goal!.w);
});

test("카드 틀: 안쪽 간격은 L1에서 건넨 할 일 → 적은 날 0 · 적은 날 → 단추 줄 16(Figma 166:153~155)", async ({ page }) => {
  await open(page, "/dev/v2?s=fix11-l1");
  const g = await page.evaluate((sel) => {
    const card = document.querySelector(sel)!;
    const r = (s: string) => card.querySelector(s)!.getBoundingClientRect();
    return { textBottom: r(".offer-text").bottom, written: { top: r(".offer-written").top, bottom: r(".offer-written").bottom, h: r(".offer-written").height }, actionsTop: r(".detail-actions").top };
  }, CARD);
  expect(g.written.top).toBe(g.textBottom);
  expect(g.written.h).toBe(20);
  expect(g.actionsTop - g.written.bottom).toBe(16);
});

test("카드 틀: 글 200자 카드는 줄이 늘어 높이가 느는 것이 정상이고, 틀 값(바탕 · 안쪽 · 점 위치)은 그대로다", async ({ page }) => {
  await open(page, "/dev/states?s=C31&sheet=closed");
  const f = await frame(page);
  expect(f.box.h).toBeGreaterThan(142);
  expect(f.bg).toBe("rgb(255, 255, 255)");
  expect(f.dot.y).toBe(15);
  expect(f.title.y).toBe(8);
  expect(f.text.font).toBe("16px/700/24px");
});

test("「오늘 기록」 입구는 틀이 바뀌지 않는다(.entry-card를 같이 쓰지만 먼저 할 일 카드 규칙이 걸리지 않는다)", async ({ page }) => {
  await open(page, "/dev/v2?s=fix11-l1");
  const e = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("#evening-entry")!;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { bg: cs.backgroundColor, pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`, dir: cs.flexDirection, h: r.height, dots: el.querySelectorAll(".offer-dot").length };
  });
  expect(e.bg).toBe("rgb(243, 238, 230)");
  expect(e.pad).toBe("8px 16px 8px 16px");
  expect(e.dir).toBe("row");
  expect(e.h).toBe(56);
  expect(e.dots).toBe(0);
});
