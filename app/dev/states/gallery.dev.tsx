"use client";

import { EveningEntry } from "../../../components/evening-record";
import { LoginActionsView, LoginLayout } from "../../../components/login-button";
import { OfferCard } from "../../../components/offer-card";
import {
  categoryAddedText,
  categoryDuplicateText,
  TODO_TEXT,
  TodoView,
  type ChipView,
  type RowView,
  type TodoViewProps,
} from "../../../components/todo-view";
import { DEMO_TEXT, LOGIN_TEXT } from "../../../lib/login-text";
import { describeTodoDay } from "../../../lib/todos/day";

/**
 * 상태 모음(개발용, 디자인 명세 12-6 C1~C26). 서버 Action·DB·네트워크를 부르지 않는다.
 * 진짜 화면과 같은 View 컴포넌트(TodoView)에 가짜 데이터만 넣는다.
 * 들어 있는 글·분야 이름은 모두 지어낸 예시다(이메일·실제 기록 없음). 시안의 「학교 과제」는 쓰지 않는다(D-132).
 * 쓰는 법: /dev/states?s=C5  ·  창 열림/닫힘을 바꿔 보려면 &sheet=open 또는 &sheet=closed
 */

const noop = () => {};
const DAY = describeTodoDay("2026-11-05"); // 목요일
const NEXT_DAY = describeTodoDay("2026-11-06");

function row(id: string, text: string | null, extra: Partial<RowView> = {}): RowView {
  return { id, text, done: false, saving: false, failed: false, checkFailed: false, category: null, ...extra };
}

const CHIPS: ChipView[] = [
  { id: "c1", name: "취업 준비" },
  { id: "c2", name: "운동" },
  { id: "c3", name: "영어" },
];

const BASIC: RowView[] = [
  row("r1", "이력서 파일 이름 바꾸기", { category: "취업 준비" }),
  row("r2", "자기소개서 첫 문단 쓰기", { done: true, category: "취업 준비" }),
  row("r3", "면접 질문 다섯 개 뽑아 보기"),
];

const LONG_TEXT = "가".repeat(100) + "나".repeat(100); // 200자
const LONG_URL = "https://example.com/" + "a-very-long-path-without-spaces/".repeat(6) + "end";
const NAME_20 = "토익스피킹레벨칠목표반복연습하기매일아침"; // 한글 20자 이름(C23)
const OVER_DRAFT = "다".repeat(230);
const OVER_CATEGORY = "가나다라마바사아자차카타파하거너더러머버서"; // 23자(C16)
const COUNT_CATEGORY = "가나다라마바사아자차카타파하거"; // 15자(C16 셈)

/** 할 일 12개(C1 끝까지 내림·C7·C-D11) */
function twelve(extra?: (i: number) => Partial<RowView>): RowView[] {
  const list: RowView[] = [];
  for (let i = 1; i <= 12; i += 1) {
    list.push(row(`m${i}`, `할 일 ${i}번`, { done: i % 4 === 0, category: i % 3 === 0 ? "운동" : null, ...extra?.(i) }));
  }
  return list;
}

function manyChips(n: number): ChipView[] {
  const names = ["취업 준비", "운동", "영어", "독서", "자격증", "건강", "집안일", "돈 관리", "친구", "취미", "글쓰기", "산책"];
  return Array.from({ length: n }, (_, i) => ({ id: `k${i}`, name: names[i % names.length] + (i >= names.length ? ` ${i}` : "") }));
}

type Partial2 = Partial<TodoViewProps> & { sheetOpen?: boolean };

/** C30·C31: 먼저 할 일 카드 하나만(C31은 먼저 할 일 글이 200자). C30은 응답 전 자리(.slot-card)만 */
const LONG_OFFER_TEXT = "긴 할 일 글 ".repeat(40).slice(0, 200);
function OfferOnly({ text }: { text: string | null }) {
  return (
    <OfferCard
      offer={{ id: "o2", surface: "card", day: "2026-11-05", categoryId: null, categoryName: "영어", todoId: text ? "t-long" : null, todoText: text, state: "new" }}
      busy={false}
      error={null}
      onStart={noop}
      onDismiss={noop}
    />
  );
}

/** C29: 목록 위에 얹히는 것(진짜 화면은 app-shell.tsx topSlot). 가짜 데이터만 쓴다 */
function TopCards() {
  return (
    <>
      <button type="button" className="goal-line">
        이번 주 목표 15시간 중 9시간
      </button>
      <OfferCard
        offer={{ id: "o1", surface: "card", day: "2026-11-05", categoryId: null, categoryName: "영어", todoId: null, todoText: null, state: "new" }}
        busy={false}
        error={null}
        onStart={noop}
        onDismiss={noop}
      />
      <EveningEntry evening={false} onOpen={noop} />
    </>
  );
}

