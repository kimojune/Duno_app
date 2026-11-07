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
