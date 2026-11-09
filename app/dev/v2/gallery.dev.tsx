"use client";

import { useState, type ReactNode } from "react";
import { CategoryPage } from "../../../components/category-page";
import { EveningRecord } from "../../../components/evening-record";
import { EveningTodoGallery } from "./evening-todo-gallery.dev";
import { GoalEditor } from "../../../components/goal";
import { GrowthScreen } from "../../../components/growth-screen";
import { AfterSave } from "../../../components/after-save";
import { MeScreen } from "../../../components/me-screen";
import { Onboarding } from "../../../components/onboarding";
import { TabBar, type TabId } from "../../../components/tab-bar";
import { TimerScreen } from "../../../components/timer-screen";
import { TodoDetail } from "../../../components/todo-detail";
import type { EveningApi } from "../../../lib/evening-api";
import type { FocusApi } from "../../../lib/focus-api";
import type { GoalsApi } from "../../../lib/goals-api";
import type { GrowthApi } from "../../../lib/growth-api";
import type { GrowthData } from "../../../lib/growth/types";
import type { ManageApi } from "../../../lib/manage-api";
import type { SettingsApi } from "../../../lib/onboarding-api";
import type { PushApi } from "../../../lib/push/subscribe";
import { useTabbarHeight } from "../../../lib/use-tabbar-height";
import type { SettingsData } from "../../../lib/settings/types";
import type { TodayRead } from "../../../lib/today-types";

/**
 * 원샷 v2 화면 모음(개발용, B10). 서버 Action·DB·네트워크를 부르지 않고 진짜 화면 컴포넌트에 가짜 데이터만 넣는다.
 * 쓰는 법: /dev/v2?s=tabbar | growth-empty | growth-week | growth-many | growth-goal | growth-ratio | growth-pie | goal | evening | category | detail
 *          | ratio-onboarding | ratio-onboarding-many | me-ratio | me-ratio-many | evening-split | evening-split-many (고침4 2단계: 원형 다이얼)
 *  - growth-week-zero: 이번 주 0시간 + 지난 기록 있음(고침7 ①: 목표 비율 뷰가 「총 시간」으로 시작, 머리 아래 「이번 주 0시간」)
 *  - growth-week: 상태보기에 한 주 쓴 기록이 있고 이번 주 목표는 없는 것(목표 비율 탭·띠그래프가 처음. 기간·보기 방식은 화면 시험이 눌러서 바꾼다)
 *  - growth-goal | growth-ratio | growth-pie: 상태보기 두 뷰(고침5) — 목표 한 줄 + 이번 주 목표 뷰 / 목표 비율 뷰 띠 / 목표 비율 뷰 원(기억한 탭·보기로 연다)
 *  - growth-many: 분야 50개(꺾쇠·아주 긴 이름 포함)의 상태보기. 가로로 넘치지 않는지 본다
 *  - tabbar: 내 정보 탭 + 아래 탭 줄(맨 아래까지 내려 저장 단추·로그아웃이 탭 줄에 가려지지 않는지 본다)
 *  - goal·evening·category·detail: 새 전체 화면 창 넷. 창 밖에는 본문·탭 줄 모양의 요소를 두어 inert를 본다
 *  - me-goal · me-goal-empty · me-goal-fail(고침6 ③): 내 정보 첫 카드(목표 있음·없음). 카드를 누르면 S8-b 「목표」. me-goal-fail은 저장이 늘 실패한다
 *  - after-save · after-save-ratio(고침9 S5-3, Figma 49:142 · 59:2): 오늘 기록을 저장한 뒤 「이번 주」 카드. 저장 결과는 늘 어학 +1시간 · 포트폴리오 +2시간.
 *    after-save = 목표 세운 주(어학 2/5시간 → 「3시간 더」, 포트폴리오 12/6시간 → 「목표 6시간」), after-save-ratio = 목표 없는 주(어학 20%/30%, 포트폴리오 60%/40%)
 *  - after-save-many: 바뀐 분야 여섯 → 큰 순 넷 + 「그 밖 2개」
 *  - timer-many · detail-many(고침 5바퀴): 분야 10개(긴 이름 포함)의 타이머 「할 일 없이 시작」 칩 줄 · 할 일 자세히 칩 줄. 한 줄 + 옆으로 넘김을 본다
 * 들어 있는 글·분야 이름은 모두 지어낸 예시다.
 */

