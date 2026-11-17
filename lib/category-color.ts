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

/**
 * 분야의 색 순서 정하기(MO-46). 서버가 정한 고정 칸(categories.color_order: 보관한 분야까지 포함한 만든 순서, 0부터)이 있으면 그것을,
 * 없으면(null·undefined: 마이그레이션 전 사본 등) 화면 순서(fallbackOrder)를 쓴다. 기타(분야 없음)는 둘 다 null이다.
 * 고정 칸 덕에 분야 하나를 보관해도 다른 분야의 색 번호가 바뀌지 않는다. 색 번호는 categoryColorNumber(결과)다.
 */
export function resolveColorOrder(colorOrder: number | null | undefined, fallbackOrder: number | null): number | null {
  if (typeof colorOrder === "number" && Number.isFinite(colorOrder) && colorOrder >= 0) return colorOrder;
  return fallbackOrder;
}

/** 색 순서를 가진 분야 한 줄(분야 목록 항목 모두가 이 모양을 만족한다) */
export type ColorOrdered = { id: string; colorOrder?: number | null };

/**
 * 화면이 쓰는 색 순서: 분야 목록(화면 순서 = 보관하지 않은 분야를 만든 순서)에서 id의 색 순서.
 * 고정 칸(colorOrder)이 있으면 그것을, 없으면 목록에서의 자리를 쓴다. 목록에 없거나 기타(null)면 null(기타 색).
 * 화면은 categoryColorValue에 순서를 넘길 때 항상 이 함수를 거친다(목록의 자리를 직접 넘기지 않는다).
 */
export function colorOrderIn(list: readonly ColorOrdered[], id: string | null): number | null {
  if (id === null) return null;
  const at = list.findIndex((c) => c.id === id);
  if (at < 0) return null;
  return resolveColorOrder(list[at].colorOrder, at);
}

/** 목록의 모든 분야 → 색 순서(고정 칸이 있으면 그것, 없으면 목록에서의 자리). 상태보기 조각 색이 쓴다 */
export function colorOrderRecord(list: readonly ColorOrdered[]): Record<string, number> {
  return Object.fromEntries(list.map((c, at) => [c.id, resolveColorOrder(c.colorOrder, at) as number]));
}

/** 목록의 모든 분야 → 색 번호(1~8) */
export function colorNumbersIn(list: readonly ColorOrdered[]): Record<string, number> {
  return Object.fromEntries(list.map((c, at) => [c.id, categoryColorNumber(resolveColorOrder(c.colorOrder, at) as number)]));
}
