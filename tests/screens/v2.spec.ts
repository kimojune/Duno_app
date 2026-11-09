import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { TEXT200_CSS } from "./text200-css";
import { assertChipOneLine, assertChipPaging } from "./chip-row";

/**
 * 원샷 v2 화면 사진과 치수 확인(고침 1바퀴 B10). 개발 서버(next dev, 3200 포트)의 /dev/v2에서만 돈다: npm run screens
 * 대상: 아래 탭 줄 + 내 정보 탭(B1·B8·B9), 상태보기 기록 없음의 「오늘 기록」(B17), 상태보기 두 뷰(고침5: 목표 한 줄·탭 둘·이번 주 목표·목표 비율 띠/원), 새 전체 화면 창 넷(B6·B7).
 * 파일 이름: v2-<상태>-<크기>.png. 글자 200%는 screens.spec.ts와 같은 방법으로 흉내 낸다(토큰의 px를 두 배로).
 * 고침 1바퀴에서는 작성만 했고, 고침 2바퀴에서 돌려 실패를 가렸다(docs/oneshot-v2/보고.md 「고침 2바퀴」).
 */

const OUT = "test-results/screens";
const SIZES = {
  "360x640": { width: 360, height: 640, text200: false },
  "360x800": { width: 360, height: 800, text200: false },
  "320x640": { width: 320, height: 640, text200: false },
  "text200-sim": { width: 360, height: 800, text200: true },
} as const;
type SizeTag = keyof typeof SIZES;

async function open(page: Page, state: string, size: SizeTag) {
  const s = SIZES[size];
  await page.setViewportSize({ width: s.width, height: s.height });
  await page.goto(`/dev/v2?s=${state}`);
  if (s.text200) await page.addStyleTag({ content: TEXT200_CSS });
  await page.waitForLoadState("networkidle");
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/v2-${name}.png`, fullPage: false });
}

async function scrollSizes(page: Page) {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
}

const ALL_SIZES: SizeTag[] = ["360x640", "360x800", "320x640", "text200-sim"];

// ---- 아래 탭 줄 + 내 정보 (B1·B8·B9) ----
for (const size of ALL_SIZES) {
  test(`tabbar ${size}: 맨 아래까지 내려도 저장 단추·로그아웃이 탭 줄에 가려지지 않고, 탭 글이 칸을 넘치지 않는다`, async ({ page }) => {
    await open(page, "tabbar", size);
    await shot(page, `tabbar-top-${size}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await shot(page, `tabbar-bottom-${size}`);

    const bar = (await page.locator(".tabbar").boundingBox())!;
    const save = (await page.getByRole("button", { name: "알림 설정 저장" }).boundingBox())!;
    const logout = (await page.getByRole("button", { name: "로그아웃" }).boundingBox())!;
    // B1: 맨 아래에서 저장 단추와 로그아웃의 아래 끝이 탭 줄의 위 끝보다 위에 있다
    expect(save.y + save.height, "알림 설정 저장 단추가 탭 줄에 가려지지 않는다").toBeLessThanOrEqual(bar.y + 0.5);
    expect(logout.y + logout.height, "로그아웃이 탭 줄에 가려지지 않는다").toBeLessThanOrEqual(bar.y + 0.5);

    // B9: 탭 글이 자기 칸을 넘치지 않고(두 줄로 내려갈 수 있다), 가로 스크롤이 없다
    const overflow = await page.$$eval(".tabbar-btn", (buttons) => buttons.map((b) => b.scrollWidth - b.clientWidth));
    expect(Math.max(...overflow)).toBeLessThanOrEqual(1);
    const sw = await scrollSizes(page);
    expect(sw.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(sw.clientWidth);
    // 각 탭의 누르는 면은 높이 48 이상
    const heights = await page.$$eval(".tabbar-btn", (buttons) => buttons.map((b) => b.getBoundingClientRect().height));
    expect(heights.length, "탭 단추가 있다(없으면 Math.min이 Infinity라 그냥 통과한다)").toBeGreaterThan(0);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(48);
  });
}

test("tabbar: 내 정보 안 포커스가 탭 줄 밑으로 들어가지 않는다(scroll-padding-bottom에 탭 줄 높이, B8)", async ({ page }) => {
  await open(page, "tabbar", "360x640");
  const padding = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom);
  const bar = (await page.locator(".tabbar").boundingBox())!;
  expect(parseFloat(padding), "스크롤 여백이 탭 줄 높이보다 크다").toBeGreaterThan(bar.height);
  await page.getByRole("button", { name: "알림 설정 저장" }).focus();
  const save = (await page.getByRole("button", { name: "알림 설정 저장" }).boundingBox())!;
  expect(save.y + save.height).toBeLessThanOrEqual(bar.y + 0.5);
});

