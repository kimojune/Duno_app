import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * 상태별 스크린샷과 치수 확인. 개발 서버(next dev, 3200 포트)에서만 돈다: npm run screens
 * 상태 모음(/dev/states)은 개발 서버에만 있어서 기본 e2e(production 빌드)와 나눈다.
 *
 * 글자 200% 흉내: 글자 크기 토큰(--font-*)의 px 값을 두 배로 바꾸는 CSS를 넣는다. 높이는 min-height뿐이라 줄이 늘어난다.
 * 한계: 안드로이드의 실제 「글꼴 크기」 설정이 아니다(글꼴 확대 방식·줄 간격·최소 크기 보정은 기기마다 다르다).
 *       체크 칸·로고·아이콘처럼 글자가 아닌 것은 그대로다. 브라우저 확대(zoom)가 아니라 글자만 키운 것이다.
 */

const OUT = "test-results/screens";
const SIZES = [
  { tag: "360x800", width: 360, height: 800, text200: false },
  { tag: "320x640", width: 320, height: 640, text200: false },
  { tag: "text200", width: 360, height: 800, text200: true },
] as const;
type Size = (typeof SIZES)[number];

const TEXT200_CSS = `:root{
  --font-name: 700 64px/80px var(--font-family);
  --font-title: 700 48px/64px var(--font-family);
  --font-body: 400 32px/48px var(--font-family);
  --font-sub: 400 28px/40px var(--font-family);
  --font-google: 500 28px/40px var(--font-family);
}`;

const LOGIN_IDS = ["L1", "L2", "L3", "L4", "L5"];
const TODO_IDS = ["T1", "T2", "T3", "T4", "T6", "T7", "T8", "T9", "T10", "T11", "T13", "T13b-keep-rows", "T13c-first-load", "T15", "T16", "T16b", "T16b-after-remove"];

const measurements: Record<string, unknown> = {};

async function open(page: Page, url: string, size: Size) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(url);
  if (size.text200) await page.addStyleTag({ content: TEXT200_CSS });
  await page.waitForLoadState("networkidle");
}

/**
 * name.png: 화면 크기 그대로(입력 줄은 아래에 붙은 채). name-full.png: 길이 전체. 전체 캡처에서는 붙어 있는 줄이 중간에 끼므로
 * 입력 줄·머리의 sticky를 풀어 한 번에 보이게 한다.
 */
async function shot(page: Page, name: string, fullPage = true) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  if (!fullPage) return;
  const tag = await page.addStyleTag({ content: ".input-bar,.sticky-top{position:static!important}" });
  await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
  await tag.evaluate((el) => (el as Element).remove());
}

