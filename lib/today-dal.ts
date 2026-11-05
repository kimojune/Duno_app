import "server-only";
import { listCategoriesForUser } from "./categories/core";
import { createClient } from "./supabase/server";
import { listTodosForToday } from "./todos/core";
import { getTodoKeyFromEnv } from "./todos/crypto";
import type { TodayRead } from "./today-types";

/**
 * 오늘 화면 읽기(서버 전용 DAL): 할 일 목록과 분야 목록을 함께, 결과는 나눠서(C-D5).
 * 서버 컴포넌트(app/page.tsx)는 이것을 바로 부르고, 화면이 다시 읽을 때는 GET /todos/today가 이것을 부른다.
 * Server Action이 아니다(MO-17). 세션 확인은 두 core 함수가 각자 안에서 getClaims로 한다. use cache를 쓰지 않는다.
 */
export async function readToday(): Promise<TodayRead> {
  const supabase = await createClient();
  if (!supabase) return { todos: { ok: false, error: "config" }, categories: { ok: false, error: "config" } };
  const key = getTodoKeyFromEnv();
  const [todos, categories] = await Promise.all([
    listTodosForToday({ supabase, key }),
    listCategoriesForUser({ supabase, key }),
  ]);
  return { todos, categories };
}
