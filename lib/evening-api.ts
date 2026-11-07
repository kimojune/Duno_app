import { saveEveningLog } from "../app/evening/actions";
import type { EveningState, SavedEvening } from "./evening/types";
import { getJson } from "./manage-api";
import type { RecordResult } from "./records/common";
import type { EveningItem, SaveMode } from "./evening/logic";

/**
 * 저녁 기록 화면이 서버를 부르는 길(브라우저 쪽). 화면은 이 모양의 객체를 받고, 시험은 가짜를 넣는다.
 * 실패는 던지지 않고 unavailable로 바꾼다.
 */
export type EveningSaveInput = {
  id: string;
  targetDay: string;
  totalMinutes: number;
  items: EveningItem[];
  saveMode: SaveMode;
  /** 기기 시계(서버 시각과 따로 남긴다) */
  clientSavedAt: string;
};

export type EveningApi = {
  /** 기기 먼저 저장 구현이면 true(고침 3바퀴): 쓰기가 기기에 먼저 반영되고 서버에는 뒤에서 가므로 끊겨 있어도 막지 않는다 */
  localFirst?: boolean;
  /** day를 안 주면 오늘 */
  fetchState(day?: string): Promise<RecordResult<EveningState>>;
  save(input: EveningSaveInput): Promise<RecordResult<SavedEvening>>;
};

export const defaultEveningApi: EveningApi = {
  fetchState: (day) => getJson(day ? `/evening?day=${encodeURIComponent(day)}` : "/evening"),
  save: async (input) => {
    try {
      return await saveEveningLog(input);
    } catch {
      return { ok: false, error: "unavailable" };
    }
  },
};
