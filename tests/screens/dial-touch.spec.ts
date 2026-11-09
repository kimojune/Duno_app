import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { fillWheel } from "../e2e/wheel";

/**
 * 휴대폰 다이얼 끌기 끊김(보고 19절, 22 팀장 긴급): 안드로이드 Chrome에서 손잡이를 손가락으로 끌면 조금 가다 끊겼다.
 * 진짜 터치 길을 흉내 낸다 — 모바일 기기 설정(isMobile·hasTouch, 폭 360)에 CDP Input.dispatchTouchEvent(touchStart → touchMove 여럿 → touchEnd).
 * page.mouse·dispatchEvent로 포인터 이벤트를 직접 쏘면 브라우저의 스크롤 판단(touch-action)을 건너뛰어 이 버그가 보이지 않는다.
 * 보는 것: 끌기 동안 pointercancel 없음 · 손잡이 값(aria-valuenow)이 끈 만큼 바뀜 · 바깥 스크롤(다이얼을 담은 스크롤 칸) 그대로.
 * 끌기를 놓은 뒤: 손잡이가 아닌 자리(조각 위·다이얼 밖)를 쓸면 화면이 스크롤된다 · 조각을 누르면 고른다.
 * 개발 갤러리(/dev/v2)의 화면이다(컴포넌트는 앱과 같은 것). npm run screens(SCREENS_PORT·SCREENS_DIST_DIR로 포트·빌드 폴더를 바꿔 돈다)
 */

// 뷰포트 높이를 줄여 겹친 창(시트) 안이 스크롤되게 한다(스크롤이 없으면 「바깥 스크롤 그대로」·「쓸면 스크롤」을 볼 수 없다)
test.use({ viewport: { width: 360, height: 560 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

type Pt = { x: number; y: number };
const frame = (page: Page) => page.waitForTimeout(16);

async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", p?: Pt) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [] });
}
/** 한 손가락으로 점들을 차례로 지나간다 */
async function swipe(page: Page, cdp: CDPSession, points: Pt[]) {
  await touch(cdp, "touchStart", points[0]);
  await frame(page);
  for (const p of points.slice(1)) {
    await touch(cdp, "touchMove", p);
    await frame(page);
  }
  await touch(cdp, "touchEnd");
  await frame(page);
}
async function tap(page: Page, cdp: CDPSession, p: Pt) {
  await touch(cdp, "touchStart", p);
  await page.waitForTimeout(60);
  await touch(cdp, "touchEnd");
  await page.waitForTimeout(100);
}

/** 포인터 기록(창에서 capture 단계로) + 다이얼을 담은 스크롤 칸 표시. 시험마다 한 번 */
async function watch(page: Page, dialSel: string) {
  await page.evaluate((sel) => {
    const w = window as unknown as { __log: string[] };
    w.__log = [];
    for (const type of ["pointerdown", "pointercancel", "pointerup", "lostpointercapture"]) {
      window.addEventListener(type, (e) => w.__log.push(`${type}:${(e.target as Element).getAttribute?.("class") ?? "?"}`), true);
    }
    // 다이얼에서 가장 가까운 스크롤 칸(없으면 문서)
    let el: HTMLElement | null = document.querySelector<SVGSVGElement>(sel)!.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) break;
      el = el.parentElement;
    }
    const box = el && el !== document.body ? el : (document.scrollingElement as HTMLElement);
    box.setAttribute("data-dial-scroller", "1");
  }, dialSel);
}
const scrollTop = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>("[data-dial-scroller]")!.scrollTop);
const logOf = (page: Page) => page.evaluate(() => (window as unknown as { __log: string[] }).__log.splice(0));

/** 다이얼 가운데·손잡이 반지름(px) */
async function geometry(svg: Locator, handle: Locator) {
  const s = (await svg.boundingBox())!;
  const h = (await handle.boundingBox())!;
  const c = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  const k = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  return { c, k, r: Math.hypot(k.x - c.x, k.y - c.y), t0: Math.atan2(k.y - c.y, k.x - c.x) };
}
/** 손잡이를 원 둘레로 turn 바퀴(+ 시계 방향) 끈다. 한 걸음 약 4px */
function arc(g: Awaited<ReturnType<typeof geometry>>, turn: number): Pt[] {
  const steps = Math.max(8, Math.ceil((Math.abs(turn) * 2 * Math.PI * g.r) / 4));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = g.t0 + (turn * 2 * Math.PI * i) / steps;
    return { x: g.c.x + g.r * Math.cos(a), y: g.c.y + g.r * Math.sin(a) };
  });
}

