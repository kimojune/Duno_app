import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { photoDir } from "./photo-dir";

/**
 * 고침11 사진 묶음(디자인 QA용, 워크플로 S6, 22 팀장 → W2). 개발 갤러리(/dev/v2?s=fix11-…, 개발 서버 전용)의 화면을 360×800 · deviceScaleFactor 2 · 전체 화면(viewport) 한 장씩 찍고,
 * 사진 옆에 같은 이름의 .json으로 그 화면에서 잰 값(getBoundingClientRect · getComputedStyle · SVG 속성)을 둔다.
 * 단언은 23 명세 4절(2026-11-10-고침11-먼저할일카드-타이머시계-명세.md)의 값이다. 화면 값이 명세와 다르면 앱을 고치지 않고 json의 mismatches와 목록.md에 「명세 X / 화면 Y」로 적는다(아래 EXPECTED_DIFFS).
 * PM 결정: 단추 글은 「오늘 할 일에 추가」(그림의 「추가하기」 자리). K5 · T2 · T3 · T4는 만들지 않았다.
 * 사진은 기본 test-results/photos/고침11-사진, SAVE_PHOTOS=1일 때만 docs/oneshot-v2/고침11-사진 (photo-dir.ts).
 * 데이터: 오늘 2026-11-13(목) 서울 12:00 고정, 건넨 할 일 「토익 단어 50개」(어학) · 어제(11-12) 적은 것. 개발 갤러리가 시계를 고정한다(타이머 now 고정 → 남은 24:12에서 멈춘다).
 * 체험 코드·진짜 로그인·운영 주소·서버 Action은 쓰지 않는다.
 */
test.use({ deviceScaleFactor: 2 }); // 사진은 360×800 CSS px, 2배 화소(720×1600)
const OUT = photoDir("고침11-사진");
const FIRST_ROW_Y_K8 = 310; // 카드 없음일 때 목록 맨 위 줄 y(360x800, 첫 실행에서 잰 값)
const GRAY = "rgb(94, 100, 120)"; // #5E6478
const INK = "rgb(28, 35, 64)"; // #1C2340
const WHITE = "rgb(255, 255, 255)";
const NOTICE = "rgb(243, 238, 230)"; // #F3EEE6
const OTHER = "rgb(207, 203, 196)"; // #CFCBC4

type Mismatch = { item: string; spec: string; screen: string; group?: string };
const r1 = (n: number) => Math.round(n * 100) / 100;

async function open(page: Page, s: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${s}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

async function save(page: Page, name: string, data: Record<string, unknown>, mismatches: Mismatch[]) {
  for (const x of mismatches) x.group = KNOWN_DIFFS[x.item]?.group ?? "목록 밖";
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ viewport: "360x800 @2x", ...data, mismatches }, null, 2) + "\n", "utf8");
}

/** 한 값을 명세 값과 견주어, 다르면 mismatches에 「명세 X / 화면 Y」로 쌓는다 */
function check(mm: Mismatch[], item: string, spec: unknown, screen: unknown) {
  if (String(spec) !== String(screen)) mm.push({ item, spec: String(spec), screen: String(screen) });
}

async function measureCard(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector<HTMLElement>("section.entry-card")!;
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const css = (el: Element | null) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        text: (el.textContent ?? "").trim(),
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: s.color,
        background: s.backgroundColor,
        borderTop: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        borderRadius: s.borderTopLeftRadius,
        padding: s.padding,
      };
    };
    const headerEl = Array.from(document.querySelectorAll("p, span, h2")).find((e) => e.children.length === 0 && /^11월 13일/.test(e.textContent ?? ""));
    const gapEls = { written: card.querySelector(".offer-written"), notice: card.querySelector(".notice"), actions: card.querySelector(".detail-actions") };
    const dotEl = card.querySelector('[class*="dot"], [class*="Dot"]');
    const buttons = Array.from(card.querySelectorAll("button"));
    const primary = card.querySelector(".btn-primary, .btn-secondary:not(.btn-text)");
    const skip = buttons.find((b) => (b.textContent ?? "").trim() === "넘기기") ?? null;
    const main = buttons.find((b) => b !== skip) ?? null;
    const notice = card.querySelector(".notice");
    return {
      gaps: {
        writtenToNotice: gapEls.written && gapEls.notice ? gapEls.notice.getBoundingClientRect().top - gapEls.written.getBoundingClientRect().bottom : null,
        noticeToActions: gapEls.notice && gapEls.actions ? gapEls.actions.getBoundingClientRect().top - gapEls.notice.getBoundingClientRect().bottom : null,
      },
      dot: dotEl ? { width: dotEl.getBoundingClientRect().width, height: dotEl.getBoundingClientRect().height } : null,
      headerDay: (headerEl?.textContent ?? "").split(" · ")[0],
      card: { ...box(card), ...css(card), text: undefined },
      title: css(card.querySelector(".entry-title")),
      todoText: css(card.querySelector(".offer-text")),
      writtenLine: css(card.querySelector(".offer-written")),
      status: css(card.querySelector("p[role=status]")),
      notice: notice ? { ...box(notice), ...css(notice) } : null,
      mainButton: main ? { ...box(main), ...css(main), disabled: (main as HTMLButtonElement).disabled, ariaBusy: main.getAttribute("aria-busy") } : null,
      skipButton: skip ? { ...box(skip), ...css(skip), disabled: (skip as HTMLButtonElement).disabled } : null,
      primaryClass: primary?.className ?? null,
      buttonOrder: buttons.map((b) => (b.textContent ?? "").trim()),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
}

