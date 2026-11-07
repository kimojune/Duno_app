import { dismissOffer, requestOffer } from "../app/offers/actions";
import type { DismissedOffer, OfferRequestResult, OfferSurface } from "./offers/types";
import type { RecordResult } from "./records/common";

/** 먼저 할 일 카드·타이머 추천이 서버를 부르는 길(브라우저 쪽). 실패는 던지지 않고 unavailable로 바꾼다 */
export type OffersApi = {
  /** 기기 먼저 저장 구현이면 true(고침 3바퀴): 쓰기가 기기에 먼저 반영되고 서버에는 뒤에서 가므로 끊겨 있어도 막지 않는다 */
  localFirst?: boolean;
  /** 그 자리에서 건넬 것을 받는다(같은 제시는 한 번만 센다) */
  request(surface: OfferSurface): Promise<RecordResult<OfferRequestResult>>;
  dismiss(id: string): Promise<RecordResult<DismissedOffer>>;
};

export const defaultOffersApi: OffersApi = {
  request: async (surface) => {
    try {
      return await requestOffer({ surface });
    } catch {
      return { ok: false, error: "unavailable" };
    }
  },
  dismiss: async (id) => {
    try {
      return await dismissOffer(id);
    } catch {
      return { ok: false, error: "unavailable" };
    }
  },
};
