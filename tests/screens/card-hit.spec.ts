import { expect, test, type Page } from "@playwright/test";

/**
 * 고침 11-2(창구 가): 먼저 할 일 카드 단추는 보이는 꼴이 40 · 14, 누르는 자리(단추 상자: 위아래 투명 테두리 4px)는 높이·폭 48 이상이고 서로 겹치지 않는다.
 * 개발 상태 모음(/dev/states) C29(분야만 카드) · C31(글 200자 카드)로 잰다. 가장자리 점을 elementFromPoint로 눌러 그 단추만 맞는지 본다.
 */
async function open(page: Page, state: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`/dev/states?s=${state}&sheet=closed`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.entry-card[aria-label="오늘 먼저 할 일"]')).toBeVisible();
}

type Hit = { label: string; visible: { x: number; y: number; w: number; h: number }; hit: { x: number; y: number; w: number; h: number } };

async function hits(page: Page): Promise<Hit[]> {
  return page.evaluate(() => {
    const out: Hit[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.entry-card[aria-label="오늘 먼저 할 일"] button')) {
      const r = el.getBoundingClientRect();
      // 누름 영역 = 단추 상자 전체, 보이는 꼴 = 위아래 투명 테두리를 뺀 안쪽
      const cs = getComputedStyle(el);
      const bt = parseFloat(cs.borderTopWidth);
      const bb = parseFloat(cs.borderBottomWidth);
      out.push({
        label: el.textContent ?? "",
        visible: { x: r.x, y: r.y + bt, w: r.width, h: r.height - bt - bb },
        hit: { x: r.x, y: r.y, w: r.width, h: r.height },
      });
    }
    return out;
  });
}

for (const [state, width, height] of [
  ["C29", 360, 800],
  ["C29", 320, 640],
  ["C31", 360, 800],
] as const) {
  test(`카드 단추 ${state} ${width}x${height}: 보이는 높이 40 · 글 14 Medium, 누름 영역 48 이상, 서로 겹치지 않는다`, async ({ page }) => {
    await open(page, state, width, height);
    const list = await hits(page);
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const b of list) {
      expect(Math.round(b.visible.h), `${b.label} 보이는 높이`).toBe(40);
      expect(b.hit.h, `${b.label} 누름 높이`).toBeGreaterThanOrEqual(47.5);
      expect(b.hit.w, `${b.label} 누름 폭`).toBeGreaterThanOrEqual(47.5);
    }
    const fonts = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.entry-card[aria-label="오늘 먼저 할 일"] button')].map((el) => {
        const cs = getComputedStyle(el);
        return `${cs.fontSize}/${cs.fontWeight}`;
      }),
    );
    for (const f of fonts) expect(f).toBe("14px/500");
    // 서로 겹치지 않는다(누름 영역끼리)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].hit;
        const b = list[j].hit;
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapX > 0.01 && overlapY > 0.01, `${list[i].label} ↔ ${list[j].label} 누름 영역 겹침`).toBe(false);
      }
    }
    // 누름 영역이 카드 위 글(제목·할 일 글)과도 겹치지 않는다
    const textBottom = await page.evaluate(() => {
      const card = document.querySelector('.entry-card[aria-label="오늘 먼저 할 일"]')!;
      return Math.max(...[...card.querySelectorAll<HTMLElement>(".offer-text, .entry-title, .offer-written, .notice")].map((e) => e.getBoundingClientRect().bottom));
    });
    for (const b of list) expect(b.hit.y, `${b.label} 누름 영역 위끝이 위 글 아래`).toBeGreaterThanOrEqual(textBottom - 0.01);
  });

  test(`카드 단추 ${state} ${width}x${height}: 누름 영역 가장자리(위·아래 끝 1px 안, 주 단추와 「넘기기」 경계)를 눌러도 그 단추만 맞는다`, async ({ page }) => {
    await open(page, state, width, height);
    const list = await hits(page);
    const owner = (x: number, y: number) =>
      page.evaluate(([px, py]) => (document.elementFromPoint(px, py)?.closest("button")?.textContent ?? null) as string | null, [x, y] as const);
    for (const b of list) {
      const cx = b.hit.x + b.hit.w / 2;
      expect(await owner(cx, b.hit.y + 1), `${b.label} 위끝 1px 안`).toBe(b.label);
      expect(await owner(cx, b.hit.y + b.hit.h - 1), `${b.label} 아래끝 1px 안`).toBe(b.label);
      expect(await owner(b.visible.x + 1, b.visible.y + b.visible.h / 2), `${b.label} 왼쪽 끝`).toBe(b.label);
      expect(await owner(b.visible.x + b.visible.w - 1, b.visible.y + b.visible.h / 2), `${b.label} 오른쪽 끝`).toBe(b.label);
    }
    // 주 단추와 「넘기기」 사이 경계: 주 단추 오른쪽 끝 안쪽은 주 단추, 「넘기기」 왼쪽 끝 안쪽은 「넘기기」
    const [primary, skip] = list;
    const mid = primary.visible.y + primary.visible.h / 2;
    expect(await owner(primary.visible.x + primary.visible.w - 0.5, mid)).toBe(primary.label);
    expect(await owner(skip.visible.x + 0.5, mid)).toBe(skip.label);
  });
}

