import { FONT_TOKENS } from "../../lib/design-tokens";

/**
 * 글자 200% 흉내 CSS. 출처 표(lib/design-tokens.ts FONT_TOKENS)의 글자 토큰을 이름으로 모두 읽어 px를 두 배로 한다.
 * 새 글자 토큰(예: --font-goal-line)이 생기면 여기서 저절로 따라온다(손으로 적은 목록에 빠지지 않는다).
 */
export function buildText200Css(): string {
  const lines = Object.entries(FONT_TOKENS)
    .filter(([name]) => name !== "--font-family")
    .map(([name, value]) => {
      const doubled = value.replace(/(\d+(?:\.\d+)?)px/g, (_, n: string) => `${Number(n) * 2}px`);
      return `  ${name}: ${doubled};`;
    });
  return `:root{\n${lines.join("\n")}\n}`;
}

export const TEXT200_CSS = buildText200Css();
