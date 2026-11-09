import type { CategoryItem } from "../categories/types";
import { EVENING_BACK_DAYS } from "../evening/logic";
import type { EveningState } from "../evening/types";
import { isActive, minutesByCategory } from "../focus/logic";
import type { FocusSession, FocusState } from "../focus/types";
import type { GoalSummary } from "../goals/types";
import { computeGoalSummary, computeGrowth } from "../growth/compute";
import type { GrowthData } from "../growth/types";
import type { RecordResult } from "../records/common";
import type { TodayRead } from "../today-types";
import { describeTodoDay, todoDayFor } from "../todos/day";
import { sortByPosition } from "../todos/order";
import type { TodayTodos, TodoItem, TodoResult } from "../todos/types";
import { addDays, isDayString, weekStartFor } from "../week";
import { latestLogPerDay } from "./logs";
import { categoryPageFromDay, mergeCategoryMinutes } from "../notes/category-minutes";
import type { CategoryPageDay } from "../notes/types";
import type { Mirror, MirrorTodo } from "./types";

/**
 * 기기 거울에서 화면이 읽는 값을 만든다(순수 계산, 고침 3바퀴). 서버 읽기(할 일·저녁 기록·타이머·상태보기·이번 주 목표)와 같은 모양·같은 규칙을 기기에서 낸다.
 * 서버 것을 기다리지 않으므로 끊긴 채로도, 막 누른 뒤에도 바로 읽힌다.
 * 처음 쓰는 기기(아직 서버 사본을 한 번도 못 받음, 기기에 적은 것도 없음)는 「아직 읽을 수 없음」으로 돌려준다: 비어 있는 것으로 보이면 안 된다.
 */

const UNAVAILABLE = { ok: false, error: "unavailable" } as const;

function isUnknown(m: Mirror): boolean {
  return !m.synced && m.todos.length === 0 && m.categories.length === 0 && m.settings === null;
}

function todoItem(t: MirrorTodo): TodoItem {
  return t.text === null
    ? { id: t.id, readable: false, text: null, done: t.done, createdAt: t.createdAt, categoryId: t.categoryId }
    : { id: t.id, readable: true, text: t.text, done: t.done, createdAt: t.createdAt, categoryId: t.categoryId };
}

/** 그 날의 할 일: 만든 순서(createdAt, id), 순서를 정한 행(position)이 앞 — 서버 목록과 같은 규칙 */
export function todosOfDay(m: Mirror, day: string): MirrorTodo[] {
  const rows = m.todos
    .filter((t) => t.day === day)
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
  return sortByPosition(rows);
}

export function categoryList(m: Mirror): { categories: CategoryItem[] } {
  return { categories: m.categories };
}

export function readableCategories(m: Mirror): { id: string; name: string }[] {
  return m.categories.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name }] : []));
}

/** 오늘 화면(할 일 + 분야) */
export function deriveToday(m: Mirror, nowMs: number): TodayRead {
  if (isUnknown(m)) return { todos: UNAVAILABLE, categories: UNAVAILABLE };
  const day = todoDayFor(new Date(nowMs));
  return {
    todos: { ok: true, data: { day: describeTodoDay(day), todos: todosOfDay(m, day).map(todoItem) } },
    categories: { ok: true, data: categoryList(m) },
  };
}

/** 지난 날의 할 일(보기만). 기기에 둔 기간(오늘부터 8일) 안이면 기기에서 읽고, 그 밖은 null(서버에서 읽는다) */
export function derivePastDay(m: Mirror, date: string, nowMs: number): TodoResult<TodayTodos> | null {
  if (!isDayString(date)) return { ok: false, error: "invalid_input" };
  const today = todoDayFor(new Date(nowMs));
  if (date >= today) return { ok: false, error: "invalid_input" };
  if (!m.synced) return null;
  if (date < addDays(today, -7)) return null;
  return { ok: true, data: { day: describeTodoDay(date), todos: todosOfDay(m, date).map(todoItem) } };
}

/** 어제 못 끝낸 할 일(가져올 후보). 오늘 할 일(끝낸 것 포함)과 글이 같은 것은 이미 가져온 것으로 보고 뺀다 */
export function deriveYesterday(m: Mirror, nowMs: number): TodoResult<{ todos: TodoItem[] }> {
  if (isUnknown(m)) return UNAVAILABLE;
  const today = todoDayFor(new Date(nowMs));
  const yesterday = addDays(today, -1);
  const taken = new Set(todosOfDay(m, today).flatMap((t) => (t.text === null ? [] : [t.text])));
  const todos = todosOfDay(m, yesterday)
    .filter((t) => !t.done && !(t.text !== null && taken.has(t.text)))
    .map(todoItem);
  return { ok: true, data: { todos } };
}

