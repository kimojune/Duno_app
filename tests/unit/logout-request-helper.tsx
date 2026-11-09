import { useState, type ComponentProps } from "react";
import { TodoScreen } from "../../components/todo-screen";

/**
 * 고침10 E: 할 일 머리의 「로그아웃」 글 단추는 없어졌다(로그아웃은 내 정보 한 곳). 내 정보의 로그아웃 단추는 할 일 화면의
 * logoutRequest를 1 올려 같은 로그아웃 흐름(확인 창 · 막힘)을 시작한다. 이 도우미는 그 길을 흉내 낸다:
 * 시험용 단추 「로그아웃 요청」을 누르면 logoutRequest가 1 오른다. 화면(TodoScreen)은 진짜 그대로다.
 */
export const LOGOUT_REQUEST_NAME = "로그아웃 요청";

export function TodoScreenWithLogout(props: ComponentProps<typeof TodoScreen>) {
  const [request, setRequest] = useState(props.logoutRequest ?? 0);
  return (
    <>
      <TodoScreen {...props} logoutRequest={request} />
      <button type="button" id="test-logout-request" onClick={() => setRequest((n) => n + 1)}>
        {LOGOUT_REQUEST_NAME}
      </button>
    </>
  );
}
