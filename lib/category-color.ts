/**
 * 분야 색 배정(고침 4바퀴, PM 확정 11-08: 분야 한도 50, 9번째부터 돌려 씀).
 * 분야 순서(0부터) → 색 번호 1~8. 9번째 분야(순서 8)부터 다시 1로 돌아간다. 기타(분야 없음)는 따로 기타 색이다.
 * 색 값은 여기 없다. 이 함수는 번호와 CSS 변수 이름만 돌려주고, 값은 app/globals.css `:root`의
 * `--color-category-1` ~ `--color-category-8`, `--color-category-other`(값의 출처는 lib/design-tokens.ts)가 정한다.
 * 그래서 디자인 값이 오면 이 파일은 그대로 두고 표와 globals.css만 바꾼다.
 *
 * 쓰는 곳(조각 색을 정하는 곳은 이 파일의 categoryColorValue 하나다): 처음 정한 비율 다이얼(components/ratio-editor.tsx),
 * 저녁 나누기 다이얼(components/evening-record.tsx), 상태보기 띠·원·분야 줄 막대·색점(components/growth-views.tsx).
 * 세 화면은 같은 분야 순서를 쓴다: 보관하지 않고 이름을 읽을 수 있는 내 분야를 만든 순서(created_at 오름차순, 같으면 id)에서의 자리(0부터).
 * 기타는 자리가 없고(null) 늘 기타 색이다.
 * 색만으로 분야를 가르지 않는다: 이 함수를 쓰는 화면은 분야 이름 글을 같이 보여 준다(WCAG 1.4.1).
 * 서버·클라이언트 어디서나 쓰는 순수 모듈이다.
 */

/** 돌려 쓰는 색 개수. 분야 한도(50)보다 작아 9번째부터 다시 1번을 쓴다 */
export const CATEGORY_COLOR_COUNT = 8;

/** 기타(분야 없음)를 가리키는 키 */
export const CATEGORY_COLOR_OTHER = "other" as const;

export type CategoryColorKey = number | typeof CATEGORY_COLOR_OTHER;

export type CategoryColor = {
  /** 1~8, 또는 기타면 "other" */
  key: CategoryColorKey;
  /** CSS 변수 이름. 예: "--color-category-3", "--color-category-other" */
  cssVar: string;
  /** 스타일에 그대로 넣는 값. 예: "var(--color-category-3)" */
  cssValue: string;
};

/**
 * 분야 순서(0부터) → 색 번호 1~8. 0→1, 7→8, 8→1, 49→2.
 * 순서는 정수여야 하지만 방어한다: 소수는 버리고(내림이 아니라 0 쪽으로), 음수는 반대쪽에서 센다(-1→8),
 * NaN·무한대는 첫 색(1)으로 둔다. 어떤 입력이어도 1~8 안이다.
 */
export function categoryColorNumber(order: number): number {
  if (typeof order !== "number" || !Number.isFinite(order)) return 1;
  const whole = Math.trunc(order);
  return ((((whole % CATEGORY_COLOR_COUNT) + CATEGORY_COLOR_COUNT) % CATEGORY_COLOR_COUNT) + 1);
}

/** 색 번호(또는 "other")의 CSS 변수 이름 */
export function categoryColorVar(key: CategoryColorKey): string {
  return `--color-category-${key}`;
}

/**
 * 분야의 색. order는 분야 순서(0부터), 기타(분야 없음, categoryId null)는 null.
 * 순서는 화면이 보여 주는 분야 순서(만든 순서)를 쓴다. 분야를 지우면 뒤 분야의 색이 한 칸씩 당겨질 수 있다(임시).
 */
export function categoryColor(order: number | null): CategoryColor {
  if (order === null) {
    const cssVar = categoryColorVar(CATEGORY_COLOR_OTHER);
    return { key: CATEGORY_COLOR_OTHER, cssVar, cssValue: `var(${cssVar})` };
  }
  const key = categoryColorNumber(order);
  const cssVar = categoryColorVar(key);
  return { key, cssVar, cssValue: `var(${cssVar})` };
}

/** 스타일에 그대로 넣는 색 값(var(--color-category-N)). 다이얼·상태보기가 조각 색을 정할 때 부르는 한 군데. 기타는 null */
export function categoryColorValue(order: number | null): string {
  return categoryColor(order).cssValue;
}
