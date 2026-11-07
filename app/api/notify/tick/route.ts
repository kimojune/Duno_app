import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { getPushServerConfig, getTickConfig } from "../../../../lib/push/config";
import { NOTIFY_WINDOW_MINUTES_DEFAULT } from "../../../../lib/push/due";
import { sendPushSignal } from "../../../../lib/push/send";
import { runNotifyTick } from "../../../../lib/push/tick";

/**
 * 알림 예약 실행 주소(PRD 7-8, ⑦). 앱 밖의 예약 도구(Vercel Cron·Supabase 예약 작업 등)가 정한 간격(기본 15분)으로 부른다.
 * 호출한 쪽이 `Authorization: Bearer <CRON_SECRET>`를 보내야 한다. 비밀을 먼저 확인한다: 서버 설정에 예약 비밀이 없거나 보낸 값이 틀리면 모두 401(일정한 시간으로 비교한다).
 * 비밀이 맞은 뒤 서버 키·푸시 서명 키 가운데 하나라도 설정에 없으면 아무것도 하지 않고 503 not_configured를 돌려준다(앱은 그대로 돈다).
 * 응답에는 개수만 싣는다. 실제 설정(키 값·예약)은 PM이 서버 설정에 두는 일이라 이번 틀에서는 자리만 있다.
 */
export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: Request): Promise<Response> {
  try {
    // 비밀 확인이 먼저다(A9): 예약 비밀이 설정에 없거나 호출한 쪽이 맞게 보내지 않으면, 다른 설정이 있는지 없는지도 알리지 않고 401
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (!cronSecret || !authorized(request, cronSecret)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    const tick = getTickConfig();
    const push = getPushServerConfig();
    if (!tick || !push) return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
    const admin = createClient(tick.supabaseUrl, tick.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const minutes = Number(process.env.NOTIFY_TICK_MINUTES);
    const result = await runNotifyTick({
      admin,
      now: new Date(),
      send: (endpoint) => sendPushSignal({ endpoint, config: push }),
      windowMinutes: Number.isInteger(minutes) && minutes >= 1 && minutes <= 120 ? minutes : NOTIFY_WINDOW_MINUTES_DEFAULT,
    });
    return result.ok
      ? Response.json({ ok: true, data: result.data }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  } catch {
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}

export const GET = handle;
export const POST = handle;