async function measureTimer(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    };
    const svg = document.querySelector<SVGSVGElement>(".timer-face-svg")!;
    const svgBox = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const scale = svgBox.width / vb.width; // SVG 좌표 1 = 화면 px × scale
    const radii = (el: Element | null) => (el ? [Math.hypot(Number(el.getAttribute("x1")), Number(el.getAttribute("y1"))), Math.hypot(Number(el.getAttribute("x2")), Number(el.getAttribute("y2")))].map((n) => Math.round(n * 100) / 100) : null);
    const plate = document.querySelector(".clock-plate");
    const core = document.querySelector(".clock-core");
    const sector = document.querySelector(".clock-sector");
    const sectorStyle = sector ? getComputedStyle(sector) : null;
    let sectorInfo: Record<string, unknown> | null = null;
    if (sector) {
      const d = sector.getAttribute("d");
      let startDeg: number | null = null;
      let endDeg: number | null = null;
      let radius: number | null = null;
      if (d) {
        const m = /^M0 0L(-?[\d.]+) (-?[\d.]+)A([\d.]+) [\d.]+ \d \d \d (-?[\d.]+) (-?[\d.]+)Z$/.exec(d);
        if (m) {
          startDeg = (Math.atan2(Number(m[2]), Number(m[1])) * 180) / Math.PI;
          endDeg = (Math.atan2(Number(m[5]), Number(m[4])) * 180) / Math.PI;
          radius = Number(m[3]);
        }
      } else {
        radius = Number(sector.getAttribute("r"));
      }
      sectorInfo = {
        tag: sector.tagName,
        d,
        radius,
        radiusPx: radius === null ? null : radius * scale,
        fill: sectorStyle!.fill,
        stroke: sectorStyle!.stroke,
        strokeWidth: sectorStyle!.strokeWidth,
        startDeg,
        endDeg,
      };
    }
    const name = document.querySelector(".timer-face-name");
    const clock = document.querySelector<HTMLElement>(".timer-clock");
    const clockCss = clock ? getComputedStyle(clock) : null;
    const status = document.querySelector(".timer-running > p.todo-sub");
    const end = document.querySelector(".timer-running .btn");
    const center = { x: svgBox.x + svgBox.width / 2, y: svgBox.y + svgBox.height / 2 };
    const nameBox = box(name);
    const clockBox = box(clock);
    return {
      svg: { ...box(svg), scale, viewBox: `${vb.x} ${vb.y} ${vb.width} ${vb.height}`, ariaHidden: svg.getAttribute("aria-hidden"), focusable: svg.getAttribute("focusable"), tabIndex: svg.getAttribute("tabindex") },
      center,
      plate: plate ? { r: Number(plate.getAttribute("r")), diameterPx: (plate as SVGGraphicsElement).getBoundingClientRect().width, fill: getComputedStyle(plate).fill, stroke: getComputedStyle(plate).stroke, strokeWidth: getComputedStyle(plate).strokeWidth } : null,
      core: core ? { r: Number(core.getAttribute("r")), diameterPx: (core as SVGGraphicsElement).getBoundingClientRect().width, fill: getComputedStyle(core).fill } : null,
      sector: sectorInfo,
      ticks: {
        total: document.querySelectorAll(".clock-tick-minor, .clock-tick-major").length,
        minor: document.querySelectorAll(".clock-tick-minor").length,
        major: document.querySelectorAll(".clock-tick-major").length,
        minorStroke: document.querySelector(".clock-tick-minor") ? getComputedStyle(document.querySelector(".clock-tick-minor")!).stroke : null,
        minorWidth: document.querySelector(".clock-tick-minor") ? getComputedStyle(document.querySelector(".clock-tick-minor")!).strokeWidth : null,
        majorStroke: document.querySelector(".clock-tick-major") ? getComputedStyle(document.querySelector(".clock-tick-major")!).stroke : null,
        majorWidth: document.querySelector(".clock-tick-major") ? getComputedStyle(document.querySelector(".clock-tick-major")!).strokeWidth : null,
        minorRadii: radii(document.querySelector(".clock-tick-minor")),
        majorRadii: radii(document.querySelector(".clock-tick-major")),
        labelRadius: (() => {
          const t = Array.from(document.querySelectorAll(".clock-num")).find((n) => n.textContent === "5");
          return t ? Math.hypot(Number(t.getAttribute("x")), Number(t.getAttribute("y"))) : null;
        })(),
        labels: Array.from(document.querySelectorAll(".clock-num")).map((n) => n.textContent),
        labelFont: document.querySelector(".clock-num") ? getComputedStyle(document.querySelector(".clock-num")!).font : null,
      },
      label: document.querySelector(".timer-label")?.textContent ?? null,
      name: name ? { ...nameBox, text: name.textContent, fontSize: getComputedStyle(name).fontSize, color: getComputedStyle(name).color, offsetFromCenterY: center.y - nameBox!.cy, topFromCenterY: center.y - nameBox!.y } : null,
      number: clock
        ? {
            ...clockBox,
            text: clock.textContent,
            fontSize: clockCss!.fontSize,
            fontWeight: clockCss!.fontWeight,
            lineHeight: clockCss!.lineHeight,
            color: clockCss!.color,
            tabular: clockCss!.fontVariantNumeric,
            role: clock.getAttribute("role"),
            ariaLabel: clock.getAttribute("aria-label"),
            topFromCenterY: center.y - clockBox!.y,
          }
        : null,
      statusText: status ? { text: status.textContent, fontSize: getComputedStyle(status).fontSize, color: getComputedStyle(status).color, y: box(status)!.y } : null,
      endButton: end ? { ...box(end), text: (end.textContent ?? "").trim(), background: getComputedStyle(end).backgroundColor, color: getComputedStyle(end).color, radius: getComputedStyle(end).borderTopLeftRadius, fontSize: getComputedStyle(end).fontSize, fontWeight: getComputedStyle(end).fontWeight } : null,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
}