/** 저녁 기록 화면이 열릴 때 필요한 것(대상 날 기준) */
export function deriveEveningState(m: Mirror, dayParam: string | undefined, nowMs: number): RecordResult<EveningState> {
  if (isUnknown(m)) return UNAVAILABLE;
  const today = todoDayFor(new Date(nowMs));
  const day = dayParam === undefined || dayParam === "" ? today : dayParam;
  if (!isDayString(day) || day > today || day < addDays(today, -EVENING_BACK_DAYS)) return { ok: false, error: "invalid_input" };
  const existing = latestLogPerDay(m.logs.filter((l) => l.targetDay === day))[0] ?? null;
  const doneIds = [...new Set(todosOfDay(m, day).filter((t) => t.done).map((t) => t.categoryId))];
  const timerByCategory = minutesByCategory(
    m.sessions.filter((s) => s.day === day),
    nowMs,
  );
  return { ok: true, data: { today, day, existing, doneCategoryIds: doneIds, timerByCategory, categories: readableCategories(m) } };
}

/** 이번 주 목표 한 줄과 목표 정하기 창이 읽는 것 */
export function deriveGoalSummary(m: Mirror, nowMs: number): RecordResult<GoalSummary> {
  if (isUnknown(m)) return UNAVAILABLE;
  const today = todoDayFor(new Date(nowMs));
  return { ok: true, data: computeGoalSummary({ today, logs: m.logs, categories: readableCategories(m), goalItems: m.goals[weekStartFor(today)] ?? null }) };
}

/** 상태보기 */
export function deriveGrowth(m: Mirror, nowMs: number): RecordResult<GrowthData> {
  if (isUnknown(m)) return UNAVAILABLE;
  const today = todoDayFor(new Date(nowMs));
  return {
    ok: true,
    data: computeGrowth({
      today,
      logs: m.logs,
      categories: readableCategories(m),
      ratios: m.settings?.ratios ?? [],
      goalItems: m.goals[weekStartFor(today)] ?? null,
      goalText: m.settings?.goal ?? null,
    }),
  };
}

/**
 * 분야 페이지 날짜별 시간(고침8): 서버가 준 날짜 묶음의 할 일은 그대로 두고, minutes는 기기 사본의 오늘 기록에서 서버와 같은 규칙
 * (mergeCategoryMinutes · 날마다 가장 늦은 것 latestLogPerDay — F6 기준)으로 다시 센다. 아직 기기에 저장만 하고 보내지 않은 기록도 든다.
 * 범위도 서버와 같다: 할 일을 상한까지 받았으면 그 가장 오래된 날부터. 기기 사본을 모르면(처음 받기 전) null — 서버 값을 그대로 쓴다
 */
export function deriveCategoryDays(m: Mirror, categoryId: string | null, days: CategoryPageDay[]): CategoryPageDay[] | null {
  if (isUnknown(m)) return null;
  const todoDays = days.filter((d) => d.todos.length > 0);
  const todoCount = todoDays.reduce((s, d) => s + d.todos.length, 0);
  const fromDay = categoryPageFromDay(todoCount, todoDays);
  return mergeCategoryMinutes(todoDays, latestLogPerDay(m.logs), categoryId, fromDay);
}

/** 타이머 화면이 열릴 때: 진행 중인 세션과 오늘 시작한 세션들 */
export function deriveFocusState(m: Mirror, nowMs: number): RecordResult<FocusState> {
  if (isUnknown(m)) return UNAVAILABLE;
  const today = todoDayFor(new Date(nowMs));
  const sorted = [...m.sessions].sort((a, b) => (a.startedAt === b.startedAt ? (a.id < b.id ? -1 : 1) : a.startedAt < b.startedAt ? -1 : 1));
  const todays: FocusSession[] = sorted.filter((s) => s.day === today);
  // 어제 시작해 새벽 4시를 넘긴 채 도는 세션도 진행 중으로 본다: 끝내지 않은 가장 최근 것
  const active = [...sorted].reverse().find((s) => isActive(s, nowMs)) ?? null;
  return { ok: true, data: { serverNow: new Date(nowMs).toISOString(), active, today: todays } };
}
