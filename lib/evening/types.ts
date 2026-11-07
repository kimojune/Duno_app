import type { EveningItem, ItemDelta, SaveMode } from "./logic";

/** 저녁 기록이 화면에 돌려주는 모양(서버 비밀 없음, 화면도 import해도 된다) */

export type EveningLog = {
  id: string;
  /** 대상 날(두노 하루) */
  targetDay: string;
  totalMinutes: number;
  items: EveningItem[];
  saveMode: SaveMode;
  /** 서버가 저장한 시각 */
  savedAt: string;
};

/** 저녁 기록 화면이 열릴 때 읽는 것(그 날 기준) */
export type EveningState = {
  /** 서버가 보는 오늘(두노 하루) */
  today: string;
  /** 이 상태가 가리키는 대상 날 */
  day: string;
  /** 그 날 이미 저장한 기록(가장 늦은 것). 없으면 null */
  existing: EveningLog | null;
  /** 그 날 끝낸 할 일의 분야 번호(중복 없음, null은 기타) */
  doneCategoryIds: (string | null)[];
  /** 그 날 타이머로 진행한 시간(분야별, null은 기타) */
  timerByCategory: { categoryId: string | null; minutes: number }[];
  /** 고를 수 있는 분야(보관 안 한 것, 이름을 풀 수 있는 것) */
  categories: { id: string; name: string }[];
};

export type SavedEvening = {
  log: EveningLog;
  /** 그 날 앞선 기록 대비 분야별로 바뀐 시간(앞선 기록이 없으면 0에서 시작) */
  delta: ItemDelta[];
};
