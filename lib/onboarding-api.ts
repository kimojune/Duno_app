import { addCategory } from "../app/todos/actions";
import { saveRatios, saveSettings } from "../app/settings/actions";
import type { AddCategoryResult } from "./categories/types";
import { requestNotificationPermission, type PermissionState } from "./push/client";
import type { RecordResult } from "./records/common";
import type { NotifySettings, RatioItem, SettingsData } from "./settings/types";

/**
 * 처음 설정·내 정보 화면이 서버를 부르는 길(브라우저 쪽). 화면은 이 모양의 객체를 받아, 시험은 가짜를 넣는다.
 * 실패는 던지지 않고 unavailable로 바꾼다.
 */
export type SettingsApi = {
  addCategory(id: string, name: string): Promise<AddCategoryResult>;
  saveRatios(ratios: RatioItem[]): Promise<RecordResult<{ ratios: RatioItem[] }>>;
  saveSettings(patch: {
    goal?: string | null;
    notify?: Partial<NotifySettings>;
    completeOnboarding?: boolean;
  }): Promise<RecordResult<Omit<SettingsData, "ratios">>>;
  requestPermission(): Promise<PermissionState>;
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
  requestPermission: requestNotificationPermission,
};
