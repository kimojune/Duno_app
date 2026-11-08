"use server";

import { checkExpectedUser } from "../../lib/mirror/account";
import { createClient } from "../../lib/supabase/server";
import { saveEveningLog } from "../evening/actions";
import { endFocus, startFocus } from "../focus/actions";
import { clearWeeklyGoal, saveWeeklyGoal } from "../goals/actions";
import { dismissOffer } from "../offers/actions";
import { saveRatios, saveSettings } from "../settings/actions";
import { addCategory, addTodo, setTodoDone } from "../todos/actions";
import { addNote, carryOverTodos, deleteNote, deleteTodo, editTodo, reorderTodos } from "../todos/manage-actions";
import { recordView } from "../views/actions";

/**
 * 기기 먼저 저장의 보낼 줄이 쓰기 하나를 보내는 Server Action(고침 4바퀴). 공개 입구라 인자는 모두 unknown으로 받는다.
 * 1) 계정 확인: 세션 사용자 ≠ 기대 사용자(이 줄의 주인)면 account_mismatch로 거절한다. 기대 번호는 거절에만 쓰고 권한을 넓히지 않는다.
 * 2) 쓰기 종류에 맞는 기존 Server Action을 부른다. 그 Action이 세션을 다시 확인하고 인자를 모두 다시 검사한다(쓰기는 세션 사용자로만).
 * 분야 만들기가 duplicate면 이미 있는 그 분야(existing: 세션 사용자의 것만, RLS 그대로)를 함께 돌려준다(기기가 뒤의 쓰기의 분야 번호를 바꾼다).
 * 예상 못 한 예외는 unavailable로 바꾸고 원문을 내지 않는다.
 */

export type LocalOpReply = { ok: true } | { ok: false; error: string; existing?: { id: string; name: string } };

type Fields = Record<string, unknown>;

export async function sendLocalOp(expectedUser: unknown, op: unknown, clientAt: unknown): Promise<LocalOpReply> {
  try {
    const supabase = await createClient();
    if (!supabase) return { ok: false, error: "config" };
    const account = await checkExpectedUser(supabase, expectedUser);
    if (!account.ok) return { ok: false, error: account.error };
    if (op === null || typeof op !== "object" || typeof (op as Fields).kind !== "string") return { ok: false, error: "invalid_input" };
    const res = await dispatch(op as Fields, clientAt);
    if (res.ok) return { ok: true };
    const existing = (res as { existing?: unknown }).existing;
    if (res.error === "duplicate" && existing && typeof existing === "object") {
      const e = existing as { id?: unknown; name?: unknown };
      if (typeof e.id === "string" && typeof e.name === "string") return { ok: false, error: "duplicate", existing: { id: e.id, name: e.name } };
    }
    return { ok: false, error: res.error };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

type Reply = { ok: true } | { ok: false; error: string };

async function dispatch(op: Fields, clientAt: unknown): Promise<Reply> {
  switch (op.kind) {
    case "todo.add":
      return addTodo(op.id, op.text, op.categoryId ?? null, clientAt);
    case "todo.done":
      return setTodoDone(op.id, op.done);
    case "todo.edit": {
      const patch: Fields = {};
      if (op.text !== undefined) patch.text = op.text;
      if (op.categoryId !== undefined) patch.categoryId = op.categoryId;
      return editTodo(op.id, patch);
    }
    case "todo.delete":
      return deleteTodo(op.id);
    case "todo.reorder":
      return reorderTodos(op.ids);
    case "todo.carry":
      return carryOverTodos(op.items, clientAt);
    case "note.add":
      return addNote(op.id, op.todoId, op.text, clientAt);
    case "note.delete":
      return deleteNote(op.id);
    case "category.add":
      return addCategory(op.id, op.name);
    case "evening.save":
      return saveEveningLog(op.input);
    case "focus.start":
      return startFocus(op.input);
    case "focus.end":
      return endFocus(op.id, clientAt);
    case "goal.save":
      return saveWeeklyGoal(op.items, clientAt);
    case "goal.clear":
      return clearWeeklyGoal(clientAt);
    case "settings.save":
      return saveSettings(op.patch);
    case "ratios.save":
      return saveRatios(op.ratios);
    case "view.record": {
      const input = { id: op.id, screen: op.screen, entry: op.entry, clientAt };
      return recordView(input);
    }
    case "offer.dismiss":
      return dismissOffer(op.id);
    default:
      return { ok: false, error: "invalid_input" };
  }
}
