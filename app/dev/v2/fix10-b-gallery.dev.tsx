"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CarryOver } from "../../../components/carry-over";
import { EveningEntry, EveningRecord } from "../../../components/evening-record";
import { GoalEditor, GoalLine } from "../../../components/goal";
import { PastDays } from "../../../components/past-days";
import { TodoDetail } from "../../../components/todo-detail";
import { TodoScreen } from "../../../components/todo-screen";
import type { EveningApi } from "../../../lib/evening-api";
import type { GoalsApi } from "../../../lib/goals-api";
import type { ManageApi } from "../../../lib/manage-api";
import type { NoteItem } from "../../../lib/notes/types";
import type { TodayRead } from "../../../lib/today-types";
import type { TodoDay, TodoItem } from "../../../lib/todos/types";

/**
 * 고침10 W2b(S2 · S2-b · 지난 날 · 분야 줄 · 시트 · 오늘 기록 나누기)의 개발 갤러리(/dev/v2?s=…). 서버 Action·DB·네트워크를 부르지 않고
 * 진짜 화면 컴포넌트에 가짜 데이터만 넣는다. 사진 묶음은 같은 자리에서 찍는다. 글·이름은 모두 지어낸 예시다.
 *  - 할 일(S2): todo-s2(머리 · 이번 주 목표 카드 · 오늘 기록 카드 · 어제 못 끝낸 접힌 줄 · 목록) · todo-empty(빈 목록 예시) ·
 *    carry-open(어제 못 끝낸 것 펼침, 모두 고른 채) · carry-none(모두 풂 → 「고른 할 일 없음」) · sheet-add(적는 창)
 *  - 할 일 페이지(S2-b): note-0(작업 기록 0개) · note-many(카드) · note-hint(빈 칸에서 「남기기」 → 안내) · note-busy(「남기는 중」) · note-menu(「⋯」 메뉴 막) · sheet-category(분야 고르기 시트)
 *  - 지난 날: past-days(할 일 · 이날 기록) · past-empty(빈 날 「할 일 0개」)
 *  - 시트: sheet-goal(이번 주 목표)
 *  - 오늘 기록 나누기(PM d-180): split-two(칩 둘 고름) · split-three(칩 셋 고름) · split-timer-one(타이머 분야 + 칩 하나). 시간 단계에서 「분야마다 나누기」를 누르면 나눈 모습이다
 */

export const FIX10B_GALLERY_IDS = [
  "todo-s2",
  "todo-empty",
  "carry-open",
  "carry-none",
  "sheet-add",
  "note-0",
  "note-many",
  "note-hint",
  "note-busy",
  "note-menu",
  "sheet-category",
  "past-days",
  "past-empty",
  "sheet-goal",
  "split-two",
  "split-three",
  "split-timer-one",
] as const;
export type Fix10BGalleryId = (typeof FIX10B_GALLERY_IDS)[number];
export function isFix10BGalleryId(id: string): id is Fix10BGalleryId {
  return (FIX10B_GALLERY_IDS as readonly string[]).includes(id);
}

