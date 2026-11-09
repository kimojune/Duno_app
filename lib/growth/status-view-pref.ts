/**
 * 상태보기에서 고른 뷰 탭·기간·보기 방식(이 기기·이 사용자에 기억한다). 순수 함수만: 읽고 쓰는 길은 GrowthApi.viewPref(기기 저장소, 사용자별 열쇠,
 * 로그아웃 때 지움 — lib/local/kv.ts kvKeys.pref).
 * 기기 저장소의 값은 믿지 않는다: 모양이 다르거나 모르는 값이면 그 칸만 처음 값으로 돌린다(다른 판에서 적은 값, 고친 값).
 *
 * 원샷 v2 고침5(PM d-99·d-101·d-102, 의견 8): 상태보기는 뷰 둘 — 「이번 주 목표」(goal, 시간·분야별 막대) / 「목표 비율」(ratio, %·띠/원).
 * - 처음 탭: 이번 주 목표를 세운 주 → goal, 세우지 않은 주 → ratio(initialStatusTab).
 * - 사용자가 고른 탭은 그 주 동안만 기억한다(tabWeek = 고른 주의 월요일). 주가 바뀌면 다시 처음 탭 규칙을 따른다.
 * - 기간(이번 주 / 총 시간 / 비교)과 보기 방식(띠그래프 / 원그래프)은 목표 비율 뷰의 것이다.
 */

/**
 * 기간: 이번 주(처음, 달력 주 월~일) / 총 시간. 「비교」는 D-093의 옛 보기(이번 주·지난주·지난달·총 시간 나란히)를 지우지 않고 남긴 것(결정 대기).
 * PM 확정 11-09: 기간 이름은 「이번 주」(「최근 1주」는 뺐다).
 */
export const STATUS_PERIODS = ["week", "total", "compare"] as const;
export type StatusPeriod = (typeof STATUS_PERIODS)[number];

/** 뷰 탭: 이번 주 목표 / 목표 비율(이 순서가 탭 순서) */
export const STATUS_TABS = ["goal", "ratio"] as const;
export type StatusTab = (typeof STATUS_TABS)[number];

export type StatusPref = {
  period: StatusPeriod;
  /** 목표 비율 뷰의 보기 방식(보기 목록의 번호) */
  view: string;
  /** 사용자가 고른 탭. 고른 적이 없으면 null */
  tab: StatusTab | null;
  /** tab을 고른 주의 월요일(YYYY-MM-DD). 이 주가 아니면 tab을 쓰지 않는다 */
  tabWeek: string | null;
};

/** 처음 값: 이번 주 · 띠그래프(목표 비율 뷰의 처음 보기, PM d-102) · 고른 탭 없음. 기억한 값이 없을 때만 쓴다 */
export const DEFAULT_STATUS_PREF: StatusPref = { period: "week", view: "band", tab: null, tabWeek: null };

/** 이전 판이 적어 둔 기간 값 → 지금 값. 「최근 1주」(recent)였던 값은 「이번 주」로 읽는다 */
const LEGACY_PERIODS: Readonly<Record<string, StatusPeriod>> = { recent: "week" };
/** 이전 판이 적어 둔 보기 방식 → 지금 값. 「분야별 줄 막대」(rows)는 이번 주 목표 뷰로 옮겨 가 목표 비율 뷰에서는 처음 보기(띠그래프)로 읽는다 */
const LEGACY_VIEWS: Readonly<Record<string, string>> = { rows: "band" };

/** 기기 저장소 열쇠 이름(사용자 번호 뒤에 붙는다: lib/local/kv.ts kvKeys.pref) */
export const STATUS_PREF_NAME = "growth-view";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** @param viewIds 지금 고를 수 있는 보기 방식 번호들(보기 목록). 목록에 없는 값은 처음 값으로 돌린다 */
export function parseStatusPref(raw: unknown, viewIds: readonly string[]): StatusPref {
  const fallbackView = viewIds.includes(DEFAULT_STATUS_PREF.view) ? DEFAULT_STATUS_PREF.view : (viewIds[0] ?? DEFAULT_STATUS_PREF.view);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULT_STATUS_PREF, view: fallbackView };
  const { period, view, tab, tabWeek } = raw as Record<string, unknown>;
  const legacyView = typeof view === "string" && Object.hasOwn(LEGACY_VIEWS, view) ? LEGACY_VIEWS[view] : null;
  const tabOk = typeof tab === "string" && (STATUS_TABS as readonly string[]).includes(tab) && typeof tabWeek === "string" && DAY.test(tabWeek);
  return {
    period:
      typeof period === "string" && (STATUS_PERIODS as readonly string[]).includes(period)
        ? (period as StatusPeriod)
        : typeof period === "string" && Object.hasOwn(LEGACY_PERIODS, period)
          ? LEGACY_PERIODS[period]
          : DEFAULT_STATUS_PREF.period,
    view: typeof view === "string" && viewIds.includes(view) ? view : legacyView !== null && viewIds.includes(legacyView) ? legacyView : fallbackView,
    tab: tabOk ? (tab as StatusTab) : null,
    tabWeek: tabOk ? (tabWeek as string) : null,
  };
}

/**
 * 지금 보일 탭. 이 주(weekStart)에 고른 탭이 있으면 그것, 아니면 이번 주 목표를 세운 주는 「이번 주 목표」, 세우지 않은 주는 「목표 비율」.
 * @param hasGoal 이번 주 목표가 있는가(목표 항목이 하나 이상)
 */
export function initialStatusTab(pref: Pick<StatusPref, "tab" | "tabWeek">, weekStart: string, hasGoal: boolean): StatusTab {
  if (pref.tab !== null && pref.tabWeek === weekStart) return pref.tab;
  return hasGoal ? "goal" : "ratio";
}
