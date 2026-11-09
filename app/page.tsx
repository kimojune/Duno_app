import { cookies } from "next/headers";
import { LoginButton, LoginLayout } from "../components/login-button";
import { AppShell } from "../components/app-shell";
import { LocalAppShell } from "../components/local-app-shell";
import { getPublicEnv } from "../lib/env";
import { isDemoEnabled } from "../lib/server-config";
import { startDemo } from "./demo/actions";
import { noticeFromErrorParam } from "../lib/login-text";
import { createClient } from "../lib/supabase/server";
import { getDeps } from "../lib/deps";
import { readHome } from "../lib/home-dal";
import { DEVICE_HINT_COOKIE } from "../lib/local/device-hint";
import { readMirrorForUser } from "../lib/mirror/core";
import type { HomeRead } from "../lib/home-types";

// 로그인 상태를 보여 주므로 정적 캐시하지 않고 요청 때마다 그린다.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; open?: string | string[] }>;
}) {
  const { error, open } = await searchParams;
  // 알림을 눌러 들어온 길(예: /?open=evening): 저녁 알림은 저녁 기록을 연다(PRD 7-3·7-8, AI 판단·PM 확인 전)
  const initialOpen = open === "evening" ? "evening" : null;

  // 사용자 판단은 getClaims()로만 한다. 이메일은 화면에 내지 않는다(명세 2-0).
  const supabase = await createClient();
  if (supabase) {
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      // 기기 먼저 저장(고침 3바퀴, 기본): 서버는 사용자 번호만 넘기고 개인 데이터는 HTML에 싣지 않는다. 화면이 기기 저장소에서 바로 그리고,
      // 서버 것은 브라우저가 GET /mirror로 뒤에서 받아 맞춘다(예전에는 여기서 DB를 읽어 첫 화면이 그만큼 늦었다).
      // 끄는 법: 서버 설정에 DUNO_LOCAL_FIRST=off를 두면 예전 방식(서버가 읽어 넘기고 서버에 직접 쓴다)으로 돈다. 문제가 생겼을 때의 안전 장치이고,
      // 고치기 전·후 반응 속도를 같은 빌드에서 견주는 데도 쓴다.
      if (process.env.DUNO_LOCAL_FIRST?.trim().toLowerCase() === "off") {
        // 처음 화면(할 일 + 분야 + 설정)은 여기서 DAL로 바로 읽어 넘긴다(Server Action·자기 Route Handler를 거치지 않는다. MO-17).
        let home: HomeRead;
        try {
          home = await readHome();
        } catch {
          const unavailable = { ok: false, error: "unavailable" } as const;
          home = { today: { todos: unavailable, categories: unavailable }, settings: unavailable };
        }
        return <AppShell home={home} initialOpen={initialOpen} userKey={data.claims.sub} />;
      }
      // 단, 이 기기에서 처음 여는 사용자(로그인 직후 포함: 기기 표시 쿠키가 없다)에게는 서버 사본을 첫 화면과 함께 실어 보낸다. 그래야
      // JS를 받은 뒤 서버에 사본을 다시 받으러 가는 왕복 없이 목록이 보인다. 다시 여는 기기에는 싣지 않는다(기기 저장소에서 바로 그린다).
      const sub = data.claims.sub;
      const knownDevice = (await cookies()).get(DEVICE_HINT_COOKIE)?.value === sub;
      let initialSnapshot = null;
      if (!knownDevice) {
        try {
          const deps = await getDeps();
          const mirror = deps ? await readMirrorForUser(deps) : null;
          if (mirror?.ok) initialSnapshot = mirror.data;
        } catch {
          // 사본을 못 읽어도 화면이 GET /mirror로 받는다
        }
      }
      return <LocalAppShell userKey={sub} initialOpen={initialOpen} initialSnapshot={initialSnapshot} />;
    }
  }

  const fromUrl = noticeFromErrorParam(error);
  const initialNotice = fromUrl ?? (getPublicEnv() === null ? "config" : null);
  return (
    <LoginLayout>
      {/* 체험 코드(시연): DEMO_ACCESS_CODE가 있을 때만 칸을 그린다. 화면에는 「켜짐 여부」만 가고 코드 값은 가지 않는다 */}
      <LoginButton initialNotice={initialNotice} startDemo={isDemoEnabled() ? startDemo : null} />
    </LoginLayout>
  );
}
