import type { TodayRead } from "./today-types";

/**
 * 화면이 오늘 목록(할 일 + 분야)을 다시 읽는 길(브라우저 쪽). Server Action이 아니라 같은 출처 GET이라,
 * 적기·체크 Action이 끝나지 않아도 그 뒤에 줄 서지 않고 나란히 돈다(MO-17).
 * 서버 전용 모듈·비밀은 가져오지 않는다. user_id·날짜를 보내지 않는다(서버가 세션·시계로 정한다).
 * 네트워크 실패·이상한 응답은 그 칸을 unavailable로 바꾼다(던지지 않는다).
 */

export const TODAY_PATH = "/todos/today";

const UNAVAILABLE = { ok: false, error: "unavailable" } as const;

/** 한 칸이 { ok: true, data } 또는 { ok: false, error: 문자열 } 꼴인지만 본다(같은 출처 서버가 만든 값) */
function part<T>(value: unknown): T {
  if (value !== null && typeof value === "object") {
    const v = value as { ok?: unknown; data?: unknown; error?: unknown };
    if (v.ok === true && v.data !== null && typeof v.data === "object") return { ok: true, data: v.data } as T;
    if (v.ok === false && typeof v.error === "string") return { ok: false, error: v.error } as T;
  }
  return UNAVAILABLE as T;
}

/** 오늘 내 할 일 목록과 분야 목록 다시 읽기(GET /todos/today) */
export async function fetchToday(): Promise<TodayRead> {
  try {
    const res = await fetch(TODAY_PATH, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body: unknown = await res.json();
    const b = (body !== null && typeof body === "object" ? body : {}) as { todos?: unknown; categories?: unknown };
    return { todos: part<TodayRead["todos"]>(b.todos), categories: part<TodayRead["categories"]>(b.categories) };
  } catch {
    return { todos: UNAVAILABLE, categories: UNAVAILABLE };
  }
}
