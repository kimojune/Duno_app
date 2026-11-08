/**
 * 상태보기에서 고른 기간·보기 방식(이 기기·이 사용자에 기억한다). 순수 함수만: 읽고 쓰는 길은 GrowthApi.viewPref(기기 저장소, 사용자별 열쇠).
 * 기기 저장소의 값은 믿지 않는다: 모양이 다르거나 모르는 값이면 그 칸만 처음 값으로 돌린다(다른 판에서 적은 값, 고친 값).
 */

/** 기간: 최근 1주(처음) / 총 시간. 「비교」는 D-093의 옛 보기(이번 주·지난주·지난달·쌓인 것 나란히)를 지우지 않고 남긴 것(결정 대기) */
export const STATUS_PERIODS = ["recent", "total", "compare"] as const;
export type StatusPeriod = (typeof STATUS_PERIODS)[number];

export type StatusPref = { period: StatusPeriod; view: string };

/** 처음 값: 최근 1주 · 띠그래프 */
export const DEFAULT_STATUS_PREF: StatusPref = { period: "recent", view: "band" };

/** 기기 저장소 열쇠 이름(사용자 번호 뒤에 붙는다: lib/local/kv.ts kvKeys.pref) */
export const STATUS_PREF_NAME = "growth-view";

/** @param viewIds 지금 고를 수 있는 보기 방식 번호들(보기 목록). 목록에 없는 값은 처음 값으로 돌린다 */
export function parseStatusPref(raw: unknown, viewIds: readonly string[]): StatusPref {
  const fallbackView = viewIds.includes(DEFAULT_STATUS_PREF.view) ? DEFAULT_STATUS_PREF.view : (viewIds[0] ?? DEFAULT_STATUS_PREF.view);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { period: DEFAULT_STATUS_PREF.period, view: fallbackView };
  const { period, view } = raw as Record<string, unknown>;
  return {
    period: typeof period === "string" && (STATUS_PERIODS as readonly string[]).includes(period) ? (period as StatusPeriod) : DEFAULT_STATUS_PREF.period,
    view: typeof view === "string" && viewIds.includes(view) ? view : fallbackView,
  };
}
