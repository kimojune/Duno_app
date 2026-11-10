import { APP_CONFIG } from "../app-config";
import type { EveningLog } from "../evening/types";
import { latestLogPerDay } from "./logs";
import { elapsedSecondsSoFar } from "../focus/logic";
import type { FocusSession } from "../focus/types";
import type { NoteItem } from "../notes/types";
import type { SettingsData } from "../settings/types";
import { DEFAULT_NOTIFY } from "../settings/validation";
import { offerCopyId } from "../offers/copy-id";
import { todoDayFor } from "../todos/day";
import { addDays, weekStartFor } from "../week";
import type { Mirror, MirrorSnapshot, MirrorTodo, QueuedOp } from "./types";

/**
 * 기기 거울에 쓰기(Op) 하나를 반영하는 순수 계산(고침 3바퀴, 기기 먼저 저장). 시계·저장소·네트워크를 건드리지 않는다.
 * 화면이 보는 값 = replay(서버에서 받은 거울, 보낼 줄): 서버가 쓰기를 거절해 줄에서 빼면 다시 입혀 되돌려진다.
 * 그래서 이 함수는 없는 대상(이미 지워진 할 일 등)을 만나도 던지지 않고 그냥 넘어간다(줄의 앞선 쓰기가 거절되면 뒤의 쓰기가 대상을 잃을 수 있다).
 * 하루 경계(서울 새벽 4시)는 쓰기를 누른 때(clientAt)로 정한다. 입력 검사(글 길이 등)는 쓰기를 줄에 넣기 전에 끝낸 값만 들어온다.
 */

export function emptyMirror(): Mirror {
  return {
    synced: false,
    todos: [],
    categories: [],
    settings: null,
    logs: [],
    goals: {},
    sessions: [],
    notes: {},
    offers: { card: null, timer_tab: null },
  };
}

const dayOf = (iso: string): string => todoDayFor(new Date(iso));

function defaultSettings(): SettingsData {
  return { goal: null, goalReadable: true, onboardingDone: false, notify: { ...DEFAULT_NOTIFY }, ratios: [] };
}

