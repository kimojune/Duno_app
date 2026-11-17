import type { CategoryItem } from "./types";

/**
 * 읽을 수 있는 분야(이름을 풀 수 있는 것)만 {id, name}으로 줄인다. 분야 색 고정 칸(colorOrder)이 있으면 함께 싣는다
 * (화면이 색 순서를 lib/category-color.ts의 colorOrderIn으로 정할 때 쓴다). 화면 순서는 받은 순서 그대로다.
 */
export type ReadableCategory = { id: string; name: string; colorOrder?: number };

export function toReadable(list: readonly CategoryItem[]): ReadableCategory[] {
  return list.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name, ...(c.colorOrder !== undefined ? { colorOrder: c.colorOrder } : {}) }] : []));
}
