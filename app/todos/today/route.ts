import { readTodayResponse, TODAY_UNAVAILABLE } from "../../../lib/read-response";
import { readToday } from "../../../lib/today-dal";

/**
 * GET /todos/today — 오늘 내 할 일 목록과 보관 안 한 내 분야 목록을 함께(결과는 나눠서, C-D5).
 * 화면이 다시 보일 때·연결이 돌아올 때·새벽 4시에 다시 읽는 길이다.
 * Server Action이 아니라서 적기·체크·분야 더하기(Action)가 걸려 있어도 그 뒤에 줄 서지 않고 나란히 돈다(MO-17).
 * 공개 HTTP 엔드포인트다: 세션 확인은 core 함수 안에서 getClaims로 한다. 받는 인자는 없다.
 * 응답은 Cache-Control: private, no-store, 오류는 짧은 코드만.
 * 처음 목록은 app/page.tsx가 DAL(readToday)에서 바로 읽는다(서버 컴포넌트는 이 주소를 fetch하지 않는다).
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return readTodayResponse(await readToday());
  } catch {
    return readTodayResponse(TODAY_UNAVAILABLE);
  }
}