/** 쓰기 하나를 거울에 입힌 새 거울(원래 거울은 바꾸지 않는다) */
export function applyOp(m: Mirror, queued: Pick<QueuedOp, "op" | "clientAt">): Mirror {
  const { op, clientAt } = queued;
  switch (op.kind) {
    case "todo.add": {
      if (m.todos.some((t) => t.id === op.id)) return m;
      const todo: MirrorTodo = { id: op.id, day: dayOf(clientAt), text: op.text, done: false, createdAt: clientAt, categoryId: op.categoryId ?? null, position: null };
      return { ...m, todos: [...m.todos, todo], notes: { ...m.notes, [op.id]: m.notes[op.id] ?? [] } };
    }
    case "todo.done":
      return mapTodo(m, op.id, (t) => (t.done === op.done ? t : { ...t, done: op.done }));
    case "todo.edit":
      return mapTodo(m, op.id, (t) => ({
        ...t,
        ...(op.text !== undefined ? { text: op.text } : {}),
        ...(op.categoryId !== undefined ? { categoryId: op.categoryId } : {}),
      }));
    case "todo.delete": {
      if (!m.todos.some((t) => t.id === op.id)) return m;
      const notes = { ...m.notes };
      delete notes[op.id];
      return { ...m, todos: m.todos.filter((t) => t.id !== op.id), notes };
    }
    case "todo.reorder": {
      const order = new Map(op.ids.map((id, index) => [id, index]));
      return { ...m, todos: m.todos.map((t) => (order.has(t.id) ? { ...t, position: order.get(t.id) as number } : t)) };
    }
    case "todo.carry": {
      const today = dayOf(clientAt);
      const yesterday = addDays(today, -1);
      const base = Date.parse(clientAt);
      const added: MirrorTodo[] = [];
      op.items.forEach(({ from, id }, index) => {
        const source = m.todos.find((t) => t.id === from && t.day === yesterday);
        if (!source || m.todos.some((t) => t.id === id) || added.some((t) => t.id === id)) return;
        // 같은 때 가져온 줄이 순서대로 보이게 1ms씩 늦춘다
        added.push({ id, day: today, text: source.text, done: false, createdAt: new Date(base + index).toISOString(), categoryId: source.categoryId, position: null });
      });
      if (added.length === 0) return m;
      const notes = { ...m.notes };
      for (const t of added) notes[t.id] = notes[t.id] ?? [];
      return { ...m, todos: [...m.todos, ...added], notes };
    }
    case "note.add": {
      const list = m.notes[op.todoId];
      if (!list) {
        // 기록 목록을 모르는 할 일(열어 보지 않았거나 끊겨서 못 읽음): 목록은 서버에서 받을 때 함께 온다. 다만 이 할 일에 기록이 생겼다는 표시만은 바로 남긴다
        // (고침10: 안 남기면 거울을 다시 읽는 순간 할 일 줄의 종이 아이콘이 사라진다)
        if (!m.todos.some((t) => t.id === op.todoId && t.hasNotes !== true)) return m;
        return { ...m, todos: m.todos.map((t) => (t.id === op.todoId ? { ...t, hasNotes: true } : t)) };
      }
      if (list.some((n) => n.id === op.id)) return m;
      const note: NoteItem = { id: op.id, todoId: op.todoId, day: dayOf(clientAt), createdAt: clientAt, readable: true, text: op.text };
      return { ...m, notes: { ...m.notes, [op.todoId]: [...list, note] } };
    }
    case "note.delete": {
      let changed = false;
      const notes: Record<string, NoteItem[]> = {};
      for (const [todoId, list] of Object.entries(m.notes)) {
        const next = list.filter((n) => n.id !== op.id);
        if (next.length !== list.length) changed = true;
        notes[todoId] = next;
      }
      return changed ? { ...m, notes } : m;
    }
    case "category.add": {
      if (m.categories.some((c) => c.id === op.id)) return m;
      return { ...m, categories: [...m.categories, { id: op.id, readable: true, name: op.name, createdAt: clientAt }] };
    }
    case "evening.save": {
      const input = op.input;
      const log: EveningLog = {
        id: input.id,
        targetDay: input.targetDay,
        totalMinutes: input.totalMinutes,
        items: input.items,
        saveMode: input.saveMode,
        savedAt: input.clientSavedAt,
      };
      return { ...m, logs: latestLogPerDay([...m.logs.filter((l) => l.id !== log.id), log]) };
    }
    case "focus.start": {
      const input = op.input;
      if (m.sessions.some((s) => s.id === input.id)) return m;
      const session: FocusSession = {
        id: input.id,
        startedAt: input.clientStartedAt,
        day: dayOf(input.clientStartedAt),
        plannedMinutes: APP_CONFIG.timerMinutes,
        endedAt: null,
        elapsedSeconds: null,
        todoId: input.todoId ?? null,
        categoryId: input.categoryId ?? null,
        offerId: input.offerId ?? null,
        surface: input.surface,
        // 반대편 여부 둘은 서버만 정한다(기록 위조 막기). 기기 거울에는 비워 둔다
        oppositeByGoal: null,
        oppositeByRatio: null,
      };
      const offers = input.offerId
        ? {
            card: m.offers.card?.id === input.offerId ? null : m.offers.card,
            timer_tab: m.offers.timer_tab?.id === input.offerId ? null : m.offers.timer_tab,
          }
        : m.offers;
      return { ...m, sessions: [...m.sessions, session], offers };
    }
    case "focus.end": {
      return {
        ...m,
        sessions: m.sessions.map((s) => {
          if (s.id !== op.id || s.endedAt !== null) return s;
          const started = Date.parse(s.startedAt);
          const ended = Date.parse(clientAt);
          const elapsed = Number.isFinite(started) && Number.isFinite(ended) ? elapsedSecondsSoFar(started, ended, s.plannedMinutes) : 0;
          return { ...s, endedAt: clientAt, elapsedSeconds: elapsed };
        }),
      };
    }
    case "goal.save": {
      const weekStart = weekStartFor(dayOf(clientAt));
      return { ...m, goals: { ...m.goals, [weekStart]: op.items.map((i) => ({ categoryId: i.categoryId as string | null, minutes: i.minutes })) } };
    }
    case "goal.clear": {
      const weekStart = weekStartFor(dayOf(clientAt));
      return { ...m, goals: { ...m.goals, [weekStart]: null } };
    }
    case "settings.save": {
      const current = m.settings ?? defaultSettings();
      const patch = op.patch;
      const next: SettingsData = {
        ...current,
        ...(patch.goal !== undefined ? { goal: patch.goal, goalReadable: true } : {}),
        ...(patch.notify ? { notify: { ...current.notify, ...patch.notify } } : {}),
        ...(patch.completeOnboarding ? { onboardingDone: true } : {}),
      };
      return { ...m, settings: next };
    }
    case "ratios.save": {
      const current = m.settings ?? defaultSettings();
      return { ...m, settings: { ...current, ratios: op.ratios } };
    }
    case "view.record":
      return m; // 쌓기만 하는 기록이라 거울이 바뀔 것이 없다
    case "offer.addTodo": {
      // 건넨 지난 날 할 일을 오늘 사본으로(사본 id는 제시 id에서 정해진 식, 서버와 같다). 이미 있으면 새로 만들지 않는다
      const copyId = offerCopyId(op.offerId);
      if (!copyId) return m;
      const today = dayOf(clientAt);
      const card = m.offers.card;
      const withCard = (todos: MirrorTodo[], text: string | null): Mirror =>
        card && card.id === op.offerId ? { ...m, todos, offers: { ...m.offers, card: { ...card, todoId: copyId, todoText: text, todoDay: today } } } : { ...m, todos };
      const existing = m.todos.find((t) => t.id === copyId);
      if (existing) return withCard(m.todos, existing.text);
      const source = m.todos.find((t) => t.id === op.from && !t.done && t.day < today);
      if (!source) return m;
      const copy: MirrorTodo = { id: copyId, day: today, text: source.text, done: false, createdAt: clientAt, categoryId: source.categoryId, position: null };
      const next = withCard([...m.todos, copy], source.text);
      return { ...next, notes: { ...next.notes, [copyId]: next.notes[copyId] ?? [] } };
    }
    case "offer.dismiss": {
      const card = m.offers.card?.id === op.id ? null : m.offers.card;
      const timer = m.offers.timer_tab?.id === op.id ? null : m.offers.timer_tab;
      return card === m.offers.card && timer === m.offers.timer_tab ? m : { ...m, offers: { card, timer_tab: timer } };
    }
  }
}

