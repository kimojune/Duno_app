import { FOCUS_SURFACES, type FocusSession } from "./types";

/** focus_sessions 행과 화면 모양 사이의 옮김(서버 전용 core들이 같이 쓴다) */

export type FocusRow = {
  id: string;
  started_at: string;
  day: string;
  planned_minutes: number;
  ended_at: string | null;
  elapsed_seconds: number | null;
  todo_id: string | null;
  category_id: string | null;
  offer_id: string | null;
  surface: string;
  opposite_by_goal: boolean | null;
  opposite_by_ratio: boolean | null;
};
export const COLUMNS = "id, started_at, day, planned_minutes, ended_at, elapsed_seconds, todo_id, category_id, offer_id, surface, opposite_by_goal, opposite_by_ratio";

export function toSession(row: FocusRow): FocusSession {
  const surface = FOCUS_SURFACES.find((s) => s === row.surface) ?? "manual";
  return {
    id: row.id,
    startedAt: row.started_at,
    day: row.day,
    plannedMinutes: row.planned_minutes,
    endedAt: row.ended_at ?? null,
    elapsedSeconds: row.elapsed_seconds ?? null,
    todoId: row.todo_id ?? null,
    categoryId: row.category_id ?? null,
    offerId: row.offer_id ?? null,
    surface,
    oppositeByGoal: row.opposite_by_goal ?? null,
    oppositeByRatio: row.opposite_by_ratio ?? null,
  };
}

