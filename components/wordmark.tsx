/**
 * 워드마크 「DUNO」 글자 자리표시(고침 4바퀴 G). 로고 그림이 확정되기 전의 자리다: 글자 모양·색·크기는 지금 토큰 그대로이고
 * (글자 모양은 놓인 자리의 글꼴을 이어받는다), 디자인이 로고를 정하면 이 부품 안만 바꾼다(놓인 자리는 그대로).
 * 아이콘 실물(public/icon-*.png)은 이 부품이 다루지 않는다.
 *
 * 놓인 자리와 접근성(제목과 겹치지 않게):
 * - 로그인 화면(components/login-button.tsx LoginLayout): 그 화면의 유일한 제목 h1 안. 제목 이름이 「DUNO」다.
 * - 할 일 탭 머리(components/todo-view.tsx): h1 「오늘」 위의 제목이 아닌 글. 탭마다 h1(오늘·상태보기 등)이 이미 있어
 *   둘째 제목을 만들지 않는다. 다른 탭 머리에는 두지 않는다(한 화면에 한 번만 보이게).
 * 글은 React 텍스트로만 그린다.
 */
export const WORDMARK_TEXT = "DUNO";

export function Wordmark({ className }: { className?: string }) {
  return <span className={className ? `wordmark ${className}` : "wordmark"}>{WORDMARK_TEXT}</span>;
}
