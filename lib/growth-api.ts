import { recordView } from "../app/views/actions";
import type { GrowthData } from "./growth/types";
import { getJson } from "./manage-api";
import type { CategoryPageData } from "./notes/types";
import type { RecordResult } from "./records/common";
import type { ViewEntry, ViewScreen } from "./views/core-types";

/**
 * 상태보기·분야 페이지 화면이 서버를 부르는 길(브라우저 쪽). 화면은 이 모양의 객체를 받고, 시험은 가짜를 넣는다.
 * 실패는 던지지 않고 unavailable로 바꾼다. 화면 본 것 기록(recordView)이 실패해도 화면은 그대로다.
 */
export type GrowthApi = {
  /** 기기 먼저 저장 구현이면 true(고침 3바퀴): 쓰기가 기기에 먼저 반영되고 서버에는 뒤에서 가므로 끊겨 있어도 막지 않는다 */
  localFirst?: boolean;
  /**
   * 상태보기에서 고른 기간·보기 방식을 이 기기·이 사용자에 기억하는 길(기기 먼저 저장 구현에만 있다. 없으면 기억하지 않고 처음 값으로 돈다).
   * load는 저장된 값을 그대로(믿지 않는다: 화면이 parseStatusPref로 걸러 읽는다), 실패하면 undefined. save는 던지지 않는다
   */
  viewPref?: { load(): Promise<unknown>; save(value: unknown): Promise<void> };
  fetchGrowth(): Promise<RecordResult<GrowthData>>;
  fetchCategoryPage(categoryId: string | null): Promise<RecordResult<CategoryPageData>>;
  /** 화면이 그려진 뒤 한 번. id는 화면이 만든 uuid */
  recordView(input: { id: string; screen: ViewScreen; entry: ViewEntry }): Promise<unknown>;
};

export const defaultGrowthApi: GrowthApi = {
  fetchGrowth: () => getJson("/growth"),
  fetchCategoryPage: (categoryId) => getJson(`/category?id=${encodeURIComponent(categoryId ?? "other")}`),
  recordView: async (input) => {
    try {
      return await recordView(input);
    } catch {
      return { ok: false, error: "unavailable" };
    }
  },
};
