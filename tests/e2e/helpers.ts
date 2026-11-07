import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Browser, BrowserContext, Cookie } from "@playwright/test";
import type { IntegrationEnv } from "../integration/load-env";

/**
 * 새 e2e 시험들이 같이 쓰는 도구(todo-flow.spec.ts의 같은 이름 함수들과 같은 방법. 그 파일은 건드리지 않았다).
 * 로그인은 화면(OAuth)이 아니라 Node에서 @supabase/ssr 서버 클라이언트로 signInWithPassword를 하고,
 * 그때 쓰려던 쿠키를 받아 브라우저 컨텍스트에 넣는다. 비밀번호·토큰을 브라우저에 넘기지 않는다.
 */

export type Account = { label: "A" | "B"; email: string; password: string };

export function accountA(env: IntegrationEnv): Account {
  return { label: "A", email: env.DUNO_TEST_A_EMAIL, password: env.DUNO_TEST_A_PASSWORD };
}

export async function sessionCookies(env: IntegrationEnv, account: Account): Promise<Cookie[]> {
  const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, c]) => ({ name, value: c.value })),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) jar.set(name, { value, options: options ?? {} });
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error(`${account.label} 로그인 실패 (status=${error.status ?? "?"}, code=${error.code ?? "?"})`);
  return [...jar.entries()]
    .filter(([, c]) => c.value !== "")
    .map(([name, c]) => {
      const maxAge = typeof c.options.maxAge === "number" ? c.options.maxAge : undefined;
      return {
        name,
        value: c.value,
        domain: "localhost",
        path: "/",
        expires: maxAge ? Math.floor(Date.now() / 1000) + maxAge : -1,
        httpOnly: Boolean(c.options.httpOnly),
        secure: false,
        sameSite: "Lax",
      } satisfies Cookie;
    });
}

export async function contextFor(
  browser: Browser,
  cookies: Cookie[],
  options: { serviceWorkers?: "allow" | "block" } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, ...options });
  await context.addCookies(cookies);
  return context;
}

export async function nodeClient(env: IntegrationEnv, account: Account): Promise<SupabaseClient> {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error(`${account.label} 시험용 로그인 실패 (code=${error.code ?? "?"})`);
  return client;
}

/** 시험 계정의 처음 설정을 마친 것으로 만든다(todo-flow.spec.ts의 markOnboardingDone과 같다) */
export async function markOnboardingDone(client: SupabaseClient, label: string): Promise<string> {
  const { data } = await client.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error(`${label} 사용자 번호를 읽지 못했다`);
  const { error } = await client
    .from("user_settings")
    .upsert({ user_id: userId, onboarding_done_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`${label} 처음 설정 마침 표시 실패 (code=${error.code ?? "?"})`);
  return userId;
}

/** 조건이 참이 될 때까지 intervalMs마다 본다. 걸린 시간(ms)을 돌려주고, 시간이 지나면 -1 */
export async function pollUntil(check: () => Promise<boolean>, timeoutMs = 20_000, intervalMs = 60): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await check()) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return -1;
}
