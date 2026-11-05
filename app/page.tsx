import { LoginButton, LoginLayout } from "../components/login-button";
import { TodoScreen } from "../components/todo-screen";
import { getPublicEnv } from "../lib/env";
import { noticeFromErrorParam } from "../lib/login-text";
import { createClient } from "../lib/supabase/server";

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
      return <TodoScreen />;
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
