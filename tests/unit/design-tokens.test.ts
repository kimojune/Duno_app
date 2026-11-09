import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { viewport } from "../../app/layout";
import manifest from "../../app/manifest";
import {
  ALL_TOKENS,
  BACKGROUND_COLOR,
  CATEGORY_COLOR_TOKENS,
  CHART_OUTLINE,
  COLOR_TOKENS,
  FONT_TOKENS,
  RADIUS_TOKENS,
  THEME_COLOR,
} from "../../lib/design-tokens";
import { buildText200Css } from "../screens/text200-css";

/**
 * 토큰 값의 한 출처(lib/design-tokens.ts)와 그것을 쓰는 곳이 같은 값인지 지킨다.
 * 디자인 값이 확정되면 출처 표와 globals.css(·offline.html) :root의 값만 바꾸면 이 시험이 그대로 통과해야 한다.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const css = read("app/globals.css");
const offline = read("public/offline.html");

/** CSS 주석을 걷어 낸다 */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
/** 쉼표 둘레·연속 공백 차이는 같은 값으로 본다(offline.html은 줄여 적었다) */
const norm = (value: string) => value.replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").trim();

/** `:root { … }` 블록 하나의 안쪽. 블록이 정확히 하나여야 한다 */
function rootBlock(text: string): string {
  const stripped = stripComments(text);
  const blocks = [...stripped.matchAll(/:root\s*\{([^}]*)\}/g)];
  expect(blocks, ":root 블록은 하나").toHaveLength(1);
  return blocks[0][1];
}

/** `--이름: 값;` 목록(값 안의 따옴표·쉼표·괄호를 그대로 둔다) */
function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = norm(m[2]);
  return out;
}

describe("globals.css :root가 출처 표와 같다", () => {
  const declared = declarations(rootBlock(css));

  it("출처 표의 모든 토큰이 globals.css에 같은 값으로 있다", () => {
    for (const [name, value] of Object.entries(ALL_TOKENS)) {
      expect(declared[name], name).toBe(norm(value));
    }
  });

  it("globals.css의 색·글자 토큰은 출처 표에 모두 있다(표에 없는 색을 몰래 더하지 않는다)", () => {
    const tracked = Object.keys(declared).filter((name) => /^--(color|font)-/.test(name));
    for (const name of tracked) expect(Object.keys(ALL_TOKENS), `${name}이 출처 표에 없음`).toContain(name);
  });

  it("출처 표의 색 값은 모두 대문자 hex 여섯 자리다", () => {
    for (const [name, value] of Object.entries({ ...COLOR_TOKENS, ...CATEGORY_COLOR_TOKENS })) {
      expect(value, name).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it(":root와 Google 단추 밖에서는 css가 색 hex를 직접 쓰지 않는다", () => {
    // 토큰을 거치지 않은 색을 막는다. Google 단추 값은 Google 지침이라 토큰이 아니다(login-states.test.tsx가 값을 본다)
    let rest = stripComments(css).replace(/:root\s*\{[^}]*\}/, "");
    rest = rest.replace(/\.google-btn(:active)?\s*\{[^}]*\}/g, "");
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? []).toEqual([]);
  });
});

describe("manifest·layout이 출처 표의 색을 쓴다", () => {
  it("THEME_COLOR는 주색, BACKGROUND_COLOR는 바탕색 토큰이다", () => {
    expect(THEME_COLOR).toBe(COLOR_TOKENS["--color-primary"]);
    expect(BACKGROUND_COLOR).toBe(COLOR_TOKENS["--color-bg"]);
  });

  it("manifest theme_color·background_color가 표와 같다(대소문자는 같은 색)", () => {
    const m = manifest();
    expect(m.theme_color?.toUpperCase()).toBe(THEME_COLOR);
    expect(m.background_color?.toUpperCase()).toBe(BACKGROUND_COLOR);
  });

  it("layout viewport.themeColor가 표의 주색이다", () => {
    expect(String(viewport.themeColor).toUpperCase()).toBe(THEME_COLOR);
  });

  it("app·components·lib의 코드는 색 hex를 직접 쓰지 않는다(출처 표 제외)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name) && rel !== "lib/design-tokens.ts") {
          if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])|rgba?\(|hsla?\(/.test(stripComments(read(rel)))) offenders.push(rel);
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(dir);
    expect(offenders).toEqual([]);
  });
});