/**
 * 화면이 명세와 다른 것으로 확인해 목록.md · 보고에 적은 차이(앱은 고치지 않았다). 「항목 → 알려진 화면 값」으로 고정한다:
 * 화면 값이 여기 적은 값과 다르면(목록 밖 차이이거나 값이 바뀌었으면) 시험이 실패한다. 명세와 같아진 항목은 여기서 빼서 명세 값 단언이 되게 한다.
 * 무리: 가 = 고침11 이전부터의 현행 꼴(카드 틀·단추 부품·추천 꼬리표·요일 데이터), 나 = 23이 판단할 것(타이머 글자 자리·끝내기 너비), 다 = 그 밖에 새로 찾은 것.
 */
const KNOWN_DIFFS: Record<string, { group: "가 현행 꼴" | "나 23이 판단" | "다 새로 찾음"; screen: string[] }> = {
  "머리 날짜 글(요일)": { group: "가 현행 꼴", screen: ["11월 13일 금요일"] },
  "카드 x": { group: "가 현행 꼴", screen: ["16"] },
  "카드 너비": { group: "가 현행 꼴", screen: ["328"] },
  "카드 바탕(--color-surface)": { group: "가 현행 꼴", screen: ["rgb(243, 238, 230)"] },
  "카드 높이": { group: "가 현행 꼴", screen: ["108", "156", "128"] },
  "분야 점 10×10(제목 옆)": { group: "가 현행 꼴", screen: ["없음"] },
  "제목 글자 크기": { group: "가 현행 꼴", screen: ["16px"] },
  "제목 색": { group: "가 현행 꼴", screen: ["rgb(28, 35, 64)"] },
  "건넨 할 일 굵기": { group: "가 현행 꼴", screen: ["400"] },
  "넘기기 누름 영역 너비": { group: "가 현행 꼴", screen: ["68"] },
  "넘기기 누름 영역 높이": { group: "가 현행 꼴", screen: ["48"] },
  "단추 너비(명세 84는 윤곽 단추 기준)": { group: "가 현행 꼴", screen: ["162.88", "119.63"] },
  "단추 높이": { group: "가 현행 꼴", screen: ["48"] },
  "단추 바탕": { group: "가 현행 꼴", screen: ["rgb(28, 35, 64)"] },
  "단추 윤곽": { group: "가 현행 꼴", screen: ["1px solid rgb(28, 35, 64)"] },
  "단추 글자 크기": { group: "가 현행 꼴", screen: ["16px"] },
  "단추 글 색": { group: "가 현행 꼴", screen: ["rgb(255, 255, 255)"] },
  "K6 단추 윤곽": { group: "가 현행 꼴", screen: ["1px solid rgb(28, 35, 64)"] },
  "K6 단추 높이": { group: "가 현행 꼴", screen: ["48"] },
  "알림 상자 x": { group: "가 현행 꼴", screen: ["32"] },
  "알림 상자 너비": { group: "가 현행 꼴", screen: ["296"] },
  "안내 상자 x": { group: "가 현행 꼴", screen: ["16"] },
  "안내 상자 너비": { group: "가 현행 꼴", screen: ["328"] },
  "「추천」 꼬리표 글자 크기": { group: "가 현행 꼴", screen: ["14px"] },
  "「남은 시간」 상자 위쪽이 판 가운데에서 위로": { group: "나 23이 판단", screen: ["28"] },
  "숫자 상자 위쪽이 판 가운데에서 위로": { group: "나 23이 판단", screen: ["12"] },
  "끝내기 단추 너비": { group: "나 23이 판단", screen: ["82"] },
  "적은 날 줄 → 알림 상자 간격": { group: "다 새로 찾음", screen: ["4"] },
  "알림 상자 → 단추 줄 간격": { group: "다 새로 찾음", screen: ["4"] },
  "안내 상자 위 → 목록 제목 아래로 내려옴": { group: "다 새로 찾음", screen: ["68"] },
};
function expectOnlyKnown(mm: Mismatch[]) {
  const bad = mm.filter((x) => !KNOWN_DIFFS[x.item]?.screen.includes(x.screen));
  expect(bad, "명세와 다른 곳(알려진 화면 값 밖)").toEqual([]);
}

