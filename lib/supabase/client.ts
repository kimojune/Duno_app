import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "../env";

/** 브라우저용. 설정 값이 없으면 null. */
export function createClient() {
  const env = getPublicEnv();
  if (!env) return null;
  return createBrowserClient(env.url, env.key);
}
