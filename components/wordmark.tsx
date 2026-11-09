/**
 * 워드마크(명세 ② 브랜드 모양 L1 「한 조각이 나온 고리」, 원샷 v2 고침9 — Figma 50:139·60:2 「워드마크 고리(조각 빠짐)」·「워드마크 조각(2px 바깥 · 빛 없음)」).
 * 작은 먹남색 고리(18px, 두께 = 지름의 약 20%) + 「duno」(16 Bold, --color-text). 고리에서 조각 하나가 먹남색 그대로 2px 바깥(오른쪽 위 45°)으로 나온다.
 * 화면 머리에는 살구·빛 번짐을 쓰지 않는다. 그림 경로는 Figma가 내보낸 SVG 경로 그대로다(색만 currentColor = 놓인 자리의 글자색 --color-text).
 *
 * 놓인 자리와 접근성(제목과 겹치지 않게):
 * - 로그인 화면(components/login-button.tsx LoginLayout): 그 화면의 유일한 제목 h1 안. 큰 L1(지름 120·살구 조각)은 다음 판이라, 그 자리에서는
 *   작은 고리를 숨기고 글자 「duno」만 h1 글꼴로 보인다(globals.css .login-name). 제목 이름은 「두노」다.
 * - 할 일 탭 머리(components/todo-view.tsx), 상태보기 맨 위(components/growth-screen.tsx), 내 정보 맨 위: 제목이 아닌 글. 탭마다 제목(h1)이 따로 있다.
 * 화면 읽기 이름은 「두노」 하나(role="img"). 그림과 보이는 글 「duno」는 숨겨 「duno」를 영어 글자로 읽지 않게 한다. 글은 React 텍스트로만 그린다.
 */
export const WORDMARK_TEXT = "duno";
/** 화면 읽기 이름(명세 ② 「두노」) */
export const WORDMARK_LABEL = "두노";

/** 고리(조각이 빠진 자리 포함) — Figma 37e64.svg 경로, 18×18 */
const RING_PATH =
  "M17.6933 6.67063C18.2061 8.58433 18.0731 10.6138 17.3149 12.4442C16.5568 14.2746 15.2158 15.8036 13.5 16.7942C11.7842 17.7848 9.78954 18.1816 7.82528 17.923C5.86102 17.6644 4.03698 16.7649 2.63605 15.364C1.23513 13.963 0.335609 12.139 0.077009 10.1747C-0.181591 8.21048 0.21518 6.21578 1.20578 4.5C2.19639 2.78423 3.72546 1.44326 5.55586 0.685088C7.38626 -0.073088 9.41568 -0.206104 11.3294 0.306671L10.2941 4.17037C9.23094 3.8855 8.10348 3.9594 7.0866 4.38061C6.06971 4.80181 5.22022 5.54679 4.66989 6.5C4.11955 7.45321 3.89912 8.56138 4.04279 9.65263C4.18646 10.7439 4.68619 11.7572 5.46448 12.5355C6.24277 13.3138 7.25613 13.8136 8.34738 13.9572C9.43864 14.1009 10.5468 13.8805 11.5 13.3301C12.4532 12.7798 13.1982 11.9303 13.6194 10.9134C14.0406 9.89653 14.1145 8.76907 13.8296 7.70591L17.6933 6.67063Z";
/** 나온 조각 — Figma 9ae67.svg 경로(7.4×7.4) */
const PIECE_PATH = "M1.03528 0C2.56128 0.40889 3.95276 1.21226 5.06987 2.32937C6.18697 3.44648 6.99035 4.83796 7.39924 6.36396L3.53553 7.39924C3.30837 6.55146 2.86205 5.77841 2.24144 5.1578C1.62082 4.53718 0.847777 4.09086 0 3.8637L1.03528 0Z";
/**
 * 조각 자리: 고리 안 빠진 자리(Figma 조각 틀 inset 57.19%·1.7% → x 10.294, y 0.306)에서 2px를 오른쪽 위 45°로(x +1.414, y −1.414).
 * Figma 60:2 틀이 고리보다 (+1.41, −1.41) 옮겨져 있다
 */
export const WORDMARK_PIECE_OFFSET = 2;
const PIECE_SHIFT = WORDMARK_PIECE_OFFSET / Math.SQRT2;
const PIECE_X = 10.294 + PIECE_SHIFT;
const PIECE_Y = 0.306 - PIECE_SHIFT;

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : "wordmark"} role="img" aria-label={WORDMARK_LABEL}>
      <svg className="wordmark-ring" width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true" focusable="false" overflow="visible">
        <path d={RING_PATH} />
        <path className="wordmark-piece" d={PIECE_PATH} transform={`translate(${PIECE_X.toFixed(3)} ${PIECE_Y.toFixed(3)})`} />
      </svg>
      <span className="wordmark-text" aria-hidden="true">
        {WORDMARK_TEXT}
      </span>
    </span>
  );
}
