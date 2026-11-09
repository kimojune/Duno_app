// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PrimaryButton, SecondaryButton, TextButton } from "../../components/ui";

/**
 * 고침10 C 글자·선 굵기(Figma 49:174 · 121:445 · 147:2, PM 2). 단추 부품(components/ui.tsx)과 공통 CSS 한 곳에서 바꾼다.
 * - 단추 글은 모두 Bold(주·보조·확인 창) — .btn
 * - 글 단추(TextButton — 「균등 배분」·「접기」·「지우기」·「건너뛰기」 등)는 14 Medium — .btn-text
 * - 보조 단추 테두리 1.5. 입력 칸 테두리는 1 --color-border-input 그대로
 * - 이름표(「체험 코드」·「새 분야 이름」·「분야」 등 .input-label · .sheet-label)는 12 Regular 보조색
 */
const CSS = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return CSS.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? "";
};

afterEach(cleanup);

describe("고침10 C 단추 글 굵기 · 선", () => {
  it(".btn(주·보조 단추 공통)은 16 Bold, 글 단추 .btn-text는 14 Medium으로 덮는다", () => {
    const btn = CSS.match(/\n\.btn \{([^}]*)\}/)?.[1] ?? "";
    expect(btn).toMatch(/font: var\(--font-body\);/);
    expect(btn).toMatch(/font-weight: 700;/);
    expect(rule(".btn-text")).toMatch(/font: 500 0\.875rem\/1\.25rem var\(--font-family\)/);
  });

  it("보조 단추 테두리 1.5, 입력 칸 테두리는 1 --color-border-input 그대로", () => {
    expect(rule(".btn-secondary")).toMatch(/border-width: 0; box-shadow: inset 0 0 0 1\.5px var\(--color-primary\);/);
    // 「+ 5분」 같은 입력 꼴 단추(1px 회색 테두리)는 보조 단추 선을 받지 않는다
    expect(rule(".time-wheel-nudge-btn")).toMatch(/border-width: 1px; box-shadow: none; border-color: var\(--color-border-input\);/);
    expect(CSS).toMatch(/\.input \{[^}]*border: 1px solid var\(--color-border-input\)/);
  });

  it("단추 부품 셋이 같은 클래스를 단다(한 곳에서 바뀐다)", () => {
    render(
      <>
        <PrimaryButton>저장</PrimaryButton>
        <SecondaryButton>작업 기록 남기기</SecondaryButton>
        <TextButton>균등 배분</TextButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "저장" }).className).toBe("btn btn-primary");
    expect(screen.getByRole("button", { name: "작업 기록 남기기" }).className).toBe("btn btn-secondary");
    expect(screen.getByRole("button", { name: "균등 배분" }).className).toBe("btn btn-text");
  });

  it("이름표 .input-label · .sheet-label은 12 Regular 보조색(적는 창 머리 「할 일」은 창 제목이라 16 Bold 글색)", () => {
    expect(rule(".input-label")).toMatch(/font: 400 0\.75rem\/1rem var\(--font-family\); color: var\(--color-text-sub\);/);
    expect(rule(".sheet-label")).toMatch(/font: 400 0\.75rem\/1rem var\(--font-family\); color: var\(--color-text-sub\);/);
    expect(CSS).toMatch(/\.todo-sheet \.(?:sheet-head|screen-head) \.sheet-label \{ font: var\(--font-body\); font-weight: 700; color: var\(--color-text\); \}/);
  });

  it("단추 글을 Regular(400)로 되돌리는 .btn 규칙이 없다(「저장」·「작업 기록 남기기」·「30분 시작」·확인 창)", () => {
    const btnRules = [...CSS.matchAll(/([^{}\n]*\.btn[^{}\n]*)\{([^}]*)\}/g)];
    const regular = btnRules.filter(([, sel, body]) => !/btn-text|growth-switch|row-detail-btn/.test(sel) && /font(-weight)?:\s*400\b|font: var\(--font-(body|sub)\);(?![^}]*font-weight)/.test(body));
    expect(regular.map(([, sel]) => sel.trim()).filter((sel) => sel !== ".btn"), "Regular로 덮는 단추 규칙").toEqual([]);
  });
});
