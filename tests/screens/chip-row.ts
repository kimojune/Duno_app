import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 분야 칩 줄 한 줄 + 옆으로 넘김(고침 5바퀴, 명세 ⑦-1·④-2)을 실제 배치로 잰다. screens.spec.ts·v2.spec.ts가 같이 쓴다.
 * - 줄 높이 = 칩 하나 높이(하한·상한 둘 다), 모든 칩의 위가 같다(두 줄 아님)
 * - 문서·칩 줄이 화면 밖으로 가로로 넘치지 않는다
 * - 넘치면: 「›」가 칩 줄 밖 오른쪽 제 칸(칩을 가리지 않음), 누름 48 · 보이는 면 32, 넘친 쪽 끝 24px이 옅어진다(mask)
 * - 넘치지 않으면: 「‹」「›」 없음
 * 돌려주는 값은 측정 기록용이다.
 */
export async function measureChipRow(row: Locator) {
  return row.evaluate((el) => {
    const s = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const scroller = el.parentElement!;
    const chips = [...el.children].map((c) => {
      const r = c.getBoundingClientRect();
      return { top: Math.round(r.top - box.top), height: r.height, left: r.left, right: r.right };
    });
    const nav = (name: string) => {
      const b = [...scroller.querySelectorAll<HTMLElement>(".chip-nav")].find((x) => x.getAttribute("aria-label") === name);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const f = b.querySelector(".chip-nav-face")!.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, faceW: f.width, faceH: f.height, tabIndex: b.tabIndex };
    };
    return {
      flexWrap: s.flexWrap,
      overflowX: s.overflowX,
      overflowY: s.overflowY,
      mask: s.maskImage || s.getPropertyValue("-webkit-mask-image"),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      scrollLeft: el.scrollLeft,
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      chips,
      rows: new Set(chips.map((c) => c.top)).size,
      maxChipHeight: Math.max(...chips.map((c) => c.height)),
      next: nav("분야 더 보기"),
      prev: nav("앞 분야 보기"),
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    };
  });
}

export type ChipRowMeasure = Awaited<ReturnType<typeof measureChipRow>>;

export async function assertChipOneLine(page: Page, row: Locator, vw: number): Promise<ChipRowMeasure> {
  const m = await measureChipRow(row);
  expect(m.chips.length, "칩이 있다(빈 줄에서 그냥 통과하지 않게)").toBeGreaterThan(0);
  expect(m.flexWrap, "한 줄(감싸지 않음)").toBe("nowrap");
  expect(m.overflowX, "옆으로 넘긴다").toBe("auto");
  expect(m.overflowY, "세로로는 밀지 않는다").toBe("hidden");
  expect(m.rows, "모든 칩이 한 줄에 있다").toBe(1);
  expect(m.maxChipHeight, "칩 누름 높이 48 이상").toBeGreaterThanOrEqual(48);
  expect(m.clientHeight, "줄 높이 = 칩 하나 높이(하한)").toBeGreaterThanOrEqual(m.maxChipHeight - 0.5);
  expect(m.clientHeight, "줄 높이 = 칩 하나 높이(상한, 두 줄 아님)").toBeLessThanOrEqual(m.maxChipHeight + 1);
  expect(m.box.left, "칩 줄이 화면 왼쪽 밖으로 나가지 않는다").toBeGreaterThanOrEqual(-0.5);
  expect(m.box.right, "칩 줄이 화면 오른쪽 밖으로 나가지 않는다").toBeLessThanOrEqual(vw + 0.5);
  expect(m.docScrollWidth, "문서에 가로 스크롤 없음").toBeLessThanOrEqual(m.docClientWidth);
  const overflowing = m.scrollWidth > m.clientWidth + 1;
  if (overflowing && m.scrollLeft <= 1) {
    expect(m.next, "넘치면 「›」가 있다").not.toBeNull();
    expect(m.prev, "처음에는 「‹」가 없다").toBeNull();
  }
  if (!overflowing) {
    expect(m.next, "넘치지 않으면 「›」 없음").toBeNull();
    expect(m.prev, "넘치지 않으면 「‹」 없음").toBeNull();
    expect(m.mask, "넘치지 않으면 옅어지는 띠 없음").toBe("none");
  }
  for (const b of [m.next, m.prev]) {
    if (!b) continue;
    expect(b.w, "넘김 단추 누름 폭 48").toBeGreaterThanOrEqual(48);
    expect(b.h, "넘김 단추 누름 높이 48").toBeGreaterThanOrEqual(48);
    expect(b.faceW, "보이는 면 폭 32").toBeCloseTo(32, 0);
    expect(b.faceH, "보이는 면 높이 32").toBeCloseTo(32, 0);
    expect(b.tabIndex, "넘김 단추는 Tab 순서 밖").toBe(-1);
    expect(b.right, "넘김 단추가 화면 안").toBeLessThanOrEqual(vw + 0.5);
    expect(b.left, "넘김 단추가 화면 안").toBeGreaterThanOrEqual(-0.5);
  }
  if (m.next) {
    expect(m.next.left, "「›」는 칩 줄 밖 오른쪽(칩을 가리지 않음)").toBeGreaterThanOrEqual(m.box.right - 0.5);
    expect(m.mask, "오른쪽 끝 24px이 옅어진다").toContain("linear-gradient");
    expect(m.mask).toContain("24px");
  }
  if (m.prev) expect(m.prev.right, "「‹」는 칩 줄 밖 왼쪽(칩을 가리지 않음)").toBeLessThanOrEqual(m.box.left + 0.5);
  return m;
}