// ---- 상태보기 두 뷰(원샷 v2 고침5, 명세 ③-S + ⑩ PM 8) ----
// 대표 상태: growth-goal(목표 한 줄 + 이번 주 목표 뷰) · growth-ratio(목표 비율 뷰 띠) · growth-pie(목표 비율 뷰 원)
//            · growth-week(목표 없는 주 → 목표 비율 탭이 처음) · growth-empty(기록 없음) · growth-many(분야 50개).
// 모두 가로로 넘치지 않는다(scrollWidth ≤ clientWidth). 360px 폭·320px·글자 200% 흉내에서 잰다.
async function noHorizontalScroll(page: Page, what: string) {
  const sw = await scrollSizes(page);
  expect(sw.scrollWidth, `${what}: 가로 스크롤 없음`).toBeLessThanOrEqual(sw.clientWidth);
}
/** 화면 안에 든다: 요소의 오른쪽 끝이 보이는 폭을 넘지 않는다 */
async function insideViewport(page: Page, selector: string, what: string) {
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  const rights = await page.$$eval(selector, (els) => els.map((el) => el.getBoundingClientRect().right));
  expect(rights.length, `${what}: 요소가 있다`).toBeGreaterThan(0);
  expect(Math.max(...rights), `${what}: 화면 폭 안`).toBeLessThanOrEqual(width + 0.5);
}
/** :root 변수 값을 실제 색(rgb)으로: 요소가 칠해진 색과 견줄 때 */
async function rootColor(page: Page, name: string) {
  return page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${n})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);
}