/** 조각 위의 한 점(손잡이에서 40px 넘게 떨어진 곳). want = 조각 순서(.dial-slice 중), 없으면 고르지 않은 아무 조각 */
async function slicePoint(page: Page, dialSel: string, want?: number): Promise<Pt> {
  const p = await page.evaluate(
    ({ sel, want }) => {
      const svg = document.querySelector<SVGSVGElement>(sel)!;
      const b = svg.getBoundingClientRect();
      const c = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      const r = (b.width / 240) * 81; // 손잡이·조각 고리 가운데 반지름(viewBox 240 중 81)
      const slices = [...svg.querySelectorAll(".dial-slice")];
      const knobs = [...svg.querySelectorAll(".dial-handle")].map((h) => {
        const k = h.getBoundingClientRect();
        return { x: k.left + k.width / 2, y: k.top + k.height / 2 };
      });
      for (let i = 0; i < 200; i++) {
        const a = (i / 200) * 2 * Math.PI;
        const x = c.x + r * Math.cos(a);
        const y = c.y + r * Math.sin(a);
        const el = document.elementFromPoint(x, y);
        if (!el || !el.classList.contains("dial-slice")) continue;
        if (want !== undefined ? slices.indexOf(el) !== want : el.classList.contains("is-picked")) continue;
        if (knobs.some((k) => Math.hypot(k.x - x, k.y - y) < 40)) continue;
        return { x, y };
      }
      return null;
    },
    { sel: dialSel, want },
  );
  expect(p, "조각 위의 점").not.toBeNull();
  return p!;
}

/** 손잡이를 끌고 본다: pointercancel 없음 · 값이 minChange 넘게 바뀜 · 바깥 스크롤 그대로 */
async function dragHandle(page: Page, cdp: CDPSession, dialSel: string, handle: Locator, turn: number, minChange: number) {
  const svg = page.locator(dialSel);
  const before = Number(await handle.getAttribute("aria-valuenow"));
  const top0 = await scrollTop(page);
  const g = await geometry(svg, handle);
  await logOf(page);
  await swipe(page, cdp, arc(g, turn));
  const log = await logOf(page);
  const after = Number(await page.locator(`${dialSel} .dial-handle`).first().getAttribute("aria-valuenow"));
  const top1 = await scrollTop(page);
  console.log(`[dial-touch] ${dialSel} 끌기 ${turn}바퀴: 값 ${before} → ${after} · 스크롤 ${top0} → ${top1} · 포인터 ${log.join(" ")}`);
  expect(log.filter((l) => l.startsWith("pointercancel")), "끌기 동안 pointercancel 없음").toEqual([]);
  expect(Math.abs(after - before), `손잡이 값이 ${minChange} 넘게 바뀐다`).toBeGreaterThan(minChange);
  expect(top1, "끄는 동안 바깥 스크롤 그대로").toBe(top0);
}
/** 손잡이가 아닌 자리에서 세로로 쓸면 스크롤 칸이 움직인다(위로 갈 자리가 있으면 손가락을 위로, 아니면 아래로) */
async function swipeScrolls(page: Page, cdp: CDPSession, from: Pt, what: string) {
  const top0 = await scrollTop(page);
  const max = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-dial-scroller]")!;
    return el.scrollHeight - el.clientHeight;
  });
  const dir = top0 < max - 40 ? -1 : 1; // 손가락 위로(-1) = 내용이 위로 = scrollTop 커짐
  const pts = Array.from({ length: 16 }, (_, i) => ({ x: from.x, y: from.y + dir * i * 8 }));
  await logOf(page);
  await swipe(page, cdp, pts);
  await page.waitForTimeout(300); // 관성 스크롤이 끝나게
  const top1 = await scrollTop(page);
  console.log(`[dial-touch] ${what} 쓸기: 스크롤 ${top0} → ${top1} (최대 ${max})`);
  expect(Math.abs(top1 - top0), `${what}에서 손가락으로 쓸면 스크롤된다`).toBeGreaterThan(20);
}
async function center(page: Page, sel: string) {
  await page.locator(sel).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(100);
}

