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

/** 한 번에 보내는 푸시 수 상한(A5). 구독이 많아도 푸시 서비스에 한꺼번에 몰리지 않게 */
export const PUSH_SEND_CONCURRENCY = 10;
/** 설정을 읽는 쪽 크기(A5). 표 전체를 한 번에 읽지 않는다 */
export const SETTINGS_PAGE_SIZE = 1000;
/** 구독을 읽을 때 in 목록에 넣는 사용자 수 상한 */
const SUBS_USER_CHUNK = 200;

/** items를 최대 limit개씩 동시에 처리한다. 끝나는 순서와 상관없이 모든 항목을 처리한다 */
async function forEachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(lanes);
}

export async function runNotifyTick(args: {
  admin: SupabaseClient;
  now: Date;
  send: (endpoint: string) => Promise<PushSendResult>;
  windowMinutes?: number;
}): Promise<{ ok: true; data: TickSummary } | { ok: false; error: "unavailable" }> {
  try {
    const window = args.windowMinutes ?? NOTIFY_WINDOW_MINUTES_DEFAULT;
    const nowMinute = seoulMinuteOfDay(args.now);

    // 저녁과 아침 가운데 지금 창에 든 알림이 하나라도 있는 사용자(한 사용자가 둘 다 들면 한 번만 보낸다). 설정은 쪽으로 읽는다
    const due = new Set<string>();
    for (let from = 0; ; from += SETTINGS_PAGE_SIZE) {
      const page = await args.admin
        .from("user_settings")
        .select("user_id, notify_evening_enabled, notify_evening_minute, notify_morning_enabled, notify_morning_minute")
        .order("user_id", { ascending: true })
        .range(from, from + SETTINGS_PAGE_SIZE - 1);
      if (page.error) return { ok: false, error: "unavailable" };
      const rows = (page.data ?? []) as SettingsRow[];
      for (const row of rows) {
        const evening = row.notify_evening_enabled && isDue(row.notify_evening_minute, nowMinute, window);
        const morning = row.notify_morning_enabled && isDue(row.notify_morning_minute, nowMinute, window);
        if (evening || morning) due.add(row.user_id);
      }
      if (rows.length < SETTINGS_PAGE_SIZE) break;
    }
    const summary: TickSummary = { dueUsers: due.size, sent: 0, gone: 0, failed: 0 };
    if (due.size === 0) return { ok: true, data: summary };

    const targets: { id: string; user_id: string; endpoint: string }[] = [];
    const dueList = [...due];
    for (let i = 0; i < dueList.length; i += SUBS_USER_CHUNK) {
      const subs = await args.admin.from("push_subscriptions").select("id, user_id, endpoint").in("user_id", dueList.slice(i, i + SUBS_USER_CHUNK));
      if (subs.error) return { ok: false, error: "unavailable" };
      targets.push(...((subs.data ?? []) as { id: string; user_id: string; endpoint: string }[]));
    }
    await forEachLimited(targets, PUSH_SEND_CONCURRENCY, async (sub) => {
      let result: PushSendResult;
      try {
        result = await args.send(sub.endpoint);
      } catch {
        result = { ok: false, error: "network" };
      }
      if (result.ok) summary.sent += 1;
      else if (result.error === "gone") {
        summary.gone += 1;
        await args.admin.from("push_subscriptions").delete().eq("id", sub.id);
      } else summary.failed += 1;
    });
    return { ok: true, data: summary };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
