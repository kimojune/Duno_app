import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 분야 칩 줄(고침9 — PM 16:3x · 23 칩 두 줄)을 실제 배치로 잰다. screens.spec.ts·v2.spec.ts가 같이 쓴다.
 * 옛 고침5 「한 줄 + 옆으로 넘김 + 「‹ ›」」 측정을 바꿨다.
 * - 칩은 감싼다(flex-wrap: wrap), 가로로 넘기지 않는다. 문서·칩 줄이 화면 밖으로 가로로 넘치지 않는다
 * - 접혔을 때 줄 수 ≤ 2(하한 1). 넘치면 둘째 줄 끝 「+n」, n = 숨은 칩 수(만든 순서 뒤쪽)
 * - 「‹ ›」 넘김 단추·옅어지는 띠 없음
 * 돌려주는 값은 측정 기록용이다.
 */
export async function measureChipRow(row: Locator) {
  return row.evaluate((el) => {
    const s = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const kids = [...el.children] as HTMLElement[];
    const chips = kids.map((c) => {
      const r = c.getBoundingClientRect();
      return {
        label: c.textContent ?? "",
        more: c.hasAttribute("data-chip-more"),
        top: Math.round(r.top - box.top),
        height: r.height,
        left: r.left,
        right: r.right,
      };
    });
    const tops = [...new Set(chips.map((c) => c.top))].sort((a, b) => a - b);
    // 4px 안 차이는 같은 줄
    let rows = 0;
    let last = -Infinity;
    for (const t of tops) {
      if (t - last > 4) rows += 1;
      last = t;
    }
    const more = el.querySelector<HTMLElement>("[data-chip-more]");
    return {
      flexWrap: s.flexWrap,
      overflowX: s.overflowX,
      mask: s.maskImage || s.getPropertyValue("-webkit-mask-image"),
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      chips,
      rows,
      more: more ? { label: more.getAttribute("aria-label"), text: more.textContent, expanded: more.getAttribute("aria-expanded") } : null,
      nav: el.parentElement!.querySelectorAll(".chip-nav").length,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    };
  });
}

export type ChipRowMeasure = Awaited<ReturnType<typeof measureChipRow>>;

/** 접힌 칩 줄: 감쌈 · 줄 수 1~2 · 넘김 단추·띠 없음 · 가로 넘침 없음 · 칩 높이 36 이상. total을 주면 「+n」 수 = total − 보이는 칩 수 */
export async function assertChipTwoLines(page: Page, row: Locator, vw: number, total?: number): Promise<ChipRowMeasure> {
  const m = await measureChipRow(row);
  const chips = m.chips.filter((c) => !c.more);
  expect(chips.length, "칩이 있다(빈 줄에서 그냥 통과하지 않게)").toBeGreaterThan(0);
  expect(m.flexWrap, "감싼다").toBe("wrap");
  expect(m.overflowX, "가로로 넘기지 않는다").toBe("visible");
  expect(m.nav, "「‹ ›」 넘김 단추 없음").toBe(0);
  expect(m.mask, "옅어지는 띠 없음").toBe("none");
  expect(m.rows, "줄 수 하한").toBeGreaterThanOrEqual(1);
  expect(m.rows, "접힌 줄 수 상한 2").toBeLessThanOrEqual(2);
  for (const c of m.chips) {
    expect(c.height, `${c.label} 칩 높이 36`).toBeGreaterThanOrEqual(36 - 0.5);
    expect(c.left, `${c.label} 화면 왼쪽 안`).toBeGreaterThanOrEqual(-0.5);
    expect(c.right, `${c.label} 화면 오른쪽 안`).toBeLessThanOrEqual(vw + 0.5);
  }
  expect(m.box.right, "칩 줄이 화면 오른쪽 밖으로 나가지 않는다").toBeLessThanOrEqual(vw + 0.5);
  expect(m.docScrollWidth, "문서에 가로 스크롤 없음").toBeLessThanOrEqual(m.docClientWidth);
  if (m.more) {
    expect(m.chips[m.chips.length - 1].more, "「+n」은 맨 뒤(둘째 줄 끝, 칩이 줄 폭만큼 크면 첫 줄 끝)").toBe(true);
    // 「+n」은 마지막 줄 오른쪽 끝: 그 줄에서 「+n」보다 오른쪽 칩 없음
    const moreChip = m.chips[m.chips.length - 1];
    expect(m.chips.filter((c) => Math.abs(c.top - moreChip.top) <= 4 && c.left > moreChip.left).length).toBe(0);
    if (total !== undefined) {
      const hidden = total - chips.length;
      expect(hidden, "숨은 칩이 있다").toBeGreaterThan(0);
      expect(m.more.text?.replace(/\s/g, ""), "「+n」의 n = 숨은 칩 수").toBe(`+${hidden}`);
      expect(m.more.label).toBe(`분야 ${hidden}개 더 보기`);
    }
    expect(m.more.expanded).toBe("false");
  } else if (total !== undefined) {
    expect(chips.length, "「+n」이 없으면 모두 보인다").toBe(total);
  }
  return m;
}

/**
 * 「+n」 → 모두 펼침(줄 수 제한 없음) + 맨 끝 「접기」(aria-expanded=true), 초점은 처음 드러난 칩. 「접기」 → 두 줄, 초점은 「+n」.
 * 끝없는 다시 그림(Maximum update depth)이 없는지도 본다.
 */
export async function assertChipExpandCollapse(page: Page, row: Locator, vw: number, total: number) {
  const errors: string[] = [];
  const onError = (e: Error) => errors.push(e.message);
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === "error" && m.text().includes("Maximum update depth")) errors.push(m.text());
  };
  page.on("pageerror", onError);
  page.on("console", onConsole);
  const before = await assertChipTwoLines(page, row, vw, total);
  expect(before.more, "넘치는 줄에서만 부른다").not.toBeNull();
  const shownBefore = before.chips.filter((c) => !c.more).length;
  await row.locator("[data-chip-more]").click();
  const open = await measureChipRow(row);
  expect(open.chips.filter((c) => !c.more).length, "모두 펼침").toBe(total);
  expect(open.rows, "펼치면 두 줄을 넘는다").toBeGreaterThan(2);
  const collapse = row.getByRole("button", { name: "분야 접기" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(collapse).toHaveText("접기");
  expect(open.chips[open.chips.length - 1].label, "「접기」는 맨 끝").toBe("접기");
  const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
  expect(focused, "펼친 뒤 초점은 처음 드러난 칩").toBe(open.chips[shownBefore].label);
  expect(open.docScrollWidth, "펼쳐도 가로 넘침 없음").toBeLessThanOrEqual(open.docClientWidth);
  await collapse.click();
  const back = await assertChipTwoLines(page, row, vw, total);
  expect(back.more).not.toBeNull();
  await expect(row.locator("[data-chip-more]")).toBeFocused();
  page.off("pageerror", onError);
  page.off("console", onConsole);
  expect(errors, "펼치고 접는 동안 화면 오류(끝없는 다시 그림) 없음").toEqual([]);
  return { before, open, back };
}
