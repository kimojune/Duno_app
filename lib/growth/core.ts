import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCategoriesForUser } from "../categories/core";
import { listEveningLogs } from "../evening/core";
import { readWeeklyGoalItems } from "../goals/core";
import { recordFail, type RecordResult } from "../records/common";
import { requireUserId } from "../session";
import { readSettingsForUser } from "../settings/core";
import type { TodoKey } from "../todos/crypto";
import { todoDayFor } from "../todos/day";
import { weekStartFor } from "../week";
import { computeGrowth } from "./compute";
import type { GrowthData } from "./types";

/**
 * 상태보기 읽기(PRD 7-4). 서버 전용. 저녁 기록(날마다 가장 늦은 것)을 이번 주·지난주·지난달·누적으로 모아 준다.
 * 세션 확인은 각 core 함수가 자기 안에서 한다. 예외는 던지지 않고 짧은 코드로 돌려준다.
 */
export type GrowthDeps = { supabase: SupabaseClient; key: TodoKey | null; now?: () => Date };

const serverNow = () => new Date();

export async function readGrowthForUser(deps: GrowthDeps): Promise<RecordResult<GrowthData>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (!deps.key) return recordFail("config");
    const today = todoDayFor((deps.now ?? serverNow)());
    const weekStart = weekStartFor(today);

    const [logs, settings, categories, goal] = await Promise.all([
      listEveningLogs({ supabase: deps.supabase }),
      readSettingsForUser({ supabase: deps.supabase, key: deps.key }),
      listCategoriesForUser({ supabase: deps.supabase, key: deps.key }),
      readWeeklyGoalItems({ supabase: deps.supabase, weekStart }),
    ]);
    if (!logs.ok) return logs;
    if (!goal.ok) return goal;
    if (!settings.ok) return settings;
    if (!categories.ok) return recordFail(categories.error === "unauthenticated" ? "unauthenticated" : categories.error === "config" ? "config" : "unavailable");

    return {
      ok: true,
      data: computeGrowth({
        today,
        logs: logs.data,
        categories: categories.data.categories.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name }] : [])),
        ratios: settings.data.ratios,
        goalItems: goal.data,
        // 목표 한 문장: 위에서 읽은 설정(지금 세션 사용자, readSettingsForUser가 복호화)을 그대로 쓴다. 새 읽기 길을 만들지 않는다
        goalText: settings.data.goal,
      }),
    };
  } catch {
    return recordFail("unavailable");
  }
}