const noop = () => {};
const never = () => new Promise<never>(() => {});
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const CATEGORIES = [
  { id: C1, name: "어학" },
  { id: C2, name: "포트폴리오" },
  { id: C3, name: "CS 공부" },
];

/** 분야 9개 이상(분야 색을 9번째부터 돌려 쓰는지·가로 넘침 보기). 이름 하나는 아주 길게 */
const MANY = Array.from({ length: 10 }, (_, i) => ({
  id: `d${i}d${i}d${i}d${i}-0000-4000-8000-00000000000${i}`,
  name: i === 3 ? "아주아주아주긴분야이름이라서한줄에다안들어갑니다" : `분야 ${i + 1}`,
}));

const SETTINGS: SettingsData = {
  goal: "토익 900점",
  goalReadable: true,
  onboardingDone: true,
  notify: { eveningEnabled: true, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 },
  ratios: [
    { categoryId: C1, percent: 50 },
    { categoryId: C2, percent: 30 },
    { categoryId: C3, percent: 20 },
  ],
};

const settingsApi: SettingsApi = {
  addCategory: async () => ({ ok: false, error: "unavailable" }),
  saveRatios: async (ratios) => ({ ok: true, data: { ratios } }),
  saveSettings: async () => ({ ok: true, data: { goal: null, goalReadable: true, onboardingDone: true, notify: SETTINGS.notify } }),
  requestPermission: async () => "granted",
};
const pushApi: PushApi = {
  permission: () => "granted",
  supported: () => true,
  hasKey: () => true,
  subscribed: async () => true,
  enable: async () => "ok",
  disable: async () => {},
};

const goalsApi: GoalsApi = {
  fetchSummary: never,
  save: async () => ({ ok: true, data: { weekStart: "2026-11-02", items: [] } }),
  clear: async () => ({ ok: true, data: { weekStart: "2026-11-02" } }),
};
const eveningApi: EveningApi = {
  fetchState: async () => ({
    ok: true,
    data: {
      today: "2026-11-07",
      day: "2026-11-07",
      existing: null,
      doneCategoryIds: [C1],
      timerByCategory: [{ categoryId: C1, minutes: 30 }],
      categories: CATEGORIES,
    },
  }),
  save: never,
};
/** 저녁 나누기 다이얼: 타이머 어학 30분, 끝낸 할 일 포트폴리오 → 쓴 시간을 2시간으로 두면 어학 30 · 포트폴리오 90 */
const eveningSplitApi = (categories: { id: string; name: string }[]): EveningApi => ({
  fetchState: async () => ({
    ok: true,
    data: {
      today: "2026-11-07",
      day: "2026-11-07",
      existing: null,
      doneCategoryIds: categories.slice(1).map((c) => c.id),
      timerByCategory: [{ categoryId: categories[0].id, minutes: 30 }],
      categories,
    },
  }),
  save: never,
});
const growthApi = (data: GrowthData, pref?: unknown): GrowthApi => ({
  ...(pref === undefined ? {} : { viewPref: { load: async () => pref, save: async () => {} } }),
  fetchGrowth: async () => ({ ok: true, data }),
  fetchCategoryPage: async () => ({
    ok: true,
    data: {
      categoryId: C1,
      days: [
        {
          day: "2026-11-06",
          todos: [
            { id: "t1", text: "단어 서른 개 외우기", done: true, notes: [{ id: "n1", todoId: "t1", day: "2026-11-06", createdAt: "x", readable: true, text: "오전에 열 개, 저녁에 스무 개를 외웠다." }] },
            { id: "t2", text: "듣기 모의고사 한 회", done: false, notes: [] },
          ],
        },
      ],
    },
  }),
  recordView: async () => ({ ok: true }),
});
const manageApi: ManageApi = {
  editTodo: never,
  deleteTodo: never,
  reorderTodos: never,
  addNote: never,
  deleteNote: never,
  fetchNotes: async () => ({
    ok: true,
    data: { notes: [{ id: "n1", todoId: "t1", day: "2026-11-07", createdAt: "x", readable: true, text: "첫 문단을 고쳤다. 다음에는 경력 항목을 줄인다." }] },
  }),
  fetchYesterday: never,
  carryOver: never,
};

