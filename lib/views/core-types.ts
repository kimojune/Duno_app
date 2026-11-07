/** 화면 본 것 기록의 값 목록(화면도 import해도 된다. 서버 전용 core와 같은 값) */
export const VIEW_SCREENS = ["growth", "category"] as const;
export const VIEW_ENTRIES = ["after_save", "self"] as const;
export type ViewScreen = (typeof VIEW_SCREENS)[number];
export type ViewEntry = (typeof VIEW_ENTRIES)[number];
