import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCategoriesForUser } from "../categories/core";
import { listEveningLogs } from "../evening/core";
import { listFocusSessionsSince } from "../focus/core";
import { readWeeklyGoalItems } from "../goals/core";
import { MIRROR_TODO_DAYS, type MirrorSnapshot } from "../local/types";
import { recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";
import { readSettingsForUser } from "../settings/core";
import type { TodoKey } from "../todos/crypto";
import { todoDayFor } from "../todos/day";
import { listTodosWindow } from "../todos/core";
import { addDays, weekStartFor } from "../week";

/**
 * 기기 먼저 저장(고침 3바퀴)의 「서버 것 받기」: 기기 거울이 필요로 하는 내 자료를 한 번에 읽는다(서버 전용).
 * 칸마다 따로 읽어, 한 칸이 실패해도 나머지는 준다(실패한 칸은 null: 기기가 옛 값을 그대로 둔다). 로그인이 없으면 통째로 unauthenticated.
 * 세션 확인은 각 core 함수가 자기 안에서 한다(getClaims). 사용자 id·날짜를 받지 않는다(세션·서버 시계로 정한다).
 * 글(할 일·분야 이름·목표)은 서버가 풀어 평문으로 준다: 기기 보관은 평문(PM 확정, 혼자 쓰는 동안 허용). 응답은 사용자별이라 캐시하지 않는다.
 */
export type MirrorDeps = { supabase: SupabaseClient; key: TodoKey | null; now?: () => Date };

const serverNow = () => new Date();

export async function readMirrorForUser(deps: MirrorDeps): Promise<RecordResult<MirrorSnapshot>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (!deps.key) return recordFail("config");
    const key = deps.key;
    const now = (deps.now ?? serverNow)();
    const today = todoDayFor(now);
    const fromDay = addDays(today, -(MIRROR_TODO_DAYS - 1));
    const weekStart = weekStartFor(today);

    const [todos, categories, settings, logs, goal, sessions] = await Promise.all([
      listTodosWindow({ supabase: deps.supabase, key, now: () => now }, fromDay, today),
      listCategoriesForUser({ supabase: deps.supabase, key }),
      readSettingsForUser({ supabase: deps.supabase, key }),
      listEveningLogs({ supabase: deps.supabase }),
      readWeeklyGoalItems({ supabase: deps.supabase, weekStart }),
      listFocusSessionsSince({ supabase: deps.supabase, now: () => now }, fromDay),
    ]);
    const parts = [todos, categories, settings, logs, goal, sessions];
    // 세션이 도중에 풀렸으면 통째로 알린다(칸마다 같은 코드)
    if (parts.some((p) => !p.ok && p.error === "unauthenticated")) return recordFail("unauthenticated");
    return {
      ok: true,
      data: {
        serverNow: now.toISOString(),
        todos: todos.ok ? todos.data : null,
        categories: categories.ok ? categories.data.categories : null,
        settings: settings.ok ? settings.data : null,
        logs: logs.ok ? logs.data : null,
        goal: goal.ok ? { weekStart, items: goal.data } : null,
        sessions: sessions.ok ? sessions.data : null,
      },
    };
  } catch {
    return recordFail("unavailable");
  }
}