async function scrollSizes(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test.afterAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/measurements.json`, JSON.stringify(measurements, null, 2));
});

for (const id of [...LOGIN_IDS, ...TODO_IDS]) {
  for (const size of SIZES) {
    test(`${id} ${size.tag}`, async ({ page }) => {
      await open(page, `/dev/states?s=${id}`, size);
      await shot(page, `${id}-${size.tag}`);
      const sw = await scrollSizes(page);
      measurements[`${id}-${size.tag}-scroll`] = sw;
      expect(sw.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(sw.clientWidth);

      if (LOGIN_IDS.includes(id)) {
        const btn = page.locator(".google-btn");
        const box = (await btn.boundingBox())!;
        measurements[`${id}-${size.tag}-google-button`] = box;
        expect(box.height).toBeGreaterThanOrEqual(48);
        if (size.tag === "360x800") {
          // L1: 단추 아래 끝이 화면 아래에서 32px
          expect(Math.round(size.height - (box.y + box.height))).toBe(32);
        }
        if (size.tag === "320x640" && id === "L1") {
          const lines = await btn.locator("span").evaluate((el) => el.getClientRects().length);
          expect(lines, "단추 글이 한 줄").toBe(1);
        }
        if (id === "L1" && size.tag === "360x800") {
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
          measurements["L1-google-button-style"] = style;
          expect(style).toEqual({
            background: "rgb(255, 255, 255)",
            border: "1px solid rgb(116, 119, 117)",
            color: "rgb(31, 31, 31)",
            paddingLeft: "12px",
            paddingRight: "12px",
            gap: "10px",
            minHeight: "48px",
          });
          // 로고는 20x20 그대로이고 이미지가 실제로 그려진다
          const logo = await page.locator(".google-btn img").evaluate((img: HTMLImageElement) => ({
            w: img.getBoundingClientRect().width,
            h: img.getBoundingClientRect().height,
            loaded: img.complete && img.naturalWidth > 0,
          }));
          expect(logo).toEqual({ w: 20, h: 20, loaded: true });
        }
        if (id === "L2") await expect(btn).toHaveAttribute("aria-busy", "true");
        if (id === "L3") await expect(page.locator(".notice[role=alert]")).toHaveText(/로그인하지 못했어요/);
        if (id === "L4") {
          await expect(page.getByRole("status").filter({ hasText: "로그인을 마치지 않았어요" })).toBeVisible();
        }
      } else {
        // 단추·입력·체크 칸 터치 영역 48 이상
        const small = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>("button, input.input, .check-hit")) {
            const r = el.getBoundingClientRect();
            if (r.height < 47.5) out.push(`${el.className || el.tagName}:${r.height}`);
          }
          return out;
        });
        expect(small, "누를 곳 높이 48 이상").toEqual([]);

        if (id === "T3") {
          const hits = await page.locator(".check-hit").evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return { w: r.width, h: r.height };
            }),
          );
          measurements[`T3-${size.tag}-check-hit`] = hits;
          for (const h of hits) {
            expect(h.w).toBeGreaterThanOrEqual(48);
            expect(h.h).toBeGreaterThanOrEqual(48);
          }
          await expect(page.getByRole("checkbox", { name: "이력서 파일 이름 바꾸기" })).not.toBeChecked();
          await expect(page.getByRole("checkbox", { name: "자기소개서 첫 문단 쓰기" })).toBeChecked();
        }
        if (id === "T4") {
          const style = await page.locator(".todo-text").first().evaluate((el) => {
            const s = getComputedStyle(el);
            return {
              overflowWrap: s.overflowWrap,
              textOverflow: s.textOverflow,
              lineClamp: s.getPropertyValue("-webkit-line-clamp") || "none",
            };
          });
          measurements["T4-text-style"] = style;
          expect(style.overflowWrap).toBe("anywhere");
          expect(style.textOverflow).toBe("clip");
          expect(["none", "normal"]).toContain(style.lineClamp);
          // 체크 칸은 첫 줄 옆: 칸 안 체크 상자(칸 위에서 12px)가 글 첫 줄과 같은 높이에서 시작한다
          const checkTop = (await page.locator(".check-hit").first().boundingBox())!.y;
          const textTop = (await page.locator(".todo-text").first().boundingBox())!.y;
          expect(Math.abs(checkTop + 12 - textTop)).toBeLessThanOrEqual(2);
        }
        if (id === "T1") {
          await expect(page.locator(".todo-main")).toHaveAttribute("aria-busy", "true");
          await expect(page.locator(".todo-skeleton")).toHaveAttribute("aria-hidden", "true");
        }
        if (id === "T2") await expect(page.getByText("0개 중 0개 끝냄")).toBeVisible();
        if (id === "T11") {
          await expect(page.getByText("200자까지 적을 수 있어요. 지금 230자예요.")).toBeVisible();
          await expect(page.locator("#todo-input")).toHaveAttribute("aria-describedby", "todo-help");
          expect(await page.locator("#todo-input").getAttribute("maxlength")).toBeNull();
          if (size.tag === "320x640") {
            expect((await page.locator("#todo-input").boundingBox())!.width).toBeGreaterThanOrEqual(216);
          }
        }
        if (id === "T6" && !size.text200) {
          // 새 줄이 입력 줄에 가려지지 않는지: scrollIntoView(nearest) 뒤 줄 아래 끝이 입력 줄 위 끝보다 위
          await page.locator("#row-m12").evaluate((el) => el.scrollIntoView({ block: "nearest" }));
          const rowBox = (await page.locator("#row-m12").boundingBox())!;
          const barBox = (await page.locator(".input-bar").boundingBox())!;
          measurements[`T6-${size.tag}-row-vs-bar`] = { rowBottom: rowBox.y + rowBox.height, barTop: barBox.y };
          expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(barBox.y + 0.5);
          await shot(page, `T6-${size.tag}-scrolled`, false);
        }
        if (id === "T9") await expect(page.locator(".notice[role=alert]")).toHaveText(/할 일을 불러오지 못했어요/);
        if (id === "T13") await expect(page.locator(".notice[role=alert]")).toContainText("로그인이 풀렸어요");
        if (id === "T13b-keep-rows") {
          await expect(page.locator(".notice[role=alert]")).toContainText("로그인이 풀렸어요");
          await expect(page.getByText(/3개 중 1개 끝냄/)).toBeVisible(); // 줄 3개, 개수 그대로
          await expect(page.locator(".todo-row")).toHaveCount(3);
        }
        if (id === "T13c-first-load") {
          await expect(page.locator(".notice[role=alert]")).toContainText("로그인이 풀렸어요");
          await expect(page.getByText("오늘 적은 할 일이 없어요.")).toHaveCount(0);
          await expect(page.getByText(/개 중 \d개 끝냄/)).toHaveCount(0);
        }
        if (id === "T16b") {
          await expect(page.locator(".notice[role=alert]")).toContainText("아직 저장되지 않은 글이 있어요");
        }
        if (id === "T7") {
          const disabled = page.getByRole("checkbox", { name: "저장하지 못한 할 일" });
          await expect(disabled).toHaveAttribute("aria-disabled", "true");
        }
        if (id === "T16") await expect(page.locator(".notice[role=alert]")).toContainText("아직 저장되지 않은 글이 있어요");
        if (size.text200) {
          const barBox = (await page.locator(".input-bar").boundingBox())!;
          measurements[`${id}-text200-bar-height`] = barBox.height;
        }
      }
    });
  }
}

test("T16b 다음 장면: 실패 줄을 뺀 뒤 포커스가 위 줄 체크 칸에 있다 (정적 장면, 포커스는 시험이 준다)", async ({ page }) => {
  // 실제 포커스 이동은 단위 시험(todo-screen.test.tsx)이 확인한다. 여기서는 그 결과 장면이 어떻게 보이는지만 찍는다.
  await open(page, "/dev/states?s=T16b-after-remove", SIZES[0]);
  await page.getByRole("checkbox", { name: "면접 질문 다섯 개 뽑아 보기" }).focus();
  await expect(page.getByRole("checkbox", { name: "면접 질문 다섯 개 뽑아 보기" })).toBeFocused();
  await expect(page.locator(".notice[role=alert]")).toHaveCount(0);
  await shot(page, "T16b-next-scene-focus-360x800", false);
});

test("T5 적는 중: 입력 칸 포커스 (키보드 없음 — 키보드가 열린 모습은 미검증)", async ({ page }) => {
  await open(page, "/dev/states?s=T5", SIZES[0]);
  await page.locator("#todo-input").focus();
  await expect(page.getByLabel("할 일 적기")).toBeFocused();
  await shot(page, "T5-focus-nokeyboard-360x800", false);
});

test("T14 글자 200%에서 입력 줄 높이가 화면 높이의 절반을 넘지 않는다", async ({ page }) => {
  await open(page, "/dev/states?s=T11", SIZES[2]); // 도움말까지 보이는 가장 큰 입력 줄
  const barBox = (await page.locator(".input-bar").boundingBox())!;
  measurements["T14-T11-bar-height-vs-half"] = { bar: barBox.height, half: 400 };
  expect(barBox.height).toBeLessThanOrEqual(400);
});

test("B 대표 화면 (할 일, 로그인) 360x800", async ({ page }) => {
  await open(page, "/dev/states?s=T3&d=B", SIZES[0]);
  await shot(page, "B-todo-360x800");
  // B는 새것이 위: 목록을 거꾸로 그린다
  const names = await page.locator(".todo-text").allInnerTexts();
  expect(names[0]).toBe("면접 질문 다섯 개 뽑아 보기");
  await open(page, "/dev/states?s=L1&d=B", SIZES[0]);
  await shot(page, "B-login-360x800");
});

// ---- 오프라인 화면 O1~O4 (public/offline.html) ----
for (const size of SIZES) {
  test(`O ${size.tag}`, async ({ page }) => {
    await open(page, "/offline.html", size);
    await shot(page, `O1-${size.tag}`);
    const sw = await scrollSizes(page);
    expect(sw.scrollWidth).toBeLessThanOrEqual(sw.clientWidth);
    if (size.tag === "320x640") expect(sw.scrollWidth).toBeLessThanOrEqual(320);
    await expect(page.getByRole("status")).toContainText("인터넷에 연결되지 않았어요.");
    await expect(page.getByRole("status")).toContainText("연결되면 할 일을 불러올게요.");
    const button = page.getByRole("button", { name: "다시 연결해 보기" });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);

    // O2: 연결해 보는 중 — 요청을 붙잡아 두고 누른다
    await page.route("**/sw.js", () => new Promise(() => {}));
    await button.click();
    await expect(page.getByRole("button", { name: "연결해 보는 중" })).toHaveAttribute("aria-busy", "true");
    await shot(page, `O2-${size.tag}`);
  });
}

test("O1 눌렀는데 아직 오프라인이면 문구가 남고 화면이 깨지지 않는다", async ({ page }) => {
  await open(page, "/offline.html", SIZES[0]);
  await page.route("**/sw.js", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "다시 연결해 보기" }).click();
  await expect(page.getByRole("button", { name: "다시 연결해 보기" })).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("인터넷에 연결되지 않았어요.")).toBeVisible();
});
