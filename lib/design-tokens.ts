/**
 * 디자인 토큰 값의 한 출처. 색·글자·크기 값은 여기에만 적고, 다른 곳은 이 값과 같다는 것을 시험이 지킨다.
 *
 * - app/globals.css `:root` — CSS 변수. 값이 이 표와 정확히 같은지 tests/unit/design-tokens.test.ts가 본다.
 * - app/manifest.ts · app/layout.tsx — 이 표를 직접 가져다 쓴다(THEME_COLOR·BACKGROUND_COLOR).
 * - public/offline.html — 정적 파일이라 CSS 변수도 이 모듈도 못 읽는다. 자기 `:root`에 같은 값을 적어 두고, 시험이 같은지 본다.
 *
 * 디자인 값이 확정되면 이 표와 globals.css `:root`(와 offline.html `:root`)의 값만 바꾼다. 토큰 이름은 바꾸지 않는다
 * (글자 200% 흉내 시험이 이름으로 토큰을 덮어쓰므로, 이름이 바뀌면 흉내가 헛통과한다).
 *
 * 값은 지금 값 그대로다. 분야 색 아홉 개만 새로 더했고 그 값은 자리값이다(아래 CATEGORY_COLOR_TOKENS).
 * 서버·클라이언트 어디서나 쓰는 순수 모듈이다(import 없음).
 */

/** 색 토큰: CSS 변수 이름 → 값. 대문자 hex */
export const COLOR_TOKENS = {
  "--color-bg": "#FAFAF7",
  "--color-surface": "#FFFFFF",
  "--color-text": "#1C1C1A",
  "--color-text-sub": "#5C5B55",
  "--color-primary": "#2F5D50",
  "--color-primary-pressed": "#24493F",
  "--color-secondary-pressed": "#E3E1D9",
  "--color-on-primary": "#FFFFFF",
  "--color-border-input": "#7A7972",
  "--color-border-check": "#5C5B55",
  "--color-divider": "#E6E4DD",
  "--color-notice-bg": "#EFEDE6",
  "--color-skeleton": "#E6E4DD",
} as const;

/**
 * 분야 색 토큰(자리값). 임시, 디자인 확정 뒤 바꾼다. 지금 색 토큰에서 고른 값이라 새 색은 아니다.
 * 번호 1~8은 분야 순서(lib/category-color.ts), other는 기타(분야 없음)다.
 */
export const CATEGORY_COLOR_TOKENS = {
  "--color-category-1": "#2F5D50",
  "--color-category-2": "#24493F",
  "--color-category-3": "#5C5B55",
  "--color-category-4": "#7A7972",
  "--color-category-5": "#1C1C1A",
  "--color-category-6": "#E3E1D9",
  "--color-category-7": "#EFEDE6",
  "--color-category-8": "#E6E4DD",
  "--color-category-other": "#7A7972",
} as const;

/** 글자 토큰: 이름 → 값(폰트 묶음 문자열). --font-family는 다른 글자 토큰이 var()로 가리킨다 */
export const FONT_TOKENS = {
  "--font-family": 'system-ui, -apple-system, "Noto Sans KR", sans-serif',
  "--font-name": "700 32px/40px var(--font-family)",
  "--font-title": "700 24px/32px var(--font-family)",
  "--font-body": "400 16px/24px var(--font-family)",
  "--font-sub": "400 14px/20px var(--font-family)",
  "--font-google": "500 14px/20px var(--font-family)",
} as const;

/** 크기 토큰 */
export const SIZE_TOKENS = {
  "--tap-min": "48px",
  "--page-x": "16px",
  "--page-max": "480px",
} as const;

/** 모서리 토큰 */
export const RADIUS_TOKENS = {
  "--radius-control": "8px",
  "--radius-check": "4px",
} as const;

/** 위 표를 모두 합친 것(이름 → 값). 시험이 globals.css와 견줄 때 쓴다 */
export const ALL_TOKENS: Readonly<Record<string, string>> = {
  ...COLOR_TOKENS,
  ...CATEGORY_COLOR_TOKENS,
  ...FONT_TOKENS,
  ...SIZE_TOKENS,
  ...RADIUS_TOKENS,
};

/** 주소창·상태 줄 색(app/layout.tsx viewport.themeColor, app/manifest.ts theme_color) = 주색 */
export const THEME_COLOR = COLOR_TOKENS["--color-primary"];
/** 설치한 앱을 열 때 처음 비치는 바탕색(app/manifest.ts background_color) = 바탕색 */
export const BACKGROUND_COLOR = COLOR_TOKENS["--color-bg"];
