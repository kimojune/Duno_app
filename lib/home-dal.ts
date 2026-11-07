import "server-only";
import { getDeps } from "./deps";
import type { HomeRead } from "./home-types";
import { readSettingsForUser } from "./settings/core";
import { readToday } from "./today-dal";

/**
 * 앱 첫 화면에 필요한 읽기를 한 번에 한다(서버 전용). 세션 확인은 각 core 함수가 자기 안에서 한다. use cache를 쓰지 않는다.
 * 각 칸은 예외를 던지지 않고 짧은 오류 코드로 돌려준다(원문 없음).
 */
export async function readHome(): Promise<HomeRead> {
  const [today, settings] = await Promise.all([
    readToday().catch(() => ({
      todos: { ok: false, error: "unavailable" } as const,
      categories: { ok: false, error: "unavailable" } as const,
    })),
    (async (): Promise<HomeRead["settings"]> => {
      try {
        const deps = await getDeps();
        if (!deps) return { ok: false, error: "config" };
        return await readSettingsForUser(deps);
      } catch {
        return { ok: false, error: "unavailable" };
      }
    })(),
  ]);
  return { today, settings };
}
