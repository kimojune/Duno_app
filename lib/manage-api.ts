import { addNote, carryOverTodos, deleteNote, deleteTodo, editTodo, reorderTodos } from "../app/todos/manage-actions";
import type { EveningState } from "./evening/types";
import type { NoteItem } from "./notes/types";
import type { RecordResult } from "./records/common";
import type { TodayTodos, TodoDay, TodoItem, TodoResult } from "./todos/types";

/**
 * 할 일 화면이 고치기·지우기·순서·작업 기록·어제 것 가져오기를 부르는 길(브라우저 쪽).
 * 화면(TodoScreen)은 이 모양의 객체를 선택 입력(manage)으로 받는다: 없으면 그 기능을 그리지 않는다(기존 화면·시험 그대로).
 * 진짜 구현(defaultManageApi)은 Server Action(쓰기)과 같은 출처 GET(읽기)을 부르고, 시험은 가짜 객체를 넣는다.
 * 네트워크 실패·이상한 응답은 던지지 않고 unavailable로 바꾼다.
 */
export type ManageApi = {
  /** 기기 먼저 저장 구현이면 true(고침 3바퀴): 쓰기가 기기에 먼저 반영되고 서버에는 뒤에서 가므로 끊겨 있어도 막지 않는다 */
  localFirst?: boolean;
  editTodo(id: string, patch: { text?: string; categoryId?: string | null }): Promise<TodoResult<{ todo: TodoItem }>>;
  deleteTodo(id: string): Promise<TodoResult<{ id: string }>>;
  reorderTodos(ids: string[]): Promise<TodoResult<{ ids: string[] }>>;
  addNote(id: string, todoId: string, text: string): Promise<RecordResult<{ note: NoteItem }>>;
  deleteNote(id: string): Promise<RecordResult<{ id: string }>>;
  fetchNotes(todoId: string): Promise<RecordResult<{ notes: NoteItem[] }>>;
  fetchYesterday(): Promise<TodoResult<{ todos: TodoItem[] }>>;
  carryOver(items: { from: string; id: string }[]): Promise<TodoResult<{ todos: TodoItem[]; day: TodoDay }>>;
  /** 지난 날의 할 일 보기(보기만, 고침 3바퀴). 없으면 「지난 날 보기」를 그리지 않는다 */
  fetchDay?(date: string): Promise<TodoResult<TodayTodos>>;
  /** 지난 날 「이날 기록」 카드의 합계(분, 고침10). 그날 남긴 오늘 기록이 없으면 null. 없으면 합계를 0으로 보인다 */
  fetchDayRecord?(date: string): Promise<RecordResult<{ totalMinutes: number | null }>>;
};

const UNAVAILABLE = { ok: false, error: "unavailable" } as const;

async function safely<T>(call: () => Promise<T>): Promise<T | typeof UNAVAILABLE> {
  try {
    return await call();
  } catch {
    return UNAVAILABLE;
  }
}

/** 같은 출처 GET으로 { ok, data } | { ok: false, error } 읽기 */
export async function getJson<T>(path: string): Promise<T | typeof UNAVAILABLE> {
  try {
    const res = await fetch(path, { method: "GET", cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
    const body: unknown = await res.json();
    if (body !== null && typeof body === "object") {
      const v = body as { ok?: unknown; data?: unknown; error?: unknown };
      if (v.ok === true && v.data !== null && typeof v.data === "object") return { ok: true, data: v.data } as T;
      if (v.ok === false && typeof v.error === "string") return { ok: false, error: v.error } as T;
    }
    return UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

export const defaultManageApi: ManageApi = {
  editTodo: (id, patch) => safely(() => editTodo(id, patch)) as ReturnType<ManageApi["editTodo"]>,
  deleteTodo: (id) => safely(() => deleteTodo(id)) as ReturnType<ManageApi["deleteTodo"]>,
  reorderTodos: (ids) => safely(() => reorderTodos(ids)) as ReturnType<ManageApi["reorderTodos"]>,
  addNote: (id, todoId, text) => safely(() => addNote(id, todoId, text)) as ReturnType<ManageApi["addNote"]>,
  deleteNote: (id) => safely(() => deleteNote(id)) as ReturnType<ManageApi["deleteNote"]>,
  fetchNotes: (todoId) => getJson(`/notes?todoId=${encodeURIComponent(todoId)}`),
  fetchYesterday: () => getJson("/todos/yesterday"),
  carryOver: (items) => safely(() => carryOverTodos(items)) as ReturnType<ManageApi["carryOver"]>,
  fetchDay: (date) => getJson(`/todos/day?date=${encodeURIComponent(date)}`),
  // 새 서버 입구가 아니다: 오늘 기록 화면이 읽는 GET /evening?day=… 의 existing(그날 마지막 기록)에서 합계만 꺼낸다
  fetchDayRecord: async (date) => {
    const res = await getJson<RecordResult<EveningState>>(`/evening?day=${encodeURIComponent(date)}`);
    return res.ok ? { ok: true, data: { totalMinutes: res.data.existing?.totalMinutes ?? null } } : res;
  },
};
