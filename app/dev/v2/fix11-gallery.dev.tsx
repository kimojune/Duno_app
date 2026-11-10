"use client";

import type { ReactNode } from "react";
import { EveningEntry } from "../../../components/evening-record";
import { GoalLine } from "../../../components/goal";
import { OfferCard } from "../../../components/offer-card";
import { TabBar, type TabId } from "../../../components/tab-bar";
import { TimerScreen } from "../../../components/timer-screen";
import { TodoScreen } from "../../../components/todo-screen";
import type { FocusApi } from "../../../lib/focus-api";
import type { FocusSession } from "../../../lib/focus/types";
import type { GoalsApi } from "../../../lib/goals-api";
import type { ManageApi } from "../../../lib/manage-api";
import type { Offer } from "../../../lib/offers/types";
import type { TodayRead } from "../../../lib/today-types";
import { describeTodoDay } from "../../../lib/todos/day";
import type { TodoItem } from "../../../lib/todos/types";
import { useTabbarHeight } from "../../../lib/use-tabbar-height";

/**
 * 고침11 사진용 개발 갤러리(/dev/v2?s=fix11-…). 서버·DB·네트워크를 부르지 않고 진짜 화면 컴포넌트에 가짜 데이터만 넣는다.
 * 오늘 = 2026-11-13(목) · 건넨 할 일 「토익 단어 50개」(어학) · 어제(11-12) 적은 것. 시계는 고정(타이머는 now를 넘긴다). 글은 23 Figma 「고침11」 줄과 같다.
 * 개발 서버 전용 경로(pageExtensions)라 운영 빌드에 들어가지 않는다.
 */

export const FIX11_GALLERY_IDS = [
  "fix11-k1",
  "fix11-k2",
  "fix11-k3",
  "fix11-k4",
  "fix11-k6",
  "fix11-k7",
  "fix11-k8",
  "fix11-k9",
  "fix11-today",
  "fix11-t1",
  "fix11-t5",
  "fix11-t6",
] as const;
export type Fix11GalleryId = (typeof FIX11_GALLERY_IDS)[number];
export function isFix11GalleryId(id: string): id is Fix11GalleryId {
  return (FIX11_GALLERY_IDS as readonly string[]).includes(id);
}

const noop = () => {};
const never = () => new Promise<never>(() => {});
const TODAY = "2026-11-13";
const NOW_MS = Date.parse("2026-11-13T03:00:00.000Z"); // 서울 12:00
const AT = "2026-11-13T01:00:00.000Z";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const C4 = "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4";
const CATS = [
  { id: C1, name: "어학" },
  { id: C2, name: "글쓰기" },
  { id: C3, name: "자격증" },
  { id: C4, name: "운동" },
];
const TABS: TabId[] = ["growth", "todo", "timer", "me"];
const todo = (id: string, text: string, categoryId: string | null, done = false): TodoItem => ({ id, readable: true, text, done, createdAt: AT, categoryId });
const read = (todos: TodoItem[]): TodayRead => ({
  todos: { ok: true, data: { day: describeTodoDay(TODAY), todos } },
  categories: { ok: true, data: { categories: CATS.map((c) => ({ ...c, readable: true as const, createdAt: AT })) } },
});

/** K1~K4 목록(오늘 목록에 「토익 단어 50개」가 없다) */
const LIST_WITHOUT = [todo("t-a", "자기소개서 첫 문단", C2), todo("t-b", "글 한 편 초고 쓰기", C2), todo("t-c", "정보처리기사 기출 1회", C3)];
/** 50:52 · K7 · K8 목록(오늘 목록에 있다) */
const LIST_WITH = [todo("t-1", "토익 단어 50개", C1, true), todo("t-b", "글 한 편 초고 쓰기", C2), todo("t-c", "정보처리기사 기출 1회", C3)];

const manage: ManageApi = {
  editTodo: never,
  deleteTodo: never,
  reorderTodos: never,
  addNote: never,
  deleteNote: never,
  fetchNotes: async () => ({ ok: true, data: { notes: [] } }),
  fetchYesterday: async () => ({ ok: true, data: { todos: [todo("y1", "토익 단어 50개", C1), todo("y2", "영어 면접 답변 쓰기", C1)] } }),
  carryOver: never,
  fetchDay: never,
  fetchDayRecord: never,
};
const goalsApi: GoalsApi = {
  fetchSummary: async () => ({
    ok: true,
    data: { weekStart: "2026-11-09", categories: CATS, thisWeek: [{ categoryId: C1, minutes: 720 }], goal: [{ categoryId: C1, minutes: 900 }] },
  }),
  save: never,
  clear: never,
};