const EMPTY_GROWTH: GrowthData = {
  today: "2026-11-07",
  weekStart: "2026-11-02",
  lastWeekStart: "2026-10-26",
  lastMonthRange: { from: "2026-10-01", to: "2026-10-31" },
  categories: CATEGORIES,
  ratios: SETTINGS.ratios,
  thisWeek: [],
  lastWeek: [],
  lastMonth: [],
  cumulative: [],
  loggedDaysThisWeek: 0,
  loggedDaysTotal: 0,
  goal: null,
  goalText: null,
};

/** 한 주 쓴 사람: 처음 정한 비율 50·30·20인데 이번 주는 어학과 기타로 쏠림 */
const WEEK_GROWTH: GrowthData = {
  ...EMPTY_GROWTH,
  thisWeek: [{ categoryId: C1, minutes: 420 }, { categoryId: C3, minutes: 30 }, { categoryId: null, minutes: 90 }],
  lastWeek: [{ categoryId: C1, minutes: 240 }],
  lastMonth: [{ categoryId: C2, minutes: 600 }],
  cumulative: [{ categoryId: C1, minutes: 2400 }, { categoryId: C2, minutes: 900 }, { categoryId: C3, minutes: 300 }],
  loggedDaysThisWeek: 6,
  loggedDaysTotal: 20,
};

/** 이번 주는 아직 0시간, 지난 기록은 쌓인 사람(고침7 ①): 목표 비율 뷰가 「총 시간」(60시간)으로 시작한다 */
const WEEK_ZERO_GROWTH: GrowthData = { ...WEEK_GROWTH, thisWeek: [], loggedDaysThisWeek: 0 };

/**
 * 상태보기 두 뷰(고침5): 명세 ③-S 예와 같은 값. 이번 주 목표 15시간 중 12시간(어학 2/5 · 포트폴리오 12/6 · 자격증 3/3 · 운동 1/1 · 기타 2),
 * 목표 비율 어학 30 · 포트폴리오 40 · 자격증 20 · 운동 10 → 이번 주 10 · 60 · 15 · 5 · 기타 10
 */
const G = ["a1", "a2", "a3", "a4"].map((k) => `${k}${k}${k}${k}-0000-4000-8000-000000000000`);
const GOAL_GROWTH: GrowthData = {
  ...EMPTY_GROWTH,
  categories: [
    { id: G[0], name: "어학" },
    { id: G[1], name: "포트폴리오" },
    { id: G[2], name: "자격증" },
    { id: G[3], name: "운동" },
  ],
  ratios: [
    { categoryId: G[0], percent: 30 },
    { categoryId: G[1], percent: 40 },
    { categoryId: G[2], percent: 20 },
    { categoryId: G[3], percent: 10 },
  ],
  thisWeek: [
    { categoryId: G[0], minutes: 120 },
    { categoryId: G[1], minutes: 720 },
    { categoryId: G[2], minutes: 180 },
    { categoryId: G[3], minutes: 60 },
    { categoryId: null, minutes: 120 },
  ],
  cumulative: [
    { categoryId: G[0], minutes: 1200 },
    { categoryId: G[1], minutes: 2400 },
    { categoryId: G[2], minutes: 600 },
    { categoryId: G[3], minutes: 300 },
    { categoryId: null, minutes: 240 },
  ],
  loggedDaysThisWeek: 5,
  loggedDaysTotal: 21,
  goal: {
    weekStart: "2026-11-02",
    items: [
      { categoryId: G[0], minutes: 300 },
      { categoryId: G[1], minutes: 360 },
      { categoryId: G[2], minutes: 180 },
      { categoryId: G[3], minutes: 60 },
    ],
  },
  goalText: "토익 900점 넘기고 포트폴리오 사이트 열기",
};
/** 목표 최대 길이(100자) 글: 띄어쓰기 없는 긴 낱말과 꺾쇠 모양 글을 섞는다(가로 넘침·글자 그대로 보기) */
export const LONG_GOAL = ("<img src=x onerror=alert(1)> " + "가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허".repeat(3)).slice(0, 100);
const RATIO_PREF = (view: "band" | "pie") => ({ period: "week", view, tab: "ratio", tabWeek: "2026-11-02" });

