"use client";

import type { ReactNode } from "react";
import { EveningEntry } from "../../../components/evening-record";
import { GoalLine } from "../../../components/goal";
import { OfferCard } from "../../../components/offer-card";
import { TabBar, type TabId } from "../../../components/tab-bar";
import { TimerScreen } from "../../../components/timer-screen";
import { TodoScreen, type CardBridge } from "../../../components/todo-screen";
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
 * 고침11 사진용 개발 갤러리(/dev/v2?s=fix11-…). 고침11-2(PM d-232): 카드는 L1~L8(Figma 166:*), 그대로 쓰는 K7 · K8 · K9, 타이머 T1 · T5 · T6. 서버·DB·네트워크를 부르지 않고 진짜 화면 컴포넌트에 가짜 데이터만 넣는다.
 * 오늘 = 2026-11-13(목) · 건넨 할 일 「토익 단어 50개」(어학) · 어제(11-12) 적은 것. 시계는 고정(타이머는 now를 넘긴다). 글은 23 Figma 「고침11」 줄과 같다.
 * 개발 서버 전용 경로(pageExtensions)라 운영 빌드에 들어가지 않는다.
 */

export const FIX11_GALLERY_IDS = [
  "fix11-l1",
  "fix11-l2",
  "fix11-l3",
  "fix11-l4",
  "fix11-l5",
  "fix11-l6",
  "fix11-l7",
  "fix11-l8",
  "fix11-k7",
  "fix11-k8",
  "fix11-k9",
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

/** L1~L4 · L8 목록(오늘 목록에 「토익 단어 50개」가 없다) */
const LIST_WITHOUT = [todo("t-a", "자기소개서 첫 문단", C2), todo("t-b", "글 한 편 초고 쓰기", C2), todo("t-c", "정보처리기사 기출 1회", C3)];
/** L6 · L7 · K7 · K8 목록(오늘 목록에 있다. 끝내지 않음 — 끝내면 카드가 접힌다) */
const LIST_WITH = [todo("t-1", "토익 단어 50개", C1), todo("t-b", "글 한 편 초고 쓰기", C2), todo("t-c", "정보처리기사 기출 1회", C3)];
/** L5 목록: 방금 추가한 줄이 맨 위(현행 「어제 못 끝낸 할 일 가져오기」가 넣는 자리) */
const LIST_ADDED = [todo("t-new", "토익 단어 50개", C1), ...LIST_WITHOUT];

const YESTERDAY = [todo("y1", "토익 단어 50개", C1), todo("y2", "영어 면접 답변 쓰기", C1)];
const manageFor = (yesterday: TodoItem[]): ManageApi => ({
  editTodo: never,
  deleteTodo: never,
  reorderTodos: never,
  addNote: never,
  deleteNote: never,
  fetchNotes: async () => ({ ok: true, data: { notes: [] } }),
  fetchYesterday: async () => ({ ok: true, data: { todos: yesterday } }),
  carryOver: never,
  fetchDay: never,
  fetchDayRecord: never,
});
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

function TodoTab({ todos, card, bridge, yesterday = YESTERDAY }: { todos: TodoItem[]; card: ReactNode; bridge?: Partial<CardBridge>; yesterday?: TodoItem[] }) {
  const cardBridge: CardBridge = { tagId: null, reveal: null, compose: null, onRows: noop, ...bridge };
  return (
    <Shell tab="todo">
      <TodoScreen
        initial={read(todos)}
        manage={manageFor(yesterday)}
        card={cardBridge}
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
  return <OfferCard offer={offer(o)} busy={false} error={null} today={TODAY} onAdd={noop} onDismiss={noop} onShowInList={noop} onCompose={noop} onStartInTimer={noop} {...rest} />;
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

/** 오늘 목록에 이미 있는 할 일을 건넨 카드(L6 · L7 · K7) */
const IN_LIST = { todoId: "t-1", todoDay: TODAY } as const;

export function Fix11Gallery({ id }: { id: Fix11GalleryId }) {
  switch (id) {
    case "fix11-l1":
      return <TodoTab todos={LIST_WITHOUT} card={card()} />;
    case "fix11-l2":
      return <TodoTab todos={LIST_WITHOUT} card={card({ busy: true })} />;
    case "fix11-l3":
      return <TodoTab todos={LIST_WITHOUT} card={card({ error: "offline" })} />;
    case "fix11-l4":
      return <TodoTab todos={LIST_WITHOUT} card={card({ error: "failed" })} />;
    case "fix11-l5":
      // 추가한 뒤: 카드는 「오늘 할 일에 넣었어요」 + 보조 길(포커스 있음), 새 줄이 맨 위에서 강조 + 꼬리표, 「어제 못 끝낸 할 일」은 1개로 준다.
      // 강조(2초)가 보이는 순간을 찍으려면 로드 직후에 찍는다(시험이 움직임 줄이기를 켜고 페이드 없이 고정)
      return (
        <TodoTab
          todos={LIST_ADDED}
          card={card({ added: true, o: { todoId: "t-new", todoDay: TODAY } })}
          bridge={{ tagId: "t-new", reveal: { id: "t-new", seq: 1, focus: false } }}
          yesterday={YESTERDAY.slice(1)}
        />
      );
    case "fix11-l6":
      return <TodoTab todos={LIST_WITH} card={card({ o: IN_LIST })} bridge={{ tagId: "t-1" }} />;
    case "fix11-l7":
      // 「목록에서 보기」 뒤: 그 줄이 강조되고 포커스 고리가 그 줄에 있다
      return <TodoTab todos={LIST_WITH} card={card({ o: IN_LIST })} bridge={{ tagId: "t-1", reveal: { id: "t-1", seq: 1, focus: true } }} />;
    case "fix11-l8":
      return <TodoTab todos={LIST_WITHOUT} card={card({ o: { todoId: null, todoText: null, todoDay: null } })} />;
    case "fix11-k7":
      return <TodoTab todos={LIST_WITH} card={card({ running: true, o: IN_LIST })} bridge={{ tagId: "t-1" }} />;
    case "fix11-k8":
      return <TodoTab todos={LIST_WITH} card={null} />;
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