/** 상태마다 원래 창 모습(sheetOpen)을 둔다. 사진 시험은 &sheet=로 닫힘·열림을 둘 다 찍는 상태도 있다 */
const TODO_STATES: Record<string, Partial2> = {
  // 창 닫힘
  C1: { list: "ready", rows: BASIC, sheetOpen: false },
  // 고침9 PM 2-B: 작업 기록이 있는 줄(첫 줄 · 긴 글 둘째 줄)에 종이 아이콘
  "C1-notes": {
    list: "ready",
    rows: [
      row("r1", "토익 단어 50개", { category: "어학", hasNotes: true }),
      row("r2", "포트폴리오 2장 고치기 — 표지와 목차를 먼저 다시 그리고 사례 둘을 고르기", { category: "포트폴리오", hasNotes: true }),
      row("r3", "정보처리기사 기출 1회", { done: true, category: "자격증" }),
    ],
    sheetOpen: false,
  },
  "C1-12": { list: "ready", rows: twelve(), sheetOpen: false },
  C2: { list: "loading", rows: [], categories: "loading", sheetOpen: false },
  C3: { list: "ready", rows: [], sheetOpen: false },
  C4: { list: "error", rows: [], categories: "error", sheetOpen: false },
  C8: {
    list: "ready",
    rows: BASIC,
    sheetOpen: false,
    draft: "포트폴리오 링크 정리하기",
    resume: true,
    selectedCategoryId: "c1",
  },
  // 창 열림
  C5: { list: "ready", rows: BASIC, sheetOpen: true },
  C6: { list: "ready", rows: BASIC, sheetOpen: true, selectedCategoryId: "c2", draft: "저녁에 30분 걷기" },
  C7: {
    list: "ready",
    rows: [...twelve(), row("m13", "방금 적은 열세 번째 할 일", { category: "영어" })],
    sheetOpen: true,
    live: TODO_TEXT.liveSaved,
  },
  C9: { list: "ready", rows: BASIC, sheetOpen: true, categories: "loading" },
  C10: { list: "ready", rows: BASIC, sheetOpen: true, categories: "error" },
  "C10-offline": { list: "ready", rows: BASIC, sheetOpen: true, categories: "error", online: false },
  C11: { list: "ready", rows: BASIC, sheetOpen: true, chips: [] },
  C12: { list: "ready", rows: BASIC, sheetOpen: true, newCategoryOpen: true, newCategoryDraft: "자격증", draft: "정보처리기사 원서" },
  C13: {
    list: "ready",
    rows: BASIC,
    sheetOpen: true,
    newCategoryOpen: true,
    newCategoryDraft: "자격증",
    addingCategory: true,
    live: TODO_TEXT.liveCategoryAdding,
  },
  C14: {
    list: "ready",
    rows: BASIC,
    sheetOpen: true,
    chips: [...CHIPS, { id: "c4", name: "자격증" }],
    selectedCategoryId: "c4",
    live: categoryAddedText("자격증"),
  },
  C15: { list: "ready", rows: BASIC, sheetOpen: true, newCategoryOpen: true, newCategoryDraft: "" },
  C16: { list: "ready", rows: BASIC, sheetOpen: true, newCategoryOpen: true, newCategoryDraft: OVER_CATEGORY },
  "C16-count": { list: "ready", rows: BASIC, sheetOpen: true, newCategoryOpen: true, newCategoryDraft: COUNT_CATEGORY },
  C17: { list: "ready", rows: BASIC, sheetOpen: true, selectedCategoryId: "c2", categoryNotice: categoryDuplicateText("운동") },
  C18: { list: "ready", rows: BASIC, sheetOpen: true, categoryNotice: TODO_TEXT.categoryReserved },
  C19: { list: "ready", rows: BASIC, sheetOpen: true, newCategoryOpen: true, newCategoryDraft: "자격증", newCategoryHelp: "failed" },
  C19a: {
    list: "ready",
    rows: BASIC,
    sheetOpen: true,
    newCategoryOpen: true,
    newCategoryDraft: "자격증",
    draft: "정보처리기사 원서",
    sessionLost: true,
    hasUnsaved: true,
  },
  C20: { list: "ready", rows: BASIC, sheetOpen: true, categoryNotice: TODO_TEXT.categoryLimit },
  "C20-server": { list: "ready", rows: BASIC, sheetOpen: true, newCategoryOpen: true, newCategoryDraft: "취미", newCategoryHelp: "limit" },
  C21: { list: "ready", rows: BASIC, sheetOpen: true, online: false, offlineHelp: true, draft: "지하철에서 적은 글", selectedCategoryId: "c1" },
  "C21-category": {
    list: "ready",
    rows: BASIC,
    sheetOpen: true,
    online: false,
    newCategoryOpen: true,
    newCategoryDraft: "자격증",
    newCategoryHelp: "offline",
  },
  C22: {
    list: "ready",
    rows: [row("l1", LONG_TEXT, { category: "취업 준비" }), row("l2", LONG_URL, { category: "영어" }), row("l3", "짧은 할 일")],
    sheetOpen: false,
    draft: OVER_DRAFT.slice(0, 120),
  },
  C23: {
    list: "ready",
    rows: [row("t1", "말하기 연습 녹음 듣기", { category: NAME_20 }), ...BASIC],
    sheetOpen: true,
    chips: [{ id: "long", name: NAME_20 }, ...CHIPS],
    selectedCategoryId: "long",
  },
  C24: { list: "ready", rows: BASIC, sheetOpen: true, chips: manyChips(10), selectedCategoryId: "k1" },
  // 고침 4바퀴: 분야 칩 두 줄 감싸기. C27 = 분야 여섯 개(좁은 화면에서 두 줄), C28 = 분야 한도 50개(꺾쇠 든 이름·긴 이름 포함, 두 줄을 넘어 세로로 밀림)
  C27: { list: "ready", rows: BASIC, sheetOpen: true, chips: manyChips(6), selectedCategoryId: "k1" },
  C28: {
    list: "ready",
    rows: BASIC,
    sheetOpen: true,
    chips: [{ id: "angle", name: "<b>굵게</b> & \"따옴표\"" }, { id: "long", name: NAME_20 }, ...manyChips(48)],
    selectedCategoryId: "long",
  },
  // 고침 4바퀴: 목록 위 카드(이번 주 목표 줄·오늘 먼저 할 일·저녁 기록 입구)는 한 줄 줄
  C29: { list: "ready", rows: BASIC, sheetOpen: false, topSlot: <TopCards /> },
  // 고침 4바퀴 고침1: 카드가 오기 전 자리(.slot-card)와 카드의 높이를 같은 크기에서 재려고(C30 자리, C29 카드, C31 먼저 할 일 글 200자)
  C30: { list: "ready", rows: BASIC, sheetOpen: false, topSlot: <div className="slot-card" aria-hidden="true" /> },
  C31: { list: "ready", rows: BASIC, sheetOpen: false, topSlot: <OfferOnly text={LONG_OFFER_TEXT} /> },
  C25: { list: "ready", rows: BASIC, sheetOpen: true, selectedCategoryId: "c1" },
  C26: { list: "ready", rows: BASIC, sheetOpen: true, newCategoryOpen: true, newCategoryDraft: "자격증", draft: "정보처리기사 원서" },
  // C-D11 포커스 사진: 할 일 12개(창 닫힘·열림)
  CD11: { list: "ready", rows: twelve(), sheetOpen: false },

  // 5절 T 상태 가운데 C에서 그대로 쓰는 것(「입력 줄」을 「적는 창」으로 읽음, 12-6 머리말)
  T5: { list: "ready", rows: BASIC, sheetOpen: true, draft: "포트폴리오 링크 정리하기" },
  T6: {
    list: "ready",
    rows: twelve((i) => (i === 12 ? { text: "방금 적은 열두 번째 할 일", saving: true, savingSlow: true, category: "영어" } : {})),
    sheetOpen: true,
  },
  T7: { list: "ready", rows: [...BASIC, row("f1", "저장하지 못한 할 일", { failed: true, category: "운동" })], sheetOpen: false },
  // 고침9: 저장 대기 줄(16px 도는 원)과 저장 못 한 줄(글 그대로)을 한 화면에
  "T-pending": {
    list: "ready",
    rows: [
      row("r1", "토익 단어 50개", { category: "어학" }),
      row("q1", "포트폴리오 2장 고치기", { queued: true, category: "포트폴리오" }),
      row("f1", "저장하지 못한 할 일", { failed: true, category: "운동" }),
    ],
    sheetOpen: false,
    online: false,
  },
  T8: { list: "ready", rows: [row("c1", "이력서 파일 이름 바꾸기", { checkFailed: true }), ...BASIC.slice(1)], sheetOpen: false },
  T11: { list: "ready", rows: BASIC, sheetOpen: true, draft: OVER_DRAFT },
  T13: {
    list: "ready",
    rows: [...BASIC, row("f2", "저장하지 못한 할 일", { failed: true })],
    sessionLost: true,
    hasUnsaved: true,
    sheetOpen: true,
    draft: "적던 글",
  },
  "T13b-keep-rows": { list: "ready", rows: BASIC, sessionLost: true, sheetOpen: false },
  "T13c-first-load": { list: "locked", rows: [], sessionLost: true, categories: "error", sheetOpen: false },
  T15: { list: "ready", day: NEXT_DAY, rows: [row("n1", "새 하루의 첫 할 일")], sheetOpen: true, selectedCategoryId: "c1" },
  T16: { list: "ready", rows: BASIC, draft: "적던 글", resume: true, logoutConfirm: true, sheetOpen: false },
  T16b: { list: "ready", rows: [...BASIC, row("f3", "저장하지 못한 할 일", { failed: true })], logoutConfirm: true, sheetOpen: false },
  "T16b-after-remove": { list: "ready", rows: BASIC, sheetOpen: false },
};