/** 분야 50개(꺾쇠·긴 이름 포함): 화면이 가로로 넘치지 않는지 본다. 이름은 모두 지어낸 예시 */
const MANY_IDS = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const MANY_NAMES = MANY_IDS.map((_, i) =>
  i === 0 ? "<b>굵게</b><img src=x onerror=alert(1)>" : i === 1 ? "아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주긴분야이름공백없음" : `분야 ${i + 1}`,
);
const MANY_GROWTH: GrowthData = {
  ...EMPTY_GROWTH,
  categories: MANY_IDS.map((id, i) => ({ id, name: MANY_NAMES[i] })),
  ratios: MANY_IDS.map((id) => ({ categoryId: id, percent: 2 })),
  thisWeek: MANY_IDS.map((id, i) => ({ categoryId: id, minutes: 5 * ((i % 7) + 1) })),
  cumulative: MANY_IDS.map((id, i) => ({ categoryId: id, minutes: 60 * ((i % 9) + 1) })),
  loggedDaysThisWeek: 7,
  loggedDaysTotal: 30,
};

const TABS: TabId[] = ["growth", "todo", "timer", "me"];

/** 타이머(고침 5바퀴 칩 줄): 켜진 타이머 없음, 오늘 할 일 없음 → 「할 일 없이 시작」과 분야 칩 줄이 처음부터 보인다 */
const focusApi: FocusApi = {
  fetchState: async () => ({ ok: true, data: { serverNow: new Date().toISOString(), active: null, today: [] } }),
  start: never,
  end: never,
};
const timerToday = async (): Promise<TodayRead> => ({
  todos: { ok: true, data: { day: { date: "2026-11-09", year: 2026, month: 11, dayOfMonth: 9, weekday: 1 }, todos: [] } },
  categories: { ok: true, data: { categories: MANY.map((c) => ({ ...c, readable: true as const, createdAt: "x" })) } },
});

/** 실제 앱(AppShell)과 같은 탭 줄 높이 측정을 쓴다: 글자 200%에서 탭 줄이 두 줄이 돼도 여백이 따라 늘어난다 */
function Shell({ children }: { children: ReactNode }) {
  const { shellRef, shellStyle } = useTabbarHeight();
  return (
    <div ref={shellRef} className="app-shell" style={shellStyle}>
      {children}
    </div>
  );
}