function mapTodo(m: Mirror, id: string, change: (t: MirrorTodo) => MirrorTodo): Mirror {
  let changed = false;
  const todos = m.todos.map((t) => {
    if (t.id !== id) return t;
    const next = change(t);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? { ...m, todos } : m;
}

/** 서버에서 받은 거울 위에 보낼 줄의 쓰기를 차례로 다시 입힌다 */
export function replay(base: Mirror, queue: QueuedOp[]): Mirror {
  return queue.reduce<Mirror>((m, q) => applyOp(m, q), base);
}

/**
 * 서버 사본을 기기 거울에 합친다: 받은 칸은 통째로 바꾸고, 못 읽은 칸(null)은 옛 값을 둔다.
 * 작업 기록(notes)과 제시(offers)는 사본에 없어 그대로 둔다. 서버 것이 이기고, 보낼 줄의 쓰기는 이 뒤에 replay로 다시 입힌다(기기 것이 이긴다).
 */
export function mergeSnapshot(base: Mirror, snapshot: MirrorSnapshot): Mirror {
  const goals = snapshot.goal ? { ...base.goals, [snapshot.goal.weekStart]: snapshot.goal.items } : base.goals;
  return {
    ...base,
    synced: true,
    todos: snapshot.todos ?? base.todos,
    categories: snapshot.categories ?? base.categories,
    settings: snapshot.settings ?? base.settings,
    logs: snapshot.logs ?? base.logs,
    goals,
    sessions: snapshot.sessions ?? base.sessions,
  };
}