// 기록 없음(B17 → 고침5): 글은 남기고(PM 11:1x) 예시 값 — 목표 비율 띠 + 빈 띠 「0시간」 + 「오늘 기록」 단추
for (const size of ["360x800", "text200-sim"] as SizeTag[]) {
  test(`growth-empty ${size}: 목표 비율 띠 + 빈 띠 「0시간」 + 안내 글 아래 「오늘 기록」, 가로로 넘치지 않는다`, async ({ page }) => {
    await open(page, "growth-empty", size);
    await expect(page.getByRole("tab", { name: "목표 비율" })).toHaveAttribute("aria-selected", "true");
    await shot(page, `growth-empty-${size}`);
    await expect(page.locator(".growth-band")).toHaveCount(2);
    await expect(page.locator(".growth-band.is-empty")).toHaveText("0시간");
    await expect(page.getByRole("button", { name: "원그래프로 보기" })).toHaveCount(0);
    const text = page.getByText(/아직 이번 주 오늘 기록이 없어요/);
    const button = page.getByRole("button", { name: "오늘 기록", exact: true });
    await expect(button).toBeVisible();
    await expect(page.getByRole("button", { name: "저녁 기록 남기기" })).toHaveCount(0);
    const t = (await text.boundingBox())!;
    const b = (await button.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(t.y + t.height - 0.5);
    expect(b.height).toBeGreaterThanOrEqual(48);
    await noHorizontalScroll(page, "기록 없음 이번 주");
    await page.getByRole("button", { name: "총 시간" }).click();
    await noHorizontalScroll(page, "기록 없음 총 시간");
  });
}

for (const size of ["360x800", "text200-sim", "320x640"] as SizeTag[]) {
  test(`growth-goal ${size}: 목표 한 줄(20/28 Bold·낱말 감쌈) · 탭 둘(48, 켜진 탭 3px 밑줄 + Bold) · 이번 주 목표 카드, 가로로 넘치지 않는다`, async ({ page }) => {
    await open(page, "growth-goal", size);
    const s = SIZES[size];
    // 목표 한 줄: 제목 아래·탭 위, 글자색, Bold, 20/28(글자 200% 흉내는 40/56), 낱말 단위 감쌈, 말줄임 없음
    const line = page.locator(".growth-goal-line");
    await expect(line).toBeVisible();
    const st = await line.evaluate((el) => {
      const c = getComputedStyle(el);
      // 글 높이 = 상자 높이 − 위아래 여백(줄 수를 잴 때)
      return { size: c.fontSize, lh: c.lineHeight, weight: c.fontWeight, wb: c.wordBreak, overflow: c.textOverflow, color: c.color, h: el.clientHeight - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom), sw: el.scrollWidth, cw: el.clientWidth };
    });
    expect(st.size).toBe(s.text200 ? "40px" : "20px");
    expect(st.lh).toBe(s.text200 ? "56px" : "28px");
    expect(st.weight).toBe("700");
    expect(st.wb).toBe("keep-all");
    expect(st.overflow).not.toBe("ellipsis");
    expect(st.color).toBe(await rootColor(page, "--color-text"));
    expect(st.sw).toBeLessThanOrEqual(st.cw + 0.5);
    const lineH = s.text200 ? 56 : 28;
    expect(st.h).toBeGreaterThanOrEqual(lineH - 0.5); // 한 줄 이상
    if (size === "360x800") expect(st.h).toBeLessThanOrEqual(2 * lineH + 0.5); // 360px 보통 글자에서 이 예시 글은 두 줄 안
    const lineBox = (await line.boundingBox())!;
    const tabsBox = (await page.getByRole("tablist").boundingBox())!;
    const titleBox = (await page.getByRole("heading", { level: 1, name: "상태보기" }).boundingBox())!;
    expect(lineBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 0.5);
    expect(tabsBox.y).toBeGreaterThanOrEqual(lineBox.y + lineBox.height - 0.5);

    // 탭 둘: 높이 48 이상, 폭은 탭 줄의 반, 켜진 탭 = 글자색 3px 밑줄 + Bold, 꺼진 탭 = 보조색
    const tabs = await page.$$eval('[role="tab"]', (els) =>
      els.map((el) => {
        const c = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { name: el.textContent, selected: el.getAttribute("aria-selected"), w: r.width, h: r.height, bw: c.borderBottomWidth, bc: c.borderBottomColor, weight: c.fontWeight, color: c.color };
      }),
    );
    expect(tabs.map((t) => [t.name, t.selected])).toEqual([["이번 주 목표", "true"], ["목표 비율", "false"]]);
    expect(Math.min(...tabs.map((t) => t.h))).toBeGreaterThanOrEqual(48);
    expect(Math.abs(tabs[0].w - tabs[1].w)).toBeLessThanOrEqual(1);
    expect(tabs[0].w + tabs[1].w).toBeGreaterThanOrEqual(tabsBox.width - 32 - 1); // 탭 줄 안쪽 폭(좌우 16 여백)을 둘이 나눈다
    expect(tabs[0].bw).toBe("3px");
    expect(tabs[0].bc).toBe(await rootColor(page, "--color-text"));
    expect(tabs[0].weight).toBe("700");
    expect(tabs[1].bw).toBe("1px");
    expect(tabs[1].color).toBe(await rootColor(page, "--color-text-sub"));
    expect(tabs[1].color).not.toBe(tabs[0].color);

    // 이번 주 목표 카드: 머리 글, 흰 카드 둥근 모서리 16, 줄 다섯(만든 순서 · 기타 끝), 칩 없음
    await expect(page.locator(".growth-card-title")).toHaveText("목표 15시간 중 12시간");
    const card = await page.locator(".growth-card").evaluate((el) => {
      const c = getComputedStyle(el);
      return { radius: c.borderTopLeftRadius, bg: c.backgroundColor };
    });
    expect(card.radius).toBe("16px");
    expect(card.bg).toBe(await rootColor(page, "--color-surface"));
    expect(card.bg).not.toBe(await rootColor(page, "--color-bg"));
    await expect(page.locator(".growth-item .growth-name")).toHaveText(["어학", "포트폴리오", "자격증", "운동", "기타"]);
    await expect(page.locator("[aria-pressed]")).toHaveCount(0);
    // 막대: 채움은 6px 이상 + 1px 윤곽, 어학의 빈 자리는 점선, 눈금은 글자색
    const fills = await page.$$eval(".growth-goal-fill", (els) => els.map((el) => ({ w: el.getBoundingClientRect().width, bw: getComputedStyle(el).borderTopWidth, bs: getComputedStyle(el).borderTopStyle })));
    expect(fills.length).toBe(5);
    expect(Math.min(...fills.map((f) => f.w))).toBeGreaterThanOrEqual(6);
    expect(fills.every((f) => f.bw === "1px" && f.bs === "solid")).toBe(true);
    const gaps = await page.$$eval(".growth-goal-gap", (els) => els.map((el) => ({ w: el.getBoundingClientRect().width, bs: getComputedStyle(el).borderTopStyle, bg: getComputedStyle(el).backgroundColor })));
    expect(gaps.length).toBe(1);
    expect(gaps[0].bs).toBe("dashed");
    expect(gaps[0].w).toBeGreaterThan(10);
    expect(gaps[0].bg).toBe("rgba(0, 0, 0, 0)"); // 빈 자리는 채우지 않는다(살구 채움 없음)
    await shot(page, `growth-goal-${size}`);
    await noHorizontalScroll(page, "이번 주 목표 뷰");
    await insideViewport(page, ".growth-goal-bar", "막대");
    await insideViewport(page, ".growth-row-value", "오른쪽 숫자");
  });

  test(`growth-ratio ${size}: 띠 두 줄(위 점선·아래 실선 윤곽, 칸 안 %, 좁은 칸은 숫자 숨김) · 목록, 가로로 넘치지 않는다`, async ({ page }) => {
    await open(page, "growth-ratio", size);
    await expect(page.getByRole("tab", { name: "목표 비율" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".growth-card-total")).toHaveText("20시간");
    await expect(page.locator(".growth-band")).toHaveCount(2);
    const outline = await rootColor(page, "--color-text");
    const segs = await page.$$eval(".growth-band-cell", (els) =>
      els.map((el) => {
        const c = getComputedStyle(el);
        const label = el.querySelector(".growth-seg-label")!;
        return { line: el.closest(".growth-band")!.getAttribute("data-line"), style: c.borderTopStyle, width: c.borderTopWidth, color: c.borderTopColor, w: el.getBoundingClientRect().width, labelShown: getComputedStyle(label).display !== "none", text: label.textContent };
      }),
    );
    expect(segs.filter((x) => x.line === "ratio").map((x) => x.style)).toEqual(["dashed", "dashed", "dashed", "dashed"]);
    expect(segs.filter((x) => x.line === "spent").map((x) => x.style)).toEqual(["solid", "solid", "solid", "solid", "solid"]);
    // 1.5px 테두리는 기기 픽셀에 맞춰진다: DPR 2 이상(폰)은 1.5px, DPR 1은 1px
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    expect(segs.every((x) => x.width === (dpr >= 2 ? "1.5px" : "1px") && x.color === outline)).toBe(true);
    // 워커 A의 공통 윤곽 규칙(inset box-shadow)이 칸에 덧그려지지 않는다
    expect(await page.$$eval(".growth-band-cell", (els) => els.every((el) => getComputedStyle(el).boxShadow === "none"))).toBe(true);
    // 칸이 28px보다 좁으면 숫자는 숨기고(아래 목록에만), 넓으면 보인다. 둘 다 있는 예시다(이번 주 운동 5%)
    const narrow = segs.filter((x) => x.w < 28);
    const wide = segs.filter((x) => x.w >= 28);
    expect(narrow.length).toBeGreaterThan(0);
    expect(wide.length).toBeGreaterThan(0);
    expect(narrow.every((x) => !x.labelShown)).toBe(true);
    expect(wide.every((x) => x.labelShown)).toBe(true);
    await expect(page.locator(".growth-item .growth-row-value")).toHaveText(["10% / 목표 30%", "60% / 목표 40%", "15% / 목표 20%", "5% / 목표 10%", "10%"]);
    await expect(page.locator(".growth-legend-item")).toHaveText(["목표 비율", "이번 주"]);
    // 기간 칩: 보이는 면 둥근 999, 누름 영역 48
    const chips = await page.$$eval(".growth-period", (els) => els.map((el) => ({ h: el.getBoundingClientRect().height, r: getComputedStyle(el.querySelector(".growth-period-face")!).borderTopLeftRadius })));
    expect(chips.length).toBe(3);
    expect(Math.min(...chips.map((c) => c.h))).toBeGreaterThanOrEqual(48);
    expect(chips.every((c) => parseFloat(c.r) >= 16)).toBe(true);
    await shot(page, `growth-ratio-${size}`);
    // 분야 색 점은 실제로 1px 먹남색 윤곽으로 칠해진다(CSS 값이 아니라 계산값) — 바탕·면 색과도 다르다
    const dots = await page.$$eval(".growth-dot", (els) => els.map((el) => ({ shadow: getComputedStyle(el).boxShadow, bg: getComputedStyle(el).backgroundColor })));
    expect(dots.length).toBeGreaterThan(0);
    const surface = await rootColor(page, "--color-surface");
    const pageBg = await rootColor(page, "--color-bg");
    for (const d of dots) {
      expect(d.shadow, "1px 안쪽 윤곽").toMatch(/inset/);
      expect(d.shadow).toContain(outline);
      expect(d.shadow).toMatch(/0px 0px 0px 1px/);
      expect(d.bg).not.toBe(surface);
      expect(d.bg).not.toBe(pageBg);
    }
    // 칸 바깥 폭 27px은 숫자가 숨고 29px은 보인다 — 첫 칸(왼쪽 테두리 있음)도 나머지 칸(왼쪽 테두리 0)도 같은 기준이다(실제 폭을 바꿔 잰다)
    for (const index of [0, 1, 2]) {
      const probe = await page.evaluate((i) => {
        const band = document.querySelector('.growth-band[data-line="spent"]')!;
        const slot = band.children[i] as HTMLElement;
        const label = slot.querySelector(".growth-seg-label") as HTMLElement;
        const out: Record<string, { width: number; shown: boolean }> = {};
        for (const w of [27, 29]) {
          slot.style.flex = "none";
          slot.style.inlineSize = `${w}px`;
          void slot.offsetWidth;
          out[String(w)] = { width: slot.getBoundingClientRect().width, shown: getComputedStyle(label).display !== "none" };
        }
        return out;
      }, index);
      expect(probe["27"].width, `칸 ${index} 바깥 폭 27`).toBeCloseTo(27, 1);
      expect(probe["29"].width, `칸 ${index} 바깥 폭 29`).toBeCloseTo(29, 1);
      expect(probe["27"].shown, `칸 ${index}: 27px 칸은 숫자 숨김`).toBe(false);
      expect(probe["29"].shown, `칸 ${index}: 29px 칸은 숫자 보임`).toBe(true);
    }
    await noHorizontalScroll(page, "목표 비율 띠");
    await insideViewport(page, ".growth-band", "띠");
    await insideViewport(page, ".growth-row-value", "오른쪽 %");
  });

  test(`growth-pie ${size}: 원 둘 나란히(같은 크기), 조각 실선 1px 윤곽, 조각마다 %, 가로로 넘치지 않는다`, async ({ page }) => {
    await open(page, "growth-pie", size);
    await expect(page.locator("svg.growth-pie")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "띠그래프로 보기" })).toBeVisible();
    const boxes = await page.$$eval("svg.growth-pie", (els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
    expect(Math.abs(boxes[0].w - boxes[1].w)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThanOrEqual(0.5); // 한 줄에 나란히
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].w - 0.5);
    // 360px에서 원 지름 약 132 안팎(그림 칸 폭에 맞춘다)
    const diameter = (boxes[0].w * 200) / 256; // 원 지름 = 그림 칸의 200/256(바깥 % 자리)
    expect(diameter).toBeGreaterThanOrEqual(80);
    expect(diameter).toBeLessThanOrEqual(140);
    const slices = await page.$$eval("path.growth-pie-slice", (els) => els.map((el) => ({ s: getComputedStyle(el).stroke, w: getComputedStyle(el).strokeWidth, d: getComputedStyle(el).strokeDasharray })));
    expect(slices.length).toBe(9);
    const outline = await rootColor(page, "--color-text");
    expect(slices.every((x) => x.s === outline && x.w === "1px" && x.d === "none")).toBe(true);
    await expect(page.locator("svg.growth-pie").nth(1).locator("text")).toHaveText(["10%", "60%", "15%", "5%", "10%"]);
    await expect(page.locator(".growth-pie-label.is-outside line")).toHaveCount(1); // 5%만 이끌 선으로 원 밖
    await shot(page, `growth-pie-${size}`);
    await noHorizontalScroll(page, "원그래프");
    await insideViewport(page, "svg.growth-pie", "원");
  });

  test(`growth-week ${size}: 목표 없는 주 → 목표 비율 탭·띠그래프가 처음, 원그래프·총 시간 · 이번 주 목표 탭(정하기 + 예시)도 가로로 넘치지 않는다`, async ({ page }) => {
    await open(page, "growth-week", size);
    await expect(page.getByRole("tab", { name: "목표 비율" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "이번 주" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "최근 1주" })).toHaveCount(0);
    await expect(page.locator(".growth-band")).toHaveCount(2);
    await noHorizontalScroll(page, "띠그래프");
    await page.getByRole("button", { name: "원그래프로 보기" }).click();
    await expect(page.locator("svg.growth-pie")).toHaveCount(2);
    await noHorizontalScroll(page, "원그래프");
    await page.getByRole("button", { name: "총 시간" }).click();
    await expect(page.getByRole("button", { name: "총 시간" })).toHaveAttribute("aria-pressed", "true");
    await noHorizontalScroll(page, "총 시간");
    await page.getByRole("tab", { name: "이번 주 목표" }).click();
    await expect(page.getByRole("group", { name: "예시" })).toBeVisible();
    await expect(page.getByRole("button", { name: "이번 주 목표 정하기" })).toHaveCount(1);
    // PM d-125: 흐림은 막대(채움·점선·눈금)에만. 막대는 여전히 불투명 40%
    const barOpacity = await page.locator(".growth-example-item .growth-goal-bar").evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
    expect(barOpacity).toEqual(["0.4", "0.4"]);
    await expectExampleTextSharp(page);
    await shot(page, `growth-nogoal-${size}`);
    await noHorizontalScroll(page, "목표 없는 주의 이번 주 목표 탭");
  });
}

