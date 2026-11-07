import { endFocus, startFocus } from "../app/focus/actions";
import type { EndedFocus, FocusState, FocusSurface, StartedFocus } from "./focus/types";
import { getJson } from "./manage-api";
import type { RecordResult } from "./records/common";

/**
 * 타이머 화면이 서버를 부르는 길(브라우저 쪽). 화면은 이 모양의 객체를 받고, 시험은 가짜를 넣는다.
 * 실패는 던지지 않고 unavailable로 바꾼다.
 */
export type FocusStartInput = {
  id: string;
  todoId?: string | null;
  categoryId?: string | null;
  offerId?: string | null;
  surface: FocusSurface;
  /** 기기 시계(서버 시각과 따로 남긴다) */
  clientStartedAt: string;
};

export type FocusApi = {
  fetchState(): Promise<RecordResult<FocusState>>;
  start(input: FocusStartInput): Promise<RecordResult<StartedFocus>>;
  end(id: string): Promise<RecordResult<EndedFocus>>;
};

export const defaultFocusApi: FocusApi = {
  fetchState: () => getJson("/focus"),
  start: async (input) => {
    try {
      return await startFocus(input);
    } catch {
      return { ok: false, error: "unavailable" };
    }
  },
  end: async (id) => {
    try {
      return await endFocus(id);
    } catch {
      return { ok: false, error: "unavailable" };
    }
  },
};
