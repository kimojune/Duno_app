/** 먼저 할 일 건네기가 화면에 돌려주는 모양(서버 비밀 없음, 화면도 import해도 된다) */
export const OFFER_SURFACES = ["card", "timer_tab"] as const;
export type OfferSurface = (typeof OFFER_SURFACES)[number];

export type Offer = {
  /** 제시 기록 번호(먼저 한 기록의 offer_id가 된다) */
  id: string;
  surface: OfferSurface;
  day: string;
  /** 건넨 분야 */
  categoryId: string;
  categoryName: string;
  /** 건넨 할 일(없으면 분야만 건넨 것) */
  todoId: string | null;
  todoText: string | null;
  /** new = 아직 반응 없음, dismissed = 넘겼다, started = 그 제시로 타이머를 켰다 */
  state: "new" | "dismissed" | "started";
};

/** offer가 null이면 건네지 않은 것: evening = 저녁이라 카드를 안 건넴, no_target = 건넬 분야가 없음(비율·목표 없음) */
export type OfferRequestResult = { offer: Offer | null; reason?: "evening" | "no_target" };
export type DismissedOffer = { id: string };
