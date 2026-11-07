import { FOCUS_SURFACES, type FocusSession } from "./types";

/** focus_sessions 행과 화면 모양 사이의 옮김(서버 전용 core들이 같이 쓴다) */

export type FocusRow = {
  id: string;
  started_at: string;
  /** 기기 시계(기기 먼저 저장에서 시작을 보낸 뒤에 올라가도 진짜 시작 시각을 알도록). 없을 수 있다 */
  client_started_at?: string | null;
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
export const COLUMNS = "id, started_at, client_started_at, day, planned_minutes, ended_at, elapsed_seconds, todo_id, category_id, offer_id, surface, opposite_by_goal, opposite_by_ratio";

/**
 * 시작 시각: 서버 시계(started_at)가 기본이다. 기기 먼저 저장은 시작을 보낸 시각이 늦을 수 있어(끊긴 채 켠 타이머), 기기가 보낸 시작 시각(client_started_at)이
 * 서버가 받은 때 이전 72시간 안·이후 5분 이내면 그 시각을 시작으로 본다(범위를 벗어나면 서버 시계). 임시, docs/oneshot-v2/임시값.md.
 */
export function effectiveStartedAt(row: Pick<FocusRow, "started_at" | "client_started_at">): string {
  const server = Date.parse(row.started_at);
  const client = row.client_started_at ? Date.parse(row.client_started_at) : Number.NaN;
  if (!Number.isFinite(server) || !Number.isFinite(client)) return row.started_at;
  const delta = server - client; // 서버가 받은 때 − 기기가 누른 때(보통 0 이상)
  return delta <= 72 * 3600_000 && delta >= -5 * 60_000 ? new Date(client).toISOString() : row.started_at;
}

export function toSession(row: FocusRow): FocusSession {
  const surface = FOCUS_SURFACES.find((s) => s === row.surface) ?? "manual";
  return {
    id: row.id,
    startedAt: effectiveStartedAt(row),
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