describe("offline.html이 출처 표와 같은 값을 쓴다", () => {
  const declared = declarations(rootBlock(offline));

  it(":root에 적은 색·글자·크기 토큰이 모두 표의 값과 같다", () => {
    const names = Object.keys(declared);
    expect(names.length, "offline.html :root에 토큰이 있다").toBeGreaterThan(5);
    for (const name of names) {
      expect(ALL_TOKENS[name], `${name}이 출처 표에 없음`).toBeDefined();
      expect(declared[name], name).toBe(norm(ALL_TOKENS[name]));
    }
    // 이 화면이 실제로 쓰는 토큰은 빠짐없이 있어야 한다(var()로 가리키는데 정의가 없으면 색이 안 나온다)
    const used = new Set([...offline.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    for (const name of used) expect(declared[name], `${name}을 쓰는데 :root에 없음`).toBeDefined();
  });

  it(":root 밖에서는 색 hex를 직접 쓰지 않는다", () => {
    const rest = stripComments(offline).replace(/:root\s*\{[^}]*\}/, "");
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? []).toEqual([]);
  });

  it("글자 토큰 표에는 --font-family가 있어 offline.html의 var(--font-family)가 풀린다", () => {
    expect(FONT_TOKENS["--font-family"]).toBeDefined();
    expect(declared["--font-family"]).toBe(norm(FONT_TOKENS["--font-family"]));
  });
});