/**
 * PM d-125: 목표 없는 주의 예시 글(분야 이름·「목표 n시간」)은 흐리지 않는다 — 계산된 글 색이 보조 글 토큰(--color-text-sub)이고,
 * 그 요소와 조상들의 계산된 opacity 곱이 1이다(흰 바탕 5.88:1). 토큰 값 자체와도, 바탕(--color-surface)과도 따로 맞춰 본다
 */
async function expectExampleTextSharp(page: Page) {
  const r = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-text-sub)";
    document.body.appendChild(probe);
    const sub = getComputedStyle(probe).color;
    probe.style.color = "var(--color-surface)";
    const surface = getComputedStyle(probe).color;
    probe.remove();
    const root = getComputedStyle(document.documentElement).getPropertyValue("--color-text-sub").trim();
    const els = Array.from(document.querySelectorAll<HTMLElement>(".growth-example-item .growth-name, .growth-example-item .growth-goal-of"));
    return {
      sub,
      surface,
      root,
      texts: els.map((el) => {
        let opacity = 1;
        for (let n: HTMLElement | null = el; n; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity);
        return { text: el.textContent, color: getComputedStyle(el).color, opacity };
      }),
    };
  });
  expect(r.root.toUpperCase()).toBe("#5E6478");
  expect(r.sub).toBe("rgb(94, 100, 120)");
  expect(r.sub).not.toBe(r.surface);
  expect(r.texts.length).toBeGreaterThan(0);
  expect(r.texts.map((t) => t.text)).toEqual(["포트폴리오", "목표 6시간", "어학", "목표 5시간"]);
  for (const t of r.texts) {
    expect(t.color, `${t.text} 글 색`).toBe(r.sub);
    expect(t.opacity, `${t.text} 불투명 곱`).toBe(1);
  }
}

