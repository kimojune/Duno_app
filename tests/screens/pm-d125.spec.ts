import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * PM d-125: 상태보기 · 이번 주 목표 뷰 · 목표를 세우지 않은 주의 「예시」 막대. 예시 글(분야 이름·「목표 n시간」)은 흐리지 않고
 * 보조 글 색(--color-text-sub, 흰 바탕 5.88:1)이며, 흐림(불투명 40%)은 막대(채움·점선·눈금)에만 남는다. 360×800 사진을 docs/oneshot-v2/고침5/에 둔다.
 * 개발 갤러리(/dev/v2?s=growth-week)의 화면이다. 개발 서버(3200)에서 돈다: npm run screens
 */
const OUT = path.resolve(__dirname, "../../docs/oneshot-v2/고침5");

test("PM d-125 360x800: 예시 글 넷은 보조 글 색·불투명 곱 1, 막대만 흐림, 「예시」 이름표·점선 그대로", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dev/v2?s=growth-week");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "이번 주 목표" }).click();
  const example = page.getByRole("group", { name: "예시" });
  await expect(example).toBeVisible();

  const r = await example.evaluate((root) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-text-sub)";
    document.body.appendChild(probe);
    const sub = getComputedStyle(probe).color;
    probe.style.color = "var(--color-surface)";
    const surface = getComputedStyle(probe).color;
    probe.remove();
    const opacityChain = (el: Element) => {
      let o = 1;
      for (let n: Element | null = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
      return o;
    };
    const texts = Array.from(root.querySelectorAll(".growth-example-item .growth-name, .growth-example-item .growth-goal-of")).map((el) => ({
      text: el.textContent,
      color: getComputedStyle(el).color,
      opacity: opacityChain(el),
    }));
    const bars = Array.from(root.querySelectorAll(".growth-example-item .growth-goal-bar")).map((el) => ({
      opacity: opacityChain(el),
      gapStyle: getComputedStyle(el.querySelector(".growth-goal-gap")!).borderTopStyle,
    }));
    const label = root.querySelector(".growth-example-label")!;
    return { sub, surface, texts, bars, label: { text: label.textContent, color: getComputedStyle(label).color, opacity: opacityChain(label) } };
  });

  expect(r.sub).toBe("rgb(94, 100, 120)"); // #5E6478
  expect(r.sub).not.toBe(r.surface);
  expect(r.texts.length).toBeGreaterThan(0);
  expect(r.texts.map((t) => t.text)).toEqual(["포트폴리오", "목표 6시간", "어학", "목표 5시간"]);
  for (const t of r.texts) {
    expect(t.color, `${t.text} 글 색`).toBe(r.sub);
    expect(t.opacity, `${t.text} 불투명 곱`).toBe(1);
  }
  // 막대는 여전히 흐리고(0.4) 빈 자리는 점선
  expect(r.bars.length).toBe(2);
  for (const b of r.bars) {
    expect(b.opacity).toBeCloseTo(0.4, 5);
    expect(b.gapStyle).toBe("dashed");
  }
  // 「예시」 이름표 그대로(보조 글 색, 흐리지 않음)
  expect(r.label).toEqual({ text: "예시", color: r.sub, opacity: 1 });

  const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(s.sw).toBeLessThanOrEqual(s.cw);
  await example.scrollIntoViewIfNeeded();
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, "PM-d125-예시막대.png"), fullPage: false });
});
