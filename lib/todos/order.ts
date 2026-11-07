/**
 * 할 일 순서(todos.position, null 허용). 서버(manage-core)와 기기(lib/local)가 같은 규칙을 쓰려고 서버 전용 모듈 밖에 둔다.
 * position 오름차순(null은 뒤), 같으면 들어온 순서 그대로(안정 정렬).
 */
export function sortByPosition<T extends { position?: number | null }>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const pa = a.row.position ?? Number.POSITIVE_INFINITY;
      const pb = b.row.position ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa < pb ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}
