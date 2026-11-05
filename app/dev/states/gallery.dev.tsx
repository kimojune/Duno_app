"use client";

import { LoginActionsView, LoginLayout } from "../../../components/login-button";
import { TodoView, type RowView, type TodoViewProps } from "../../../components/todo-view";
import { LOGIN_TEXT } from "../../../lib/login-text";
import { describeTodoDay } from "../../../lib/todos/day";

/**
 * 상태 모음(개발용). 서버 Action·DB·네트워크를 부르지 않는다. 진짜 화면과 같은 View 컴포넌트에 가짜 데이터만 넣는다.
 * 들어 있는 글은 모두 지어낸 예시다(이메일·실제 기록 없음).
 */

const noop = () => {};
const DAY = describeTodoDay("2026-11-05"); // 수요일
const NEXT_DAY = describeTodoDay("2026-11-06");

function row(id: string, text: string | null, extra: Partial<RowView> = {}): RowView {
  return { id, text, done: false, saving: false, failed: false, checkFailed: false, ...extra };
}

const BASIC: RowView[] = [
  row("r1", "이력서 파일 이름 바꾸기"),
  row("r2", "자기소개서 첫 문단 쓰기", { done: true }),
  row("r3", "면접 질문 다섯 개 뽑아 보기"),
];

const LONG_TEXT = "가".repeat(100) + "나".repeat(100); // 200자
const LONG_URL = "https://example.com/" + "a-very-long-path-without-spaces/".repeat(6) + "end";
const OVER_DRAFT = "다".repeat(230);

function many(): RowView[] {
  const list: RowView[] = [];
  for (let i = 1; i <= 11; i += 1) list.push(row(`m${i}`, `할 일 ${i}번`, { done: i % 4 === 0 }));
  list.push(row("m12", "방금 적은 열두 번째 할 일", { saving: true, savingSlow: true })); // 느린 망: 1초 뒤
  return list;
}

type Partial2 = Partial<TodoViewProps>;

const TODO_STATES: Record<string, Partial2> = {
  T1: { list: "loading", rows: [] },
  T2: { list: "ready", rows: [] },
  T3: { list: "ready", rows: BASIC },
  T4: {
    list: "ready",
    rows: [row("l1", LONG_TEXT), row("l2", LONG_URL), row("l3", "짧은 할 일")],
  },
  T5: { list: "ready", rows: BASIC, draft: "포트폴리오 링크 정리하기" },
  T6: { list: "ready", rows: many(), draft: "" },
  T7: { list: "ready", rows: [...BASIC, row("f1", "저장하지 못한 할 일", { failed: true })] },
  T8: { list: "ready", rows: [row("c1", "이력서 파일 이름 바꾸기", { checkFailed: true }), ...BASIC.slice(1)] },
  T9: { list: "error", rows: [] },
  T10: { list: "ready", rows: BASIC, online: false, offlineHelp: true, draft: "지하철에서 적은 글" },
  T11: { list: "ready", rows: BASIC, draft: OVER_DRAFT },
  T13: {
    list: "ready",
    rows: [...BASIC, row("f2", "저장하지 못한 할 일", { failed: true })],
    sessionLost: true,
    hasUnsaved: true,
    draft: "적던 글",
  },
  // R1: 로그인이 풀려도 이미 보이던 줄과 개수는 그대로, 안내만 더해진다
  "T13b-keep-rows": { list: "ready", rows: BASIC, sessionLost: true },
  // R1: 처음 불러오기부터 풀림 — 목록·빈 문구·개수 없이 안내만
  "T13c-first-load": { list: "locked", rows: [], sessionLost: true },
  T15: { list: "ready", day: NEXT_DAY, rows: [row("n1", "새 하루의 첫 할 일")] },
  T16: { list: "ready", rows: BASIC, draft: "적던 글", logoutConfirm: true },
  // P2: 확인이 떠 있을 때 「빼기」로 실패 줄을 치운 다음 장면(확인이 닫혔다. 포커스는 시험이 위 줄 체크 칸에 준다)
  "T16b-after-remove": { list: "ready", rows: BASIC },
  // R3: 저장 못 한 줄이 있으면 입력 칸이 비어 있어도 로그아웃 확인
  T16b: {
    list: "ready",
    rows: [...BASIC, row("f3", "저장하지 못한 할 일", { failed: true })],
    logoutConfirm: true,
  },
};

const LOGIN_STATES: Record<string, { notice: Parameters<typeof LoginActionsView>[0]["notice"]; busy: boolean }> = {
  L1: { notice: null, busy: false },
  L2: { notice: null, busy: true },
  L3: { notice: "failed", busy: false },
  L4: { notice: "cancelled", busy: false },
  L5: { notice: "offline", busy: false },
};

const STATE_IDS: string[] = [...Object.keys(LOGIN_STATES), ...Object.keys(TODO_STATES)];

export function StateGallery({ id, direction }: { id: string; direction: "A" | "B" }) {
  if (!STATE_IDS.includes(id)) {
    return (
      <main style={{ padding: 16 }}>
        <h1>상태 모음 (개발용)</h1>
        <ul>
          {STATE_IDS.map((sid) => (
            <li key={sid}>
              <a href={`/dev/states?s=${sid}`}>{sid}</a> · <a href={`/dev/states?s=${sid}&d=B`}>{sid} (B)</a>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  const login = LOGIN_STATES[id];
  if (login) {
    return (
      <LoginLayout direction={direction}>
        <LoginActionsView notice={login.notice} busy={login.busy} live={login.busy ? LOGIN_TEXT.busy : ""} onClick={noop} />
      </LoginLayout>
    );
  }
  const state = TODO_STATES[id];
  const props: TodoViewProps = {
    direction,
    day: DAY,
    list: "ready",
    rows: [],
    draft: "",
    online: true,
    offlineHelp: false,
    sessionLost: false,
    hasUnsaved: false,
    logoutConfirm: false,
    live: "",
    onDraftChange: noop,
    onSubmit: noop,
    onToggle: noop,
    onRetry: noop,
    onRemove: noop,
    onReload: noop,
    onLogout: noop,
    onLogoutConfirm: noop,
    onLogoutCancel: noop,
    onCopy: noop,
    onRelogin: noop,
    ...state,
  };
  return <TodoView {...props} />;
}
