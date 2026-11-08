"use client";

import { useState, type ReactNode } from "react";
import { CategoryPage } from "../../../components/category-page";
import { EveningRecord } from "../../../components/evening-record";
import { GoalEditor } from "../../../components/goal";
import { GrowthScreen } from "../../../components/growth-screen";
import { MeScreen } from "../../../components/me-screen";
import { Onboarding } from "../../../components/onboarding";
import { TabBar, type TabId } from "../../../components/tab-bar";
import { TodoDetail } from "../../../components/todo-detail";
import type { EveningApi } from "../../../lib/evening-api";
import type { GoalsApi } from "../../../lib/goals-api";
import type { GrowthApi } from "../../../lib/growth-api";
import type { GrowthData } from "../../../lib/growth/types";
import type { ManageApi } from "../../../lib/manage-api";
import type { SettingsApi } from "../../../lib/onboarding-api";
import type { PushApi } from "../../../lib/push/subscribe";
import { useTabbarHeight } from "../../../lib/use-tabbar-height";
import type { SettingsData } from "../../../lib/settings/types";

/**
 * 원샷 v2 화면 모음(개발용, B10). 서버 Action·DB·네트워크를 부르지 않고 진짜 화면 컴포넌트에 가짜 데이터만 넣는다.
 * 쓰는 법: /dev/v2?s=tabbar | growth-empty | growth-recent | growth-many | goal | evening | category | detail
 *          | ratio-onboarding | ratio-onboarding-many | me-ratio | me-ratio-many | evening-split | evening-split-many (고침4 2단계: 원형 다이얼)
 *  - growth-recent: 상태보기에 한 주 쓴 기록이 있는 것(최근 1주·띠그래프가 처음. 기간·보기 방식은 화면 시험이 눌러서 바꾼다)
 *  - growth-many: 분야 50개(꺾쇠·아주 긴 이름 포함)의 상태보기. 가로로 넘치지 않는지 본다
 *  - tabbar: 내 정보 탭 + 아래 탭 줄(맨 아래까지 내려 저장 단추·로그아웃이 탭 줄에 가려지지 않는지 본다)
 *  - goal·evening·category·detail: 새 전체 화면 창 넷. 창 밖에는 본문·탭 줄 모양의 요소를 두어 inert를 본다
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
const growthApi = (data: GrowthData): GrowthApi => ({
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
  recentWeek: [],
  lastWeek: [],
  lastMonth: [],
  cumulative: [],
  loggedDaysThisWeek: 0,
  loggedDaysRecentWeek: 0,
  loggedDaysTotal: 0,
  goal: null,
};

/** 한 주 쓴 사람: 처음 정한 비율 50·30·20인데 최근 1주는 어학과 기타로 쏠림 */
const RECENT_GROWTH: GrowthData = {
  ...EMPTY_GROWTH,
  thisWeek: [{ categoryId: C1, minutes: 360 }, { categoryId: null, minutes: 60 }],
  recentWeek: [{ categoryId: C1, minutes: 420 }, { categoryId: C3, minutes: 30 }, { categoryId: null, minutes: 90 }],
  lastWeek: [{ categoryId: C1, minutes: 240 }],
  lastMonth: [{ categoryId: C2, minutes: 600 }],
  cumulative: [{ categoryId: C1, minutes: 2400 }, { categoryId: C2, minutes: 900 }, { categoryId: C3, minutes: 300 }],
  loggedDaysThisWeek: 5,
  loggedDaysRecentWeek: 6,
  loggedDaysTotal: 20,
};

/** 분야 50개(꺾쇠·긴 이름 포함): 화면이 가로로 넘치지 않는지 본다. 이름은 모두 지어낸 예시 */
const MANY_IDS = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const MANY_NAMES = MANY_IDS.map((_, i) =>
  i === 0 ? "<b>굵게</b><img src=x onerror=alert(1)>" : i === 1 ? "아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주긴분야이름공백없음" : `분야 ${i + 1}`,
);
const MANY_GROWTH: GrowthData = {
  ...EMPTY_GROWTH,
  categories: MANY_IDS.map((id, i) => ({ id, name: MANY_NAMES[i] })),
  ratios: MANY_IDS.map((id) => ({ categoryId: id, percent: 2 })),
  recentWeek: MANY_IDS.map((id, i) => ({ categoryId: id, minutes: 5 * ((i % 7) + 1) })),
  cumulative: MANY_IDS.map((id, i) => ({ categoryId: id, minutes: 60 * ((i % 9) + 1) })),
  loggedDaysRecentWeek: 7,
  loggedDaysTotal: 30,
};

const TABS: TabId[] = ["growth", "todo", "timer", "me"];

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
  if (id === "evening-split" || id === "evening-split-many") {
    const cats = id === "evening-split" ? CATEGORIES : MANY;
    return <Opener render={(close) => <EveningRecord api={eveningSplitApi(cats)} onClose={close} />} />;
  }
  if (id === "growth-empty") {
    return (
      <Shell>
        <GrowthScreen api={growthApi(EMPTY_GROWTH)} active activation={1} entry="self" onOpenCategory={noop} onOpenEvening={noop} />
        <TabBar tabs={TABS} current="growth" onSelect={noop} />
      </Shell>
    );
  }
  if (id === "growth-recent" || id === "growth-many") {
    return (
      <Shell>
        <GrowthScreen api={growthApi(id === "growth-recent" ? RECENT_GROWTH : MANY_GROWTH)} active activation={1} entry="self" onOpenCategory={noop} onOpenEvening={noop} />
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
  if (id === "detail") {
    return (
      <Opener
        render={(close) => (
          <TodoDetail
            todo={{ id: "t1", text: "이력서 고치기", categoryId: C2, canMoveUp: true, canMoveDown: true }}
            chips={CATEGORIES}
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
          "growth-recent",
          "growth-many",
          "goal",
          "evening",
          "category",
          "detail",
          "ratio-onboarding",
          "ratio-onboarding-many",
          "me-ratio",
          "me-ratio-many",
          "evening-split",
          "evening-split-many",
        ].map((s) => (
          <li key={s}>
            <a href={`/dev/v2?s=${s}`}>{s}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
