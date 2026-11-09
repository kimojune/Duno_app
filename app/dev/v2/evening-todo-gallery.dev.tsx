"use client";

import { useState } from "react";
import { EveningRecord } from "../../../components/evening-record";
import type { EveningApi } from "../../../lib/evening-api";
import type { LocalTodos } from "../../../lib/local/todos";
import type { TodayRead } from "../../../lib/today-types";
import type { TodoItem } from "../../../lib/todos/types";

/**
 * 개발용(고침 5바퀴 E2): 오늘 기록 시간 단계의 「오늘 할 일 n/m ›」 줄과 「오늘 할 일」 시트. /dev/v2?s=evening-todo
 * 서버·기기 저장소를 부르지 않는 메모리 가짜 LocalTodos를 넣는다(진짜 앱에서는 할 일 탭과 같은 LocalTodos). 글·분야 이름은 지어낸 예시다.
 */

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const CATEGORIES = [
  { id: C1, name: "어학" },
  { id: C2, name: "포트폴리오" },
  { id: C3, name: "CS 공부" },
];
// 분야 열 개(긴 이름 하나): 시트의 칩 줄이 한 줄을 넘쳐 「›」가 나는지 본다(/dev/v2?s=evening-todo-many)
const MANY_CATEGORIES = [
  ...CATEGORIES,
  ...Array.from({ length: 7 }, (_, i) => ({
    id: `e${i}e${i}e${i}e${i}-0000-4000-8000-00000000000${i}`,
    name: i === 2 ? "아주아주아주긴분야이름이라서한줄에다안들어갑니다" : `분야 ${i + 4}`,
  })),
];
const DAY = { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 };
const AT = "2026-11-07T01:00:00.000Z";

function memoryTodos(categories: { id: string; name: string }[]): LocalTodos {
  let todos: TodoItem[] = [
    { id: "t1", readable: true, text: "토익 단어 50개 외우기", done: true, createdAt: AT, categoryId: C1 },
    { id: "t2", readable: true, text: "이력서 경력 부분 고치기", done: true, createdAt: AT, categoryId: C2 },
    { id: "t3", readable: true, text: "운영체제 3장 읽기", done: false, createdAt: AT, categoryId: C3 },
    { id: "t4", readable: true, text: "빨래", done: false, createdAt: AT, categoryId: null },
  ];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const read = (): TodayRead => ({
    todos: { ok: true, data: { day: DAY, todos } },
    categories: { ok: true, data: { categories: categories.map((c) => ({ ...c, readable: true as const, createdAt: AT })) } },
  });
  return {
    read,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    subscribeState: () => () => {},
    addTodo: ({ id, text, categoryId }) => {
      todos = [...todos, { id, readable: true, text, done: false, createdAt: new Date().toISOString(), categoryId }];
      emit();
    },
    setDone: (id, done) => {
      todos = todos.map((t) => (t.id === id ? { ...t, done } : t));
      emit();
    },
    addCategory: async () => ({ ok: false, error: "unavailable" }),
    refresh: () => {},
    isAuthLost: () => false,
    flushBeforeSignOut: async () => 0,
    discard: async () => {},
  };
}

const eveningApiFor = (categories: { id: string; name: string }[]): EveningApi => ({
  localFirst: true,
  fetchState: async () => ({
    ok: true,
    data: { today: "2026-11-07", day: "2026-11-07", existing: null, doneCategoryIds: [C1, C2], timerByCategory: [{ categoryId: C1, minutes: 150 }], categories },
  }),
  save: () => new Promise<never>(() => {}),
});

export function EveningTodoGallery({ many = false }: { many?: boolean }) {
  const categories = many ? MANY_CATEGORIES : CATEGORIES;
  const [local] = useState(() => memoryTodos(categories));
  const [eveningApi] = useState(() => eveningApiFor(categories));
  const [open, setOpen] = useState(true);
  return open ? (
    <EveningRecord api={eveningApi} todos={{ local }} onClose={() => setOpen(false)} />
  ) : (
    <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
      창 열기
    </button>
  );
}