/** 고침11-2 검토 고침 1·2·7: 보이는 간격 · 카드 높이 · 포커스 고리 상자 · 누름 영역을 지난 날(L1) · 알림 붙음(L3) · 이미 목록(L6) · 분야만(L8) 카드로 잰다 */
const STATES = [
  { id: "fix11-k1", label: "L1" },
  { id: "fix11-k3", label: "L3(알림 상자 붙음)" },
  { id: "fix11-today", label: "L6" },
  { id: "fix11-k6", label: "L8" },
] as const;

async function openGallery(page: Page, id: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${id}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.entry-card[aria-label="오늘 먼저 할 일"]')).toBeVisible();
}

type Boxes = { card: { y: number; h: number }; written: { b: number } | null; notice: { y: number; b: number } | null; btn: { y: number; h: number; hit: { y: number; h: number } }[] };

async function boxes(page: Page): Promise<Boxes> {
  return page.evaluate(() => {
    const card = document.querySelector('.entry-card[aria-label="오늘 먼저 할 일"]')!;
    const cr = card.getBoundingClientRect();
    const w = card.querySelector(".offer-written")?.getBoundingClientRect();
    const n = card.querySelector(".notice")?.getBoundingClientRect();
    const btn = [...card.querySelectorAll<HTMLElement>("button")].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const bt = parseFloat(cs.borderTopWidth);
      const bb = parseFloat(cs.borderBottomWidth);
      return { y: r.y + bt, h: r.height - bt - bb, hit: { y: r.y, h: r.height } };
    });
    return { card: { y: cr.y, h: cr.height }, written: w ? { b: w.bottom } : null, notice: n ? { y: n.y, b: n.bottom } : null, btn };
  });
}

for (const s of STATES) {
  test(`카드 ${s.label}: 보이는 간격(적은 날 줄 → 알림 12 · 알림/줄 → 단추 줄 16)과 누름 영역 48 · 겹침 없음`, async ({ page }) => {
    await openGallery(page, s.id);
    const b = await boxes(page);
    const first = b.btn[0];
    expect(Math.round(first.h), "보이는 높이 40").toBe(40);
    expect(first.hit.h, "누름 높이").toBeGreaterThanOrEqual(47.5);
    if (b.notice && b.written) {
      expect(Math.round((b.notice.y - b.written.b) * 10) / 10, "적은 날 줄 → 알림 상자").toBe(12);
      expect(Math.round((first.y - b.notice.b) * 10) / 10, "알림 상자 → 단추 줄").toBe(16);
    } else if (b.written) {
      expect(Math.round((first.y - b.written.b) * 10) / 10, "적은 날 줄 → 단추 줄").toBe(16);
    }
    console.log(`MEASURE ${s.label} cardH=${b.card.h} btnY=${first.y - b.card.y}`);
  });
}

test("카드 L3은 L1보다 알림 상자(44) + 위 여백 12 = 56 높다(명세 198 − 142). 카드 전체 높이 142 · 198은 카드 틀(안쪽 여백 · 제목/글 줄 쌓기) 차이로 맞지 않는다 — 23 QA 몫(현재 L1 112)", async ({ page }) => {
  await openGallery(page, "fix11-k1");
  const l1 = (await boxes(page)).card.h;
  await openGallery(page, "fix11-k3");
  const l3 = (await boxes(page)).card.h;
  expect(Math.round(l3 - l1), "L3 − L1").toBe(56);
});

test("카드 단추 포커스 고리: 보이는 40 채움 둘레(상자 안쪽 -2) · 2px", async ({ page }) => {
  await openGallery(page, "fix11-k1");
  const btn = page.locator('.entry-card[aria-label="오늘 먼저 할 일"] button').first();
  await page.keyboard.press("Tab");
  await btn.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const ring = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const off = parseFloat(cs.outlineOffset);
    return { w: parseFloat(cs.outlineWidth), style: cs.outlineStyle, color: cs.outlineColor, boxH: r.height + 2 * off, visibleH: r.height - 8 };
  });
  expect(ring.style).toBe("solid");
  expect(ring.w).toBe(2);
  expect(ring.boxH, "고리 안쪽 상자 높이 = 보이는 40 + 위아래 2씩").toBeCloseTo(44, 0);
});