function offer(over: Partial<Offer> = {}): Offer {
  return { id: "o-fix11", surface: "card", day: TODAY, categoryId: C1, categoryName: "어학", todoId: "t-old", todoText: "토익 단어 50개", todoDay: "2026-11-12", state: "new", ...over };
}

function Shell({ children, tab }: { children: ReactNode; tab: TabId }) {
  const { shellRef, shellStyle } = useTabbarHeight();
  return (
    <div ref={shellRef} className="app-shell" style={shellStyle}>
      {children}
      <TabBar tabs={TABS} current={tab} onSelect={noop} />
    </div>
  );
}

function TodoTab({ todos, card }: { todos: TodoItem[]; card: ReactNode }) {
  return (
    <Shell tab="todo">
      <TodoScreen
        initial={read(todos)}
        manage={manage}
        topSlot={
          <>
            <GoalLine api={goalsApi} refreshKey={0} onOpen={noop} />
            {card}
            <EveningEntry onOpen={noop} />
          </>
        }
      />
    </Shell>
  );
}

const card = (over: Partial<Parameters<typeof OfferCard>[0]> & { o?: Partial<Offer> } = {}) => {
  const { o, ...rest } = over;
  return <OfferCard offer={offer(o)} busy={false} error={null} today={TODAY} onAdd={noop} onDismiss={noop} {...rest} />;
};

function session(over: Partial<FocusSession>): FocusSession {
  return {
    id: "s-fix11",
    startedAt: new Date(NOW_MS - 348_000).toISOString(), // 남은 24:12
    day: TODAY,
    plannedMinutes: 30,
    endedAt: null,
    elapsedSeconds: null,
    todoId: "t-1",
    categoryId: C1,
    offerId: null,
    surface: "timer_tab",
    oppositeByGoal: null,
    oppositeByRatio: null,
    ...over,
  };
}
function focusApi(active: FocusSession | null): FocusApi {
  return { fetchState: async () => ({ ok: true, data: { serverNow: new Date(NOW_MS).toISOString(), active, today: [] } }), start: never, end: never };
}
const timerToday = async () => read([todo("t-1", "토익 단어 50개", C1), todo("t-b", "글 한 편 초고 쓰기", C2), todo("t-c", "정보처리기사 기출 1회", C3)]);
const fixedNow = () => NOW_MS;

function Timer({ active, recommended, added }: { active: FocusSession | null; recommended?: Parameters<typeof TimerScreen>[0]["recommended"]; added?: Parameters<typeof TimerScreen>[0]["added"] }) {
  return (
    <Shell tab="timer">
      <TimerScreen api={focusApi(active)} fetchToday={timerToday} active activation={1} now={fixedNow} recommended={recommended} added={added} />
    </Shell>
  );
}

export function Fix11Gallery({ id }: { id: Fix11GalleryId }) {
  switch (id) {
    case "fix11-k1":
      return <TodoTab todos={LIST_WITHOUT} card={card()} />;
    case "fix11-k2":
      return <TodoTab todos={LIST_WITHOUT} card={card({ busy: true })} />;
    case "fix11-k3":
      return <TodoTab todos={LIST_WITHOUT} card={card({ error: "offline" })} />;
    case "fix11-k4":
      return <TodoTab todos={LIST_WITHOUT} card={card({ error: "failed" })} />;
    case "fix11-k6":
      return <TodoTab todos={LIST_WITHOUT} card={card({ o: { todoId: null, todoText: null, todoDay: null } })} />;
    case "fix11-k7":
      return <TodoTab todos={LIST_WITH} card={card({ running: true, o: { todoId: "t-1", todoDay: TODAY } })} />;
    case "fix11-k8":
      return <TodoTab todos={LIST_WITH} card={null} />;
    case "fix11-today":
      return <TodoTab todos={LIST_WITH} card={card({ o: { todoId: "t-1", todoDay: TODAY } })} />;
    case "fix11-k9":
      return <Timer active={null} recommended={{ offerId: "o-fix11", todoId: "t-1", categoryId: C1, label: "추천" }} added={{ todoId: "t-1", text: "토익 단어 50개" }} />;
    case "fix11-t1":
      return <Timer active={session({})} />;
    case "fix11-t5":
      return <Timer active={session({ startedAt: new Date(NOW_MS - 1_800_000).toISOString() })} />;
    case "fix11-t6":
      return <Timer active={session({ startedAt: new Date(NOW_MS - 12_000).toISOString(), todoId: null, categoryId: null })} />;
  }
}