type CardM = Awaited<ReturnType<typeof measureCard>>;
type TimerM = Awaited<ReturnType<typeof measureTimer>>;

/** 카드 공통 명세 값(4절 「카드 공통」) */
function checkCardCommon(m: CardM, mm: Mismatch[], skipColor: string = INK) {
  check(mm, "머리 날짜 글(요일)", "11월 13일 목요일", m.headerDay);
  check(mm, "카드 x", 20, r1(m.card.x!));
  check(mm, "카드 너비", 320, r1(m.card.width!));
  check(mm, "카드 바탕(--color-surface)", "#FFFFFF", m.card.background);
  check(mm, "카드 모서리", "16px", m.card.borderRadius);
  check(mm, "분야 점 10×10(제목 옆)", "10×10", m.dot ? `${r1(m.dot.width)}×${r1(m.dot.height)}` : "없음");
  check(mm, "제목 글자 크기", "12px", m.title!.fontSize);
  check(mm, "제목 색", GRAY, m.title!.color);
  check(mm, "건넨 할 일 글자 크기", "16px", m.todoText!.fontSize);
  check(mm, "건넨 할 일 굵기", "700", m.todoText!.fontWeight);
  check(mm, "건넨 할 일 색", INK, m.todoText!.color);
  check(mm, "넘기기 누름 영역 너비", 63, r1(m.skipButton!.width!));
  check(mm, "넘기기 누름 영역 높이", 40, r1(m.skipButton!.height!));
  check(mm, "넘기기 글자 크기", "14px", m.skipButton!.fontSize);
  check(mm, "넘기기 색", skipColor, m.skipButton!.color);
}

/** 추가 꼴(K1~K4) 값(4절): 적은 날 줄 · 「추가」 단추 */
function checkAddCard(m: CardM, mm: Mismatch[], opts: { written: string; button: string }) {
  check(mm, "적은 날 줄 글", opts.written, m.writtenLine!.text);
  check(mm, "적은 날 줄 글자 크기", "14px", m.writtenLine!.fontSize);
  check(mm, "적은 날 줄 줄 높이", "20px", m.writtenLine!.lineHeight);
  check(mm, "적은 날 줄 색", GRAY, m.writtenLine!.color);
  check(mm, "단추 글(PM 결정)", opts.button, m.mainButton!.text);
  check(mm, "단추 너비(명세 84는 윤곽 단추 기준)", 84, r1(m.mainButton!.width!));
  check(mm, "단추 높이", 40, r1(m.mainButton!.height!));
  check(mm, "단추 바탕", WHITE, m.mainButton!.background);
  check(mm, "단추 윤곽", `1.5px solid ${INK}`, m.mainButton!.borderTop);
  check(mm, "단추 모서리", "999px", m.mainButton!.borderRadius);
  check(mm, "단추 글자 크기", "14px", m.mainButton!.fontSize);
  check(mm, "단추 글 색", INK, m.mainButton!.color);
  check(mm, "단추 순서", `${opts.button},넘기기`, m.buttonOrder.join(","));
}