/**
 * 「›」를 눌러 한 화면 폭 넘기고(움직임 줄이기로 바로 옮김), 「‹」가 생기는지 본다. 이어서 끝까지 넘겨 마지막 칩이 줄 안에 다 보이는지 본다.
 * 부르기 전에 page.emulateMedia({ reducedMotion: "reduce" })를 해 둔다.
 */
export async function assertChipPaging(row: Locator) {
  // 넘김 단추가 나고 들며 칩 줄 폭이 바뀌어 단추가 끝없이 깜빡이면 React가 「Maximum update depth exceeded」를 낸다(고침 5바퀴에서 찾은 것)
  const errors: string[] = [];
  const page = row.page();
  const onError = (e: Error) => errors.push(e.message);
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === "error" && m.text().includes("Maximum update depth")) errors.push(m.text());
  };
  page.on("pageerror", onError);
  page.on("console", onConsole);
  const scroller = row.locator("xpath=..");
  const before = await measureChipRow(row);
  expect(before.scrollWidth, "넘치는 줄에서만 부른다").toBeGreaterThan(before.clientWidth + 1);
  await scroller.getByRole("button", { name: "분야 더 보기" }).click();
  const after = await measureChipRow(row);
  const expected = Math.min(before.clientWidth, before.scrollWidth - before.clientWidth);
  expect(Math.abs(after.scrollLeft - expected), "한 화면 폭만큼 넘어갔다").toBeLessThanOrEqual(1);
  expect(after.prev, "넘어간 뒤 「‹」가 생긴다").not.toBeNull();
  expect(after.prev!.right).toBeLessThanOrEqual(after.box.left + 0.5);
  // 끝까지 넘기면 「›」가 사라지고 마지막 칩이 줄 안에 다 보인다
  for (let i = 0; i < 80; i += 1) {
    const next = scroller.getByRole("button", { name: "분야 더 보기" });
    if ((await next.count()) === 0) break;
    await next.click();
  }
  const end = await measureChipRow(row);
  expect(end.next, "끝에서는 「›」 없음").toBeNull();
  const last = end.chips[end.chips.length - 1];
  expect(last.right, "마지막 칩이 줄 안에 다 보인다").toBeLessThanOrEqual(end.box.right + 0.5);
  expect(last.left).toBeGreaterThanOrEqual(end.box.left - 0.5);
  // 「‹」로 처음까지 돌아오면 「‹」가 사라진다
  for (let i = 0; i < 80; i += 1) {
    const prev = scroller.getByRole("button", { name: "앞 분야 보기" });
    if ((await prev.count()) === 0) break;
    await prev.click();
  }
  const back = await measureChipRow(row);
  expect(back.scrollLeft).toBeLessThanOrEqual(1);
  expect(back.prev).toBeNull();
  expect(back.next).not.toBeNull();
  page.off("pageerror", onError);
  page.off("console", onConsole);
  expect(errors, "넘기는 동안 화면 오류(끝없는 다시 그림) 없음").toEqual([]);
  return { before, after, end };
}