const LOGIN_STATES: Record<string, { notice: Parameters<typeof LoginActionsView>[0]["notice"]; busy: boolean }> = {
  L1: { notice: null, busy: false },
  L2: { notice: null, busy: true },
  L3: { notice: "failed", busy: false },
  L4: { notice: "cancelled", busy: false },
  L5: { notice: "offline", busy: false },
};

/** 체험 코드 칸(23 S0): D1 기본(49:169) · D2 틀린 코드(141:13) · D3 시작 중(141:31) */
const DEMO_STATES: Record<string, { value: string; notice: "wrong_code" | null; busy: boolean }> = {
  D1: { value: "", notice: null, busy: false },
  D2: { value: "DUNO-2025", notice: "wrong_code", busy: false },
  D3: { value: "DUNO-2026", notice: null, busy: true },
};

export const STATE_IDS: string[] = [...Object.keys(LOGIN_STATES), ...Object.keys(DEMO_STATES), ...Object.keys(TODO_STATES)];

export function StateGallery({ id, sheet }: { id: string; sheet: "open" | "closed" | null }) {
  if (!STATE_IDS.includes(id)) {
    return (
      <main style={{ padding: 16 }}>
        <h1>상태 모음 (개발용)</h1>
        <ul>
          {STATE_IDS.map((sid) => (
            <li key={sid}>
              <a href={`/dev/states?s=${sid}`}>{sid}</a>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  const demo = DEMO_STATES[id];
  if (demo) {
    return (
      <LoginLayout>
        <LoginActionsView
          notice={null}
          busy={false}
          live={demo.busy ? DEMO_TEXT.busy : ""}
          onClick={noop}
          googleDisabled={demo.busy}
          demo={{ value: demo.value, notice: demo.notice, busy: demo.busy, onChange: noop, onSubmit: noop }}
        />
      </LoginLayout>
    );
  }
  const login = LOGIN_STATES[id];
  if (login) {
    return (
      <LoginLayout>
        <LoginActionsView notice={login.notice} busy={login.busy} live={login.busy ? LOGIN_TEXT.busy : ""} onClick={noop} />
      </LoginLayout>
    );
  }
  const state = TODO_STATES[id];
  const props: TodoViewProps = {
    day: DAY,
    list: "ready",
    rows: [],
    online: true,
    offlineHelp: false,
    sessionLost: false,
    hasUnsaved: false,
    logoutConfirm: false,
    live: "",
    sheetOpen: false,
    draft: "",
    resume: false,
    categories: "ready",
    chips: CHIPS,
    selectedCategoryId: null,
    categoryNotice: "",
    newCategoryOpen: false,
    newCategoryDraft: "",
    addingCategory: false,
    newCategoryHelp: null,
    onOpenSheet: noop,
    onCloseSheet: noop,
    onDraftChange: noop,
    onSubmit: noop,
    onToggleChip: noop,
    onOpenNewCategory: noop,
    onNewCategoryDraftChange: noop,
    onAddCategory: noop,
    onCancelNewCategory: noop,
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
  if (sheet) props.sheetOpen = sheet === "open";
  if (props.draft && !state.resume) props.resume = props.draft.trim().length > 0 || props.newCategoryDraft.trim().length > 0;
  return <TodoView {...props} />;
}