const noop = () => {};
const never = () => new Promise<never>(() => {});
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const CATS = [
  { id: C1, name: "어학" },
  { id: C2, name: "글쓰기" },
  { id: C3, name: "CS 공부" },
];
const AT = "2026-11-07T01:00:00.000Z";
const DAY: TodoDay = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const todo = (id: string, text: string, categoryId: string | null, done = false, hasNotes = false): TodoItem => ({ id, readable: true, text, done, createdAt: AT, categoryId, hasNotes });
const dayOf = (date: string): TodoDay => {
  const [y, m, d] = date.split("-").map(Number);
  return { date, year: y, month: m, dayOfMonth: d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};
const note = (id: string, day: string, text: string): NoteItem => ({ id, todoId: "t1", day, createdAt: AT, readable: true, text });

function manage(over: Partial<ManageApi> = {}): ManageApi {
  return {
    editTodo: async (id, patch) => ({ ok: true, data: { todo: todo(id, patch.text ?? "x", patch.categoryId ?? null) } }),
    deleteTodo: async (id) => ({ ok: true, data: { id } }),
    reorderTodos: async (ids) => ({ ok: true, data: { ids } }),
    addNote: never,
    deleteNote: async (id) => ({ ok: true, data: { id } }),
    fetchNotes: async () => ({ ok: true, data: { notes: [] } }),
    fetchYesterday: async () => ({ ok: true, data: { todos: [todo("y1", "토익 단어 50개 외우기", C1), todo("y2", "글 한 편 초고 쓰기", C2), todo("y3", "운영체제 3장 읽기", C3)] } }),
    carryOver: never,
    fetchDay: async (date) => ({
      ok: true,
      data: { day: dayOf(date), todos: [todo("p1", "토익 단어 50개 외우기", C1, true), todo("p2", "글 한 편 초고 쓰기", C2, true), todo("p3", "운영체제 3장 읽기", C3, false)] },
    }),
    fetchDayRecord: async () => ({ ok: true, data: { totalMinutes: 150 } }),
    ...over,
  };
}

const goalsApi: GoalsApi = {
  fetchSummary: async () => ({ ok: true, data: { weekStart: "2026-11-02", categories: CATS, thisWeek: [{ categoryId: C1, minutes: 240 }], goal: [{ categoryId: C1, minutes: 300 }, { categoryId: C2, minutes: 360 }] } }),
  save: async () => ({ ok: true, data: { weekStart: "2026-11-02", items: [] } }),
  clear: async () => ({ ok: true, data: { weekStart: "2026-11-02" } }),
};

/** 마운트 뒤 한 번 해 주는 동작(눌러야 나오는 상태를 사진으로 찍게). 개발 갤러리 전용 */
function Auto({ run, children }: { run: (root: HTMLElement) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => ref.current && run(ref.current), 250);
    return () => clearTimeout(timer);
  }, [run]);
  return <div ref={ref}>{children}</div>;
}
const click = (root: HTMLElement, selector: string) => root.querySelector<HTMLElement>(selector)?.click();

function initial(todos: TodoItem[]): TodayRead {
  return {
    todos: { ok: true, data: { day: DAY, todos } },
    categories: { ok: true, data: { categories: CATS.map((c) => ({ ...c, readable: true as const, createdAt: AT })) } },
  };
}

function S2({ todos, openSheet = false }: { todos: TodoItem[]; openSheet?: boolean }) {
  return (
    <Auto run={(root) => openSheet && click(root, "#add-todo-button")}>
      <TodoScreen
        initial={initial(todos)}
        manage={manage()}
        topSlot={
          <>
            <GoalLine api={goalsApi} refreshKey={0} onOpen={noop} />
            <EveningEntry onOpen={noop} />
          </>
        }
      />
    </Auto>
  );
}

function Detail({ notes, after }: { notes: NoteItem[]; after?: (root: HTMLElement) => void }) {
  return (
    <Auto run={(root) => after?.(root)}>
      <TodoDetail
        todo={{ id: "t1", text: "글 한 편 초고 쓰기", categoryId: C2, canMoveUp: true, canMoveDown: true }}
        chips={CATS}
        api={manage({ fetchNotes: async () => ({ ok: true, data: { notes } }) })}
        online
        onClose={noop}
        onEdited={noop}
        onDeleted={noop}
        onMove={async () => true}
        onAddCategory={async () => ({ ok: false, reason: "failed" })}
        done={false}
        onToggleDone={noop}
        dayLabel="11월 7일 토요일"
      />
    </Auto>
  );
}

/** 오늘 기록 나누기: 시간 단계에서 쓴 시간을 2시간(시간 2 · 분 0)으로 쓴 뒤 「분야마다 나누기」를 누르면 나눈 모습이 나온다(화면 시험도 그렇게 한다) */
function splitApi(args: { done: string[]; timer: { categoryId: string | null; minutes: number }[] }): EveningApi {
  return {
    fetchState: async () => ({
      ok: true,
      data: { today: "2026-11-07", day: "2026-11-07", existing: null, doneCategoryIds: args.done, timerByCategory: args.timer, categories: CATS },
    }),
    save: never,
  };
}