test("오늘 기록 「분야마다 나누기」 다이얼: 손가락 끌기가 끊기지 않고(15분 넘게) 화면이 따라 스크롤되지 않는다 · 놓은 뒤 조각·바깥은 스크롤 · 조각 탭", async ({ page }) => {
  await page.goto("/dev/v2?s=evening-split-blank");
  await page.waitForLoadState("networkidle");
  await page.locator("#dev-open-window").click();
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await fillWheel(dialog, "시간", 3);
  await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
  await expect(dialog.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
  await dialog.getByRole("button", { name: "어학, 다이얼에 넣기" }).click(); // 어학 30분 · 기타 2시간 30분, 어학을 고른 채
  const S = "svg.dial"; // 이 화면의 다이얼은 하나
  await center(page, S);
  await watch(page, S);
  const cdp = await page.context().newCDPSession(page);

  const handle = page.locator("[id^='evening-dial-handle-']").first();
  await expect(handle).toHaveAttribute("aria-valuenow", "30");
  const side = (await handle.getAttribute("id"))!.replace("evening-dial-handle-", "");
  // end는 시계 방향, start는 반시계 방향으로 끌면 고른 조각(어학)이 커진다. 0.25바퀴 = 3시간의 1/4 = 45분
  await dragHandle(page, cdp, S, handle, side === "start" ? -0.25 : 0.25, 15);

  // 놓은 뒤: 조각 위(손잡이 아님)와 다이얼 밖에서 쓸면 스크롤된다
  await swipeScrolls(page, cdp, await slicePoint(page, S), "다이얼의 조각 위");
  await center(page, S);
  const b = (await page.locator(S).boundingBox())!;
  await swipeScrolls(page, cdp, { x: Math.max(8, b.x - 24), y: b.y + b.height / 2 }, "다이얼 밖");

  // 조각을 눌러 고르기: 고르지 않은 조각(기타)을 탭하면 그 조각이 골라진다
  await center(page, S);
  const p = await slicePoint(page, S);
  const pickedBefore = await page.locator(`${S} .dial-slice.is-picked`).getAttribute("aria-label");
  await tap(page, cdp, p);
  const pickedAfter = await page.locator(`${S} .dial-slice.is-picked`).getAttribute("aria-label");
  console.log(`[dial-touch] 조각 탭: ${pickedBefore} → ${pickedAfter}`);
  expect(pickedAfter, "탭한 조각이 골라진다").not.toBe(pickedBefore);
});

test("처음 설정·내 정보 「목표 비율」 다이얼: 조각 탭으로 고르고, 손가락 끌기가 끊기지 않고(15% 넘게) 화면이 따라 스크롤되지 않는다 · 놓은 뒤 조각·바깥은 스크롤", async ({ page }) => {
  await page.goto("/dev/v2?s=me-ratio");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^목표 비율, / }).click();
  const dialog = page.getByRole("dialog", { name: "목표 비율" });
  await expect(dialog.getByRole("button", { name: "균등 배분" })).toBeVisible();
  await center(page, "svg.dial");
  await watch(page, "svg.dial");
  const cdp = await page.context().newCDPSession(page);

  // 조각을 눌러 고르기(탭): 창은 첫 분야를 고른 채 열린다 — 둘째 조각을 탭해 고른다
  await expect(page.locator("svg.dial .dial-slice").nth(0)).toHaveClass(/is-picked/);
  await tap(page, cdp, await slicePoint(page, "svg.dial", 1));
  await expect(page.locator("svg.dial .dial-slice").nth(1)).toHaveClass(/is-picked/);
  await expect(page.locator("svg.dial .dial-slice").nth(0)).not.toHaveClass(/is-picked/);
  const handle = page.locator("[id^='ratio-dial-handle-']").first();
  await expect(handle).toBeVisible();
  const side = (await handle.getAttribute("id"))!.replace("ratio-dial-handle-", "");
  // 앞 손잡이(start)는 반시계, 끝 손잡이(end)는 시계 방향으로 끌면 고른 조각이 커진다: 0.25바퀴 = 25%
  await dragHandle(page, cdp, "svg.dial", handle, side === "start" ? -0.25 : 0.25, 15);

  await swipeScrolls(page, cdp, await slicePoint(page, "svg.dial"), "다이얼의 조각 위");
  await center(page, "svg.dial");
  const b = (await page.locator("svg.dial").boundingBox())!;
  await swipeScrolls(page, cdp, { x: Math.max(8, b.x - 24), y: b.y + b.height / 2 }, "다이얼 밖");
});

test("참고: 오늘 기록 두 줄 휠도 손가락 끌기가 끊기지 않는다(pointercancel 없음 · 값이 바뀜 · 바깥 스크롤 그대로)", async ({ page }) => {
  await page.goto("/dev/v2?s=evening-split-blank");
  await page.waitForLoadState("networkidle");
  await page.locator("#dev-open-window").click();
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  const wheel = dialog.getByRole("spinbutton", { name: "시간", exact: true });
  await expect(wheel).toBeVisible();
  await wheel.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.evaluate(() => {
    const w = window as unknown as { __log: string[] };
    w.__log = [];
    for (const type of ["pointercancel", "lostpointercapture"]) window.addEventListener(type, () => w.__log.push(type), true);
    let el: HTMLElement | null = document.querySelector<HTMLElement>(".time-wheel")!.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      el = el.parentElement;
    }
    (el && el !== document.body ? el : (document.scrollingElement as HTMLElement)).setAttribute("data-dial-scroller", "1");
  });
  const cdp = await page.context().newCDPSession(page);
  const before = Number(await wheel.getAttribute("aria-valuenow"));
  const top0 = await scrollTop(page);
  const b = (await wheel.boundingBox())!; // spinbutton이 .time-wheel-window 자체다
  const x = b.x + b.width / 2;
  // 손가락을 위로 끌면 다음 값(큰 값)이 올라온다
  await swipe(page, cdp, Array.from({ length: 30 }, (_, i) => ({ x, y: b.y + b.height * 0.8 - i * 4 })));
  const after = Number(await wheel.getAttribute("aria-valuenow"));
  const top1 = await scrollTop(page);
  const log = await logOf(page);
  console.log(`[dial-touch] 휠 끌기: 값 ${before} → ${after} · 스크롤 ${top0} → ${top1} · ${log.join(" ")}`);
  expect(log.filter((l) => l === "pointercancel"), "휠 끌기 동안 pointercancel 없음").toEqual([]);
  expect(after, "휠 값이 바뀐다").not.toBe(before);
  expect(top1, "휠 끄는 동안 바깥 스크롤 그대로").toBe(top0);
});