// 악용 시나리오: 목표 최대 길이(100자, 띄어쓰기 없는 긴 낱말 + 꺾쇠 모양 글) — 줄바꿈하고 가로로 넘치지 않으며 글자 그대로 보인다
for (const size of ["360x800", "text200-sim", "320x640"] as SizeTag[]) {
  test(`growth-goal-long ${size}: 목표 100자 글이 감싸지고 말줄임·가로 넘침 없이 다 보이며 img 요소가 생기지 않는다`, async ({ page }) => {
    await open(page, "growth-goal-long", size);
    const line = page.locator(".growth-goal-line");
    await expect(line).toBeVisible();
    const text = (await line.textContent()) ?? "";
    expect(text.startsWith("목표, <img src=x onerror=alert(1)> 가나다")).toBe(true);
    expect([...text.replace("목표, ", "")].length).toBe(100);
    expect(await page.locator(".growth-goal-line img, img[src='x']").count()).toBe(0);
    const m = await line.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, h: el.clientHeight, lh: parseFloat(getComputedStyle(el).lineHeight) }));
    expect(m.sw).toBeLessThanOrEqual(m.cw + 0.5);
    expect(m.h).toBeGreaterThan(2 * m.lh); // 여러 줄로 감쌌다(자르지 않았다)
    await shot(page, `growth-goal-long-${size}`);
    await noHorizontalScroll(page, "목표 100자");
  });
}

