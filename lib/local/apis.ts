import { requestOffer } from "../../app/offers/actions";
import { isEvening } from "../app-config";
import type { AddCategoryResult } from "../categories/types";
import { CATEGORY_LIMIT, checkCategoryName, sameCategoryName } from "../categories/validation";
import { diffItems, sumMinutes } from "../evening/logic";
import type { EveningApi } from "../evening-api";
import type { FocusApi } from "../focus-api";
import { isActive } from "../focus/logic";
import type { GoalsApi } from "../goals-api";
import { checkGoalItems } from "../goals/validation";
import type { GrowthApi } from "../growth-api";
import { getJson, type ManageApi } from "../manage-api";
import { checkNoteText } from "../notes/public";
import type { NoteItem } from "../notes/types";
import type { OffersApi } from "../offers-api";
import type { SettingsApi } from "../onboarding-api";
import { defaultPushApi } from "../push/subscribe";
import type { RecordResult } from "../records/common";
import { checkGoal, checkRatios, notifyPatchSchema } from "../settings/validation";
import { describeTodoDay, todoDayFor } from "../todos/day";
import type { TodoItem, TodoResult } from "../todos/types";
import { checkTodoText } from "../todos/validation";
import { addDays } from "../week";
import {
  deriveEveningState,
  deriveFocusState,
  deriveGoalSummary,
  deriveGrowth,
  derivePastDay,
  deriveToday,
  deriveYesterday,
  todosOfDay,
} from "./derive";
import type { Runtime } from "./runtime";
import type { MirrorTodo } from "./types";

/**
 * 기기 먼저 저장의 화면용 API(고침 3바퀴). 화면이 이미 쓰는 Api 모양(ManageApi·EveningApi·FocusApi·GoalsApi·GrowthApi·OffersApi·SettingsApi)을
 * 그대로 지키되, 구현이 서버 왕복이 아니라 기기 거울과 보낼 줄이다:
 * - 읽기는 기기 거울에서 바로 낸다(끊겨도, 막 누른 뒤에도).
 * - 쓰기는 기기에서 검사하고(글 길이·분야 중복 등 서버와 같은 규칙) 거울에 먼저 입힌 뒤 보낼 줄에 넣어 바로 성공으로 답한다. 서버가 거절하면 되돌린다.
 * 서버만 할 수 있는 것은 그대로 서버다: 먼저 할 일 건네기(제시 기록은 서버가 정한다), 분야 페이지(여러 날 모음), 작업 기록을 처음 여는 것.
 */

const unauthenticatedOr = <T>(error: string): RecordResult<T> => ({ ok: false, error: error as "unavailable" });

function todoItem(t: MirrorTodo): TodoItem {
  return t.text === null
    ? { id: t.id, readable: false, text: null, done: t.done, createdAt: t.createdAt, categoryId: t.categoryId }
    : { id: t.id, readable: true, text: t.text, done: t.done, createdAt: t.createdAt, categoryId: t.categoryId };
}

export type LocalApis = {
  manage: ManageApi;
  evening: EveningApi;
  focus: FocusApi;
  goals: GoalsApi;
  growth: GrowthApi;
  offers: OffersApi;
  settings: SettingsApi;
};

