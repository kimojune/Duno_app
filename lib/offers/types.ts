/** 먼저 할 일 건네기가 화면에 돌려주는 모양(서버 비밀 없음, 화면도 import해도 된다) */
export const OFFER_SURFACES = ["card", "timer_tab"] as const;
export type OfferSurface = (typeof OFFER_SURFACES)[number];

export type Offer = {
  /** 제시 기록 번호(먼저 한 기록의 offer_id가 된다) */
  id: string;
  surface: OfferSurface;
  day: string;
  /** 건넨 분야. null은 기타(처음 정한 비율에 기타를 넣었을 때) */
  categoryId: string | null;
  categoryName: string;
  /** 건넨 할 일(없으면 분야만 건넨 것) */
  todoId: string | null;
  todoText: string | null;
  /** 건넨 할 일을 적은 날(두노 하루). 오늘 것이면 오늘 날짜, 지난 날 것이면 그 날(카드가 「오늘 할 일에 추가」를 보일지 가른다). 할 일이 없으면 null */
  todoDay: string | null;
  /** new = 아직 반응 없음, dismissed = 넘겼다, started = 그 제시로 타이머를 켰다 */
  state: "new" | "dismissed" | "started";
};

/** offer가 null이면 건네지 않은 것 */
/** reason: no_target = 건넬 분야 없음, done = 그날 건넨 카드가 가리키는 할 일을 끝냈거나 지워서 카드를 접었다(새 제시 없음) */
export type OfferRequestResult = { offer: Offer | null; reason?: "no_target" | "done" };
export type DismissedOffer = { id: string };

/**
 * 「오늘 할 일에 추가」(고침 11) 결과. added = true면 오늘 사본이 있다(todoId는 제시 id에서 정한 사본 id).
 * added = false는 사본을 만들지 않은 것이다(원본이 그새 끝났거나 지워졌거나 이미 오늘 것): 화면은 카드를 다시 받는다.
 */
export type AddOfferTodoResult = { added: true; todoId: string; todoText: string | null; day: string } | { added: false };