export function Fix10BGallery({ id }: { id: Fix10BGalleryId }) {
  switch (id) {
    case "todo-s2":
      return <S2 todos={[todo("t1", "토익 단어 50개 외우기", C1, true, true), todo("t2", "글 한 편 초고 쓰기", C2), todo("t3", "운영체제 3장 읽기", C3)]} />;
    case "todo-empty":
      return <S2 todos={[]} />;
    case "sheet-add":
      return <S2 todos={[todo("t1", "토익 단어 50개 외우기", C1, true), todo("t2", "글 한 편 초고 쓰기", C2)]} openSheet />;
    case "carry-open":
      return (
        <main style={{ padding: 16 }}>
          <Auto run={(root) => click(root, ".carry-row")}>
            <CarryOver api={manage()} online onCarried={noop} />
          </Auto>
        </main>
      );
    case "carry-none":
      return (
        <main style={{ padding: 16 }}>
          <Auto
            run={(root) => {
              click(root, ".carry-row");
              setTimeout(() => root.querySelectorAll<HTMLElement>('.carry-list input[type="checkbox"]').forEach((box) => box.click()), 80);
            }}
          >
            <CarryOver api={manage()} online onCarried={noop} />
          </Auto>
        </main>
      );
    case "note-0":
      return <Detail notes={[]} />;
    case "note-many":
      return <Detail notes={[note("n1", "2026-11-06", "개요를 다섯 문단으로 나눴다."), note("n2", "2026-11-07", "첫 문단을 쓰고 둘째 문단 문장을 다듬는 중이다.")]} />;
    case "note-hint":
      return <Detail notes={[]} after={(root) => click(root, ".note-add-btn")} />;
    case "note-busy":
      return (
        <Auto
          run={(root) => {
            const box = root.querySelector<HTMLTextAreaElement>("#note-input");
            if (box) {
              Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, "오늘 쓴 글");
              box.dispatchEvent(new Event("input", { bubbles: true }));
            }
            setTimeout(() => click(root, ".note-add-btn"), 60);
          }}
        >
          <Detail notes={[]} />
        </Auto>
      );
    case "note-menu":
      return <Detail notes={[note("n1", "2026-11-06", "개요를 다섯 문단으로 나눴다.")]} after={(root) => click(root, "#detail-more")} />;
    case "sheet-category":
      return <Detail notes={[]} after={(root) => click(root, "#detail-category-line")} />;
    case "past-days":
      return <PastDays api={manage()} today="2026-11-07" onClose={noop} />;
    case "past-empty":
      return <PastDays api={manage({ fetchDay: async (date) => ({ ok: true, data: { day: dayOf(date), todos: [] } }), fetchDayRecord: async () => ({ ok: true, data: { totalMinutes: null } }) })} today="2026-11-07" onClose={noop} />;
    case "sheet-goal":
      return <GoalEditor api={goalsApi} categories={CATS} goal={[{ categoryId: C1, minutes: 300 }, { categoryId: C2, minutes: 360 }]} onClose={noop} onSaved={noop} />;
    case "split-two":
      // 쓴 시간 2시간 + 끝낸 할 일 어학·글쓰기 → 칩 둘 고름: 60 · 60
      return <EveningRecord api={splitApi({ done: [C1, C2], timer: [] })} onClose={noop} />;
    case "split-three":
      // 쓴 시간 2시간 + 끝낸 할 일 셋 → 칩 셋 고름: 40 · 40 · 40
      return <EveningRecord api={splitApi({ done: [C1, C2, C3], timer: [] })} onClose={noop} />;
    case "split-timer-one":
      // 타이머 어학 30분 + 쓴 시간 2시간 + 끝낸 할 일 글쓰기 → 어학 30(잰 그대로) · 글쓰기 90(남은 시간), 합 2시간
      return <EveningRecord api={splitApi({ done: [C2], timer: [{ categoryId: C1, minutes: 30 }] })} onClose={noop} />;
  }
}
