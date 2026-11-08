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
import type { TodoDay } from "../lib/todos/types";
import { addDays } from "../lib/week";
import { countTodoChars, TODO_TEXT_MAX_LENGTH } from "../lib/todos/validation";
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
  logout: "로그아웃",
  label: "할 일 적기",
  add: "적기",
  unreadable: "읽을 수 없는 할 일", // (임시)
  empty1: "오늘 적은 할 일이 없어요.",
  emptyClosed: "아래 단추를 눌러 적어 보세요.", // C3 창 닫힘
  emptyOpen: "아래 칸에 적어 보세요.", // C3 창 열림
  saving: "저장하는 중",
  saveFailed: "저장하지 못했어요.",
  queued: "연결되면 저장해요", // 오프라인으로 적어 기기에 둔 줄(PRD 10절)
  liveQueued: "연결되면 저장할게요",
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
  logoutConfirm: "아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.",
  // ---- 기기 먼저 저장(고침 3바퀴) ----
  offlineLocal: "인터넷 연결이 끊겼어요. 적고 끝낸 것은 이 기기에 두었다가 연결되면 보내요.",
  logoutUnsent: "보내지 못한 기록이 있어요. 지금 로그아웃하면 이 기록은 사라져요.",
  signingOut: "기록을 서버에 보내는 중이에요",
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
  sheetClose: "닫기",
  sheetCloseName: "적는 창 닫기", // 보이는 「닫기」를 품는 접근 이름(2.5.3)
  categoryLabel: "분야 (고르지 않으면 기타)",
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
  checkFailed: boolean;
  /** 분야 표시 글(CategoryTag). null이면 기타라 붙이지 않는다. 풀 수 없는 분야는 TODO_TEXT.unreadableCategory */
  category?: string | null;
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
  logoutConfirm: boolean;
  /** 기기 먼저 저장(고침 3바퀴)이면 끊김·로그아웃 확인 글이 다르다. 없으면 기본 글 */
  offlineText?: string;
  logoutConfirmText?: string;
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
  onLogout: () => void;
  onLogoutConfirm: () => void;
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

/** 목록 줄의 분야 표시. 기타(분야 없음)는 붙이지 않는다. 화면 읽기용으로 앞에 「분야 」 */
export function CategoryTag({ id, name }: { id: string; name: string }) {
  return (
    <div className="category-tag-line">
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
  // 저장 중·저장 못 한 줄은 서버에 아직 없다: 체크 칸은 보이되 눌러도 바뀌지 않고, 그 줄의 안내에 잇는다
  const notSaved = row.saving || row.failed || row.queued === true;
  const describedBy = [row.category ? tagId : null, notSaved ? statusId : null].filter(Boolean).join(" ");
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
        <p id={textId} className={row.done ? "todo-text is-done" : "todo-text"}>
          {row.text ?? TODO_TEXT.unreadable}
        </p>
        {/* C-D6: 저장 중 줄에도 분야 표시를 바로 그린다 */}
        {row.category && <CategoryTag id={tagId} name={row.category} />}
        {/* 늘 그린다(체크 칸 aria-describedby가 가리킨다). 처음 SAVING_HINT_DELAY_MS 동안은 화면 읽기용으로만 있다 */}
        {row.saving && (
          <p id={statusId} className={row.savingSlow ? "todo-sub" : "todo-sub sr-only"}>
            {TODO_TEXT.saving}
          </p>
        )}
        {row.queued && (
          <>
            <p id={statusId} className="todo-sub">
              {TODO_TEXT.queued}
            </p>
            <div className="row-actions">
              <TextButton onClick={() => onRemove(row.id)}>{TODO_TEXT.remove}</TextButton>
            </div>
          </>
        )}
        {row.failed && (
          <>
            <p id={statusId} role="status" className="todo-sub">
              {TODO_TEXT.saveFailed}
            </p>
            <div className="row-actions">
              <TextButton onClick={() => onRetry(row.id)}>{TODO_TEXT.retry}</TextButton>
              <TextButton onClick={() => onRemove(row.id)}>{TODO_TEXT.remove}</TextButton>
            </div>
          </>
        )}
        {row.checkFailed && (
          <p role="status" className="todo-sub">
            {TODO_TEXT.checkFailed}
          </p>
        )}
      </div>
      {/* 저장된 줄에만, 줄 오른쪽의 작은 단추로(B16). 보이는 글은 작아도 누르는 면은 48px 이상. 접근 이름에 보이는 글자 「자세히」가 들어 있다(2.5.3) */}
      {onOpenDetail && !notSaved && (
        <div className="row-actions row-detail">
          <TextButton className="row-detail-btn" aria-label={`자세히 보기: ${row.text ?? TODO_TEXT.unreadable}`} onClick={() => onOpenDetail(row.id)}>
            자세히
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

/** 칩 하나. 누름 영역 48×48 이상, 보이는 면은 높이 32. 고름은 면 색 + 체크 그림 둘로 가른다 */
export function CategoryChip({ chip, pressed, onToggle }: { chip: ChipView; pressed: boolean; onToggle: (id: string) => void }) {
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
        {/* 말줄임은 CSS로만. 접근 이름은 전체 이름이다(C23) */}
        <span className="chip-label">{chip.name}</span>
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
    <div className="chip-row" role="group" aria-labelledby="category-label">
      {props.chips.map((chip) => (
        <CategoryChip key={chip.id} chip={chip} pressed={chip.id === props.selectedCategoryId} onToggle={props.onToggleChip} />
      ))}
      <AddCategoryChip onOpen={props.onOpenNewCategory} />
    </div>
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
      <div className="sheet-head">
        <label htmlFor="todo-input" className="sheet-label">
          {TODO_TEXT.label}
        </label>
        <TextButton id="sheet-close" className="btn-flush-end" aria-label={TODO_TEXT.sheetCloseName} onClick={() => props.onCloseSheet("button")}>
          {TODO_TEXT.sheetClose}
        </TextButton>
      </div>
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
      <div>
        <Wordmark className="today-wordmark" />
        <h1 className="today-title">{TODO_TEXT.title}</h1>
        <p className="today-date">{dateLine}</p>
      </div>
      <TextButton id="logout-button" onClick={props.onLogout}>
        {TODO_TEXT.logout}
      </TextButton>
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
  if (logoutConfirm) {
    notices.push(
      <Notice
        key="logout"
        role="alert"
        actions={
          <>
            <SecondaryButton onClick={props.onLogoutConfirm}>{TODO_TEXT.logout}</SecondaryButton>
            <TextButton onClick={props.onLogoutCancel}>{TODO_TEXT.cancel}</TextButton>
          </>
        }
      >
        {props.logoutConfirmText ?? TODO_TEXT.logoutConfirm}
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
            <p>{TODO_TEXT.empty1}</p>
            <p>{sheetOpen ? TODO_TEXT.emptyOpen : TODO_TEXT.emptyClosed}</p>
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
      {sheetOpen ? <TodoSheet {...props} sheetRef={sheetRef} /> : <AddTodoButton resume={props.resume} onOpen={props.onOpenSheet} />}
      <LiveRegion message={props.live} />
      {props.overlay}
    </div>
  );
}
