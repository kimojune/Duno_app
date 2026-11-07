import { getDeps } from "../../../../lib/deps";
import { JSON_UNAVAILABLE, jsonResult } from "../../../../lib/json-response";
import { parseWindowMinutes, seoulMinuteOfDay } from "../../../../lib/push/due";
import { pickNotifications } from "../../../../lib/push/next";
import { readSettingsForUser } from "../../../../lib/settings/core";

/**
 * GET /api/notify/next — 푸시 신호를 받은 서비스 워커가 「지금 보낼 알림이 무엇인가」를 묻는 길(PRD 7-8, 고침 3바퀴).
 * 로그인 쿠키로 자기 설정만 읽는다(받는 인자 없음, 세션은 core 안에서 getClaims로 확인). 예약 비밀·서버 키는 쓰지 않는다.
 * 응답: { ok: true, data: { items: [{ kind, title, body, tag, url }] } }. 켜 둔 알림이 없으면 items가 빈 목록이다.
 * 사용자별 데이터라 Cache-Control: private, no-store(jsonResult가 단다).
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const deps = await getDeps();
    if (!deps) return jsonResult({ ok: false, error: "config" });
    const settings = await readSettingsForUser(deps);
    if (!settings.ok) return jsonResult(settings);
    const items = pickNotifications({
      notify: settings.data.notify,
      nowMinute: seoulMinuteOfDay(new Date()),
      windowMinutes: parseWindowMinutes(process.env.NOTIFY_TICK_MINUTES),
    });
    return jsonResult({ ok: true, data: { items } });
  } catch {
    return JSON_UNAVAILABLE();
  }
}