describe("고침 5바퀴 확정 값(디자인 명세 ①)", () => {
  const declared = declarations(rootBlock(css));

  it("색 토큰 새 값: 바탕·글자·주색·보조 글자·눌림·경계·면", () => {
    expect(COLOR_TOKENS).toMatchObject({
      "--color-bg": "#FAF7F2",
      "--color-text": "#1C2340",
      "--color-text-sub": "#5E6478",
      "--color-primary": "#1C2340",
      "--color-primary-pressed": "#2E3350",
      "--color-secondary-pressed": "#E7E1D6",
      "--color-border-input": "#7D8299",
      "--color-border-check": "#5E6478",
      "--color-divider": "#E7E1D6",
      "--color-notice-bg": "#F3EEE6",
      "--color-skeleton": "#E7E1D6",
    });
    expect(THEME_COLOR).toBe("#1C2340");
    expect(BACKGROUND_COLOR).toBe("#FAF7F2");
  });

  it("새 토큰 다섯이 출처 표와 globals.css :root에 같은 값으로 있다(--font-hero는 만들지 않는다)", () => {
    const fresh = {
      "--color-accent": "#FF8A57",
      "--color-chart-outline": "#1C2340",
      "--radius-card": "16px",
      "--radius-pill": "999px",
      "--font-goal-line": "700 20px/28px var(--font-family)",
    };
    for (const [name, value] of Object.entries(fresh)) {
      expect(ALL_TOKENS[name], `${name} 출처 표`).toBe(value);
      expect(declared[name], `${name} globals.css`).toBe(norm(value));
    }
    expect(ALL_TOKENS["--font-hero"]).toBeUndefined();
    expect(declared["--font-hero"]).toBeUndefined();
    expect(COLOR_TOKENS["--color-chart-outline"]).toBe(COLOR_TOKENS["--color-text"]);
    expect(Object.keys(RADIUS_TOKENS)).toEqual(expect.arrayContaining(["--radius-card", "--radius-pill"]));
  });

  it("살구(--color-accent)는 글자색·단추 채움·테두리로 쓰지 않는다(이번 판에는 쓰는 자리 없음)", () => {
    const rest = stripComments(css).replace(/:root\s*\{[^}]*\}/, "");
    expect(rest).not.toContain("--color-accent");
    for (const dir of ["app", "components"]) {
      const walk = (d: string): string[] =>
        fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []));
      for (const f of walk(dir)) expect(read(f), f).not.toContain("--color-accent");
    }
  });

  it("주 단추·칩은 알약(--radius-pill), 카드는 --radius-card, 주 단추 채움은 --color-primary", () => {
    const rule = (selector: string) => {
      const m = stripComments(css).match(new RegExp(String.raw`(?:^|\n)${selector.replace(/[.]/g, String.raw`\.`)}\s*\{([^}]*)\}`));
      expect(m, `${selector} 규칙`).not.toBeNull();
      return m![1];
    };
    expect(rule(".btn")).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(rule(".chip-face")).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(rule(".entry-card")).toMatch(/border-radius:\s*var\(--radius-card\)/);
    expect(rule(".btn-primary")).toMatch(/background:\s*var\(--color-primary\)/);
  });

  it("분야 색 윤곽: 공통 클래스 둘이 --color-chart-outline 1px이고, 이미 있는 분야 색 그래픽도 같은 규칙에 든다", () => {
    expect(CHART_OUTLINE).toMatchObject({ box: "chart-outline", svg: "chart-outline-svg", width: "1px", color: "var(--color-chart-outline)" });
    const text = stripComments(css);
    const box = text.match(/([^{}]*)\{\s*box-shadow:\s*inset 0 0 0 1px var\(--color-chart-outline\);\s*\}/);
    const svg = text.match(/([^{}]*)\{\s*stroke:\s*var\(--color-chart-outline\);\s*stroke-width:\s*1;\s*\}/);
    expect(box, "HTML 그래픽 윤곽 규칙").not.toBeNull();
    expect(svg, "SVG 그래픽 윤곽 규칙").not.toBeNull();
    const boxSel = box![1].split(",").map((x) => x.trim());
    const svgSel = svg![1].split(",").map((x) => x.trim());
    expect(boxSel).toEqual(expect.arrayContaining([`.${CHART_OUTLINE.box}`, ".growth-dot", ".growth-bar-fill", ".growth-band-seg"]));
    expect(svgSel).toEqual(expect.arrayContaining([`.${CHART_OUTLINE.svg}`, ".dial-slice", ".growth-pie-slice"]));
    // 윤곽 규칙이 파일 맨 끝에 있어 앞의 규칙(조각 사이 흰 선 등)보다 나중에 이긴다
    expect(text.lastIndexOf(box![0])).toBeGreaterThan(text.indexOf(".growth-band-seg {"));
    expect(text.lastIndexOf(svg![0])).toBeGreaterThan(text.indexOf(".dial-slice {"));
  });

  it("offline.html 단추도 알약이고 offline :root가 --radius-pill을 같은 값으로 가진다", () => {
    expect(declarations(rootBlock(offline))["--radius-pill"]).toBe("999px");
    expect(stripComments(offline)).toMatch(/\.btn\{[^}]*border-radius:var\(--radius-pill\)/);
  });
});

describe("글자 200% 흉내가 출처 표의 글자 토큰을 모두 본다", () => {
  it("--font-family 말고 모든 글자 토큰(새 --font-goal-line 포함)을 px 두 배로 덮는다", () => {
    const sim = declarations(rootBlock(buildText200Css()));
    const names = Object.keys(FONT_TOKENS).filter((n) => n !== "--font-family");
    expect(names).toContain("--font-goal-line");
    expect(Object.keys(sim).sort()).toEqual([...names].sort());
    expect(sim["--font-goal-line"]).toBe("700 40px/56px var(--font-family)");
    expect(sim["--font-body"]).toBe("400 32px/48px var(--font-family)");
  });
});
