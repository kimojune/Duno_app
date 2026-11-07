import { saveEveningLog } from "../../app/evening/actions";
import { endFocus, startFocus } from "../../app/focus/actions";
import { clearWeeklyGoal, saveWeeklyGoal } from "../../app/goals/actions";
import { dismissOffer } from "../../app/offers/actions";
import { saveRatios, saveSettings } from "../../app/settings/actions";
import { addCategory, addTodo, setTodoDone } from "../../app/todos/actions";
import { addNote, carryOverTodos, deleteNote, deleteTodo, editTodo, reorderTodos } from "../../app/todos/manage-actions";
import { recordView } from "../../app/views/actions";
import type { MirrorSnapshot, QueuedOp, SendResult } from "./types";

/**
 * 보낼 줄의 쓰기 하나를 서버에 보낸다(브라우저 쪽). 쓰기 한 종류마다 Server Action이 하나씩 있고, 서버가 모든 것을 다시 검사한다.
 * 쓰기를 누른 때(clientAt)를 함께 보내 서버가 하루 경계를 그 때로 정하게 한다(서버는 최근 72시간·미래 5분 범위만 검사).
 * 서버가 {ok:false}로 답하면 그 오류 코드를 그대로 돌려주고, 서버에 닿지 못해 던져지면 network로 돌려준다(보낼 줄이 멈추고 다시 한다).
 */
export async function sendToServer(queued: QueuedOp): Promise<SendResult> {
  const { op, clientAt } = queued;
  try {
    const res = await dispatch(op, clientAt);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  } catch {
    return { ok: false, error: "unavailable", network: true };
  }
}

type Reply = { ok: true } | { ok: false; error: string };

async function dispatch(op: QueuedOp["op"], clientAt: string): Promise<Reply> {
  switch (op.kind) {
    case "todo.add":
      return addTodo(op.id, op.text, op.categoryId ?? null, clientAt);
    case "todo.done":
      return setTodoDone(op.id, op.done);
    case "todo.edit": {
      const patch: { text?: string; categoryId?: string | null } = {};
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
    case "view.record":
      return recordView({ id: op.id, screen: op.screen, entry: op.entry, clientAt });
    case "offer.dismiss":
      return dismissOffer(op.id);
  }
}

/** 서버 사본 받기(GET /mirror). 던지지 않고 짧은 코드로 돌려준다 */
export async function fetchMirrorSnapshot(): Promise<{ ok: true; data: MirrorSnapshot } | { ok: false; error: string }> {
  try {
    const res = await fetch("/mirror", { method: "GET", cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
    const body: unknown = await res.json();
    if (body !== null && typeof body === "object") {
      const v = body as { ok?: unknown; data?: unknown; error?: unknown };
      if (v.ok === true && v.data !== null && typeof v.data === "object") return { ok: true, data: v.data as MirrorSnapshot };
      if (v.ok === false && typeof v.error === "string") return { ok: false, error: v.error };
    }
    return { ok: false, error: "unavailable" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
