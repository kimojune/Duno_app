import { LoginButton, LoginLayout } from "../components/login-button";
import { AppShell } from "../components/app-shell";
import { getPublicEnv } from "../lib/env";
import { noticeFromErrorParam } from "../lib/login-text";
import { createClient } from "../lib/supabase/server";
import { readHome } from "../lib/home-dal";
import type { HomeRead } from "../lib/home-types";

// 로그인 상태를 보여 주므로 정적 캐시하지 않고 요청 때마다 그린다.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;

  // 사용자 판단은 getClaims()로만 한다. 이메일은 화면에 내지 않는다(명세 2-0).
  const supabase = await createClient();
  if (supabase) {
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      // 처음 화면(할 일 + 분야 + 설정)은 여기서 DAL로 바로 읽어 넘긴다(Server Action·자기 Route Handler를 거치지 않는다. MO-17).
      // 세션 확인은 core 함수들이 다시 한다. 결과는 짧은 코드만 담긴 평범한 객체다.
      let home: HomeRead;
      try {
        home = await readHome();
      } catch {
        const unavailable = { ok: false, error: "unavailable" } as const;
        home = { today: { todos: unavailable, categories: unavailable }, settings: unavailable };
      }
      return <AppShell home={home} />;
    }
  }

  const fromUrl = noticeFromErrorParam(error);
  const initialNotice = fromUrl ?? (getPublicEnv() === null ? "config" : null);
  return (
    <LoginLayout>
      <LoginButton initialNotice={initialNotice} />
    </LoginLayout>
  );
}
