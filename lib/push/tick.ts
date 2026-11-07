import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDue, NOTIFY_WINDOW_MINUTES_DEFAULT, seoulMinuteOfDay } from "./due";
import type { PushSendResult } from "./send";

/**
 * 예약 실행 한 번(PRD 7-8, ⑦): 지금 보낼 때가 된 저녁·아침 알림을 찾아 그 사용자의 구독으로 푸시 신호를 보낸다. 서버 전용.
 * 모든 사용자의 설정·구독을 읽어야 해서 RLS를 우회하는 서버 키(admin)로 부른다. 그래서 이 함수는 예약 주소(app/api/notify/tick)에서만,
 * 예약 비밀을 확인한 뒤 부른다. 결과에는 사용자 번호·주소를 싣지 않고 개수만 돌려준다.
 * 사라진 구독(gone)은 지운다. 푸시를 보내는 함수(send)는 밖에서 받는다(시험에서 가짜로 바꾼다).
 */
export type TickSummary = { dueUsers: number; sent: number; gone: number; failed: number };

type SettingsRow = {
  user_id: string;
  notify_evening_enabled: boolean;
  notify_evening_minute: number;
  notify_morning_enabled: boolean;
  notify_morning_minute: number;
};

export async function runNotifyTick(args: {
  admin: SupabaseClient;
  now: Date;
  send: (endpoint: string) => Promise<PushSendResult>;
  windowMinutes?: number;
}): Promise<{ ok: true; data: TickSummary } | { ok: false; error: "unavailable" }> {
  try {
    const window = args.windowMinutes ?? NOTIFY_WINDOW_MINUTES_DEFAULT;
    const nowMinute = seoulMinuteOfDay(args.now);
    const settings = await args.admin
      .from("user_settings")
      .select("user_id, notify_evening_enabled, notify_evening_minute, notify_morning_enabled, notify_morning_minute");
    if (settings.error) return { ok: false, error: "unavailable" };

    // 저녁과 아침 가운데 지금 창에 든 알림이 하나라도 있는 사용자(한 사용자가 둘 다 들면 한 번만 보낸다)
    const due = new Set<string>();
    for (const row of (settings.data ?? []) as SettingsRow[]) {
      const evening = row.notify_evening_enabled && isDue(row.notify_evening_minute, nowMinute, window);
      const morning = row.notify_morning_enabled && isDue(row.notify_morning_minute, nowMinute, window);
      if (evening || morning) due.add(row.user_id);
    }
    const summary: TickSummary = { dueUsers: due.size, sent: 0, gone: 0, failed: 0 };
    if (due.size === 0) return { ok: true, data: summary };

    const subs = await args.admin.from("push_subscriptions").select("id, user_id, endpoint").in("user_id", [...due]);
    if (subs.error) return { ok: false, error: "unavailable" };
    for (const sub of (subs.data ?? []) as { id: string; user_id: string; endpoint: string }[]) {
      const result = await args.send(sub.endpoint);
      if (result.ok) summary.sent += 1;
      else if (result.error === "gone") {
        summary.gone += 1;
        await args.admin.from("push_subscriptions").delete().eq("id", sub.id);
      } else summary.failed += 1;
    }
    return { ok: true, data: summary };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
