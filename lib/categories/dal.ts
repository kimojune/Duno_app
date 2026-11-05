import "server-only";
import { createClient } from "../supabase/server";
import { getTodoKeyFromEnv } from "../todos/crypto";
import { createCategoryForUser } from "./core";
import type { AddCategoryResult } from "./types";

/**
 * 분야 데이터 접근 계층(서버 전용). 요청마다 서버 클라이언트를 새로 만들고, 키는 서버 환경 변수에서 읽는다.
 * 인증·인가는 core 함수 안에서 한다(getClaims). 사용자 데이터라 use cache를 쓰지 않는다.
 * 읽기: 할 일 목록과 함께 lib/today-dal.ts의 readToday가 읽는다(서버 컴포넌트·GET /todos/today).
 * 쓰기: app/todos/actions.ts의 addCategory(Server Action).
 */

export async function createMyCategory(id: unknown, name: unknown): Promise<AddCategoryResult> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "config" };
  return createCategoryForUser({ supabase, key: getTodoKeyFromEnv() }, id, name);
}