const CARD_STATES: { id: string; file: string; node: string; data: string; written: string | null; button: string; error?: string }[] = [
  { id: "fix11-k1", file: "K1 처음 건넴(지난 날 할 일)", node: "157:60", data: "11-13 12:00 · 「토익 단어 50개」 · 어학 · 11-12(어제) 적음", written: "어제 적은 할 일", button: "오늘 할 일에 추가" },
  { id: "fix11-k2", file: "K2 추가하는 중", node: "157:166", data: "11-13 12:00 · 「토익 단어 50개」 · 어학 · 11-12(어제) 적음 · 추가하는 중", written: "어제 적은 할 일", button: "추가하는 중" },
  { id: "fix11-k3", file: "K3 오프라인", node: "157:272", data: "11-13 12:00 · 「토익 단어 50개」 · 어학 · 11-12(어제) 적음 · 오프라인", written: "어제 적은 할 일", button: "오늘 할 일에 추가", error: "인터넷에 연결되면 추가할 수 있어요." },
  { id: "fix11-k4", file: "K4 실패", node: "157:380", data: "11-13 12:00 · 「토익 단어 50개」 · 어학 · 11-12(어제) 적음 · 추가 실패", written: "어제 적은 할 일", button: "오늘 할 일에 추가", error: "추가하지 못했어요. 다시 눌러 주세요." },
];

for (const s of CARD_STATES) {
  test(`${s.file} (${s.node})`, async ({ page }) => {
    await open(page, s.id);
    await expect(page.getByRole("region", { name: "오늘 먼저 할 일" })).toBeVisible();
    const m = await measureCard(page);
    const mm: Mismatch[] = [];
    checkCardCommon(m, mm, s.id === "fix11-k2" ? GRAY : INK); // K2: 추가하는 중에는 「넘기기」가 보조색(명세 4절)
    checkAddCard(m, mm, { written: s.written!, button: s.button });
    expect(m.todoText!.text, "건넨 할 일 글").toBe("토익 단어 50개");
    expect(m.title!.text).toBe("오늘 먼저 할 일 · 어학");
    // 카드 높이(4절: K1 142 · K3 198). K2·K4는 K1·K3과 같은 틀
    check(mm, "카드 높이", s.error ? 198 : 142, r1(m.card.height!));
    if (s.id === "fix11-k2") {
      expect(m.mainButton!.ariaBusy, "추가하는 중 aria-busy").toBe("true");
      expect(m.skipButton!.disabled, "추가하는 중 넘기기 막힘").toBe(true);
    }
    if (s.error) {
      expect(m.notice!.text, "알림 상자 글").toBe(s.error);
      check(mm, "알림 상자 x", 36, r1(m.notice!.x!));
      check(mm, "알림 상자 너비", 288, r1(m.notice!.width!));
      check(mm, "알림 상자 바탕", NOTICE, m.notice!.background);
      check(mm, "알림 상자 모서리", "8px", m.notice!.borderRadius);
      check(mm, "알림 상자 안쪽", "12px", m.notice!.padding);
      check(mm, "알림 상자 글자 크기", "14px", m.notice!.fontSize);
      check(mm, "알림 상자 굵기", "400", m.notice!.fontWeight);
      check(mm, "알림 상자 줄 높이", "20px", m.notice!.lineHeight);
      check(mm, "알림 상자 글 색", INK, m.notice!.color);
      check(mm, "적은 날 줄 → 알림 상자 간격", 12, r1(m.gaps.writtenToNotice!));
      check(mm, "알림 상자 → 단추 줄 간격", 16, r1(m.gaps.noticeToActions!));
    }
    expect(m.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(m.clientWidth);
    await save(page, s.file, { node: s.node, data: s.data, measured: m }, mm);
    expectOnlyKnown(mm);
  });
}

test("K6 분야만 건넴 · 안 B 현행 「30분 시작」 (157:593)", async ({ page }) => {
  await open(page, "fix11-k6");
  const m = await measureCard(page);
  const mm: Mismatch[] = [];
  expect(m.todoText!.text, "분야만 건넬 때 글").toBe("어학 30분");
  expect(m.writtenLine, "적은 날 줄 없음").toBeNull();
  expect(m.mainButton!.text).toBe("30분 시작");
  expect(m.buttonOrder).toEqual(["30분 시작", "넘기기"]);
  checkCardCommon(m, mm);
  check(mm, "K6 단추 윤곽", `1.5px solid ${INK}`, m.mainButton!.borderTop);
  check(mm, "K6 단추 높이", 40, r1(m.mainButton!.height!));
  await save(page, "K6 분야만 건넴(안 B 30분 시작)", { node: "157:593", data: "11-13 12:00 · 「어학 30분」(할 일 없음) · 어학 · 적은 날 없음", measured: m }, mm);
  expectOnlyKnown(mm);
});

test("K7 타이머가 이미 돎 (157:698)", async ({ page }) => {
  await open(page, "fix11-k7");
  const m = await measureCard(page);
  const mm: Mismatch[] = [];
  expect(m.status!.text).toBe("타이머가 돌고 있어요. 타이머 탭에서 볼 수 있어요.");
  expect(m.mainButton!.text).toBe("타이머 탭 열기");
  expect(m.skipButton).toBeNull();
  check(mm, "카드 x", 20, r1(m.card.x!));
  check(mm, "카드 너비", 320, r1(m.card.width!));
  check(mm, "카드 바탕(--color-surface)", "#FFFFFF", m.card.background);
  check(mm, "카드 모서리", "16px", m.card.borderRadius);
  check(mm, "머리 날짜 글(요일)", "11월 13일 목요일", m.headerDay);
  check(mm, "카드 높이", 144, r1(m.card.height!));
  check(mm, "상태 글 글자 크기", "14px", m.status!.fontSize);
  check(mm, "상태 글 색", GRAY, m.status!.color);
  check(mm, "주 단추 바탕", INK, m.mainButton!.background);
  check(mm, "주 단추 글 색", WHITE, m.mainButton!.color);
  await save(page, "K7 타이머가 이미 돎", { node: "157:698", data: "11-13 12:00 · 「토익 단어 50개」 · 어학 · 오늘 목록에 있음 · 타이머 도는 중", measured: m }, mm);
  expectOnlyKnown(mm);
});

test("K8 넘긴 뒤 · 카드 없음 (157:802)", async ({ page }) => {
  await open(page, "fix11-k8");
  await expect(page.getByRole("region", { name: "오늘 먼저 할 일" })).toHaveCount(0);
  await expect(page.getByText("토익 단어 50개")).toBeVisible();
  await expect(page.getByRole("button", { name: "넘기기" })).toHaveCount(0);
  const first = (await page.locator(".todo-row").first().boundingBox())!;
  const rows = await page.locator(".todo-row").count();
  expect(rows, "오늘 목록 3줄").toBe(3);
  expect(r1(first.y), "할 일 목록 맨 위 y(카드 없음: 이번 주 목표 · 오늘 기록 · 어제 못 끝낸 줄 아래, 360x800)").toBe(FIRST_ROW_Y_K8);
  await save(page, "K8 넘긴 뒤(카드 없음)", { node: "157:802", data: "11-13 12:00 · 카드 없음 · 오늘 목록 3개(토익 단어 50개 · 어학, 글 한 편 초고 쓰기 · 글쓰기, 정보처리기사 기출 1회 · 자격증)", measured: { cardCount: 0, firstRowY: first.y, scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth) } }, []);
});

