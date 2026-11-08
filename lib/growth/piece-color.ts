/**
 * 상태보기 조각(띠그래프·원그래프·분야 줄의 색점)의 색을 정하는 한 군데.
 * 임시: 지금 있는 색 토큰을 돌려 쓴다(색 값은 새로 정하지 않는다). 분야 색 배정 함수(lib/category-color.ts, --color-category-*)는
 * 겉모습 워커가 따로 만든다. 합치기 워커는 이 함수 하나만 그 함수로 바꾸면 된다 — 조각 색을 부르는 곳은 모두 이 함수를 거친다.
 *
 * @param categoryId 분야 번호(기타는 null)
 * @param index 조각 자리(받은 분야 순서, 기타는 맨 끝). 분야 번호 대신 자리로 색을 돌려 쓰는 임시 방식이다
 * @returns CSS 색 값(var(--…) 꼴)
 */
const TEMP_FILLS = [
  "var(--color-primary)",
  "var(--color-text-sub)",
  "var(--color-border-input)",
  "var(--color-primary-pressed)",
  "var(--color-border-check)",
] as const;

export function pieceColor(categoryId: string | null, index: number): string {
  if (categoryId === null) return "var(--color-skeleton)";
  return TEMP_FILLS[((index % TEMP_FILLS.length) + TEMP_FILLS.length) % TEMP_FILLS.length];
}