export function createLocalApis(runtime: Runtime): LocalApis {
  const nowMs = () => runtime.now();
  const mirror = () => runtime.getMirror();
  const categoryIds = () => new Set(mirror().categories.map((c) => c.id));

  // ---- 분야 페이지: 서버에서만 읽는다(여러 날 모음). 열어 본 것은 이 화면을 여는 동안 기억해 두었다가 먼저 보여 준다 ----
  const categoryPageCache = new Map<string, Awaited<ReturnType<GrowthApi["fetchCategoryPage"]>>>();

  const manage: ManageApi = {
    localFirst: true,
    async editTodo(id, patch): Promise<TodoResult<{ todo: TodoItem }>> {
      const current = mirror().todos.find((t) => t.id === id);
      if (!current) return { ok: false, error: "not_found" };
      let text: string | undefined;
      if (patch.text !== undefined) {
        const checked = checkTodoText(patch.text);
        if (!checked.ok) return { ok: false, error: checked.error };
        text = checked.text;
      }
      if (patch.categoryId !== undefined && patch.categoryId !== null && !categoryIds().has(patch.categoryId)) return { ok: false, error: "invalid_category" };
      if (text === undefined && patch.categoryId === undefined) return { ok: false, error: "invalid_input" };
      runtime.enqueue({ kind: "todo.edit", id, ...(text !== undefined ? { text } : {}), ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}) });
      const updated = mirror().todos.find((t) => t.id === id);
      return updated ? { ok: true, data: { todo: todoItem(updated) } } : { ok: false, error: "not_found" };
    },
    async deleteTodo(id) {
      if (!mirror().todos.some((t) => t.id === id)) return { ok: false, error: "not_found" };
      runtime.enqueue({ kind: "todo.delete", id });
      return { ok: true, data: { id } };
    },
    async reorderTodos(ids) {
      if (ids.length === 0 || ids.length > 200 || new Set(ids).size !== ids.length) return { ok: false, error: "invalid_input" };
      const known = new Set(mirror().todos.map((t) => t.id));
      if (ids.some((id) => !known.has(id))) return { ok: false, error: "not_found" };
      runtime.enqueue({ kind: "todo.reorder", ids });
      return { ok: true, data: { ids } };
    },
    async addNote(id, todoId, text): Promise<RecordResult<{ note: NoteItem }>> {
      const checked = checkNoteText(text);
      if (!checked.ok) return { ok: false, error: checked.error };
      if (!mirror().todos.some((t) => t.id === todoId)) return { ok: false, error: "not_found" };
      const queued = runtime.enqueue({ kind: "note.add", id, todoId, text: checked.text });
      const note = mirror().notes[todoId]?.find((n) => n.id === id);
      // 열어 보지 않은 할 일이면 거울에 목록이 없다: 화면이 쓸 한 줄은 직접 만들어 준다(서버에서 받을 때 함께 온다)
      return { ok: true, data: { note: note ?? { id, todoId, day: todoDayFor(new Date(queued.clientAt)), createdAt: queued.clientAt, readable: true, text: checked.text } } };
    },
    async deleteNote(id) {
      runtime.enqueue({ kind: "note.delete", id });
      return { ok: true, data: { id } };
    },
    async fetchNotes(todoId): Promise<RecordResult<{ notes: NoteItem[] }>> {
      const cached = mirror().notes[todoId];
      if (cached) return { ok: true, data: { notes: cached } };
      // 아직 서버에 없는 할 일(보낼 줄에 「적기」가 남음)은 서버에 물을 것이 없다
      if (runtime.hasPendingAdd(todoId)) return { ok: true, data: { notes: [] } };
      const res = await getJson<RecordResult<{ notes: NoteItem[] }>>(`/notes?todoId=${encodeURIComponent(todoId)}`);
      if (!res.ok) return res;
      // 서버 목록에 아직 못 보낸 기록 쓰기를 다시 입힌다
      runtime.patchBase((m) => ({ ...m, notes: { ...m.notes, [todoId]: res.data.notes } }));
      return { ok: true, data: { notes: mirror().notes[todoId] ?? res.data.notes } };
    },
    async fetchYesterday() {
      return deriveYesterday(mirror(), nowMs());
    },
    async carryOver(items) {
      if (items.length === 0 || items.length > 50) return { ok: false, error: "invalid_input" };
      const today = todoDayFor(new Date(nowMs()));
      const yesterday = addDays(today, -1);
      const sources = new Set(todosOfDay(mirror(), yesterday).map((t) => t.id));
      if (items.some((i) => !sources.has(i.from))) return { ok: false, error: "not_found" };
      runtime.enqueue({ kind: "todo.carry", items });
      const made = items.flatMap((i) => {
        const t = mirror().todos.find((x) => x.id === i.id);
        return t ? [todoItem(t)] : [];
      });
      return { ok: true, data: { todos: made, day: describeTodoDay(today) } };
    },
    async fetchDay(date) {
      const local = derivePastDay(mirror(), date, nowMs());
      if (local) return local;
      return getJson(`/todos/day?date=${encodeURIComponent(date)}`);
    },
  };

  const evening: EveningApi = {
    localFirst: true,
    async fetchState(day) {
      return deriveEveningState(mirror(), day, nowMs());
    },
    async save(input) {
      if (sumMinutes(input.items) !== input.totalMinutes) return { ok: false, error: "invalid_input" };
      const state = deriveEveningState(mirror(), input.targetDay, nowMs());
      if (!state.ok) return state;
      const known = categoryIds();
      if (input.items.some((i) => i.categoryId !== null && !known.has(i.categoryId))) return { ok: false, error: "not_found" };
      const previous = state.data.existing?.items ?? [];
      runtime.enqueue({ kind: "evening.save", input });
      const log = mirror().logs.find((l) => l.id === input.id);
      if (!log) return { ok: false, error: "unavailable" };
      return { ok: true, data: { log, delta: diffItems(previous, log.items) } };
    },
  };

  const focus: FocusApi = {
    localFirst: true,
    async fetchState() {
      return deriveFocusState(mirror(), nowMs());
    },
    async start(input) {
      // 같은 id로 다시 누르면(재시도) 새로 넣지 않고 그 세션으로 성공한다(서버와 같다)
      const same = mirror().sessions.find((s) => s.id === input.id);
      if (same) return { ok: true, data: { session: same, serverNow: new Date(nowMs()).toISOString() } };
      const running = mirror().sessions.find((s) => isActive(s, nowMs()));
      if (running) return { ok: false, error: "already_running" };
      runtime.enqueue({ kind: "focus.start", input });
      const session = mirror().sessions.find((s) => s.id === input.id);
      return session ? { ok: true, data: { session, serverNow: new Date(nowMs()).toISOString() } } : { ok: false, error: "unavailable" };
    },
    async end(id) {
      const found = mirror().sessions.find((s) => s.id === id);
      if (!found) return { ok: false, error: "not_found" };
      if (found.endedAt === null) runtime.enqueue({ kind: "focus.end", id });
      const session = mirror().sessions.find((s) => s.id === id);
      return session ? { ok: true, data: { session } } : { ok: false, error: "unavailable" };
    },
  };

  const goals: GoalsApi = {
    localFirst: true,
    async fetchSummary() {
      return deriveGoalSummary(mirror(), nowMs());
    },
    async save(items) {
      const checked = checkGoalItems(items);
      if (!checked.ok) return { ok: false, error: "invalid_input" };
      const known = categoryIds();
      if (checked.items.some((i) => !known.has(i.categoryId))) return { ok: false, error: "not_found" };
      runtime.enqueue({ kind: "goal.save", items: checked.items });
      const summary = deriveGoalSummary(mirror(), nowMs());
      if (!summary.ok) return summary;
      return { ok: true, data: { weekStart: summary.data.weekStart, items: summary.data.goal ?? [] } };
    },
    async clear() {
      runtime.enqueue({ kind: "goal.clear" });
      const summary = deriveGoalSummary(mirror(), nowMs());
      if (!summary.ok) return summary;
      return { ok: true, data: { weekStart: summary.data.weekStart } };
    },
  };

  const growth: GrowthApi = {
    localFirst: true,
    async fetchGrowth() {
      return deriveGrowth(mirror(), nowMs());
    },
    async fetchCategoryPage(categoryId) {
      const key = categoryId ?? "other";
      const cached = categoryPageCache.get(key);
      const fresh = getJson<Awaited<ReturnType<GrowthApi["fetchCategoryPage"]>>>(`/category?id=${encodeURIComponent(key)}`).then((res) => {
        if (res.ok) categoryPageCache.set(key, res);
        return res;
      });
      // 열어 본 적이 있으면 그것을 먼저 보여 주고 뒤에서 새로 받아 둔다(다음에 열 때 새것). 처음이면 서버를 기다린다
      if (cached && cached.ok) {
        void fresh;
        return cached;
      }
      return fresh;
    },
    async recordView(input) {
      runtime.enqueue({ kind: "view.record", id: input.id, screen: input.screen, entry: input.entry });
      return { ok: true, data: { id: input.id } };
    },
  };

  const offers: OffersApi = {
    localFirst: true,
    async request(surface) {
      const today = todoDayFor(new Date(nowMs()));
      // 저녁에는 카드를 건네지 않는다(서버 규칙): 낮에 받아 둔 카드를 저녁에 먼저 보여 주지 않는다
      const cached = surface === "card" && isEvening(new Date(nowMs())) ? null : mirror().offers[surface];
      const refresh = requestOffer({ surface }).then((res) => {
        if (res.ok) runtime.patchBase((m) => ({ ...m, offers: { ...m.offers, [surface]: res.data.offer } }));
        return res;
      });
      // 오늘 건넨 제시를 기기에 가지고 있으면 그것을 먼저 쓰고 뒤에서 서버에 다시 묻는다(바뀌면 거울이 바뀌어 화면이 따라간다)
      if (cached && cached.day === today) {
        void refresh.catch(() => {});
        return { ok: true, data: { offer: cached } };
      }
      try {
        return await refresh;
      } catch {
        return unauthenticatedOr("unavailable");
      }
    },
    async dismiss(id) {
      runtime.enqueue({ kind: "offer.dismiss", id });
      return { ok: true, data: { id } };
    },
  };

  const settings: SettingsApi = {
    localFirst: true,
    async addCategory(id, name): Promise<AddCategoryResult> {
      const checked = checkCategoryName(name);
      if (!checked.ok) return { ok: false, error: checked.error };
      // 같은 id로 다시 오면(재시도) 새로 만들지 않고 그 분야로 성공한다(서버와 같은 순서: 같은 id가 같은 이름보다 먼저)
      const same = mirror().categories.find((c) => c.id === id);
      if (same) return { ok: true, data: { category: same } };
      const existing = mirror().categories.find((c) => c.readable && sameCategoryName(c.name, checked.name));
      if (existing && existing.readable) return { ok: false, error: "duplicate", existing: { id: existing.id, name: existing.name } };
      if (mirror().categories.length >= CATEGORY_LIMIT) return { ok: false, error: "category_limit" };
      runtime.enqueue({ kind: "category.add", id, name: checked.name });
      const made = mirror().categories.find((c) => c.id === id);
      return made ? { ok: true, data: { category: made } } : { ok: false, error: "unavailable" };
    },
    async saveRatios(ratios) {
      const checked = checkRatios(ratios);
      if (!checked.ok) return { ok: false, error: "invalid_input" };
      const known = categoryIds();
      if (checked.ratios.some((r) => r.categoryId !== null && !known.has(r.categoryId))) return { ok: false, error: "not_found" };
      runtime.enqueue({ kind: "ratios.save", ratios: checked.ratios });
      return { ok: true, data: { ratios: checked.ratios } };
    },
    async saveSettings(patch) {
      const next: { goal?: string | null; notify?: Partial<import("../settings/types").NotifySettings>; completeOnboarding?: boolean } = {};
      if (patch.goal !== undefined) {
        const goal = checkGoal(patch.goal);
        if (!goal.ok) return { ok: false, error: goal.error };
        next.goal = goal.goal;
      }
      if (patch.notify !== undefined) {
        const notify = notifyPatchSchema.safeParse(patch.notify);
        if (!notify.success) return { ok: false, error: "invalid_input" };
        next.notify = notify.data;
      }
      if (patch.completeOnboarding) next.completeOnboarding = true;
      if (Object.keys(next).length === 0) return { ok: false, error: "invalid_input" };
      runtime.enqueue({ kind: "settings.save", patch: next });
      const s = mirror().settings;
      if (!s) return { ok: false, error: "unavailable" };
      return { ok: true, data: { goal: s.goal, goalReadable: s.goalReadable, onboardingDone: s.onboardingDone, notify: s.notify } };
    },
    // 알림 허락을 묻고 푸시를 구독한다: 기기와 서버가 함께 해야 하는 일이라 서버 몫 그대로(lib/onboarding-api.ts와 같다)
    requestPermission: async () => {
      try {
        const result = await defaultPushApi.enable();
        if (result === "ok") return "granted";
        return result;
      } catch {
        return "failed";
      }
    },
  };

  return { manage, evening, focus, goals, growth, offers, settings };
}

/** 화면이 거울에서 바로 읽는 오늘 목록(할 일 + 분야) */
export function readTodayFromMirror(runtime: Runtime) {
  return deriveToday(runtime.getMirror(), runtime.now());
}
