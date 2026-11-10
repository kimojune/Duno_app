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
