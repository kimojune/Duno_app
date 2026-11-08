import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { COLOR_TOKENS } from "../../lib/design-tokens";

/**
 * 상태별 스크린샷과 치수 확인(디자인 명세 12-13 방향 C). 개발 서버(next dev, 3200 포트)에서만 돈다: npm run screens
 * 상태 모음(/dev/states, 가짜 데이터)은 개발 서버에만 있어서 기본 e2e(production 빌드)와 나눈다.
 * 파일 이름: <상태>-<창 closed|open>-<크기>.png. 길이 전체는 -full.png.
 *
 * 글자 200% 흉내(C26·text200): 글자 크기 토큰(--font-*)의 px 값을 두 배로 바꾸는 CSS를 넣는다. 파일 이름에 text200-sim을 붙인다.
 * 한계: 안드로이드의 실제 「글꼴 크기」 설정이 아니다(토큰이 px라 뿌리 글자 크기만 키우면 바뀌지 않아 토큰을 바꿔 흉내 냈다).
 *       체크 칸·로고·아이콘처럼 글자가 아닌 것은 그대로다. 키보드가 열린 모습(C5·C12·C26)과 뒤로 가기(C8)는 찍지 못한다(실기기).
 */

const OUT = "test-results/screens";
const SIZES = {
  "360x640": { width: 360, height: 640, text200: false },
  "360x800": { width: 360, height: 800, text200: false },
  "320x640": { width: 320, height: 640, text200: false },
  "text200-sim": { width: 360, height: 800, text200: true },
} as const;
type SizeTag = keyof typeof SIZES;
type Sheet = "closed" | "open";

const TEXT200_CSS = `:root{
  --font-name: 700 64px/80px var(--font-family);
  --font-title: 700 48px/64px var(--font-family);
  --font-body: 400 32px/48px var(--font-family);
  --font-sub: 400 28px/40px var(--font-family);
  --font-google: 500 28px/40px var(--font-family);
}`;

/** 출처 표(lib/design-tokens.ts)의 hex를 브라우저 계산값 모양 `rgb(r, g, b)`로 */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
/** 고른 칩 면이 칠해져야 하는 색 = 주색 토큰의 출처 값. 디자인 값이 오면 출처 표만 바꾸면 된다 */
const PRIMARY_RGB = hexToRgb(COLOR_TOKENS["--color-primary"]);

/** 12-6 C26의 「창 높이가 보이는 화면의 3분의 2(임시)」. components/todo-view.tsx SHEET_REVIEW_MAX_RATIO와 같은 값 */
const SHEET_REVIEW_MAX_RATIO = 2 / 3;

const LOGIN_IDS = ["L1", "L2", "L3", "L4", "L5"];

/** 상태마다 찍을 창 모습과 크기. 창과 상관없는 상태(목록 쪽)는 닫힘·열림 둘 다 */
const BOTH: Sheet[] = ["closed", "open"];
const OPEN: Sheet[] = ["open"];
const CLOSED: Sheet[] = ["closed"];
const BASE_SIZES: SizeTag[] = ["360x640", "360x800"];
const C_STATES: { id: string; sheets: Sheet[]; sizes?: SizeTag[] }[] = [
  { id: "C1", sheets: BOTH },
  { id: "C1-12", sheets: BOTH },
  { id: "C2", sheets: BOTH },
  { id: "C3", sheets: BOTH },
  { id: "C4", sheets: BOTH },
  { id: "C5", sheets: OPEN },
  { id: "C6", sheets: OPEN },
  { id: "C7", sheets: OPEN },
  { id: "C8", sheets: CLOSED },
  { id: "C9", sheets: OPEN },
  { id: "C10", sheets: OPEN },
  { id: "C10-offline", sheets: OPEN },
  { id: "C11", sheets: OPEN },
  { id: "C12", sheets: OPEN },
  { id: "C13", sheets: OPEN },
  { id: "C14", sheets: OPEN },
  { id: "C15", sheets: OPEN },
  { id: "C16", sheets: OPEN },
  { id: "C16-count", sheets: OPEN },
  { id: "C17", sheets: OPEN },
  { id: "C18", sheets: OPEN },
  { id: "C19", sheets: OPEN },
  { id: "C19a", sheets: OPEN },
  { id: "C20", sheets: OPEN },
  { id: "C20-server", sheets: OPEN },
  { id: "C21", sheets: OPEN },
  { id: "C21-category", sheets: OPEN },
  { id: "C22", sheets: BOTH },
  { id: "C23", sheets: OPEN },
  { id: "C24", sheets: OPEN },
  { id: "C25", sheets: BOTH, sizes: ["360x640", "360x800", "320x640"] },
  { id: "C26", sheets: OPEN, sizes: ["360x640", "360x800", "text200-sim"] },
  // 5절 T 상태를 C로 읽은 것
  { id: "T5", sheets: OPEN },
  { id: "T6", sheets: OPEN },
  { id: "T7", sheets: CLOSED },
  { id: "T8", sheets: CLOSED },
  { id: "T11", sheets: OPEN, sizes: ["360x640", "360x800", "320x640"] },
  { id: "T13", sheets: OPEN },
  { id: "T13b-keep-rows", sheets: CLOSED },
  { id: "T13c-first-load", sheets: CLOSED },
  { id: "T15", sheets: OPEN },
  { id: "T16", sheets: CLOSED },
  { id: "T16b", sheets: CLOSED },
];

