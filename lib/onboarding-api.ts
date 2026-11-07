import { addCategory } from "../app/todos/actions";
import { saveRatios, saveSettings } from "../app/settings/actions";
import type { AddCategoryResult } from "./categories/types";
import type { PermissionState } from "./push/client";
import { defaultPushApi } from "./push/subscribe";
import type { RecordResult } from "./records/common";
import type { NotifySettings, RatioItem, SettingsData } from "./settings/types";

/**
 * 처음 설정·내 정보 화면이 서버를 부르는 길(브라우저 쪽). 화면은 이 모양의 객체를 받아, 시험은 가짜를 넣는다.
 * 실패는 던지지 않고 unavailable로 바꾼다.
 */
/** 알림 켜기 결과. granted는 허락과 구독 저장이 모두 된 것이다. missing_key는 보내는 쪽 설정이 없어 허락을 묻지 않은 것, failed는 구독·저장이 안 된 것 */
export type EnableOutcome = PermissionState | "missing_key" | "failed";

export type SettingsApi = {
  addCategory(id: string, name: string): Promise<AddCategoryResult>;
  saveRatios(ratios: RatioItem[]): Promise<RecordResult<{ ratios: RatioItem[] }>>;
  saveSettings(patch: {
    goal?: string | null;
    notify?: Partial<NotifySettings>;
    completeOnboarding?: boolean;
  }): Promise<RecordResult<Omit<SettingsData, "ratios">>>;
  requestPermission(): Promise<EnableOutcome>;
};

const UNAVAILABLE = { ok: false, error: "unavailable" } as const;

async function safely<T>(call: () => Promise<T>): Promise<T | typeof UNAVAILABLE> {
  try {
    return await call();
  } catch {
    return UNAVAILABLE;
  }
}

export const defaultSettingsApi: SettingsApi = {
  addCategory: (id, name) => safely(() => addCategory(id, name)) as Promise<AddCategoryResult>,
  saveRatios: (ratios) => safely(() => saveRatios(ratios)) as ReturnType<SettingsApi["saveRatios"]>,
  saveSettings: (patch) => safely(() => saveSettings(patch)) as ReturnType<SettingsApi["saveSettings"]>,
  // 알림 허락을 묻고 푸시를 구독한다(처음 설정 끝, D-102⑤). 결과를 그대로 알려 준다(B4):
  // 구독이 안 됐으면 granted가 아니다(허락만 됐어도 알림이 가는 것은 아니므로). 던지지 않는다
  requestPermission: async () => {
    try {
      const result = await defaultPushApi.enable();
      if (result === "ok") return "granted";
      return result;
    } catch {
      return "failed";
    }
  },
};
