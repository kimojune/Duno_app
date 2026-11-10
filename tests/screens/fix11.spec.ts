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
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
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
        outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`,
        outlineOffset: s.outlineOffset,
      };
    };
    // 단추: 누름 영역 = 상자 전체(위아래 투명 테두리 4 포함), 보이는 꼴 = 테두리를 뺀 안쪽
    const btn = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const bt = parseFloat(s.borderTopWidth);
      const bb = parseFloat(s.borderBottomWidth);
      return {
        ...css(el)!,
        x: r.x,
        right: r.right,
        width: r.width,
        height: r.height - bt - bb,
        hit: { x: r.x, y: r.y, width: r.width, height: r.height },
        disabled: (el as HTMLButtonElement).disabled,
        ariaBusy: el.getAttribute("aria-busy"),
      };
    };
    const headerEl = Array.from(document.querySelectorAll("p, span, h2")).find((e) => e.children.length === 0 && /^11월 13일/.test(e.textContent ?? ""));
    const buttons = Array.from(card.querySelectorAll("button"));
    const skip = buttons.find((b) => (b.textContent ?? "").trim() === "넘기기") ?? null;
    const secondary = card.querySelector(".offer-secondary");
    const main = buttons.find((b) => b !== skip && b !== secondary) ?? null;
    const written = card.querySelector(".offer-written");
    const notice = card.querySelector(".notice");
    const actions = card.querySelector(".detail-actions");
    const dotEl = card.querySelector('[class*="dot"], [class*="Dot"]');
    const tag = document.querySelector(".first-tag");
    const tagRow = tag?.closest(".todo-row, li") ?? null;
    const catTag = tagRow?.querySelector(".category-tag") ?? null;
    const flashRow = document.querySelector(".todo-row-flash");
    const active = document.activeElement as HTMLElement | null;
    // 보조 길 포커스 고리: 단추 상자(누름 48)를 outline-offset 만큼 줄인 안쪽 가장자리, 바깥 가장자리는 거기서 고리 두께만큼 더 나간 곳
    let ring: Record<string, number | string> | null = null;
    if (secondary) {
      const r = secondary.getBoundingClientRect();
      const s = getComputedStyle(secondary);
      const off = parseFloat(s.outlineOffset);
      const w = parseFloat(s.outlineWidth);
      ring = {
        style: s.outlineStyle,
        width: w,
        color: s.outlineColor,
        offset: off,
        radius: s.borderTopLeftRadius,
        innerW: r.width + 2 * off,
        innerH: r.height + 2 * off,
        outerW: r.width + 2 * off + 2 * w,
        outerH: r.height + 2 * off + 2 * w,
      };
    }
    const carryEl = Array.from(document.querySelectorAll("button, a, div, span")).find((e) => e.children.length === 0 && /^어제 못 끝낸 할 일 \d+개 보기/.test((e.textContent ?? "").trim()));
    return {
      headerDay: (headerEl?.textContent ?? "").split(" · ")[0],
      card: { ...box(card)!, ...css(card)!, text: undefined },
      dot: dotEl ? { width: dotEl.getBoundingClientRect().width, height: dotEl.getBoundingClientRect().height } : null,
      title: css(card.querySelector(".entry-title")),
      todoText: { ...css(card.querySelector(".offer-text"))!, ...box(card.querySelector(".offer-text"))! },
      written: written ? { ...css(written)!, ...box(written)!, role: written.getAttribute("role") } : null,
      status: css(card.querySelector("p[role=status]")),
      notice: notice ? { ...box(notice)!, ...css(notice)! } : null,
      mainButton: btn(main),
      skipButton: btn(skip),
      secondary: secondary ? { ...btn(secondary)!, ring, activeIsIt: document.activeElement === secondary, focusVisible: secondary.matches(":focus-visible") } : null,
      buttonOrder: buttons.map((b) => (b.textContent ?? "").trim()),
      gaps: {
        writtenToNotice: written && notice ? notice.getBoundingClientRect().top - written.getBoundingClientRect().bottom : null,
        writtenToActions: written && !notice && actions ? actions.getBoundingClientRect().top - written.getBoundingClientRect().bottom : null,
        noticeToActions: notice && actions ? actions.getBoundingClientRect().top - notice.getBoundingClientRect().bottom : null,
        mainToSkip: main && skip ? skip.getBoundingClientRect().left - main.getBoundingClientRect().right : null,
      },
      listTag: tag
        ? {
            ...css(tag)!,
            ...box(tag)!,
            gapFromCategory: catTag ? tag.getBoundingClientRect().left - catTag.getBoundingClientRect().right : null,
            rowText: (tagRow?.textContent ?? "").trim(),
          }
        : null,
      flashRow: flashRow ? { id: flashRow.id, ...box(flashRow)!, ...css(flashRow)!, tagBackground: tag ? getComputedStyle(tag).backgroundColor : null } : null,
      focusedRow: active && active.id.startsWith("row-") ? { id: active.id, ...css(active)!, ...box(active)!, tabindex: active.getAttribute("tabindex") } : null,
      carry: carryEl?.textContent?.trim() ?? null,
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
      labelBox: (() => {
        const el = document.querySelector(".timer-label");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const dot = el.parentElement?.querySelector('[class*="dot"]');
        // 글 왼쪽 끝(가운데 정렬이면 글 상자 안쪽의 실제 글 위치)
        const range = document.createRange();
        range.selectNodeContents(el);
        const tr = range.getBoundingClientRect();
        return { x: tr.x, y: tr.y, width: tr.width, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, textAlign: cs.textAlign, hasDot: !!dot, boxY: r.y };
      })(),
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
      belowCenter: { status: box(status) ? box(status)!.y - center.y : null, button: end ? box(end)!.y - center.y : null, buttonX: end ? box(end)!.x : null },
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
  "이번 주 목표 줄(320×56 @20,112)": { group: "가 현행 꼴", screen: ["328×48@16,130"] },
  "어제 못 끝낸 줄(320×40 @20,184)": { group: "가 현행 꼴", screen: ["328×40@16,254"] },
  "오늘 기록 줄(320×56 @20,232)": { group: "가 현행 꼴", screen: ["328×56@16,190"] },
  "할 일 목록 카드 위(@20,300 · 너비 320)": { group: "가 현행 꼴", screen: ["328@16,310"] },
  "안내 상자 y": { group: "가 현행 꼴", screen: ["74"] },
  "목록 제목 「무엇을 할까요?」 글자 크기(24 Bold)": { group: "가 현행 꼴", screen: ["16px"] },
  "목록 제목 굵기": { group: "가 현행 꼴", screen: ["700"] },
  "고른 줄 크기(312×48 · x24)": { group: "가 현행 꼴", screen: ["328×48@16"] },
  "고른 줄 모서리": { group: "가 현행 꼴", screen: ["8px"] },
  "고른 줄 글(14 Bold)": { group: "가 현행 꼴", screen: ["16px/400"] },
  "다른 줄 글(14 Regular)": { group: "가 현행 꼴", screen: ["16px/400"] },
  "라디오 20×20": { group: "가 현행 꼴", screen: ["24×24"] },
  "오늘 할 일 목록 흰 카드(320 · 모서리 16)": { group: "가 현행 꼴", screen: ["없음"] },
  "줄 오른쪽 분야 점·분야 글": { group: "가 현행 꼴", screen: ["없음"] },
  "「30분 시작」 단추 320×48(x20)": { group: "가 현행 꼴", screen: ["106.17×48@16"] },
  "위 글(할 일 · 분야)": { group: "다 새로 찾음", screen: ["토익 단어 50개"] },
  "위 글 분야 점 10×10(x36)": { group: "다 새로 찾음", screen: ["없음"] },
  "위 글 글자 크기": { group: "다 새로 찾음", screen: ["16px"] },
  "위 글 색": { group: "다 새로 찾음", screen: ["rgb(28, 35, 64)"] },
  "위 글 x(점 오른쪽, x52)": { group: "다 새로 찾음", screen: ["125.56", "164"] },
  "시계 판 가운데 x": { group: "나 23이 판단", screen: ["180"] },
  "시계 판 가운데 y": { group: "나 23이 판단", screen: ["282"] },
  "상태 글 y(판 가운데에서 아래로)": { group: "나 23이 판단", screen: ["168"] },
  "끝내기 단추 y(판 가운데에서 아래로)": { group: "나 23이 판단", screen: ["196"] },
  "끝내기 단추 x": { group: "나 23이 판단", screen: ["139"] },
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
type BtnM = NonNullable<CardM["mainButton"]>;

const visTop = (b: BtnM) => b.hit.y + (b.hit.height - b.height) / 2;

type CardKind = {
  id: string;
  file: string;
  node: string;
  data: string;
  /** 건넨 할 일 자리 글 */
  todo: string;
  /** 적은 날 · 결과 · 목록에 있음 줄(없으면 null)과 그 글 색 */
  written: { text: string; color: string; role?: string } | null;
  /** 주 단추(글 · 너비). 보조 길만 있는 L5는 null */
  main: { text: string; width: number | null } | null;
  secondary?: string;
  skip: boolean;
  skipColor?: string;
  error?: string;
  height: number | null;
  carry: string;
  /** 목록 줄 꼬리표 「오늘 먼저」가 있어야 하나 / 줄 강조(flash)와 포커스 */
  tag?: { flash: boolean; focus: boolean };
};

/** 카드 값(23 명세 덧붙임 C절 + Figma 166:* 노드에서 읽은 값). 카드 틀 x20 · 너비 320 · 바탕 #FFFFFF · 모서리 16 · 분야 점 10×10 · 제목 12 · 건넨 할 일 16 Bold */
function checkCard(m: CardM, mm: Mismatch[], k: CardKind) {
  check(mm, "머리 날짜 글(요일)", "11월 13일 목요일", m.headerDay);
  check(mm, "카드 x", 20, r1(m.card.x));
  check(mm, "카드 너비", 320, r1(m.card.width));
  if (k.height !== null) check(mm, "카드 높이", k.height, r1(m.card.height));
  check(mm, "카드 바탕(--color-surface)", "#FFFFFF", m.card.background);
  check(mm, "카드 모서리", "16px", m.card.borderRadius);
  check(mm, "분야 점 10×10(제목 옆)", "10×10", m.dot ? `${r1(m.dot.width)}×${r1(m.dot.height)}` : "없음");
  check(mm, "제목 글자 크기", "12px", m.title!.fontSize);
  check(mm, "제목 굵기", "400", m.title!.fontWeight);
  check(mm, "제목 색", GRAY, m.title!.color);
  check(mm, "건넨 할 일 글", k.todo, m.todoText!.text);
  check(mm, "건넨 할 일 글자 크기", "16px", m.todoText!.fontSize);
  check(mm, "건넨 할 일 굵기", "700", m.todoText!.fontWeight);
  check(mm, "건넨 할 일 색", INK, m.todoText!.color);
  if (k.written) {
    check(mm, "줄 글(적은 날 · 결과 · 목록에 있음)", k.written.text, m.written?.text);
    check(mm, "줄 글 글자 크기", "14px", m.written?.fontSize);
    check(mm, "줄 글 굵기", "400", m.written?.fontWeight);
    check(mm, "줄 글 줄 높이", "20px", m.written?.lineHeight);
    check(mm, "줄 글 색", k.written.color, m.written?.color);
    check(mm, "줄 글 role", k.written.role ?? "null", m.written?.role ?? "null");
  } else {
    check(mm, "줄 글 없음", "없음", m.written ? m.written.text : "없음");
  }
  const above = m.notice ?? m.written ?? m.todoText!;
  if (m.notice) {
    check(mm, "알림 상자 글", k.error, m.notice.text);
    check(mm, "알림 상자 x", 36, r1(m.notice.x));
    check(mm, "알림 상자 너비", 288, r1(m.notice.width));
    check(mm, "알림 상자 바탕", NOTICE, m.notice.background);
    check(mm, "알림 상자 모서리", "8px", m.notice.borderRadius);
    check(mm, "알림 상자 안쪽", "12px", m.notice.padding);
    check(mm, "알림 상자 글자 크기", "14px", m.notice.fontSize);
    check(mm, "알림 상자 굵기", "400", m.notice.fontWeight);
    check(mm, "알림 상자 줄 높이", "20px", m.notice.lineHeight);
    check(mm, "알림 상자 글 색", INK, m.notice.color);
    check(mm, "알림 상자 높이", 44, r1(m.notice.height));
    check(mm, "적은 날 줄 → 알림 상자 간격", 12, r1(m.notice.y - m.written!.bottom));
  } else {
    expect(k.error, "알림 상자가 있어야 하는 상태").toBeUndefined();
  }
  const main = m.mainButton ?? m.secondary;
  if (main) {
    check(mm, "단추 줄 위 간격(위 글/알림 → 단추 보이는 위)", m.written || m.notice ? 16 : 14, r1(visTop(main) - above.bottom));
    check(mm, "단추 보이는 높이", 40, r1(main.height));
    expect(main.hit.height, "단추 누름 높이 48 이상(창구 가)").toBeGreaterThanOrEqual(47.5);
    expect(main.hit.width, "단추 누름 폭 48 이상").toBeGreaterThanOrEqual(47.5);
    check(mm, "단추 글자 크기", "14px", main.fontSize);
    check(mm, "단추 굵기", "500", main.fontWeight);
  }
  if (k.main) {
    expect(m.mainButton, "주 단추 있음").not.toBeNull();
    const b = m.mainButton!;
    check(mm, "단추 글", k.main.text, b.text);
    check(mm, "단추 x", 36, r1(b.x));
    if (k.main.width !== null) check(mm, "단추 너비(글에 맞춤)", k.main.width, r1(b.width));
    check(mm, "단추 바탕", INK, b.background);
    check(mm, "단추 글 색", WHITE, b.color);
    check(mm, "단추 모서리", "999px", b.borderRadius);
  }
  if (k.skip) {
    expect(m.skipButton, "「넘기기」 있음").not.toBeNull();
    const s = m.skipButton!;
    check(mm, "넘기기 글자 크기", "14px", s.fontSize);
    check(mm, "넘기기 굵기", "500", s.fontWeight);
    check(mm, "넘기기 색", k.skipColor ?? INK, s.color);
    check(mm, "넘기기 보이는 높이", 40, r1(s.height));
    expect(s.hit.height, "넘기기 누름 높이 48 이상").toBeGreaterThanOrEqual(47.5);
    check(mm, "주 단추 → 넘기기 간격", 16, r1(m.gaps.mainToSkip!));
    check(mm, "단추 순서", `${k.main!.text},넘기기`, m.buttonOrder.join(","));
  } else {
    expect(m.skipButton, "「넘기기」 없음").toBeNull();
  }
  if (k.secondary) {
    const sec = m.secondary!;
    check(mm, "보조 길 글", k.secondary, sec.text);
    check(mm, "보조 길 글 색", INK, sec.color);
    check(mm, "보조 길 글 x(글 왼쪽)", 36, r1(sec.x + parseFloat(sec.padding.split(" ")[1] ?? sec.padding)));
    expect(m.mainButton, "보조 길만 있다(주 단추 없음)").toBeNull();
    expect(m.buttonOrder, "카드 단추는 보조 길 하나").toEqual([k.secondary]);
    expect(sec.activeIsIt, "추가한 뒤 포커스는 보조 길").toBe(true);
    const ring = sec.ring!;
    expect(ring.style, "포커스 고리 보임(solid)").toBe("solid");
    check(mm, "포커스 고리 두께", 2, ring.width);
    check(mm, "포커스 고리 색", INK, ring.color);
    check(mm, "포커스 고리 모서리", "8px", ring.radius);
    // Figma 167:60: 고리 2px · 선 정렬 INSIDE · 117×36 = 고리 바깥 가장자리 기준. 화면은 안쪽·바깥 가장자리를 둘 다 json에 둔다
    check(mm, "포커스 고리 바깥 크기(명세 117×36, 바깥 가장자리 기준)", "117×36", `${r1(ring.outerW as number)}×${r1(ring.outerH as number)}`);
  }
  if (k.tag) {
    expect(m.listTag, "목록 줄 꼬리표 있음").not.toBeNull();
    const t = m.listTag!;
    check(mm, "목록 줄 꼬리표 글", "오늘 먼저", t.text);
    check(mm, "꼬리표 글자 크기", "12px", t.fontSize);
    check(mm, "꼬리표 굵기", "500", t.fontWeight);
    check(mm, "꼬리표 줄 높이", "16px", t.lineHeight);
    check(mm, "꼬리표 색", GRAY, t.color);
    check(mm, "꼬리표 바탕(강조 위 #FFFFFF · 평소 #F3EEE6)", k.tag.flash ? WHITE : NOTICE, t.background);
    check(mm, "꼬리표 모서리", "999px", t.borderRadius);
    check(mm, "꼬리표 안쪽(위아래 2 · 좌우 6)", "2px 6px", t.padding);
    check(mm, "꼬리표 크기", "59×20", `${r1(t.width)}×${r1(t.height)}`);
    check(mm, "꼬리표 ← 분야 글 끝에서", 8, r1(t.gapFromCategory!));
    expect(t.rowText, "꼬리표가 붙은 줄").toContain("토익 단어 50개");
  } else {
    expect(m.listTag, "꼬리표 없음").toBeNull();
  }
  if (k.tag?.flash) {
    expect(m.flashRow, "줄 강조 보임").not.toBeNull();
    check(mm, "강조 바탕", NOTICE, m.flashRow!.background);
    check(mm, "강조 크기", "312×54", `${r1(m.flashRow!.width)}×${r1(m.flashRow!.height)}`);
    check(mm, "강조 모서리", "8px", m.flashRow!.borderRadius);
    check(mm, "강조 x", 24, r1(m.flashRow!.x));
  } else if (k.tag) {
    expect(m.flashRow, "강조 없음").toBeNull();
  }
  if (k.tag?.focus) {
    expect(m.focusedRow, "포커스는 그 줄").not.toBeNull();
    check(mm, "포커스 줄 tabindex", "-1", m.focusedRow!.tabindex);
    check(mm, "포커스 고리", `2px solid ${INK}`, m.focusedRow!.outline);
    check(mm, "포커스 줄 모서리", "8px", m.focusedRow!.borderRadius);
    check(mm, "포커스 줄 크기(고리 바깥 312×54)", "312×54", `${r1(m.focusedRow!.width)}×${r1(m.focusedRow!.height)}`);
  } else if (k.tag) {
    expect(m.focusedRow, "포커스 줄 없음").toBeNull();
  }
  check(mm, "「어제 못 끝낸 할 일 n개 보기」", k.carry, m.carry);
  expect(m.scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(m.clientWidth);
}

const Y = "11-13 12:00 · 「토익 단어 50개」 · 어학 · 11-12(어제) 적음";
const W_Y = { text: "어제 적은 할 일", color: GRAY };
const W_IN = { text: "오늘 할 일 목록에 있어요", color: GRAY };
const CARD_STATES: CardKind[] = [
  { id: "fix11-l1", file: "L1 지난 날 할 일(오늘 할 일에 추가)", node: "166:60", data: Y, todo: "토익 단어 50개", written: W_Y, main: { text: "오늘 할 일에 추가", width: 132 }, skip: true, height: 142, carry: "어제 못 끝낸 할 일 2개 보기" },
  { id: "fix11-l2", file: "L2 추가하는 중", node: "166:159", data: `${Y} · 추가하는 중`, todo: "토익 단어 50개", written: W_Y, main: { text: "추가하는 중", width: 100 }, skip: true, skipColor: GRAY, height: 142, carry: "어제 못 끝낸 할 일 2개 보기" },
  { id: "fix11-l3", file: "L3 오프라인", node: "166:258", data: `${Y} · 오프라인`, todo: "토익 단어 50개", written: W_Y, main: { text: "오늘 할 일에 추가", width: 132 }, skip: true, error: "인터넷에 연결되면 추가할 수 있어요.", height: 198, carry: "어제 못 끝낸 할 일 2개 보기" },
  { id: "fix11-l4", file: "L4 실패", node: "166:359", data: `${Y} · 추가 실패`, todo: "토익 단어 50개", written: W_Y, main: { text: "오늘 할 일에 추가", width: 132 }, skip: true, error: "추가하지 못했어요. 다시 눌러 주세요.", height: 198, carry: "어제 못 끝낸 할 일 2개 보기" },
  { id: "fix11-l5", file: "L5 추가한 뒤(타이머에서 시작 보조 길)", node: "166:460", data: "11-13 12:00 · 「토익 단어 50개」 · 어학 · 11-12 적은 것을 방금 추가 · 새 줄 맨 위 강조(움직임 줄이기, 강조 보이는 동안) · 어제 못 끝낸 1개", todo: "토익 단어 50개", written: { text: "오늘 할 일에 넣었어요", color: INK, role: "status" }, main: null, secondary: "타이머에서 시작 ›", skip: false, height: 142, carry: "어제 못 끝낸 할 일 1개 보기", tag: { flash: true, focus: false } },
  { id: "fix11-l6", file: "L6 이미 오늘 목록에 있음(목록에서 보기)", node: "166:578", data: "11-13 12:00 · 「토익 단어 50개」 · 어학 · 오늘 목록에 있음(끝내지 않음) · 목록 줄 꼬리표", todo: "토익 단어 50개", written: W_IN, main: { text: "목록에서 보기", width: 113 }, skip: true, height: 142, carry: "어제 못 끝낸 할 일 2개 보기", tag: { flash: false, focus: false } },
  { id: "fix11-l7", file: "L7 목록에서 보기 뒤(그 줄 강조 · 포커스)", node: "166:693", data: "11-13 12:00 · 「토익 단어 50개」 · 어학 · 「목록에서 보기」를 누른 직후(움직임 줄이기, 강조 보이는 동안)", todo: "토익 단어 50개", written: W_IN, main: { text: "목록에서 보기", width: 113 }, skip: true, height: 142, carry: "어제 못 끝낸 할 일 2개 보기", tag: { flash: true, focus: true } },
  { id: "fix11-l8", file: "L8 분야만(어학 할 일 적기)", node: "166:810", data: "11-13 12:00 · 「어학 30분」(할 일 없음) · 어학", todo: "어학 30분", written: null, main: { text: "어학 할 일 적기", width: 119 }, skip: true, height: 120, carry: "어제 못 끝낸 할 일 2개 보기" },
];

/** L5 · L7은 강조(2초)가 보이는 순간을 찍는다: 움직임 줄이기를 켜 페이드 없이 고정하고 로드 직후에 잰다 */
async function openCard(page: Page, k: CardKind) {
  if (k.tag?.flash) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/dev/v2?s=${k.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".todo-row-flash", { timeout: 15_000 });
  } else {
    await open(page, k.id);
  }
}

for (const k of CARD_STATES) {
  test(`${k.file} (${k.node})`, async ({ page }) => {
    await openCard(page, k);
    await expect(page.getByRole("region", { name: "오늘 먼저 할 일" })).toBeVisible();
    const m = await measureCard(page);
    const mm: Mismatch[] = [];
    if (k.id === "fix11-l2") {
      expect(m.mainButton!.ariaBusy, "추가하는 중 aria-busy").toBe("true");
      expect(m.skipButton!.disabled, "추가하는 중 넘기기 막힘").toBe(true);
    }
    checkCard(m, mm, k);
    await save(page, k.file, { node: k.node, data: k.data, measured: m }, mm);
    expectOnlyKnown(mm);
  });
}

test("K7 타이머가 이미 돎 (157:698)", async ({ page }) => {
  await open(page, "fix11-k7");
  const m = await measureCard(page);
  const mm: Mismatch[] = [];
  expect(m.status!.text).toBe("타이머가 돌고 있어요. 타이머 탭에서 볼 수 있어요.");
  expect(m.mainButton!.text).toBe("타이머 탭 열기");
  expect(m.skipButton).toBeNull();
  check(mm, "머리 날짜 글(요일)", "11월 13일 목요일", m.headerDay);
  check(mm, "카드 x", 20, r1(m.card.x));
  check(mm, "카드 너비", 320, r1(m.card.width));
  check(mm, "카드 높이", 144, r1(m.card.height));
  check(mm, "카드 바탕(--color-surface)", "#FFFFFF", m.card.background);
  check(mm, "카드 모서리", "16px", m.card.borderRadius);
  check(mm, "분야 점 10×10(제목 옆)", "10×10", m.dot ? `${r1(m.dot.width)}×${r1(m.dot.height)}` : "없음");
  check(mm, "제목 글자 크기", "12px", m.title!.fontSize);
  check(mm, "제목 색", GRAY, m.title!.color);
  check(mm, "건넨 할 일 굵기", "700", m.todoText!.fontWeight);
  check(mm, "상태 글 글자 크기", "14px", m.status!.fontSize);
  check(mm, "상태 글 색", GRAY, m.status!.color);
  check(mm, "주 단추 바탕", INK, m.mainButton!.background);
  check(mm, "주 단추 글 색", WHITE, m.mainButton!.color);
  expect(m.mainButton!.hit.height, "단추 누름 높이 48 이상").toBeGreaterThanOrEqual(47.5);
  expect(m.listTag, "카드가 가리키는 오늘 줄에 꼬리표 「오늘 먼저」").not.toBeNull();
  await save(page, "K7 타이머가 이미 돎", { node: "157:698", data: "11-13 12:00 · 「토익 단어 50개」 · 어학 · 오늘 목록에 있음(끝내지 않음) · 타이머 도는 중", measured: m }, mm);
  expectOnlyKnown(mm);
});

test("K8 넘긴 뒤 · 카드 없음 (157:802)", async ({ page }) => {
  await open(page, "fix11-k8");
  await expect(page.getByRole("region", { name: "오늘 먼저 할 일" })).toHaveCount(0);
  await expect(page.getByText("토익 단어 50개")).toBeVisible();
  await expect(page.getByRole("button", { name: "넘기기" })).toHaveCount(0);
  await expect(page.locator(".first-tag"), "카드가 없으면 꼬리표도 없다").toHaveCount(0);
  const first = (await page.locator(".todo-row").first().boundingBox())!;
  const rows = await page.locator(".todo-row").count();
  expect(rows, "오늘 목록 3줄").toBe(3);
  expect(r1(first.y), "할 일 목록 맨 위 y(카드 없음, 360x800)").toBe(FIRST_ROW_Y_K8);
  const frame = await page.evaluate(() => {
    const r = (sel: string) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    const goal = r(".goal-line");
    const evening = Array.from(document.querySelectorAll("button")).find((b) => /오늘 기록/.test(b.textContent ?? ""))?.getBoundingClientRect();
    const carry = Array.from(document.querySelectorAll("button")).find((b) => /^어제 못 끝낸 할 일/.test((b.textContent ?? "").trim()))?.getBoundingClientRect();
    const list = document.querySelector(".todo-row")?.closest("ul, ol, section, div")?.getBoundingClientRect();
    return {
      goal,
      carry: carry ? { x: carry.x, y: carry.y, width: carry.width, height: carry.height } : null,
      evening: evening ? { x: evening.x, y: evening.y, width: evening.width, height: evening.height } : null,
      list: list ? { x: list.x, y: list.y, width: list.width, height: list.height } : null,
    };
  });
  const mm8: Mismatch[] = [];
  const box4 = (b: { x: number; y: number; width: number; height: number } | null) => (b ? `${r1(b.width)}×${r1(b.height)}@${r1(b.x)},${r1(b.y)}` : "없음");
  check(mm8, "이번 주 목표 줄(320×56 @20,112)", "320×56@20,112", box4(frame.goal));
  check(mm8, "어제 못 끝낸 줄(320×40 @20,184)", "320×40@20,184", box4(frame.carry));
  check(mm8, "오늘 기록 줄(320×56 @20,232)", "320×56@20,232", box4(frame.evening));
  check(mm8, "할 일 목록 카드 위(@20,300 · 너비 320)", "320@20,300", frame.list ? `${r1(frame.list.width)}@${r1(frame.list.x)},${r1(frame.list.y)}` : "없음");
  await save(page, "K8 넘긴 뒤(카드 없음)", { node: "157:802", data: "11-13 12:00 · 카드 없음 · 오늘 목록 3개(토익 단어 50개 · 어학, 글 한 편 초고 쓰기 · 글쓰기, 정보처리기사 기출 1회 · 자격증)", measured: { cardCount: 0, firstRowY: first.y, frame, scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth) } }, mm8);
  expectOnlyKnown(mm8);
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
      headingCss: (() => {
        const h = document.querySelector<HTMLElement>(".timer-choose h2")!;
        const cs = getComputedStyle(h);
        return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color };
      })(),
      selectedRow: (() => {
        const l = document.querySelector<HTMLInputElement>(".timer-option input:checked")!.closest("label")!;
        const r = l.getBoundingClientRect();
        const cs = getComputedStyle(l);
        const txt = l.querySelector<HTMLElement>(".timer-option-text")!;
        const tcs = getComputedStyle(txt);
        return { x: r.x, width: r.width, height: r.height, radius: cs.borderTopLeftRadius, textSize: tcs.fontSize, textWeight: tcs.fontWeight };
      })(),
      otherRowText: (() => {
        const l = Array.from(document.querySelectorAll<HTMLInputElement>(".timer-option input")).find((i) => !i.checked)!.closest("label")!;
        const tcs = getComputedStyle(l.querySelector<HTMLElement>(".timer-option-text")!);
        return { size: tcs.fontSize, weight: tcs.fontWeight };
      })(),
      radio: (() => {
        const i = document.querySelector<HTMLInputElement>(".timer-option input")!;
        const r = i.getBoundingClientRect();
        return { width: r.width, height: r.height };
      })(),
      hasListCard: !!document.querySelector(".timer-fieldset")?.closest("[class*=card], [class*=surface]"),
      fieldsetBg: getComputedStyle(document.querySelector(".timer-fieldset")!).backgroundColor,
      categoryDotInRow: !!document.querySelector(".timer-option .category-dot, .timer-option [class*=dot]"),
      startButtonBox: (() => {
        const b = document.querySelector<HTMLElement>(".timer-choose .btn-primary")!.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      })(),
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
  check(mm, "안내 상자 y", 110, r1(m.notice.y));
  check(mm, "목록 제목 「무엇을 할까요?」 글자 크기(24 Bold)", "24px", m.headingCss.fontSize);
  check(mm, "목록 제목 굵기", "700", m.headingCss.fontWeight);
  check(mm, "고른 줄 크기(312×48 · x24)", "312×48@24", `${r1(m.selectedRow.width)}×${r1(m.selectedRow.height)}@${r1(m.selectedRow.x)}`);
  check(mm, "고른 줄 모서리", "12px", m.selectedRow.radius);
  check(mm, "고른 줄 글(14 Bold)", "14px/700", `${m.selectedRow.textSize}/${m.selectedRow.textWeight}`);
  check(mm, "다른 줄 글(14 Regular)", "14px/400", `${m.otherRowText.size}/${m.otherRowText.weight}`);
  check(mm, "라디오 20×20", "20×20", `${r1(m.radio.width)}×${r1(m.radio.height)}`);
  check(mm, "오늘 할 일 목록 흰 카드(320 · 모서리 16)", "흰 바탕", m.fieldsetBg === "rgb(255, 255, 255)" ? "흰 바탕" : "없음");
  check(mm, "줄 오른쪽 분야 점·분야 글", "있음", m.categoryDotInRow ? "있음" : "없음");
  check(mm, "「30분 시작」 단추 320×48(x20)", "320×48@20", `${r1(m.startButtonBox.width)}×${r1(m.startButtonBox.height)}@${r1(m.startButtonBox.x)}`);
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
  check(mm, "위 글 분야 점 10×10(x36)", "있음", m.labelBox?.hasDot ? "있음" : "없음");
  check(mm, "위 글 글자 크기", "14px", m.labelBox?.fontSize);
  check(mm, "위 글 굵기", "400", m.labelBox?.fontWeight);
  check(mm, "위 글 색", GRAY, m.labelBox?.color);
  check(mm, "위 글 x(점 오른쪽, x52)", 52, r1(m.labelBox?.x ?? -1));
  check(mm, "시계 판 가운데 x", 180.5, r1(m.center.x));
  check(mm, "시계 판 가운데 y", 290.5, r1(m.center.y));
  check(mm, "상태 글 y(판 가운데에서 아래로)", 171.5, r1(m.belowCenter.status!));
  check(mm, "끝내기 단추 y(판 가운데에서 아래로)", 215.5, r1(m.belowCenter.button!));
  check(mm, "끝내기 단추 x", 20, r1(m.belowCenter.buttonX!));
}

const TIMER_STATES = [
  { id: "fix11-t1", file: "T1 타이머 도는 중(남은 24분 12초)", node: "158:60", data: "11-13 12:00 고정 · 「토익 단어 50개」 · 어학 · 남은 24:12(1452초) · 30분 한 바퀴", ratio: 1452 / 1800, color: "어학 #…", number: "24:12", status: "30분 타이머가 돌고 있어요", label: "토익 단어 50개 · 어학" },
  { id: "fix11-t5", file: "T5 30분이 다 됨(남은 0초)", node: "158:416", data: "11-13 12:00 고정 · 「토익 단어 50개」 · 어학 · 남은 00:00", ratio: 0, color: "", number: "00:00", status: "30분이 지났어요", label: "토익 단어 50개 · 어학" },
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
    checkTimerCommon(m, mm, { ratio: t.ratio, sectorColor, number: t.number, status: t.status, label: t.label });
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
