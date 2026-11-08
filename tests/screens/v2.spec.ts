import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * 원샷 v2 화면 사진과 치수 확인(고침 1바퀴 B10). 개발 서버(next dev, 3200 포트)의 /dev/v2에서만 돈다: npm run screens
 * 대상: 아래 탭 줄 + 내 정보 탭(B1·B8·B9), 상태보기 빈 안내의 「저녁 기록 남기기」(B17), 상태보기 기간 × 보기 방식(고침 4바퀴 C), 새 전체 화면 창 넷(B6·B7).
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

const TEXT200_CSS = `:root{
  --font-name: 700 64px/80px var(--font-family);
  --font-title: 700 48px/64px var(--font-family);
  --font-body: 400 32px/48px var(--font-family);
  --font-sub: 400 28px/40px var(--font-family);
  --font-google: 500 28px/40px var(--font-family);
}`;

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

// ---- 상태보기 빈 안내 (B17) ----
for (const size of ["360x800", "text200-sim"] as SizeTag[]) {
  test(`growth-empty ${size}: 빈 안내 아래에 「저녁 기록 남기기」`, async ({ page }) => {
    await open(page, "growth-empty", size);
    await shot(page, `growth-empty-${size}`);
    const text = page.getByText(/아직 이번 주 저녁 기록이 없어요/);
    const button = page.getByRole("button", { name: "저녁 기록 남기기" });
    await expect(button).toBeVisible();
    const t = (await text.boundingBox())!;
    const b = (await button.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(t.y + t.height - 0.5);
    expect(b.height).toBeGreaterThanOrEqual(48);
  });
}

// ---- 상태보기 기간 × 보기 방식 (고침 4바퀴 C 2단계) ----
// 대표 상태: 이번 주 분야별 줄 막대(처음 상태, PM 확정 11-09) · 띠그래프 · 원그래프 · 총 시간 · 기록 없음 · 분야 50개.
// 모두 가로로 넘치지 않는다(scrollWidth ≤ clientWidth, 위 창들과 같은 측정). 360px 폭과 글자 200% 흉내에서 잰다.
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

for (const size of ["360x800", "text200-sim", "320x640"] as SizeTag[]) {
  test(`growth-week ${size}: 이번 주 분야별 줄 막대(처음) → 띠그래프 → 원그래프 → 총 시간, 모두 가로로 넘치지 않는다`, async ({ page }) => {
    await open(page, "growth-week", size);
    // 처음 상태: 기간 이번 주 · 보기 분야별 줄 막대(기억한 값이 없을 때). 「최근 1주」 단추는 없다
    await expect(page.getByRole("button", { name: "이번 주" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "분야별 줄 막대" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "최근 1주" })).toHaveCount(0);
    await expect(page.locator(".growth-bar")).toHaveCount(4);
    await expect(page.locator(".growth-band")).toHaveCount(0);
    await shot(page, `growth-rows-${size}`);
    await noHorizontalScroll(page, "분야별 줄 막대");
    await insideViewport(page, ".growth-bar", "막대");

    await page.getByRole("button", { name: "띠그래프" }).click();
    await expect(page.getByRole("button", { name: "띠그래프" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".growth-band")).toHaveCount(2);
    await shot(page, `growth-band-${size}`);
    await noHorizontalScroll(page, "띠그래프");
    await insideViewport(page, ".growth-band", "띠");

    await page.getByRole("button", { name: "원그래프" }).click();
    await expect(page.getByRole("button", { name: "원그래프" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("svg.growth-pie")).toHaveCount(2);
    await shot(page, `growth-pie-${size}`);
    await noHorizontalScroll(page, "원그래프");
    await insideViewport(page, "svg.growth-pie", "원");

    await page.getByRole("button", { name: "총 시간" }).click();
    await expect(page.getByRole("button", { name: "총 시간" })).toHaveAttribute("aria-pressed", "true");
    await shot(page, `growth-total-${size}`);
    await noHorizontalScroll(page, "총 시간");
    // 고르는 단추는 누르는 면 높이 48 이상(--tap-min)
    const heights = await page.$$eval(".detail-chips .chip", (els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights.length, "고르는 단추가 있다(없으면 Math.min이 Infinity라 그냥 통과한다)").toBeGreaterThan(0);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(48);
  });
}

// 비교 보기(D-093, 남겨 둔 보기): 분야 줄마다 이번 주·지난주·지난달·쌓인 것 나란히. 분야 50개·긴 이름에서도 가로로 넘치지 않는다
for (const size of ["360x800", "text200-sim", "320x640"] as SizeTag[]) {
  for (const state of ["growth-week", "growth-many"]) {
    test(`${state} ${size}: 비교 보기가 가로로 넘치지 않는다`, async ({ page }) => {
      await open(page, state, size);
      await page.getByRole("button", { name: "비교" }).click();
      await expect(page.getByRole("button", { name: "비교" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("heading", { name: "분야마다 나란히" })).toBeVisible();
      await expect(page.locator(".growth-compare")).toHaveCount(state === "growth-many" ? 51 : 4);
      await shot(page, `${state}-compare-${size}`);
      await noHorizontalScroll(page, "비교");
      await insideViewport(page, ".growth-compare", "비교 줄");
    });
  }
}

// 키보드만: Tab으로 기간 → 보기 방식 단추를 차례로 지나고, Enter와 Space로 바뀐다(진짜 브라우저의 Tab 차례·키 동작)
test("growth-week 키보드: Tab으로 기간·보기 방식 단추를 차례로 지나고 Enter·Space로 바꾼다", async ({ page }) => {
  await open(page, "growth-week", "360x800");
  const name = (n: string) => page.getByRole("button", { name: n, exact: true });
  await name("이번 주").focus();
  for (const next of ["총 시간", "비교", "띠그래프", "원그래프", "분야별 줄 막대"]) {
    await page.keyboard.press("Tab");
    await expect(name(next)).toBeFocused();
  }
  await page.keyboard.press("Shift+Tab");
  await expect(name("원그래프")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(name("원그래프")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg.growth-pie")).toHaveCount(2);
  await expect(name("원그래프")).toBeFocused(); // 바꿔도 포커스가 단추에 그대로
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(name("분야별 줄 막대")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".growth-bar")).toHaveCount(4);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+Tab"); // 분야별 줄 막대 → 원그래프 → 띠그래프 → 비교
  await expect(name("비교")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(name("비교")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "분야마다 나란히" })).toBeVisible();
});

for (const size of ["360x800", "text200-sim"] as SizeTag[]) {
  test(`growth-empty ${size}: 기록 없음에서 보기를 바꿔도 가로로 넘치지 않는다`, async ({ page }) => {
    await open(page, "growth-empty", size);
    await noHorizontalScroll(page, "기록 없음 줄 막대(처음 보기)");
    await page.getByRole("button", { name: "띠그래프" }).click();
    await expect(page.locator(".growth-band")).toHaveCount(2);
    await expect(page.locator(".growth-band.is-empty")).toHaveCount(1); // 쓴 시간 줄만 비어 있다(처음 정한 비율 줄은 있다)
    await noHorizontalScroll(page, "기록 없음 띠그래프");
    await page.getByRole("button", { name: "원그래프" }).click();
    await shot(page, `growth-empty-pie-${size}`);
    await noHorizontalScroll(page, "기록 없음 원그래프");
    await page.getByRole("button", { name: "총 시간" }).click();
    await noHorizontalScroll(page, "기록 없음 총 시간");
  });

  test(`growth-many ${size}: 분야 50개(꺾쇠·아주 긴 이름)에서도 보기 셋과 총 시간이 가로로 넘치지 않는다`, async ({ page }) => {
    await open(page, "growth-many", size);
    await expect(page.locator(".growth-item")).toHaveCount(51);
    await expect(page.getByRole("button", { name: "분야별 줄 막대" })).toHaveAttribute("aria-pressed", "true"); // 처음 보기
    await shot(page, `growth-many-rows-${size}`);
    await noHorizontalScroll(page, "분야 50개 줄 막대");
    await page.getByRole("button", { name: "띠그래프" }).click();
    await shot(page, `growth-many-band-${size}`);
    await noHorizontalScroll(page, "분야 50개 띠그래프");
    await page.getByRole("button", { name: "원그래프" }).click();
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
// title = 창 맨 위 제목(h2, 창의 이름). 저녁 기록 창의 h2는 질문이고 「저녁 기록」은 그 밑 작은 글이다(eyebrow).
const WINDOWS: { id: string; title: string; eyebrow?: string }[] = [
  { id: "goal", title: "이번 주 목표" },
  { id: "evening", title: "오늘 몇 시간 썼어요?", eyebrow: "저녁 기록" },
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