const measurements: Record<string, unknown> = {};

async function open(page: Page, url: string, size: SizeTag) {
  const s = SIZES[size];
  await page.setViewportSize({ width: s.width, height: s.height });
  await page.goto(url);
  if (s.text200) await page.addStyleTag({ content: TEXT200_CSS });
  await page.waitForLoadState("networkidle");
}

/**
 * name.png: 화면 크기 그대로(단추·창은 아래에 붙은 채). name-full.png: 길이 전체. 전체 캡처에서는 떠 있는 단추·창이 중간에 끼므로
 * 고정을 풀어 한 번에 보이게 한다.
 */
async function shot(page: Page, name: string, fullPage = true) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  if (!fullPage) return;
  const tag = await page.addStyleTag({ content: ".todo-sheet,.add-todo-btn{position:static!important}" });
  await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
  await tag.evaluate((el) => (el as Element).remove());
}

async function scrollSizes(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }));
}

/** 가리는 것(창이 열렸으면 창, 닫혔으면 단추)의 위 끝 */
async function obstacleTop(page: Page): Promise<number> {
  const sheet = page.locator(".todo-sheet");
  if ((await sheet.count()) > 0) return (await sheet.boundingBox())!.y;
  return (await page.locator(".add-todo-btn").boundingBox())!.y;
}

