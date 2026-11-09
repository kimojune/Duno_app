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
 * 값은 디자인 명세 ① 확정 값이다(고침 5바퀴).
 * 서버·클라이언트 어디서나 쓰는 순수 모듈이다(import 없음).
 */

/** 색 토큰: CSS 변수 이름 → 값. 대문자 hex */
export const COLOR_TOKENS = {
  "--color-bg": "#FAF7F2",
  "--color-surface": "#FFFFFF",
  "--color-text": "#1C2340",
  "--color-text-sub": "#5E6478",
  "--color-primary": "#1C2340",
  "--color-primary-pressed": "#2E3350",
  "--color-secondary-pressed": "#E7E1D6",
  "--color-on-primary": "#FFFFFF",
  "--color-border-input": "#7D8299",
  "--color-border-check": "#5E6478",
  "--color-divider": "#E7E1D6",
  "--color-notice-bg": "#F3EEE6",
  "--color-skeleton": "#E7E1D6",
  /** 살구. 글자색·단추 채움으로 쓰지 않는다(흰 2.33 · 종이 2.18). 이번 판에는 쓰는 자리 없음(상태보기에도 쓰지 않는다) */
  "--color-accent": "#FF8A57",
  /** 분야 색을 칠한 그래픽의 1px 윤곽(= --color-text). 분야 색이 흰 바탕 3:1 미만이라 윤곽이 경계 대비를 맡는다(WCAG 1.4.11) */
  "--color-chart-outline": "#1C2340",
} as const;

/**
 * 분야 색 토큰(보드 원래 밝은 색, 디자인 명세 ① 「분야 색」). 번호 1~8은 분야 순서(lib/category-color.ts), other는 기타(분야 없음)다.
 * 이 색들은 바탕·면 색과 다르고 흰 바탕 3:1 미만이라, 칠한 그래픽에는 늘 CHART_OUTLINE 윤곽을 둔다.
 */
export const CATEGORY_COLOR_TOKENS = {
  "--color-category-1": "#7391FF",
  "--color-category-2": "#2DBE8C",
  "--color-category-3": "#AC8BFA",
  "--color-category-4": "#F5C33B",
  "--color-category-5": "#3BB8D0",
  "--color-category-6": "#E58AC7",
  "--color-category-7": "#A3B03A",
  "--color-category-8": "#8C97B8",
  "--color-category-other": "#CFCBC4",
} as const;

/**
 * 분야 색 그래픽의 윤곽 규칙(한 곳). CSS 공통 클래스 둘(app/globals.css 맨 끝 「분야 색 윤곽」 블록)의 이름이다.
 * - box: 색 점·칩 점·막대 채움·띠 칸 같은 HTML 요소. 안쪽 1px(크기를 바꾸지 않는다)
 * - svg: 원그래프·다이얼 조각 같은 SVG 도형. stroke 1px
 * 분야 색을 칠하는 요소에는 이 클래스를 단다(.dial-slice·.growth-* 현재 요소는 CSS가 같은 규칙을 직접 건다).
 */
export const CHART_OUTLINE = {
  box: "chart-outline",
  svg: "chart-outline-svg",
  color: "var(--color-chart-outline)",
  width: "1px",
} as const;

/** 글자 토큰: 이름 → 값(폰트 묶음 문자열). --font-family는 다른 글자 토큰이 var()로 가리킨다 */
export const FONT_TOKENS = {
  "--font-family": 'system-ui, -apple-system, "Noto Sans KR", sans-serif',
  "--font-name": "700 32px/40px var(--font-family)",
  "--font-title": "700 24px/32px var(--font-family)",
  "--font-body": "400 16px/24px var(--font-family)",
  "--font-sub": "400 14px/20px var(--font-family)",
  "--font-google": "500 14px/20px var(--font-family)",
  /** 상태보기 맨 위 목표 한 줄(PM 8). --font-hero는 만들지 않는다 */
  "--font-goal-line": "700 20px/28px var(--font-family)",
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
  /** 카드(상태보기 그래프 카드·오늘 기록 목록 카드·목표 비율 목록 카드) */
  "--radius-card": "16px",
  /** 주 단추·칩·보기/기간 고르기 */
  "--radius-pill": "999px",
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