test("오늘 것이면 현행 「30분 시작」 (50:52)", async ({ page }) => {
  await open(page, "fix11-today");
  const m = await measureCard(page);
  const mm: Mismatch[] = [];
  expect(m.writtenLine, "오늘 것이면 적은 날 줄 없음").toBeNull();
  expect(m.mainButton!.text).toBe("30분 시작");
  expect(m.buttonOrder).toEqual(["30분 시작", "넘기기"]);
  checkCardCommon(m, mm);
  await save(page, "오늘 것 → 30분 시작", { node: "50:52", data: "11-13 12:00 · 「토익 단어 50개」 · 어학 · 11-13(오늘) 적음", measured: m }, mm);
  expectOnlyKnown(mm);
});

test("K9 타이머 탭 · 고르기 (157:899)", async ({ page }) => {
  await open(page, "fix11-k9");
  const notice = page.getByRole("status").filter({ hasText: "를 오늘 할 일에 넣었어요." });
  await expect(notice).toHaveText("「토익 단어 50개」를 오늘 할 일에 넣었어요.");
  await expect(page.getByRole("radio", { name: /토익 단어 50개/ })).toBeChecked();
  await expect(page.getByRole("heading", { name: "타이머" })).toBeFocused(); // 포커스는 타이머 탭 제목(화면 읽기용)
  const mm: Mismatch[] = [];
  const m = await page.evaluate(() => {
    const n = Array.from(document.querySelectorAll<HTMLElement>("[role=status]")).find((e) => (e.textContent ?? "").includes("오늘 할 일에 넣었어요"))!;
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    const heading = document.querySelector<HTMLElement>(".timer-choose h2")!.getBoundingClientRect();
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>(".timer-option input")).map((i) => ({ label: (i.closest("label")?.textContent ?? "").trim(), checked: i.checked }));
    const tag = Array.from(document.querySelectorAll<HTMLElement>(".timer-option .category-tag")).map((t) => ({ text: t.textContent, fontSize: getComputedStyle(t).fontSize, color: getComputedStyle(t).color }));
    const selectedRow = document.querySelector<HTMLInputElement>(".timer-option input:checked")!.closest("label")!;
    return {
      notice: { text: (n.textContent ?? "").trim(), x: r.x, y: r.y, width: r.width, height: r.height, background: s.backgroundColor, radius: s.borderTopLeftRadius, padding: s.padding, fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, color: s.color, role: n.getAttribute("role") },
      listHeadingY: heading.y,
      radios,
      tags: tag,
      selectedRowBackground: getComputedStyle(selectedRow).backgroundColor,
      startButton: (document.querySelector(".timer-choose .btn-primary")?.textContent ?? "").trim(),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  check(mm, "안내 상자 x", 20, r1(m.notice.x));
  check(mm, "안내 상자 너비", 320, r1(m.notice.width));
  check(mm, "안내 상자 바탕", NOTICE, m.notice.background);
  check(mm, "안내 상자 모서리", "8px", m.notice.radius);
  check(mm, "안내 상자 안쪽", "12px", m.notice.padding);
  check(mm, "안내 상자 글자 크기", "14px", m.notice.fontSize);
  check(mm, "안내 상자 글 색", INK, m.notice.color);
  check(mm, "안내 상자 role", "status", m.notice.role);
  check(mm, "고른 줄 바탕", NOTICE, m.selectedRowBackground);
  check(mm, "안내 상자 높이(안쪽 12 + 줄 20 + 12)", 44, r1(m.notice.height));
  check(mm, "안내 상자 위 → 목록 제목 아래로 내려옴", 56, r1(m.listHeadingY - m.notice.y));
  check(mm, "안내 상자 줄 높이", "20px", m.notice.lineHeight);
  check(mm, "안내 상자 굵기", "400", m.notice.fontWeight);
  check(mm, "「추천」 꼬리표 글자 크기", "12px", m.tags.find((t) => t.text === "추천")?.fontSize);
  check(mm, "「추천」 꼬리표 색", GRAY, m.tags.find((t) => t.text === "추천")?.color);
  expect(m.startButton, "타이머는 켜지지 않았다: 시작 단추가 그대로").toBe("30분 시작");
  await save(page, "K9 타이머 탭 고르기(추가한 뒤)", { node: "157:899", data: "11-13 12:00 · 넣은 할 일 「토익 단어 50개」 · 어학 · 11-12(어제) 적은 것을 추가", measured: m }, mm);
  expectOnlyKnown(mm);
});

/** 타이머 공통 명세 값(4절 「타이머 시계」) */
function checkTimerCommon(m: TimerM, mm: Mismatch[], opts: { ratio: number; sectorColor: string; number: string; status: string; label: string }) {
  check(mm, "판 지름", 264, r1(m.plate!.r * 2));
  check(mm, "판 흰 원", WHITE, m.plate!.fill);
  check(mm, "판 테두리 색", "rgb(231, 225, 214)", m.plate!.stroke); // #E7E1D6
  check(mm, "가운데 판 지름", 144, r1(m.core!.r * 2));
  check(mm, "눈금 수(30분판)", 30, m.ticks.total);
  check(mm, "작은 눈금 수(1분마다, 5분 자리 빼고)", 24, m.ticks.minor);
  check(mm, "큰 눈금 수(0·5…25)", 6, m.ticks.major);
  check(mm, "작은 눈금 색", GRAY, m.ticks.minorStroke);
  check(mm, "큰 눈금 색", INK, m.ticks.majorStroke);
  check(mm, "눈금 숫자", "0,5,10,15,20,25", m.ticks.labels.join(","));
  check(mm, "작은 눈금 반지름(안쪽→바깥)", "126→132", m.ticks.minorRadii!.join("→"));
  check(mm, "큰 눈금 반지름(안쪽→바깥)", "120→132", m.ticks.majorRadii!.join("→"));
  check(mm, "눈금 숫자 반지름", 146, r1(m.ticks.labelRadius!));
  check(mm, "SVG aria-hidden", "true", m.svg.ariaHidden);
  check(mm, "SVG focusable", "false", m.svg.focusable);
  if (m.sector) {
    check(mm, "부채꼴 반지름", 116, m.sector.radius);
    check(mm, "부채꼴 채움 색", opts.sectorColor, m.sector.fill);
    check(mm, "부채꼴 윤곽 색", INK, m.sector.stroke);
    check(mm, "부채꼴 윤곽 두께(SVG 좌표 1)", "1px", m.sector.strokeWidth);
    const startSpec = -90 + (1 - opts.ratio) * 360;
    check(mm, "부채꼴 시작각(°)", r1(startSpec), r1(m.sector.startDeg as number));
    check(mm, "부채꼴 끝각(°, 270 = −90)", -90, r1(m.sector.endDeg as number));
  }
  check(mm, "숫자 글", opts.number, m.number!.text);
  check(mm, "숫자 글자 크기", "32px", m.number!.fontSize);
  check(mm, "숫자 굵기", "700", m.number!.fontWeight);
  check(mm, "숫자 줄 높이", "40px", m.number!.lineHeight);
  check(mm, "숫자 색", INK, m.number!.color);
  check(mm, "숫자 role", "timer", m.number!.role);
  check(mm, "「남은 시간」 글자 크기", "12px", m.name!.fontSize);
  check(mm, "「남은 시간」 색", GRAY, m.name!.color);
  check(mm, "「남은 시간」 상자 위쪽이 판 가운데에서 위로", 29, r1(m.name!.topFromCenterY));
  check(mm, "숫자 상자 위쪽이 판 가운데에서 위로", 11, r1(m.number!.topFromCenterY));
  check(mm, "상태 글", opts.status, m.statusText!.text);
  check(mm, "상태 글 글자 크기", "14px", m.statusText!.fontSize);
  check(mm, "상태 글 색", GRAY, m.statusText!.color);
  check(mm, "끝내기 단추 너비", 320, r1(m.endButton!.width!));
  check(mm, "끝내기 단추 높이", 48, r1(m.endButton!.height!));
  check(mm, "끝내기 단추 바탕", INK, m.endButton!.background);
  check(mm, "끝내기 단추 모서리", "999px", m.endButton!.radius);
  check(mm, "끝내기 글", "끝내기", m.endButton!.text);
  check(mm, "위 글(할 일 · 분야)", opts.label, m.label);
}

const TIMER_STATES = [
  { id: "fix11-t1", file: "T1 타이머 도는 중(남은 24분 12초)", node: "158:60", data: "11-13 12:00 고정 · 「토익 단어 50개」 · 어학 · 남은 24:12(1452초) · 30분 한 바퀴", ratio: 1452 / 1800, color: "어학 #…", number: "24:12", status: "30분 타이머가 돌고 있어요", label: "토익 단어 50개" },
  { id: "fix11-t5", file: "T5 30분이 다 됨(남은 0초)", node: "158:416", data: "11-13 12:00 고정 · 「토익 단어 50개」 · 어학 · 남은 00:00", ratio: 0, color: "", number: "00:00", status: "30분이 지났어요", label: "토익 단어 50개" },
  { id: "fix11-t6", file: "T6 기타 색 시작 직후", node: "158:494", data: "11-13 12:00 고정 · 할 일 없음 · 분야 없음(기타) · 남은 29:48(1788초)", ratio: 1788 / 1800, color: OTHER, number: "29:48", status: "30분 타이머가 돌고 있어요", label: "기타" },
];

for (const t of TIMER_STATES) {
  test(`${t.file} (${t.node})`, async ({ page }) => {
    await open(page, t.id);
    await expect(page.getByRole("timer")).toHaveText(t.number);
    const m = await measureTimer(page);
    const mm: Mismatch[] = [];
    // 분야 색: 어학은 분야 순서 첫째(--color-category-1). 화면에서 읽은 토큰 값으로 견준다
    const cat1 = await page.evaluate(() => {
      const el = document.createElement("i");
      el.style.color = getComputedStyle(document.documentElement).getPropertyValue("--color-category-1");
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    });
    const sectorColor = t.id === "fix11-t1" ? cat1 : t.color;
    if (t.id === "fix11-t5") {
      expect(m.sector, "남은 시간 0이면 부채꼴 없음").toBeNull();
    } else {
      expect(m.sector, "부채꼴 있음").not.toBeNull();
    }
    expect(m.number!.ariaLabel).toBe("30분 타이머가 돌고 있어요");
    expect(m.svg.ariaHidden).toBe("true");
    expect(m.svg.focusable).toBe("false");
    checkTimerCommon(m, mm, { ratio: t.ratio, sectorColor, number: t.number, status: t.status, label: t.id === "fix11-t1" ? "토익 단어 50개" : t.label });
    if (t.id === "fix11-t1") {
      // 4절 식: 남은 비율 = 1452 ÷ 1800, 시작 = −90 + (1 − 비율) × 360 = −20.4°
      expect(r1(m.sector!.startDeg as number)).toBe(-20.4);
      expect(r1(m.sector!.endDeg as number)).toBe(-90);
    }
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    await save(page, t.file, { node: t.node, data: t.data, remainingRatio: r1(t.ratio * 10000) / 10000, measured: m }, mm);
    expectOnlyKnown(mm);
  });
}