test.afterAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/measurements.json`, JSON.stringify(measurements, null, 2));
});

// ---- 로그인 L1~L5 (4절 그대로) ----
for (const id of LOGIN_IDS) {
  for (const size of ["360x800", "320x640", "text200-sim"] as SizeTag[]) {
    test(`${id} ${size}`, async ({ page }) => {
      await open(page, `/dev/states?s=${id}`, size);
      await shot(page, `${id}-${size}`);
      const sw = await scrollSizes(page);
      expect(sw.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(sw.clientWidth);
      const btn = page.locator(".google-btn");
      const box = (await btn.boundingBox())!;
      measurements[`${id}-${size}-google-button`] = box;
      expect(box.height).toBeGreaterThanOrEqual(48);
      if (size === "360x800") expect(Math.round(SIZES[size].height - (box.y + box.height))).toBe(32);
      if (size === "320x640" && id === "L1") {
        expect(await btn.locator("span").evaluate((el) => el.getClientRects().length), "단추 글이 한 줄").toBe(1);
      }
      if (id === "L1" && size === "360x800") {
        const style = await btn.evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            background: s.backgroundColor,
            border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
            color: s.color,
            paddingLeft: s.paddingLeft,
            paddingRight: s.paddingRight,
            gap: s.columnGap,
            minHeight: s.minHeight,
          };
        });
        expect(style).toEqual({
          background: "rgb(255, 255, 255)",
          border: "1px solid rgb(116, 119, 117)",
          color: "rgb(31, 31, 31)",
          paddingLeft: "12px",
          paddingRight: "12px",
          gap: "10px",
          minHeight: "48px",
        });
        const logo = await page.locator(".google-btn img").evaluate((img: HTMLImageElement) => ({
          w: img.getBoundingClientRect().width,
          h: img.getBoundingClientRect().height,
          loaded: img.complete && img.naturalWidth > 0,
        }));
        expect(logo).toEqual({ w: 20, h: 20, loaded: true });
      }
      if (id === "L2") await expect(btn).toHaveAttribute("aria-busy", "true");
      if (id === "L3") await expect(page.locator(".notice[role=alert]")).toHaveText(/로그인하지 못했어요/);
      if (id === "L4") await expect(page.getByRole("status").filter({ hasText: "로그인을 마치지 않았어요" })).toBeVisible();
    });
  }
}

// ---- 할 일 화면 C1~C26(+ T 상태) ----
for (const state of C_STATES) {
  for (const sheet of state.sheets) {
    for (const size of state.sizes ?? BASE_SIZES) {
      const name = `${state.id}-${sheet}-${size}`;
      test(name, async ({ page }) => {
        await open(page, `/dev/states?s=${state.id}&sheet=${sheet}`, size);
        await shot(page, name);
        const vw = SIZES[size].width;
        const vh = SIZES[size].height;

        // 가로 스크롤 없음(C24·C25, 1.4.10)
        const sw = await scrollSizes(page);
        measurements[`${name}-scroll`] = sw;
        expect(sw.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(sw.clientWidth);
        expect(sw.scrollWidth).toBeLessThanOrEqual(sw.innerWidth);

        // 누를 곳 48 이상. 칩은 보이는 32가 아니라 누름 영역(button)을 잰다(C6, D-125 ⑤)
        const small = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>("button, input.input, .check-hit")) {
            const r = el.getBoundingClientRect();
            if (r.height < 47.5) out.push(`${el.className || el.tagName}:h${r.height}`);
            // 칩과 체크 칸 누름 영역(.check-hit)은 폭도 48 이상(옛 T3, C6)
            if ((el.classList.contains("chip") || el.classList.contains("check-hit")) && r.width < 47.5) {
              out.push(`${el.className}:w${r.width}`);
            }
          }
          return out;
        });
        expect(small, "누를 곳 48 이상").toEqual([]);

        if (sheet === "closed") {
          // C1·C25: 단추 높이 56 이상·폭 48 이상, 화면 안, 접근 이름 = 보이는 글
          const btn = page.locator(".add-todo-btn");
          const box = (await btn.boundingBox())!;
          measurements[`${name}-add-button`] = box;
          expect(box.height).toBeGreaterThanOrEqual(56);
          expect(box.width).toBeGreaterThanOrEqual(48);
          expect(box.x + box.width).toBeLessThanOrEqual(vw);
          expect(box.y + box.height).toBeLessThanOrEqual(vh);
          expect(vw - (box.x + box.width)).toBeCloseTo(16, 0);
          await expect(page.getByRole("button", { name: (await btn.innerText()).trim(), exact: true })).toBeVisible();
          await expect(page.locator(".todo-sheet")).toHaveCount(0);
        } else {
          const sheetBox = (await page.locator(".todo-sheet").boundingBox())!;
          measurements[`${name}-sheet`] = { ...sheetBox, ratio: sheetBox.height / vh };
          expect(Math.round(sheetBox.y + sheetBox.height), "창의 아래 끝 = 화면 아래 끝").toBe(vh);
          await expect(page.locator(".add-todo-btn")).toHaveCount(0);
          await expect(page.getByRole("form", { name: "할 일 적기" })).toBeVisible();
        }

        if (state.id === "C1-12" || state.id === "C7") {
          // C1: 단추가 마지막 할 일을 가리지 않는다 / C7: 새 줄이 창 위에 보인다(할 일 12개 + 하나)
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const last = page.locator("li.todo-row").last();
          const lastBox = (await last.boundingBox())!;
          const top = await obstacleTop(page);
          measurements[`${name}-last-row-vs-obstacle`] = { rowBottom: lastBox.y + lastBox.height, obstacleTop: top };
          expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(top + 0.5);
          await shot(page, `${name}-scrolled-bottom`, false);
        }
        if (state.id === "C2") {
          await expect(page.locator(".todo-main")).toHaveAttribute("aria-busy", "true");
          await expect(page.locator(".todo-skeleton")).toHaveAttribute("aria-hidden", "true");
          if (sheet === "open") await expect(page.getByText("분야를 불러오는 중")).toBeVisible();
        }
        if (state.id === "C3") {
          await expect(page.getByText("0개 중 0개 끝냄", { exact: false })).toBeVisible();
          await expect(page.getByText(sheet === "open" ? "아래 칸에 적어 보세요." : "아래 단추를 눌러 적어 보세요.")).toBeVisible();
        }
        if (state.id === "C4") {
          await expect(page.locator(".notice[role=alert]")).toHaveText(/할 일을 불러오지 못했어요/);
          if (sheet === "open") await expect(page.getByRole("button", { name: "+ 분야" })).toHaveCount(0);
        }
        if (state.id === "C6" || state.id === "C24" || state.id === "C23") {
          // C6: 칩 누름 영역 48×48 이상, aria-pressed = 보이는 상태(체크 그림·주색 면)
          const chips = await page.locator(".chip").evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              const face = el.querySelector(".chip-face")!.getBoundingClientRect();
              return {
                label: el.textContent,
                w: r.width,
                h: r.height,
                faceH: face.height,
                pressed: el.getAttribute("aria-pressed"),
                check: el.querySelector(".chip-check") !== null,
                bg: getComputedStyle(el.querySelector(".chip-face")!).backgroundColor,
              };
            }),
          );
          measurements[`${name}-chips`] = chips;
          // 브라우저가 푼 --color-primary가 출처 표의 값과 같다(globals.css가 표에서 벗어나지 않았다)
          const tokenRgb = await page.evaluate(() => {
            const probe = document.createElement("i");
            probe.style.background = "var(--color-primary)";
            document.body.appendChild(probe);
            const value = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return value;
          });
          expect(tokenRgb, "--color-primary 계산값").toBe(PRIMARY_RGB);
          for (const c of chips) {
            expect(c.w, `${c.label} 폭`).toBeGreaterThanOrEqual(48);
            expect(c.h, `${c.label} 높이`).toBeGreaterThanOrEqual(48);
            expect(c.faceH, `${c.label} 보이는 면 높이`).toBeGreaterThanOrEqual(32);
            if (c.pressed !== null) {
              expect(c.pressed === "true").toBe(c.check);
              expect(c.bg === PRIMARY_RGB).toBe(c.pressed === "true"); // 고름 = 주색 토큰의 값으로 칠한 면
            }
          }
        }
        if (state.id === "C11") {
          await expect(page.locator(".chip")).toHaveCount(1);
          await expect(page.getByRole("button", { name: "+ 분야" })).toBeVisible();
        }
        if (state.id === "C13") {
          await expect(page.getByRole("button", { name: "더하는 중" })).toHaveAttribute("aria-busy", "true");
        }
        if (state.id === "C23") {
          // 칩은 한 줄 말줄임(CSS), 목록 분야 표시는 잘리지 않는다
          const chipLabel = await page.locator(".chip[aria-pressed=true] .chip-label").evaluate((el) => ({
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            overflow: getComputedStyle(el).textOverflow,
            lines: el.getClientRects().length,
          }));
          const tag = await page.locator(".category-tag").first().evaluate((el) => ({
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            wrap: getComputedStyle(el).overflowWrap,
          }));
          const row = await page.locator(".chip-row").evaluate((el) => el.clientWidth);
          const longChip = (await page.locator(".chip[aria-pressed=true]").boundingBox())!;
          measurements[`${name}-long-name`] = { chipLabel, tag, rowClientWidth: row, chipWidth: longChip.width };
          expect(chipLabel.overflow).toBe("ellipsis");
          expect(chipLabel.lines).toBe(1);
          expect(longChip.width).toBeLessThanOrEqual(row + 20 - 32 + 0.5); // 칩 최대 폭 = 보이는 폭 − 32(임시)
          expect(tag.scrollWidth).toBeLessThanOrEqual(tag.clientWidth + 1);
          expect(tag.wrap).toBe("anywhere");
        }
        if (state.id === "C24") {
          const row = await page.locator(".chip-row").evaluate((el) => {
            const s = getComputedStyle(el);
            return { overflowX: s.overflowX, overscrollX: s.overscrollBehaviorX, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
          });
          measurements[`${name}-chip-row`] = row;
          expect(row.overflowX).toBe("auto");
          expect(row.overscrollX).toBe("contain");
          expect(row.scrollWidth).toBeGreaterThan(row.clientWidth); // 칩 줄만 밀린다
          await expect(page.locator(".chip")).toHaveCount(11); // 분야 10개 + 「+ 분야」
          // 끝까지 밀면 「+ 분야」가 칩 줄 안에 다 들어온다(오른쪽 16px 여백)
          await page.locator(".chip-row").evaluate((el) => (el.scrollLeft = el.scrollWidth));
          const rowBox = (await page.locator(".chip-row").boundingBox())!;
          const addBox = (await page.locator("#add-category-chip").boundingBox())!;
          expect(addBox.x + addBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width - 15.5);
          await shot(page, `${name}-scrolled-end`, false);
        }
        if (state.id === "C26" || size === "text200-sim") {
          // C26: 창이 보이는 화면보다 높으면 창 안이 스크롤된다. 3분의 2(임시)를 넘는지는 기록만 한다(디자인 검토)
          const sheetBox = await page.locator(".todo-sheet").evaluate((el) => ({
            height: el.getBoundingClientRect().height,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            overflowY: getComputedStyle(el).overflowY,
          }));
          measurements[`${name}-sheet-vs-viewport`] = {
            ...sheetBox,
            viewport: vh,
            ratio: sheetBox.height / vh,
            overReviewRatio: sheetBox.height / vh > SHEET_REVIEW_MAX_RATIO,
          };
          expect(sheetBox.height).toBeLessThanOrEqual(vh + 0.5);
          expect(sheetBox.overflowY).toBe("auto");
        }
        if (state.id === "C22") {
          const style = await page.locator(".todo-text").first().evaluate((el) => {
            const s = getComputedStyle(el);
            return {
              overflowWrap: s.overflowWrap,
              textOverflow: s.textOverflow,
              lineClamp: s.getPropertyValue("-webkit-line-clamp") || "none",
            };
          });
          measurements[`${name}-text-style`] = style;
          expect(style.overflowWrap).toBe("anywhere");
          expect(style.textOverflow).toBe("clip");
          expect(["none", "normal"]).toContain(style.lineClamp); // 옛 T4: 줄 수로 자르지 않는다
          // 체크 칸은 첫 줄 옆, 분야 표시는 글 아래
          const checkTop = (await page.locator(".check-hit").first().boundingBox())!.y;
          const textBox = (await page.locator(".todo-text").first().boundingBox())!;
          const tagBox = (await page.locator(".category-tag").first().boundingBox())!;
          expect(Math.abs(checkTop + 12 - textBox.y)).toBeLessThanOrEqual(2);
          expect(tagBox.y).toBeGreaterThanOrEqual(textBox.y + textBox.height - 0.5);
        }
        if (state.id === "T6") {
          // 새 줄이 창에 가려지지 않는지: scrollIntoView(nearest) 뒤 줄 아래 끝이 창 위 끝보다 위
          await page.locator("#row-m12").evaluate((el) => el.scrollIntoView({ block: "nearest" }));
          const rowBox = (await page.locator("#row-m12").boundingBox())!;
          const top = await obstacleTop(page);
          measurements[`${name}-row-vs-sheet`] = { rowBottom: rowBox.y + rowBox.height, sheetTop: top };
          expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(top + 0.5);
          await shot(page, `${name}-scrolled`, false);
        }
        if (state.id === "T11") {
          await expect(page.getByText("200자까지 적을 수 있어요. 지금 230자예요.")).toBeVisible();
          await expect(page.locator("#todo-input")).toHaveAttribute("aria-describedby", "todo-help");
          expect(await page.locator("#todo-input").getAttribute("maxlength")).toBeNull();
          if (size === "320x640") expect((await page.locator("#todo-input").boundingBox())!.width).toBeGreaterThanOrEqual(216);
        }
        if (state.id === "T7") {
          await expect(page.getByRole("checkbox", { name: "저장하지 못한 할 일" })).toHaveAttribute("aria-disabled", "true");
        }
        if (state.id === "T13" || state.id === "C19a") {
          await expect(page.locator(".notice[role=alert]")).toContainText("로그인이 풀렸어요");
        }
        if (state.id === "T13b-keep-rows") {
          await expect(page.locator(".notice[role=alert]")).toContainText("로그인이 풀렸어요");
          await expect(page.getByText(/3개 중 1개 끝냄/)).toBeVisible();
          await expect(page.locator(".todo-row")).toHaveCount(3);
        }
        if (state.id === "T13c-first-load") {
          await expect(page.locator(".notice[role=alert]")).toContainText("로그인이 풀렸어요");
          await expect(page.getByText("오늘 적은 할 일이 없어요.")).toHaveCount(0);
          await expect(page.getByText(/개 중 \d개 끝냄/)).toHaveCount(0);
        }
        if (state.id === "T16" || state.id === "T16b") {
          await expect(page.locator(".notice[role=alert]")).toContainText("아직 저장되지 않은 글이 있어요");
        }
      });
    }
  }
}

// ---- C-D11 포커스가 가려지지 않는다(WCAG 2.4.11): 할 일 12개, 창 닫힘·열림에서 Tab으로 마지막 체크 칸 ----
for (const sheet of BOTH) {
  for (const size of BASE_SIZES) {
    test(`CD11 포커스 ${sheet} ${size}: Tab으로 간 마지막 체크 칸이 단추·창 위에 보인다`, async ({ page }) => {
      await open(page, `/dev/states?s=CD11&sheet=${sheet}`, size);
      await page.locator("#row-m11 input[type=checkbox]").focus();
      await page.keyboard.press("Tab"); // 키보드로 옮긴다(브라우저가 scroll-padding-bottom을 지켜 스크롤한다)
      await expect(page.locator("#row-m12 input[type=checkbox]")).toBeFocused();
      const hit = (await page.locator("#row-m12 .check-hit").boundingBox())!;
      const top = await obstacleTop(page);
      const padding = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom);
      measurements[`CD11-${sheet}-${size}`] = { checkBottom: hit.y + hit.height, obstacleTop: top, scrollPaddingBottom: padding };
      // 체크 칸(48)과 포커스 고리(체크 모양 바깥 2+2px, 칸 안쪽)가 모두 가리는 것의 위에 있다
      expect(hit.y + hit.height).toBeLessThanOrEqual(top + 0.5);
      expect(hit.y).toBeGreaterThanOrEqual(0);
      await shot(page, `CD11-focus-${sheet}-${size}`, false);
    });
  }
}

test("T16b 다음 장면: 실패 줄을 뺀 뒤 포커스가 위 줄 체크 칸에 있다 (정적 장면, 포커스는 시험이 준다)", async ({ page }) => {
  // 실제 포커스 이동은 단위 시험(todo-screen.test.tsx)이 확인한다. 여기서는 그 결과 장면이 어떻게 보이는지만 찍는다.
  await open(page, "/dev/states?s=T16b-after-remove", "360x800");
  await page.getByRole("checkbox", { name: "면접 질문 다섯 개 뽑아 보기" }).focus();
  await expect(page.locator(".notice[role=alert]")).toHaveCount(0);
  await shot(page, "T16b-next-scene-focus-closed-360x800", false);
});

test("C5·T5 적는 중: 할 일 칸 포커스 (키보드 없음 — 키보드가 열린 모습은 미검증(실기기))", async ({ page }) => {
  await open(page, "/dev/states?s=T5", "360x640");
  await page.locator("#todo-input").focus();
  await expect(page.getByRole("textbox", { name: "할 일 적기" })).toBeFocused();
  await shot(page, "C5-focus-nokeyboard-open-360x640", false);
});

test("C24 칩에 키보드 포커스가 가면 그 칩이 보이게 칩 줄이 밀린다", async ({ page }) => {
  await open(page, "/dev/states?s=C24", "360x640");
  const last = page.locator(".chip").nth(9); // 분야 열째(오른쪽 밖)
  await last.focus();
  const rowBox = (await page.locator(".chip-row").boundingBox())!;
  const chipBox = (await last.boundingBox())!;
  measurements["C24-focus-scroll"] = { rowBox, chipBox };
  expect(chipBox.x).toBeGreaterThanOrEqual(rowBox.x - 0.5);
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
  await shot(page, "C24-focus-last-chip-open-360x640", false);
});

// ---- 오프라인 화면 O1~O4 (public/offline.html, 6절 그대로) ----
for (const size of ["360x800", "320x640", "text200-sim"] as SizeTag[]) {
  test(`O ${size}`, async ({ page }) => {
    await open(page, "/offline.html", size);
    await shot(page, `O1-${size}`);
    const sw = await scrollSizes(page);
    expect(sw.scrollWidth).toBeLessThanOrEqual(sw.clientWidth);
    if (size === "320x640") expect(sw.scrollWidth).toBeLessThanOrEqual(320);
    await expect(page.getByRole("status")).toContainText("인터넷에 연결되지 않았어요.");
    await expect(page.getByRole("status")).toContainText("연결되면 할 일을 불러올게요.");
    const button = page.getByRole("button", { name: "다시 연결해 보기" });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await page.route("**/sw.js", () => new Promise(() => {}));
    await button.click();
    await expect(page.getByRole("button", { name: "연결해 보는 중" })).toHaveAttribute("aria-busy", "true");
    await shot(page, `O2-${size}`);
  });
}

test("O1 눌렀는데 아직 오프라인이면 문구가 남고 화면이 깨지지 않는다", async ({ page }) => {
  await open(page, "/offline.html", "360x800");
  await page.route("**/sw.js", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "다시 연결해 보기" }).click();
  await expect(page.getByRole("button", { name: "다시 연결해 보기" })).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("인터넷에 연결되지 않았어요.")).toBeVisible();
});
