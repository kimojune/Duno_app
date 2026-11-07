"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { CategoryPage } from "../../../components/category-page";
import { EveningRecord } from "../../../components/evening-record";
import { GoalEditor } from "../../../components/goal";
import { GrowthScreen } from "../../../components/growth-screen";
import { MeScreen } from "../../../components/me-screen";
import { TabBar, type TabId } from "../../../components/tab-bar";
import { TodoDetail } from "../../../components/todo-detail";
import type { EveningApi } from "../../../lib/evening-api";
import type { GoalsApi } from "../../../lib/goals-api";
import type { GrowthApi } from "../../../lib/growth-api";
import type { GrowthData } from "../../../lib/growth/types";
import type { ManageApi } from "../../../lib/manage-api";
import type { SettingsApi } from "../../../lib/onboarding-api";
import type { PushApi } from "../../../lib/push/subscribe";
import type { SettingsData } from "../../../lib/settings/types";

/**
 * 원샷 v2 화면 모음(개발용, B10). 서버 Action·DB·네트워크를 부르지 않고 진짜 화면 컴포넌트에 가짜 데이터만 넣는다.
 * 쓰는 법: /dev/v2?s=tabbar | growth-empty | goal | evening | category | detail
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
  lastWeek: [],
  lastMonth: [],
  cumulative: [],
  loggedDaysThisWeek: 0,
  loggedDaysTotal: 0,
  goal: null,
};

const TABS: TabId[] = ["growth", "todo", "timer", "me"];
const shellStyle = { "--tabbar-h": "calc(56px + env(safe-area-inset-bottom))" } as CSSProperties;

/** 창 밖의 본문·탭 줄(창이 열린 동안 inert가 되는지 본다) */
function Behind({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<TabId>("todo");
  return (
    <div className="app-shell" style={shellStyle}>
      <main id="dev-behind">
        <p className="todo-sub">창 뒤의 본문</p>
        <button type="button" className="btn btn-secondary" id="dev-opener" onClick={noop}>
          창 뒤의 단추
        </button>
      </main>
      <TabBar tabs={TABS} current={tab} onSelect={setTab} />
      {children}
    </div>
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
      <div className="app-shell" style={shellStyle}>
        <MeScreen settings={SETTINGS} categories={CATEGORIES} api={settingsApi} push={pushApi} onLogout={noop} />
        <TabBar tabs={TABS} current="me" onSelect={noop} />
      </div>
    );
  }
  if (id === "growth-empty") {
    return (
      <div className="app-shell" style={shellStyle}>
        <GrowthScreen api={growthApi(EMPTY_GROWTH)} active activation={1} entry="self" onOpenCategory={noop} onOpenEvening={noop} />
        <TabBar tabs={TABS} current="growth" onSelect={noop} />
      </div>
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
        {["tabbar", "growth-empty", "goal", "evening", "category", "detail"].map((s) => (
          <li key={s}>
            <a href={`/dev/v2?s=${s}`}>{s}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