/** 창 밖의 본문·탭 줄(창이 열린 동안 inert가 되는지 본다) */
function Behind({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<TabId>("todo");
  return (
    <Shell>
      <main id="dev-behind">
        <p className="todo-sub">창 뒤의 본문</p>
        <button type="button" className="btn btn-secondary" id="dev-opener" onClick={noop}>
          창 뒤의 단추
        </button>
      </main>
      <TabBar tabs={TABS} current={tab} onSelect={setTab} />
      {children}
    </Shell>
  );
}

function Opener({ render }: { render: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Behind>
      <button type="button" className="btn btn-primary" id="dev-open-window" onClick={() => setOpen(true)}>
        창 열기
      </button>
      {open && render(() => setOpen(false))}
    </Behind>
  );
}

export function V2Gallery({ id }: { id: string }) {
  if (id === "evening-todo" || id === "evening-todo-many") return <EveningTodoGallery many={id === "evening-todo-many"} />; // 고침 5바퀴: 오늘 기록의 「오늘 할 일」 줄·시트
  if (id === "tabbar") {
    return (
      <Shell>
        <MeScreen settings={SETTINGS} categories={CATEGORIES} api={settingsApi} push={pushApi} onLogout={noop} />
        <TabBar tabs={TABS} current="me" onSelect={noop} />
      </Shell>
    );
  }
  if (id === "ratio-onboarding" || id === "ratio-onboarding-many") {
    // 처음 설정: 시험이 「다음」을 두 번 눌러 3단계(처음 정한 비율)로 간다
    return (
      <Onboarding
        api={settingsApi}
        categories={id === "ratio-onboarding" ? CATEGORIES : MANY}
        initialGoal={null}
        initialRatios={[]}
        initialNotify={SETTINGS.notify}
        onDone={noop}
      />
    );
  }
  if (id === "me-ratio" || id === "me-ratio-many") {
    // 내 정보 「비율 고치기」: 저장값의 합이 100이 아니어도(30·30) 합 100으로 열린다
    const cats = id === "me-ratio" ? CATEGORIES : MANY;
    const settings: SettingsData = { ...SETTINGS, ratios: cats.slice(0, 2).map((c) => ({ categoryId: c.id, percent: 30 })) };
    return (
      <Shell>
        <MeScreen settings={settings} categories={cats} api={settingsApi} push={pushApi} onLogout={noop} />
        <TabBar tabs={TABS} current="me" onSelect={noop} />
      </Shell>
    );
  }
  if (id === "me-goal" || id === "me-goal-empty" || id === "me-goal-fail") {
    // 고침6 ③: 내 정보 첫 카드 → S8-b 「목표」. 목표 있음은 360px에서 두 줄로 감기는 길이
    const settings: SettingsData = { ...SETTINGS, goal: id === "me-goal-empty" ? null : "올해 안에 토익 900점 넘기고 포트폴리오 끝내기" };
    const api: SettingsApi = id === "me-goal-fail" ? { ...settingsApi, saveSettings: async () => ({ ok: false, error: "unavailable" }) } : settingsApi;
    return (
      <Shell>
        <MeScreen settings={settings} categories={CATEGORIES} api={api} push={pushApi} onLogout={noop} />
        <TabBar tabs={TABS} current="me" onSelect={noop} />
      </Shell>
    );
  }
  if (id === "after-save" || id === "after-save-ratio" || id === "after-save-many") {
    // 고침9 S5-3: 저장 결과(delta)는 고정, 상태보기 데이터는 저장 뒤 다시 읽은 값이라 이번 몫을 이미 품고 있다
    const many = id === "after-save-many";
    const cats = many ? MANY.slice(0, 6) : CATEGORIES;
    const delta = many ? cats.map((c, i) => ({ categoryId: c.id, minutes: (6 - i) * 30 })) : [{ categoryId: C2, minutes: 120 }, { categoryId: C1, minutes: 60 }];
    const growth: GrowthData =
      id === "after-save"
        ? { ...EMPTY_GROWTH, thisWeek: [{ categoryId: C1, minutes: 120 }, { categoryId: C2, minutes: 720 }, { categoryId: null, minutes: 60 }], goal: { weekStart: "2026-11-02", items: [{ categoryId: C1, minutes: 300 }, { categoryId: C2, minutes: 360 }] } }
        : many
          ? { ...EMPTY_GROWTH, categories: cats, ratios: [], thisWeek: cats.map((c, i) => ({ categoryId: c.id, minutes: (6 - i) * 60 })) }
          : { ...EMPTY_GROWTH, ratios: [{ categoryId: C1, percent: 30 }, { categoryId: C2, percent: 40 }, { categoryId: C3, percent: 30 }], thisWeek: [{ categoryId: C1, minutes: 120 }, { categoryId: C2, minutes: 360 }, { categoryId: null, minutes: 120 }] };
    const api: EveningApi = {
      ...eveningApi,
      fetchState: async () => ({ ok: true, data: { today: "2026-11-07", day: "2026-11-07", existing: null, doneCategoryIds: [], timerByCategory: [], categories: cats } }),
      save: async (input) => ({
        ok: true,
        data: { log: { id: input.id, targetDay: input.targetDay, totalMinutes: input.totalMinutes, items: input.items, saveMode: input.saveMode, savedAt: "2026-11-07T12:00:00.000Z" }, delta },
      }),
    };
    return (
      <Opener
        render={(close) => (
          <EveningRecord api={api} onClose={close} onOpenGrowth={noop} renderAfterSave={(saved, state) => <AfterSave api={growthApi(growth)} delta={saved.delta} fallback={state.categories} />} />
        )}
      />
    );
  }
  if (id === "evening-split-blank") {
    // 고침 5바퀴: 타이머·끝낸 할 일이 없는 날 — 나누기에 들어가면 기타 100%(칩 고르기 전)
    const blank: EveningApi = {
      fetchState: async () => ({ ok: true, data: { today: "2026-11-07", day: "2026-11-07", existing: null, doneCategoryIds: [], timerByCategory: [], categories: CATEGORIES } }),
      save: never,
      addCategory: async () => ({ ok: false, error: "unavailable" }),
    };
    return <Opener render={(close) => <EveningRecord api={blank} onClose={close} />} />;
  }
  if (id === "evening-split" || id === "evening-split-many") {
    const cats = id === "evening-split" ? CATEGORIES : MANY;
    return <Opener render={(close) => <EveningRecord api={eveningSplitApi(cats)} onClose={close} />} />;
  }
  if (id === "growth-empty") {
    return (
      <Shell>
        <GrowthScreen api={growthApi(EMPTY_GROWTH)} active activation={1} entry="self" onOpenCategory={noop} onOpenEvening={noop} onOpenGoal={noop} />
        <TabBar tabs={TABS} current="growth" onSelect={noop} />
      </Shell>
    );
  }
  if (id === "growth-week-zero") {
    return (
      <Shell>
        <GrowthScreen api={growthApi(WEEK_ZERO_GROWTH)} active activation={1} entry="self" onOpenCategory={noop} onOpenEvening={noop} onOpenGoal={noop} />
        <TabBar tabs={TABS} current="growth" onSelect={noop} />
      </Shell>
    );
  }
  if (id === "growth-week" || id === "growth-many") {
    return (
      <Shell>
        <GrowthScreen api={growthApi(id === "growth-week" ? WEEK_GROWTH : MANY_GROWTH)} active activation={1} entry="self" onOpenCategory={noop} onOpenEvening={noop} onOpenGoal={noop} />
        <TabBar tabs={TABS} current="growth" onSelect={noop} />
      </Shell>
    );
  }
  if (id === "growth-goal-long") {
    return (
      <Shell>
        <GrowthScreen api={growthApi({ ...GOAL_GROWTH, goalText: LONG_GOAL })} active activation={1} entry="self" onOpenCategory={noop} onOpenEvening={noop} onOpenGoal={noop} />
        <TabBar tabs={TABS} current="growth" onSelect={noop} />
      </Shell>
    );
  }
  if (id === "growth-goal" || id === "growth-ratio" || id === "growth-pie") {
    const pref = id === "growth-ratio" ? RATIO_PREF("band") : id === "growth-pie" ? RATIO_PREF("pie") : undefined;
    return (
      <Shell>
        <GrowthScreen api={growthApi(GOAL_GROWTH, pref)} active activation={1} entry="self" onOpenCategory={noop} onOpenEvening={noop} onOpenGoal={noop} />
        <TabBar tabs={TABS} current="growth" onSelect={noop} />
      </Shell>
    );
  }
  if (id === "goal") {
    return <Opener render={(close) => <GoalEditor api={goalsApi} categories={CATEGORIES} goal={null} onClose={close} onSaved={noop} />} />;
  }
  if (id === "evening") {
    return <Opener render={(close) => <EveningRecord api={eveningApi} onClose={close} />} />;
  }
  if (id === "category") {
    return <Opener render={(close) => <CategoryPage api={growthApi(EMPTY_GROWTH)} categoryId={C1} name="어학" onClose={close} />} />;
  }
  if (id === "timer-many") {
    return (
      <Shell>
        <TimerScreen api={focusApi} fetchToday={timerToday} active activation={1} onActiveChange={noop} />
        <TabBar tabs={TABS} current="timer" onSelect={noop} />
      </Shell>
    );
  }
  if (id === "detail" || id === "detail-many") {
    return (
      <Opener
        render={(close) => (
          <TodoDetail
            todo={{ id: "t1", text: "이력서 고치기", categoryId: C2, canMoveUp: true, canMoveDown: true }}
            chips={id === "detail" ? CATEGORIES : MANY}
            api={manageApi}
            online
            onClose={close}
            onEdited={noop}
            onDeleted={noop}
            onMove={async () => true}
          />
        )}
      />
    );
  }
  return (
    <main style={{ padding: 16 }}>
      <h1>원샷 v2 화면 모음</h1>
      <ul>
        {[
          "tabbar",
          "growth-empty",
          "growth-week-zero",
          "growth-week",
          "growth-many",
          "growth-goal",
          "growth-goal-long",
          "growth-ratio",
          "growth-pie",
          "goal",
          "evening",
          "category",
          "detail",
          "detail-many",
          "timer-many",
          "ratio-onboarding",
          "ratio-onboarding-many",
          "me-ratio",
          "me-ratio-many",
          "me-goal",
          "me-goal-empty",
          "me-goal-fail",
          "after-save",
          "after-save-ratio",
          "after-save-many",
          "evening-split",
          "evening-split-many",
          "evening-split-blank",
        ].map((s) => (
          <li key={s}>
            <a href={`/dev/v2?s=${s}`}>{s}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
