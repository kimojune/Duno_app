"use client";

import {
  useLayoutEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CATEGORY_LIMIT, CATEGORY_NAME_MAX_LENGTH, countCategoryChars } from "../lib/categories/validation";
import { categoryColorValue } from "../lib/category-color";
import type { TodoDay } from "../lib/todos/types";
import { addDays } from "../lib/week";
import { countTodoChars, TODO_TEXT_MAX_LENGTH } from "../lib/todos/validation";
import { BackHeader } from "./back-header";
import { ChipScroller } from "./chip-scroller";
import { CONFIRM_TEXT, ConfirmDialog } from "./close-confirm";
import { LiveRegion, Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";
import { Wordmark } from "./wordmark";

/**
 * 할 일 화면의 그리는 쪽(디자인 명세 12절 방향 C). 상태를 받아 그리기만 한다.
 * 진짜 화면(todo-screen.tsx)과 개발용 상태 모음 화면이 같은 컴포넌트를 쓴다. 서버 전용 모듈은 가져오지 않는다.
 * 할 일 글·분야 이름은 항상 React 텍스트로만 넣는다(innerHTML 없음). 속성(aria-label 등)도 React 속성으로만.
 *
 * 화면 구조(DOM 순서 = 포커스 순서, 12-2): 머리 → 머리 아래 Notice들 → 목록 → 「할 일 적기」 단추 또는 적는 창(둘 중 하나).
 * 적는 창은 모달이 아니다: 포커스를 가두지 않고, 연 채로 목록을 스크롤·체크할 수 있다.
 */

export const TODO_TEXT = {
  title: "오늘",
  /** 고침10 E(50:52, d-173): 날짜 줄 오른쪽 원 단추 「‹」의 화면 읽기 이름(아이콘만 보인다). 「›」 하루 뒤는 없다 */
  pastDays: "지난 날 보기",
  label: "할 일 적기",
  add: "적기",
  unreadable: "읽을 수 없는 할 일", // (임시)
  empty1: "오늘 적은 할 일이 없어요.", // 고침9: 화면 읽기용으로만(보이는 빈 목록은 아래 예시 — 명세 ⑬ 9, Figma 50:28)
  // 고침9 ⑬ 9: 빈 목록 = 이름표 「예시」 + 흐린 예시 할 일 줄 둘(옛 「아래 단추를 눌러 적어 보세요.」 대신). 누를 수 없고 목록·개수에 안 섞인다
  exampleLabel: "예시",
  examples: [
    // colorOrder: 분야 색 순서(0부터) — Figma 50:28의 점 색(어학 = 분야 색 2, 글쓰기 = 분야 색 1)
    { text: "토익 단어 50개", category: "어학", colorOrder: 1 },
    { text: "글 한 편 초고 쓰기", category: "글쓰기", colorOrder: 0 },
  ],
  /** 고침9 PM 2-B: 할 일 글 바로 뒤 종이 아이콘의 화면 읽기 이름(옛 글 「기록 있음」) */
  hasNotes: "작업 기록 있음",
  saving: "저장하는 중",
  saveFailed: "저장하지 못했어요.",
  queued: "연결되면 저장해요", // 오프라인으로 적어 기기에 둔 줄(PRD 10절). 고침9: 줄에는 보이지 않고 16px 도는 원(SavePending) + 숨은 글 「저장 대기」
  /** 고침9(PM 16:2x, 23 Figma 128:87): 저장 대기 원의 화면 읽기 글 */
  pending: "저장 대기",
  liveQueued: "저장 대기", // 고침9 O-8: 줄의 도는 원과 같은 말(polite 한 곳)
  retry: "다시",
  remove: "빼기",
  checkFailed: "끝냄 표시를 바꾸지 못했어요. 다시 눌러 주세요.",
  loadFailed: "할 일을 불러오지 못했어요.",
  reload: "다시 불러오기",
  offline: "인터넷 연결이 끊겼어요. 연결되면 적고 끝냄 표시를 할 수 있어요.",
  offlineHelp: "인터넷에 연결되면 적을 수 있어요. 적은 글은 그대로 있어요.",
  sessionUnsaved:
    "로그인이 풀렸어요. 다시 로그인하면 이 화면을 떠나서, 아직 저장되지 않은 글은 사라져요. 필요하면 먼저 복사해 두세요.",
  sessionPlain: "로그인이 풀렸어요. 다시 로그인해 주세요.",
  copy: "저장 안 된 글 복사",
  relogin: "다시 로그인",
  // ---- 기기 먼저 저장(고침 3바퀴) ----
  offlineLocal: "인터넷 연결이 끊겼어요. 적고 끝낸 것은 이 기기에 두었다가 연결되면 보내요.",
  signingOut: "기록을 서버에 보내는 중이에요",
  logoutFailed: "로그아웃하지 못했어요. 다시 눌러 주세요.", // 고침10: 확인 창 안 실패 안내(앱 공통 실패 글 꼴)
  rejected: (n: number) => `서버가 받지 않은 기록 ${n}개를 되돌렸어요`,
  cancel: "취소",
  liveLoading: "할 일을 불러오는 중",
  liveSaving: "할 일을 저장하는 중",
  liveSaved: "할 일을 저장했어요",
  liveCopied: "복사했어요",
  liveCopyFailed: "복사하지 못했어요", // (임시)
  // ---- 방향 C (12절) ----
  addButton: "할 일 적기", // AddTodoButton 기본
  addButtonResume: "적던 글 이어 적기", // 남은 글이 있을 때(12-5)
  // 고침9 ⑬ 12(PM 7): 이름표만 「분야」. 「고르지 않으면 기타」는 글 대신 맨 앞 「기타」 칩이 골라진 모양으로(④-2)
  categoryLabel: "분야",
  other: "기타",
  addCategoryChip: "+ 분야",
  newCategoryLabel: "새 분야 이름",
  addCategory: "더하기",
  addingCategory: "더하는 중",
  categoriesLoading: "분야를 불러오는 중", // C9
  categoriesFailed: "분야를 불러오지 못했어요. 지금 적으면 기타로 들어가요.", // C10
  categoriesOffline: "인터넷에 연결되면 분야를 불러올게요.", // C10 오프라인
  categoryReserved: "기타는 더하지 않아도 돼요. 분야를 고르지 않으면 기타로 들어가요.", // C18
  categoryLimit: `분야는 ${CATEGORY_LIMIT}개까지 둘 수 있어요.`, // C20
  categoryAddFailed: "분야를 더하지 못했어요. 다시 눌러 주세요.", // C19
  categoryAddOffline: "인터넷에 연결되면 분야를 더할 수 있어요. 적은 이름은 그대로 있어요.", // C21
  liveCategoryAdding: "분야를 더하는 중", // C13
  categoryPrefix: "분야 ", // CategoryTag 화면 읽기용 앞말
  unreadableCategory: "읽을 수 없는 분야", // (임시) 12-7
} as const;

/** C17 「이미 있는 분야라서 골랐어요: ○○」 */
export function categoryDuplicateText(name: string): string {
  return `이미 있는 분야라서 골랐어요: ${name}`;
}

/** C14 LiveRegion 「분야를 더하고 골랐어요: ○○」 */
export function categoryAddedText(name: string): string {
  return `분야를 더하고 골랐어요: ${name}`;
}

/**
 * 창 높이가 보이는 화면의 이 비율을 넘으면 디자인 검토에서 다시 본다(C26).
 * 임시, 결정 필요: 3분의 2. 넘는다고 막지 않는다(창 안이 스크롤된다). screens 시험이 재어 기록한다.
 */
export const SHEET_REVIEW_MAX_RATIO = 2 / 3;

/** 창이 닫혔을 때 목록 끝·scroll-padding-bottom 값(12-2, C-D11): 단추 56 + 위아래 16씩 + 아래 탭 줄 높이(탭 줄이 없으면 안전 영역만, B8) */
const CLOSED_CLEARANCE = "calc(88px + var(--tabbar-h, env(safe-area-inset-bottom)))";
/** 창이 열렸을 때: 창의 실제 높이 + 16px + 안전 영역 */
const openClearance = (sheetHeight: number) => `calc(${Math.ceil(sheetHeight) + 16}px + env(safe-area-inset-bottom))`;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function dayText(day: TodoDay): string {
  return `${day.month}월 ${day.dayOfMonth}일 ${WEEKDAYS[day.weekday]}요일`;
}

/** 오프라인으로 적어 두었다가 새벽 4시 뒤에 올라가 서버가 다른 날짜로 넣었을 때(A4). 어제면 「어제 날짜」, 더 전이면 날짜를 말한다 */
export function savedOtherDayText(saved: TodoDay, today: TodoDay): string {
  const yesterday = addDays(today.date, -1);
  return saved.date === yesterday ? "어제 날짜로 저장했어요" : `${saved.month}월 ${saved.dayOfMonth}일 날짜로 저장했어요`;
}

export function loadedText(count: number): string {
  return `할 일 ${count}개를 불러왔어요`;
}

export function overLimitText(count: number): string {
  return `${TODO_TEXT_MAX_LENGTH}자까지 적을 수 있어요. 지금 ${count}자예요.`;
}

/** C16 넘음 문구: 「20자까지 적을 수 있어요. 지금 23자예요.」 */
export function categoryOverLimitText(count: number): string {
  return `${CATEGORY_NAME_MAX_LENGTH}자까지 적을 수 있어요. 지금 ${count}자예요.`;
}

/** 할 일 칸 아래 도움말: 넘음 > 오프라인 > 180자부터 셈 */
export function helpText(draft: string, offlineHelp: boolean): string {
  const count = countTodoChars(draft);
  if (count > TODO_TEXT_MAX_LENGTH) return overLimitText(count);
  if (offlineHelp) return TODO_TEXT.offlineHelp;
  if (count >= 180) return `${count}/${TODO_TEXT_MAX_LENGTH}`;
  return "";
}

/** 새 분야 칸 아래 셈(C16): 15자부터 「15/20」, 넘으면 넘음 문구. 셈은 정규화한 이름(12-7) */
export const CATEGORY_COUNT_FROM = 15;
export function categoryCountText(draft: string): string {
  const count = countCategoryChars(draft);
  if (count > CATEGORY_NAME_MAX_LENGTH) return categoryOverLimitText(count);
  if (count >= CATEGORY_COUNT_FROM) return `${count}/${CATEGORY_NAME_MAX_LENGTH}`;
  return "";
}

export type RowView = {
  id: string;
  text: string | null; // null은 풀 수 없는 행
  done: boolean;
  saving: boolean;
  /** 저장이 SAVING_HINT_DELAY_MS를 넘겨 걸리는 중: 이때부터 「저장하는 중」 글을 눈에 보이게 한다 */
  savingSlow?: boolean;
  failed: boolean;
  /** 오프라인으로 적어 기기에 둔 줄: 연결되면 저장한다(PRD 10절) */
  queued?: boolean;
  /** 기기 먼저 저장: 서버가 아직 받지 않은 줄(끊긴 동안). 줄 오른쪽에 「저장 대기」 원만 그린다 — 「빼기」 단추는 없다(기기 보낼 줄은 빼지 않는다) */
  pending?: boolean;
  checkFailed: boolean;
  /** 분야 표시 글(CategoryTag). null이면 기타라 붙이지 않는다. 풀 수 없는 분야는 TODO_TEXT.unreadableCategory */
  category?: string | null;
  /** 작업 기록이 하나라도 있으면 true: 할 일 글 바로 뒤에 종이 아이콘(고침9 PM 2-B) */
  hasNotes?: boolean;
  /** 분야 색(분야 점, Figma 50:52). 없으면 점 없이 이름만 */
  categoryColor?: string;
};

/** 칩 하나(풀 수 있는 이름만. 풀 수 없는 분야는 칩에 보이지 않는다, 12-7) */
export type ChipView = { id: string; name: string };

/** 새 분야 칸 아래 자리에 띄우는 안내 */
export type NewCategoryHelp = "failed" | "offline" | "limit" | null;

export type TodoViewProps = {
  day: TodoDay | null;
  /** locked: 첫 불러오기부터 로그인이 풀려, 목록·빈 문구·개수를 그리지 않는다(T13c) */
  list: "loading" | "ready" | "error" | "locked";
  rows: RowView[]; // 적은 순서(오래된 것이 위). 체크해도 자리를 옮기지 않는다
  online: boolean;
  offlineHelp: boolean;
  sessionLost: boolean;
  /** 로그인 풀림 안내에서 「저장 안 된 글 복사」를 보일지(복사할 글이 있는가, 12-5) */
  hasUnsaved: boolean;
  /** 날짜 줄 오른쪽 원 단추 「‹」(지난 날 보기, d-173). 없으면 단추를 그리지 않는다(지난 날을 읽을 길이 없을 때) */
  onOpenPast?: () => void;
  /** 로그아웃 확인 창(고침10 B)이 떠 있나 */
  logoutConfirm: boolean;
  /** 로그아웃을 걸었다(확인 창 「로그아웃 중」 막힘) */
  loggingOut?: boolean;
  /** 로그아웃 요청이 실패했다(확인 창 안 안내 한 줄) */
  logoutFailed?: boolean;
  /** 기기 먼저 저장(고침 3바퀴)이면 끊김 안내 글이 다르다. 없으면 기본 글 */
  offlineText?: string;
  live: string;

  // 적는 창
  sheetOpen: boolean;
  draft: string;
  /** 단추 글이 「적던 글 이어 적기」인가(할 일 칸 글이나 새 분야 칸 글이 있음, 12-5) */
  resume: boolean;
  categories: "loading" | "ready" | "error";
  chips: ChipView[];
  selectedCategoryId: string | null;
  /** 칩 줄 아래 한 줄 안내(C17·C18·C20). 빈 글이면 없음 */
  categoryNotice: string;
  newCategoryOpen: boolean;
  newCategoryDraft: string;
  addingCategory: boolean;
  newCategoryHelp: NewCategoryHelp;

  inputRef?: RefObject<HTMLInputElement | null>;
  newCategoryInputRef?: RefObject<HTMLInputElement | null>;

  onOpenSheet: () => void;
  onCloseSheet: (via: "button" | "esc") => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onToggleChip: (id: string) => void;
  onOpenNewCategory: () => void;
  onNewCategoryDraftChange: (value: string) => void;
  onAddCategory: () => void;
  onCancelNewCategory: () => void;
  onToggle: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onReload: () => void;
  /** 확인 창 「로그아웃」. Promise면 끝날 때까지 확인 창이 막힌다 */
  onLogoutConfirm: () => void | Promise<unknown>;
  onLogoutCancel: () => void;
  onCopy: () => void;
  onRelogin: () => void;

  // ---- 원샷 v2: 선택 입력. 없으면 아무것도 더 그리지 않는다(기존 화면 그대로) ----
  /** 줄마다 「자세히」 단추를 둔다(고치기·지우기·순서·작업 기록, PRD 0번) */
  onOpenDetail?: (id: string) => void;
  /** 목록 위에 얹는 것(어제 것 가져오기·먼저 할 일 카드·이번 주 목표 줄·저녁 기록 입구) */
  topSlot?: ReactNode;
  /** 화면을 덮는 자세히 창 */
  overlay?: ReactNode;
};

/** 한글 조합 중의 엔터는 「적기」·「더하기」로 치지 않는다(12-6). 안드로이드 크롬은 조합 중 keyCode 229를 보낸다 */
function composing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

const SKELETON_WIDTHS = ["60%", "80%", "45%"] as const;

function Skeleton() {
  return (
    <ul className="todo-skeleton" aria-hidden="true">
      {SKELETON_WIDTHS.map((w) => (
        <li key={w} className="todo-row skeleton-row">
          <span className="skeleton-box" />
          <span className="skeleton-bar" style={{ width: w }} />
        </li>
      ))}
    </ul>
  );
}

function PlusIcon({ className, size }: { className: string; size: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="chip-check" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/**
 * 고침9 PM 2-B: 작업 기록이 있는 할 일의 종이 아이콘(16, 먹남색 1.5px 선 — Figma 76:430 그대로). 할 일 글 바로 뒤 6px(CSS .todo-note-icon).
 * 그림만이라 화면 읽기 이름을 단다(1.1.1). 체크 칸의 이름(할 일 글)에는 섞지 않고 설명(aria-describedby)으로 잇는다.
 */
export function NoteIcon({ id }: { id: string }) {
  return (
    <svg id={id} className="todo-note-icon" width={16} height={16} viewBox="0 0 16 16" role="img" aria-label={TODO_TEXT.hasNotes} focusable="false">
      <path
        d="M13.25 5L9.75 1.5H2.75V14.5H13.25V5ZM9.75 1.5V5H13.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 고침9 ⑬ 9: 빈 목록의 예시(Figma 50:28 · 91:664). 이름표 「예시」 + 흐린 예시 할 일 줄 둘.
 * 흐림(40%)은 모양(체크 점선·분야 점·줄 바탕·구분선)에만, 글은 보조 글 색(d-125). 누를 것이 없고(체크 칸은 그림),
 * 화면 읽기에서는 「예시」 묶음으로 읽힌다. 실제 목록(.todo-list의 줄)·「n개 중 n개」 셈에 들어가지 않는다.
 */
export function TodoExamples() {
  return (
    <section className="todo-example" aria-labelledby="todo-example-label">
      <p id="todo-example-label" className="todo-example-label">
        {TODO_TEXT.exampleLabel}
      </p>
      <ul className="todo-example-list">
        {TODO_TEXT.examples.map((example) => (
          <li key={example.text} className="todo-example-row">
            <span className="todo-example-check" aria-hidden="true" />
            <div className="todo-body">
              <p className="todo-example-text">
                <span className="sr-only">{`${TODO_TEXT.exampleLabel}: `}</span>
                {example.text}
              </p>
              <div className="category-tag-line todo-example-tag">
                <span className="todo-example-dot" style={{ background: categoryColorValue(example.colorOrder) }} aria-hidden="true" />
                <span className="category-tag">
                  <span className="sr-only">{TODO_TEXT.categoryPrefix}</span>
                  {example.category}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 고침9 「저장 대기」 = 16px 도는 원(23 그림 Figma 50:52 · 128:87): 바탕 고리(--color-divider) 위 먹남색 호 1/4(끝 둥글게), 선 2px,
 * 1초 한 바퀴 linear, 동작 줄이기면 멈춤(CSS). 원은 화면 읽기에서 숨기고 같은 자리 숨은 글 「저장 대기」를 읽힌다(줄 설명으로 이어짐).
 * 올라가면(저장됨) 부르는 쪽이 그리지 않아 원과 숨은 글이 함께 사라진다. 저장 대기를 보이는 자리는 모두 이 부품 하나를 쓴다.
 */
export function SavePending({ id }: { id?: string }) {
  return (
    <span id={id} className="save-pending">
      <svg className="save-pending-ring" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle className="save-pending-track" cx="8" cy="8" r="7" fill="none" strokeWidth="2" />
        <path className="save-pending-arc" d="M8 1A7 7 0 0 1 15 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{TODO_TEXT.pending}</span>
    </span>
  );
}

/** 목록 줄의 분야 표시. 기타(분야 없음)는 붙이지 않는다. 화면 읽기용으로 앞에 「분야 」 */
export function CategoryTag({ id, name, color }: { id: string; name: string; color?: string }) {
  return (
    <div className="category-tag-line">
      {/* 고침9 Figma 50:52: 분야 점(10, 1px 윤곽) + 이름 12 보조. 색만으로 가르지 않는다(이름이 늘 함께) */}
      {color && <span className="category-tag-dot" style={{ background: color }} aria-hidden="true" />}
      <span id={id} className="category-tag">
        <span className="sr-only">{TODO_TEXT.categoryPrefix}</span>
        {name}
      </span>
    </div>
  );
}

function Row({
  row,
  onToggle,
  onRetry,
  onRemove,
  onOpenDetail,
}: { row: RowView } & Pick<TodoViewProps, "onToggle" | "onRetry" | "onRemove" | "onOpenDetail">) {
  const textId = `todo-text-${row.id}`;
  const statusId = `todo-status-${row.id}`;
  const tagId = `todo-tag-${row.id}`;
  const noteId = `todo-note-${row.id}`;
  // 저장 중·저장 못 한 줄은 서버에 아직 없다: 체크 칸은 보이되 눌러도 바뀌지 않고, 그 줄의 안내에 잇는다
  const notSaved = row.saving || row.failed || row.queued === true || row.pending === true;
  const describedBy = [row.category ? tagId : null, row.hasNotes ? noteId : null, notSaved ? statusId : null].filter(Boolean).join(" ");
  return (
    <li className="todo-row" id={`row-${row.id}`}>
      <label className="check-hit">
        <input
          type="checkbox"
          checked={row.done}
          onChange={() => onToggle(row.id)}
          aria-labelledby={textId}
          aria-disabled={notSaved ? "true" : undefined}
          aria-describedby={describedBy || undefined}
        />
        <span className="check-box" aria-hidden="true" />
      </label>
      <div className="todo-body">
        {/* 고침9 PM 2-B: 아이콘은 글과 같은 줄 흐름 안(글이 줄을 넘기면 마지막 줄 끝에 붙는다). 체크 칸 이름은 글 span만 */}
        <p className={row.done ? "todo-text is-done" : "todo-text"}>
          <span id={textId}>{row.text ?? TODO_TEXT.unreadable}</span>
          {row.hasNotes && <NoteIcon id={noteId} />}
        </p>
        {/* C-D6: 저장 중 줄에도 분야 표시를 바로 그린다 */}
        {row.category && <CategoryTag id={tagId} name={row.category} color={row.categoryColor} />}
        {/* 늘 그린다(체크 칸 aria-describedby가 가리킨다). 처음 SAVING_HINT_DELAY_MS 동안은 화면 읽기용으로만 있다 */}
        {row.saving && (
          <p id={statusId} className={row.savingSlow ? "todo-sub" : "todo-sub sr-only"}>
            {TODO_TEXT.saving}
          </p>
        )}
        {row.queued && (
          <>
            <div className="row-actions">
              <TextButton onClick={() => onRemove(row.id)}>{TODO_TEXT.remove}</TextButton>
            </div>
          </>
        )}
        {row.failed && (
          <>
            {/* 고침9 O-8: 저장 상태는 화면 한 곳(LiveRegion, polite)에서만 알린다 — 줄의 글은 보이는 글·체크 칸 설명이고 따로 낭독하지 않는다 */}
            <p id={statusId} className="todo-sub">
              {TODO_TEXT.saveFailed}
            </p>
            <div className="row-actions">
              <TextButton onClick={() => onRetry(row.id)}>{TODO_TEXT.retry}</TextButton>
              <TextButton onClick={() => onRemove(row.id)}>{TODO_TEXT.remove}</TextButton>
            </div>
          </>
        )}
        {row.checkFailed && (
          <p className="todo-sub">
            {TODO_TEXT.checkFailed}
          </p>
        )}
      </div>
      {/* 고침9: 저장 대기는 할 일 글 줄 세로 가운데, 줄 오른쪽에 16px 도는 원(글 「연결되면 저장해요」 대신) */}
      {(row.queued || row.pending) && <SavePending id={statusId} />}
      {/* 저장된 줄에만, 줄 오른쪽 「›」(고침9 Figma 50:52 — 할 일 페이지로). 누름 48. 그림 글자라 접근 이름은 「자세히 보기: 할 일 글」 */}
      {onOpenDetail && !notSaved && (
        <div className="row-actions row-detail">
          <TextButton className="row-detail-btn" aria-label={`자세히 보기: ${row.text ?? TODO_TEXT.unreadable}`} onClick={() => onOpenDetail(row.id)}>
            <span aria-hidden="true">›</span>
          </TextButton>
        </div>
      )}
    </li>
  );
}

/** 할 일 화면 오른쪽 아래 단추(창이 닫혀 있을 때만) */
export function AddTodoButton({ resume, onOpen }: { resume: boolean; onOpen: () => void }) {
  const label = resume ? TODO_TEXT.addButtonResume : TODO_TEXT.addButton;
  return (
    <PrimaryButton id="add-todo-button" className="add-todo-btn" onClick={onOpen}>
      <PlusIcon className="plus-icon" size={24} />
      <span>{label}</span>
    </PrimaryButton>
  );
}

/**
 * 칩 하나. 누름 영역 48×48 이상, 보이는 면은 높이 32. 고름은 면 색 + 체크 그림 둘로 가른다.
 * color(고침9, Figma 50:103 · 50:390 · ④-2 「이름 + 색 점」)를 주면 이름 앞에 분야 색 점(1px 윤곽). 색만으로 가르지 않는다(이름이 늘 함께)
 */
export function CategoryChip({ chip, pressed, onToggle, color }: { chip: ChipView; pressed: boolean; onToggle: (id: string) => void; color?: string }) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={pressed}
      onClick={() => onToggle(chip.id)}
      onFocus={(e) => e.currentTarget.scrollIntoView?.({ inline: "nearest", block: "nearest" })}
      data-chip-id={chip.id}
    >
      <span className="chip-face">
        {pressed && <CheckIcon />}
        {color && <span className="chip-dot" style={{ background: color }} aria-hidden="true" />}
        {/* 말줄임은 CSS로만. 접근 이름은 전체 이름이다(C23) */}
        <span className="chip-label">{chip.name}</span>
      </span>
    </button>
  );
}

/**
 * 고침9 ⑬ 12·13(④-2): 분야를 고르지 않아도 되는 칩 줄 맨 앞 「기타」. 아무것도 안 고르면 골라진 모양으로 시작한다.
 * 누르면 고른 분야가 풀려 기타(분야 없음 = 저장 값 null)로 돌아간다. 분야 행을 만들지 않는다(「+ 분야」와 다르다).
 */
export function OtherChip({ pressed, onSelect }: { pressed: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={pressed}
      onClick={onSelect}
      onFocus={(e) => e.currentTarget.scrollIntoView?.({ inline: "nearest", block: "nearest" })}
      data-chip-id="other"
    >
      <span className="chip-face">
        {pressed && <CheckIcon />}
        <span className="chip-dot" style={{ background: categoryColorValue(null) }} aria-hidden="true" />
        <span className="chip-label">{TODO_TEXT.other}</span>
      </span>
    </button>
  );
}

/** 칩 줄 맨 끝 「+ 분야」. 고르는 칩이 아니라 단추라 aria-pressed가 없다 */
export function AddCategoryChip({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      id="add-category-chip"
      className="chip chip-add"
      onClick={onOpen}
      onFocus={(e) => e.currentTarget.scrollIntoView?.({ inline: "nearest", block: "nearest" })}
    >
      <span className="chip-face">
        <span className="chip-label">{TODO_TEXT.addCategoryChip}</span>
      </span>
    </button>
  );
}

/** 칩 줄(②): 분야 불러오는 중(C9) · 못 불러옴(C10) · 분야 없음(C11, 「+ 분야」만) · 칩 있음 */
export function CategoryChipRow(
  props: Pick<
    TodoViewProps,
    "categories" | "chips" | "selectedCategoryId" | "online" | "onToggleChip" | "onOpenNewCategory" | "onReload"
  >,
) {
  if (props.categories === "loading") {
    // 목록을 모른 채 더하면 같은 이름이 생길 수 있어 「+ 분야」를 보이지 않는다
    return (
      <p className="sheet-line" role="status">
        {TODO_TEXT.categoriesLoading}
      </p>
    );
  }
  if (props.categories === "error") {
    return (
      <div className="sheet-line">
        <span role="status">{props.online ? TODO_TEXT.categoriesFailed : TODO_TEXT.categoriesOffline}</span>
        {props.online && <TextButton className="btn-flush-start" onClick={props.onReload}>{TODO_TEXT.reload}</TextButton>}
      </div>
    );
  }
  return (
    <ChipScroller aria-labelledby="category-label">
      {/* 「기타」를 누르면 고른 칩을 한 번 더 누른 것과 같다(고른 것이 풀려 기타). 이미 기타면 그대로 */}
      <OtherChip
        pressed={props.selectedCategoryId === null}
        onSelect={() => {
          if (props.selectedCategoryId !== null) props.onToggleChip(props.selectedCategoryId);
        }}
      />
      {props.chips.map((chip, index) => (
        <CategoryChip
          key={chip.id}
          chip={chip}
          color={categoryColorValue(index)}
          pressed={chip.id === props.selectedCategoryId}
          onToggle={props.onToggleChip}
        />
      ))}
      <AddCategoryChip onOpen={props.onOpenNewCategory} />
    </ChipScroller>
  );
}

/** 「+ 분야」를 누르면 칩 줄 자리에 오는 새 분야 줄 */
export function NewCategoryRow({
  newCategoryInputRef,
  ...props
}: Pick<
    TodoViewProps,
    | "newCategoryDraft"
    | "addingCategory"
    | "newCategoryHelp"
    | "newCategoryInputRef"
    | "onNewCategoryDraftChange"
    | "onAddCategory"
    | "onCancelNewCategory"
  >) {
  const over = countCategoryChars(props.newCategoryDraft) > CATEGORY_NAME_MAX_LENGTH;
  const message =
    props.newCategoryHelp === "failed"
      ? TODO_TEXT.categoryAddFailed
      : props.newCategoryHelp === "offline"
        ? TODO_TEXT.categoryAddOffline
        : props.newCategoryHelp === "limit"
          ? TODO_TEXT.categoryLimit
          : null;
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault(); // 엔터가 창의 「적기」(form 제출)로 가지 않게. 조합 중이어도 막고, 조합 중이 아니면 「더하기」
    if (!composing(event)) props.onAddCategory();
  }
  return (
    <div className="newcat">
      <label htmlFor="newcat-input" className="sheet-label input-label">
        {TODO_TEXT.newCategoryLabel}
      </label>
      <div className="newcat-row">
        <div className="newcat-field">
          {/* maxLength를 걸지 않는다: 몰래 자르지 않는다(C16) */}
          <input
            id="newcat-input"
            ref={newCategoryInputRef}
            className="input"
            type="text"
            value={props.newCategoryDraft}
            onChange={(e) => props.onNewCategoryDraftChange(e.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby="newcat-help"
            aria-invalid={over ? true : undefined}
            autoComplete="off"
            enterKeyHint="done"
          />
          <p id="newcat-help" className="input-help">
            {/* 셈(15/20·넘음)은 낭독 영역 밖에 두고, 실패·오프라인·한도 안내는 늘 그려 둔 role="status" 안의 글만 바꾼다(4.1.3) */}
            {message ? null : categoryCountText(props.newCategoryDraft)}
            <span role="status" className="newcat-status">
              {message ?? ""}
            </span>
          </p>
        </div>
        <div className="newcat-actions">
          <SecondaryButton busy={props.addingCategory} onClick={props.onAddCategory}>
            {props.addingCategory ? TODO_TEXT.addingCategory : TODO_TEXT.addCategory}
          </SecondaryButton>
          <TextButton onClick={props.onCancelNewCategory}>{TODO_TEXT.cancel}</TextButton>
        </div>
      </div>
    </div>
  );
}

/** 적는 창. 모달이 아니다(포커스를 가두지 않는다) */
export function TodoSheet({ sheetRef, inputRef, newCategoryInputRef, ...props }: TodoViewProps & { sheetRef: RefObject<HTMLFormElement | null> }) {
  const help = helpText(props.draft, props.offlineHelp);
  const over = countTodoChars(props.draft) > TODO_TEXT_MAX_LENGTH;
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    props.onSubmit();
  }
  function onSheetKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Escape" || composing(event)) return;
    event.preventDefault();
    // 새 분야 칸에서는 새 분야 줄만 닫는다(「취소」와 같음). 그 밖에서는 창을 닫는다(글은 남김)
    if ((event.target as HTMLElement).id === "newcat-input") props.onCancelNewCategory();
    else props.onCloseSheet("esc");
  }
  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault(); // 조합 중 엔터로 form이 제출되지 않게 늘 막고, 조합 중이 아닐 때만 「적기」
    if (!composing(event)) props.onSubmit();
  }
  return (
    <form
      ref={sheetRef}
      className="todo-sheet"
      aria-label={TODO_TEXT.label}
      onSubmit={onSubmit}
      onKeyDown={onSheetKeyDown}
      noValidate
    >
      {/* 순서(고침 4바퀴): 글 칸이 먼저, 분야 칩은 그 아래. 창을 열면 포커스는 글 칸이고, 탭은 닫기 → 글 칸 → 적기 → 칩 → + 분야 순이다 */}
      {/* 고침10 A: 왼쪽 위 머리 단추 「✕」(화면 읽기 「닫기」) + 바로 옆 창 제목 「할 일」(글 칸의 이름표). 오른쪽 위 글 「닫기」는 없다 */}
      <BackHeader
        onClose={() => props.onCloseSheet("button")}
        buttonId="sheet-close"
        titleAlign="start"
        title={
          <label htmlFor="todo-input" className="sheet-label">
            {TODO_TEXT.label}
          </label>
        }
      />
      <div className="input-row">
        {/* maxLength를 걸지 않는다: 붙여 넣은 글을 몰래 자르지 않는다(T11) */}
        <input
          id="todo-input"
          ref={inputRef}
          className="input"
          type="text"
          value={props.draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          aria-describedby="todo-help"
          aria-invalid={over ? true : undefined}
          autoComplete="off"
          enterKeyHint="send"
        />
        <PrimaryButton type="submit" className="add-btn">
          {TODO_TEXT.add}
        </PrimaryButton>
      </div>
      <p id="todo-help" className="input-help">
        {help}
      </p>
      <span id="category-label" className="sheet-label sheet-category-label">
        {TODO_TEXT.categoryLabel}
      </span>
      {props.newCategoryOpen ? <NewCategoryRow {...props} newCategoryInputRef={newCategoryInputRef} /> : <CategoryChipRow {...props} />}
      {/* 칩 줄 아래 한 줄 안내(C17·C18·C20). 자리를 늘 두어 새 안내가 옛 안내를 바꾼다 */}
      <p className="cat-notice" role="status">
        {props.categoryNotice}
      </p>
    </form>
  );
}

export function TodoView(props: TodoViewProps) {
  const { day, list, rows, online, sessionLost, hasUnsaved, logoutConfirm, sheetOpen } = props;
  const doneCount = rows.filter((r) => r.done).length;
  const dateLine = day ? `${dayText(day)}${list === "ready" ? ` · ${rows.length}개 중 ${doneCount}개 끝냄` : ""}` : "";
  const sheetRef = useRef<HTMLFormElement | null>(null);

  // C-D11: scroll-padding-bottom과 목록 끝 여백을 창 높이에 맞춘다. 창 높이가 바뀌면(새 분야 줄·글자 크기) 다시 잰다.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const sheet = sheetRef.current;
    if (!sheetOpen || !sheet) {
      root.style.setProperty("--bottom-clearance", CLOSED_CLEARANCE);
      return;
    }
    const measure = () => root.style.setProperty("--bottom-clearance", openClearance(sheet.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [sheetOpen]);
  useLayoutEffect(
    () => () => {
      document.documentElement.style.removeProperty("--bottom-clearance");
    },
    [],
  );

  const header = (
    <header className="today-header">
      <Wordmark className="today-wordmark" />
      <h1 className="today-title">{TODO_TEXT.title}</h1>
      {/* 고침10 E(50:52 · d-173): 머리의 「로그아웃」은 없다(로그아웃은 내 정보 한 곳). 날짜 줄 오른쪽에 원 단추 「‹」 하나 = 지난 날 보기
          (보이는 원 32 · 누름 48 — 공통 .step-btn). 「›」 하루 뒤는 없다 */}
      <div className="today-date-row">
        <p className="today-date">{dateLine}</p>
        {props.onOpenPast && (
          <button type="button" id="past-days-button" className="step-btn today-past-btn" aria-label={TODO_TEXT.pastDays} onClick={props.onOpenPast}>
            <span className="step-btn-face" aria-hidden="true">
              ‹
            </span>
          </button>
        )}
      </div>
    </header>
  );

  const notices: ReactNode[] = [];
  if (!online) {
    notices.push(
      <Notice key="offline" role="status">
        {props.offlineText ?? TODO_TEXT.offline}
      </Notice>,
    );
  }
  if (sessionLost) {
    notices.push(
      <Notice
        key="session"
        role="alert"
        actions={
          <>
            {hasUnsaved && <TextButton onClick={props.onCopy}>{TODO_TEXT.copy}</TextButton>}
            <SecondaryButton onClick={props.onRelogin}>{TODO_TEXT.relogin}</SecondaryButton>
          </>
        }
      >
        {hasUnsaved ? TODO_TEXT.sessionUnsaved : TODO_TEXT.sessionPlain}
      </Notice>,
    );
  }

  return (
    <div className="todo-app">
      {header}
      {notices.length > 0 && <div className="notices">{notices}</div>}
      <main className="todo-main" aria-busy={list === "loading"}>
        {props.topSlot}
        {list === "loading" && <Skeleton />}
        {list === "error" && (
          <Notice role="alert" actions={<SecondaryButton onClick={props.onReload}>{TODO_TEXT.reload}</SecondaryButton>}>
            {TODO_TEXT.loadFailed}
          </Notice>
        )}
        {list === "ready" && rows.length === 0 && (
          <div className="todo-empty">
            <p className="sr-only">{TODO_TEXT.empty1}</p>
            <TodoExamples />
          </div>
        )}
        {rows.length > 0 && (
          <ul className="todo-list">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                onToggle={props.onToggle}
                onRetry={props.onRetry}
                onRemove={props.onRemove}
                onOpenDetail={props.onOpenDetail}
              />
            ))}
          </ul>
        )}
      </main>
      {/* 고침10 J: 적는 창 = 위 모서리 16 + 손잡이 줄 40×4 + 뒤의 막(먹남색 45%). 적는 창은 모달이 아니므로(C-D1) 막은 보이기만 한다 — 누름은 막을 지나 목록에 닿는다 */}
      {sheetOpen && <div className="todo-sheet-scrim" aria-hidden="true" />}
      {sheetOpen ? <TodoSheet {...props} sheetRef={sheetRef} /> : <AddTodoButton resume={props.resume} onOpen={props.onOpenSheet} />}
      <LiveRegion message={props.live} />
      {props.overlay}
      {/* 고침10 B(147:2 다섯째): 아직 저장되지 않은 기록이 있을 때만 뜨는 로그아웃 확인. 위 「로그아웃」(누르면 「로그아웃 중」 막힘) · 아래 「계속 쓰기」.
          Esc·막·뒤로 가기 = 「계속 쓰기」(로그아웃하지 않는다). 겹친 창 없이 뜨므로 스스로 history 한 칸을 쌓는다(ownHistory) */}
      {logoutConfirm && (
        <ConfirmDialog
          title={CONFIRM_TEXT.logout.title}
          description={CONFIRM_TEXT.logout.description}
          confirmLabel={CONFIRM_TEXT.logout.confirm}
          busyLabel={CONFIRM_TEXT.logout.busy}
          cancelLabel={CONFIRM_TEXT.logout.cancel}
          busy={props.loggingOut === true}
          error={props.logoutFailed ? TODO_TEXT.logoutFailed : undefined}
          ownHistory
          onConfirm={props.onLogoutConfirm}
          onCancel={props.onLogoutCancel}
        />
      )}
    </div>
  );
}
