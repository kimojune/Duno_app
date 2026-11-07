import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { getTodoKeyFromEnv, type TodoKey } from "./todos/crypto";

/**
 * DAL이 core 함수에 넘길 재료(요청마다 새 서버 클라이언트 + 서버 환경 변수의 암호화 키).
 * Supabase 주소·키가 없으면 null(호출자가 config 오류로 바꾼다).
 */
export async function getDeps(): Promise<{ supabase: SupabaseClient; key: TodoKey | null } | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  return { supabase, key: getTodoKeyFromEnv() };
}