// 비교 보기(D-093, 남겨 둔 보기): 분야 줄마다 이번 주·지난주·지난달·총 시간 나란히. 분야 50개·긴 이름에서도 가로로 넘치지 않는다
for (const size of ["360x800", "text200-sim", "320x640"] as SizeTag[]) {
  for (const state of ["growth-week", "growth-many"]) {
    test(`${state} ${size}: 비교 보기가 가로로 넘치지 않는다`, async ({ page }) => {
      await open(page, state, size);
      await page.getByRole("button", { name: "비교" }).click();
      await expect(page.getByRole("button", { name: "비교" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("heading", { name: "분야마다 나란히" })).toBeVisible();
      await expect(page.locator(".growth-compare")).toHaveCount(state === "growth-many" ? 51 : 4);
      await expect(page.getByText("쌓인 것")).toHaveCount(0);
      await shot(page, `${state}-compare-${size}`);
      await noHorizontalScroll(page, "비교");
      await insideViewport(page, ".growth-compare", "비교 줄");
    });
  }
}

// 키보드만: 탭은 좌우·Home/End로 고르고(켜진 탭만 Tab 차례), Tab으로 기간 → 보기 바꾸기를 지나며 Enter·Space로 바꾼다(진짜 브라우저)
test("growth-week 키보드: 탭 좌우·Home/End, Tab으로 기간·보기 바꾸기 단추를 차례로 지나고 Enter·Space로 바꾼다", async ({ page }) => {
  await open(page, "growth-week", "360x800");
  const name = (n: string) => page.getByRole("button", { name: n, exact: true });
  const tab = (n: string) => page.getByRole("tab", { name: n });
  await tab("목표 비율").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tab("이번 주 목표")).toBeFocused();
  await expect(tab("이번 주 목표")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tab("목표 비율")).toBeFocused();
  await expect(tab("목표 비율")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tab("이번 주 목표")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tab("목표 비율")).toHaveAttribute("aria-selected", "true");
  // 켜진 탭 다음 Tab은 꺼진 탭을 건너뛰고 기간 칩으로
  for (const next of ["이번 주", "총 시간", "비교", "원그래프로 보기"]) {
    await page.keyboard.press("Tab");
    await expect(name(next)).toBeFocused();
  }
  await page.keyboard.press("Enter");
  await expect(page.locator("svg.growth-pie")).toHaveCount(2);
  await expect(name("띠그래프로 보기")).toBeFocused(); // 바꿔도 포커스가 같은 단추에(글만 바뀜)
  await page.keyboard.press("Space");
  await expect(page.locator(".growth-band")).toHaveCount(2);
  for (let i = 0; i < 2; i++) await page.keyboard.press("Shift+Tab"); // 보기 바꾸기 → 비교 → 총 시간
  await expect(name("총 시간")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(tab("목표 비율")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(name("비교")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(name("비교")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "분야마다 나란히" })).toBeVisible();
});

for (const size of ["360x800", "text200-sim"] as SizeTag[]) {
  test(`growth-many ${size}: 분야 50개(꺾쇠·아주 긴 이름)에서도 띠·원·총 시간이 가로로 넘치지 않는다`, async ({ page }) => {
    await open(page, "growth-many", size);
    await expect(page.locator(".growth-item")).toHaveCount(51);
    await expect(page.locator(".growth-band")).toHaveCount(2); // 처음 보기
    await shot(page, `growth-many-band-${size}`);
    await noHorizontalScroll(page, "분야 50개 띠그래프");
    await page.getByRole("button", { name: "원그래프로 보기" }).click();
    await noHorizontalScroll(page, "분야 50개 원그래프");
    await insideViewport(page, "svg.growth-pie", "원");
    await page.getByRole("button", { name: "총 시간" }).click();
    await noHorizontalScroll(page, "분야 50개 총 시간");
    // 꺾쇠 이름은 글자로 보인다(요소가 되지 않는다)
    expect(await page.locator("img[src='x']").count()).toBe(0);
    await expect(page.getByText("<b>굵게</b>", { exact: false }).first()).toBeVisible();
  });
}

// ---- 새 전체 화면 창 넷 (B6·B7) ----
// title = 창 맨 위 제목(h2, 창의 이름). 오늘 기록 창의 h2는 질문이고 「오늘 기록」은 그 밑 작은 글이다(eyebrow).
const WINDOWS: { id: string; title: string; eyebrow?: string }[] = [
  { id: "goal", title: "이번 주 목표" },
  { id: "evening", title: "오늘 몇 시간 썼어요?", eyebrow: "오늘 기록" },
  { id: "category", title: "어학" },
  { id: "detail", title: "할 일 자세히" },
];
for (const w of WINDOWS) {
  for (const size of ["360x800", "text200-sim"] as SizeTag[]) {
    test(`${w.id} 창 ${size}: 사진, 밖은 inert, 뒤로 가기는 창만 닫고, 닫으면 연 단추로 포커스`, async ({ page }) => {
      await open(page, w.id, size);
      const opener = page.locator("#dev-open-window");
      const startUrl = page.url();
      await opener.focus();
      await opener.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("heading", { name: w.title, level: 2 }).first()).toBeVisible();
      await expect(page.getByRole("dialog", { name: w.title })).toBeVisible();
      if (w.eyebrow) await expect(dialog.getByText(w.eyebrow, { exact: true })).toBeVisible();
      await shot(page, `${w.id}-window-${size}`);

      // B7: 창 밖(본문·탭 줄)은 inert
      expect(await page.evaluate(() => document.querySelector(".tabbar")!.closest("[inert]") !== null)).toBe(true);
      expect(await page.evaluate(() => document.getElementById("dev-behind")!.closest("[inert]") !== null)).toBe(true);
      expect(await page.evaluate(() => document.querySelector("[role=dialog]")!.closest("[inert]") === null)).toBe(true);
      const sw = await scrollSizes(page);
      expect(sw.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(sw.clientWidth);

      // B6: 뒤로 가기는 창만 닫는다(앱·문서를 떠나지 않는다)
      await page.goBack();
      await expect(dialog).toHaveCount(0);
      expect(page.url()).toBe(startUrl);
      expect(await page.evaluate(() => document.querySelector(".tabbar")!.closest("[inert]") === null)).toBe(true);

      // B7: 닫으면 연 단추로 포커스가 돌아온다(Esc로 닫는 경우도)
      await opener.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    });
  }
}

// ---- 고침4 2단계: 원형 다이얼 (처음 정한 비율·내 정보 비율 고치기·저녁 기록 나누기) ----
// 측정: 가로 넘침 없음(문서·비율 줄·다이얼), 손잡이 누르는 자리 48 이상, 합계 100%, 저녁 창에서 뒤로 가기는 창만 닫는다.

/** 다이얼 둘레의 측정: 다이얼이 화면 안에 있고, 손잡이 누르는 자리(보이지 않는 원)가 48 이상 */
async function measureDial(page: Page, dialId: string) {
  const svg = page.locator(`svg.dial`).first();
  await expect(svg).toBeVisible();
  const box = (await svg.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x, "다이얼 왼쪽이 화면 안").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "다이얼 오른쪽이 화면 안").toBeLessThanOrEqual(vw + 0.5);
  const hits = await page.$$eval(`[id^="${dialId}-handle-"] .dial-hit`, (els) => els.map((e) => e.getBoundingClientRect().width));
  expect(hits.length, "고른 조각의 손잡이가 있다").toBeGreaterThan(0);
  expect(Math.min(...hits), "손잡이 누르는 자리 지름 48 이상").toBeGreaterThanOrEqual(48);
}
async function noRowOverflow(page: Page) {
  const rows = await page.$$eval(".ratio-row", (els) => els.map((e) => e.scrollWidth - e.clientWidth));
  expect(rows.length).toBeGreaterThan(0);
  expect(Math.max(...rows), "비율 줄이 넘치지 않는다").toBeLessThanOrEqual(1);
  const sw = await scrollSizes(page);
  expect(sw.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(sw.clientWidth);
}

const DIAL_SIZES: SizeTag[] = ["360x800", "320x640", "text200-sim"];
for (const many of [false, true]) {
  const tag = many ? "-many" : "";
  for (const size of DIAL_SIZES) {
    test(`ratio-onboarding${tag} ${size}: 처음 설정 3단계 비율 다이얼, 합 100, 가로 넘침 없음`, async ({ page }) => {
      await open(page, `ratio-onboarding${tag}`, size);
      await page.getByRole("button", { name: "다음" }).click();
      await page.getByRole("button", { name: "다음" }).click();
      await expect(page.getByText("합계 100%")).toBeVisible();
      await measureDial(page, "ratio-dial");
      await noRowOverflow(page);
      await shot(page, `ratio-onboarding${tag}-${size}`);
      // 키보드만: 다이얼에 포커스 → 다음 조각 → 손잡이 PageUp → 합 100 그대로
      await page.locator("svg.dial").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Tab");
      await page.keyboard.press("PageUp");
      await expect(page.getByText("합계 100%")).toBeVisible();
      if (many) {
        const fills = await page.$$eval(".dial-slice", (els) => els.map((e) => getComputedStyle(e).fill));
        expect(fills.length, "분야 9개 이상이 조각으로 그려진다").toBeGreaterThanOrEqual(9);
      }
    });

    test(`me-ratio${tag} ${size}: 내 정보 비율 고치기 다이얼, 저장값 30·30이 합 100으로 열린다, 가로 넘침 없음`, async ({ page }) => {
      await open(page, `me-ratio${tag}`, size);
      const dial = page.locator("svg.dial");
      await dial.scrollIntoViewIfNeeded();
      await expect(page.getByText("합계 100%")).toBeVisible();
      await measureDial(page, "ratio-dial");
      await noRowOverflow(page);
      await shot(page, `me-ratio${tag}-${size}`);
    });

    test(`evening-split${tag} ${size}: 저녁 기록 나누기 다이얼, 가로 넘침 없음, 뒤로 가기는 창만 닫는다`, async ({ page }) => {
      await open(page, `evening-split${tag}`, size);
      const startUrl = page.url();
      await page.locator("#dev-open-window").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await page.getByLabel("시간", { exact: true }).fill("2");
      await page.getByRole("button", { name: "분야마다 나누기" }).click();
      await expect(page.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
      await measureDial(page, "evening-dial");
      await noRowOverflow(page);
      await shot(page, `evening-split${tag}-${size}`);
      // 다이얼로 바꾸면 Stepper가 따라온다(키보드)
      await page.locator("svg.dial").focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("ArrowRight");
      await expect(page.locator("#evening-dial-handle-end")).toHaveAttribute("aria-valuenow", "35");
      // 안드로이드 뒤로 가기(브라우저 뒤로): 다이얼이 든 창만 닫히고 문서를 떠나지 않는다
      await page.goBack();
      await expect(dialog).toHaveCount(0);
      expect(page.url()).toBe(startUrl);
    });
  }
}

// ---- 고침 5바퀴: 분야 칩 줄 한 줄 + 옆으로 넘김(명세 ⑦-1·④-2) — 타이머 · 할 일 자세히 · 처음 설정 ----
// 분야 10개(긴 이름 하나)에서 줄 높이가 칩 하나 높이이고, 넘치면 「›」(칩 줄 밖 제 칸, 누름 48), 한 화면 폭씩 넘기고, 가로 넘침이 없다
const CHIP_ROW_CASES: { id: string; state: string; group: string; prepare?: (page: Page) => Promise<void> }[] = [
  { id: "timer", state: "timer-many", group: "분야 (고르지 않으면 기타)" },
  {
    id: "detail",
    state: "detail-many",
    group: "분야 (고르지 않으면 기타)",
    prepare: async (page) => {
      await page.locator("#dev-open-window").click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    id: "onboarding",
    state: "ratio-onboarding-many",
    group: "분야",
    prepare: async (page) => {
      await page.getByRole("button", { name: "다음" }).click();
    },
  },
  // 고침 5바퀴 이음매: 오늘 기록 나누기(E1)와 오늘 할 일 시트(E2)의 칩 줄도 같은 부품(ChipScroller)이다
  {
    id: "evening-split",
    state: "evening-split-many",
    group: "분야 · 여러 개",
    prepare: async (page) => {
      await page.locator("#dev-open-window").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByLabel("시간", { exact: true }).fill("2");
      await page.getByRole("button", { name: "분야마다 나누기" }).click();
      await expect(page.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
    },
  },
  {
    id: "evening-todo-sheet",
    state: "evening-todo-many",
    group: "분야 (고르지 않으면 기타)",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^오늘 할 일 2\/4/ }).click();
      const sheet = page.getByRole("dialog", { name: "오늘 할 일" });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: "+ 할 일" }).click();
    },
  },
];
for (const c of CHIP_ROW_CASES) {
  for (const size of ["360x800", "text200-sim"] as SizeTag[]) {
    test(`칩 줄 ${c.id} ${size}: 한 줄(줄 높이 = 칩 하나), 넘치면 「›」·한 화면 폭 넘김·「‹」, 가로 넘침 없음`, async ({ page }) => {
      await open(page, c.state, size);
      if (c.prepare) await c.prepare(page);
      const row = page.getByRole("group", { name: c.group, exact: true });
      await expect(row).toBeVisible();
      await row.scrollIntoViewIfNeeded();
      const vw = SIZES[size].width;
      const m = await assertChipOneLine(page, row, vw);
      expect(m.chips.length, "분야 10개(+기타)가 한 줄에 있다").toBeGreaterThanOrEqual(10);
      expect(m.scrollWidth, "분야 10개는 360px 한 줄을 넘친다").toBeGreaterThan(m.clientWidth + 1);
      expect(m.next, "「›」가 보인다").not.toBeNull();
      await shot(page, `chip-row-${c.id}-${size}`);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await assertChipPaging(row);
      // 키보드: 줄 안 마지막 칩에 포커스하면 그 칩이 줄 안에 다 보인다
      const last = row.locator(":scope > button").last();
      await last.focus();
      const after = await assertChipOneLine(page, row, vw);
      const lastBox = after.chips[after.chips.length - 1];
      expect(lastBox.left).toBeGreaterThanOrEqual(after.box.left - 0.5);
      expect(lastBox.right).toBeLessThanOrEqual(after.box.right + 0.5);
      const sw = await scrollSizes(page);
      expect(sw.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(sw.clientWidth);
    });
  }
}
