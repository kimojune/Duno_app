"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ManageApi } from "../lib/manage-api";
import { NOTE_MAX_LENGTH_PUBLIC, countNoteChars } from "../lib/notes/public";
import type { NoteItem } from "../lib/notes/types";
import { describeTodoDay } from "../lib/todos/day";
import type { TodoItem } from "../lib/todos/types";
import { checkTodoText, countTodoChars, TODO_TEXT_MAX_LENGTH } from "../lib/todos/validation";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { categoryColorValue } from "../lib/category-color";
import { CATEGORY_NAME_MAX_LENGTH, countCategoryChars } from "../lib/categories/validation";
import { categoryOverLimitText, TODO_TEXT } from "./todo-view";
import { BackHeader } from "./back-header";
import { CONFIRM_TEXT, ConfirmDialog } from "./close-confirm";
import { Notice, SecondaryButton, TextButton } from "./ui";

/**
 * 할 일 자세히(PRD 6절 0번 고치기·지우기·순서, 0-1번 작업 기록). 할 일 한 줄의 「자세히」 단추가 연다.
 * 모달처럼 화면을 덮지만 닫으면 목록 그대로다. 열리면 제목으로, Esc나 「닫기」로 닫는다.
 * 글·분야 고치기, 위로·아래로, 지우기(한 번 더 확인), 작업 기록 쓰기·지우기를 한 곳에 둔다. AI 없이 돈다.
 * 모든 글은 React 텍스트로만 그린다(innerHTML 없음).
 */

export const DETAIL_TEXT = {
  title: "할 일 자세히",
  editLabel: "할 일 글",
  // 고침9 PM 3(④-2, Figma 51:55 · 77:18): 칩 줄 대신 고른 분야 한 줄(색 원 + 이름 + 「›」). 누르면 분야 고르기 시트
  categoryLabel: "분야",
  categoryChange: "분야 바꾸기",
  sheetTitle: "분야 고르기",
  addCategory: "+ 분야",
  newCategoryLabel: "새 분야 이름",
  newCategoryAdd: "더하기",
  newCategoryAdding: "더하는 중",
  newCategoryCancel: "취소",
  // 고침10 A(146:10 · 147:58): 페이지 머리 = 왼쪽 위 「‹」(화면 읽기 「이전」 — components/back-header.tsx) · 저장 상태 · 「⋯」 메뉴. 머리의 「할 일」 글은 없다
  more: "더 보기",
  menuName: "할 일 메뉴",
  doneLabel: "끝냄",
  dayLabel: "하는 날",
  saving: "저장 중",
  /** 머리의 저장 상태: 고치기·작업 기록을 서버가 받았으면(또는 아직 고친 것이 없으면) 「저장됨」(12 보조, 147:58) */
  saved: "저장됨",
  saveFailedShort: "저장 안 됨",
  saveFailedRetry: "저장 안 됨 · 다시 시도",
  offline: "인터넷에 연결되면 고치거나 지울 수 있어요.",
  moveUp: "위로",
  moveDown: "아래로",
  moveFailed: "순서를 바꾸지 못했어요.",
  remove: "지우기",
  // 지우기 확인 글은 공통 확인 창 글(components/close-confirm.tsx CONFIRM_TEXT.todoRemove · noteRemove, 147:2)
  removeFailed: "지우지 못했어요. 다시 눌러 주세요.",
  notesTitle: "작업 기록",
  notesLoading: "작업 기록을 불러오는 중",
  notesFailed: "작업 기록을 불러오지 못했어요.",
  // 고침10 F(147:58 · 51:55): 쓰기 칸의 이름표는 위의 「작업 기록」(칸 안 흐린 글 없음). 단추 「남기기」(막지 않는다), 빈 칸에서 누르면 칸 아래 안내
  noteAdd: "남기기",
  noteAdding: "남기는 중",
  noteEmpty: "작업 기록을 적어 주세요",
  noteAddFailed: "기록을 남기지 못했어요. 다시 눌러 주세요.",
  noteDelete: "지우기",
  noteDeleteFailed: "기록을 지우지 못했어요.",
  unreadable: "읽을 수 없는 글",
  unreadableTodo: "읽을 수 없는 할 일",
  noteReload: "다시 불러오기",
  none: "기타",
} as const;

export type DetailTodo = {
  id: string;
  text: string | null;
  categoryId: string | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

type Chip = { id: string; name: string };

/** 시트 「+ 분야」의 결과. category가 null이면 기타(「기타」라는 이름을 적었을 때 — 분야 행을 만들지 않는다) */
export type DetailCategoryAdd =
  | { ok: true; category: Chip | null }
  | { ok: false; reason: "empty" | "too_long" | "limit" | "offline" | "failed" };

export type TodoDetailProps = {
  todo: DetailTodo;
  chips: Chip[];
  api: ManageApi;
  online: boolean;
  onClose: () => void;
  onEdited: (todo: TodoItem) => void;
  onDeleted: (id: string) => void;
  /** 위(-1)·아래(1)로 한 칸. 성공하면 true */
  onMove: (id: string, direction: -1 | 1) => Promise<boolean>;
  /** 분야 고르기 시트의 「+ 분야」: 할 일 화면의 분야 더하기 길(이름 검사·같은 이름·한도 50·기기 먼저 저장)을 그대로 탄다. 없으면 「+ 분야」를 그리지 않는다 */
  onAddCategory?: (name: string) => Promise<DetailCategoryAdd>;
  /** 분야가 이미 한도(50)만큼 있으면 true: 「+ 분야」를 누르면 칸을 열지 않고 한도 안내만(요청 없음) */
  categoryLimitReached?: boolean;
  /** 작업 기록이 있는지가 바뀌면(불러옴·남김·지움) 알린다 — 할 일 줄 아이콘(고침9 PM 2-B) */
  onNotesChange?: (todoId: string, hasNotes: boolean) => void;
  /** 고침9 Figma 51:55 「끝냄」 줄: 끝냈나와 바꾸기(할 일 줄 체크와 같은 길). 없으면 줄을 그리지 않는다 */
  done?: boolean;
  onToggleDone?: () => void;
  /** 「하는 날」 줄의 글(예: 11월 13일 목요일). 없으면 줄을 그리지 않는다 */
  dayLabel?: string;
};

function composing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export function TodoDetail({
  todo,
  chips,
  api,
  online,
  onClose,
  onEdited,
  onDeleted,
  onMove,
  onAddCategory,
  categoryLimitReached = false,
  onNotesChange,
  done,
  onToggleDone,
  dayLabel,
}: TodoDetailProps) {
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose);
  const [text, setText] = useState(todo.text ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(todo.categoryId);
  const [busy, setBusy] = useState<"save" | "remove" | "move" | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** 머리의 저장 상태(Figma 58:92 「저장됨」 · 66:76 「저장 안 됨 · 다시 시도」) */
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const lastPatchRef = useRef<{ text?: string; categoryId?: string | null } | null>(null);
  const [message, setMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** 고침10 B(147:95 · PM 11): 「지우기」를 누른 작업 기록. 있으면 확인 창 「이 작업 기록을 지울까요?」 */
  const [confirmNote, setConfirmNote] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notesState, setNotesState] = useState<"loading" | "ready" | "error">("loading");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMessage, setNoteMessage] = useState("");
  /** 빈 칸에서 「남기기」를 눌렀다: 칸 아래 안내(12 Medium)를 보이고 칸에 초점을 준다 */
  const [noteEmpty, setNoteEmpty] = useState(false);
  /** 「남기기」 연타·Enter 연타에도 저장 호출은 한 번(상태는 다음 그림에서야 바뀌므로 ref로 막는다) */
  const noteBusyRef = useRef(false);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const noteIdRef = useRef<{ id: string; text: string } | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  // 열리면 제목으로 포커스(화면 읽기 프로그램이 이 창을 읽는다)
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  /** 읽은 작업 기록을 받는다(응답을 받은 뒤에만 상태를 바꾼다. 처음 상태가 이미 「불러오는 중」이다) */
  const applyNotes = useCallback((res: Awaited<ReturnType<ManageApi["fetchNotes"]>>) => {
    if (res.ok) {
      setNotes(res.data.notes);
      setNotesState("ready");
    } else {
      setNotesState("error");
    }
  }, []);
  const todoId = todo.id;
  // 서버에서 작업 기록을 가져오는 일(바깥 시스템과 맞추기). 할 일이 바뀌면 낡은 응답은 버린다.
  useEffect(() => {
    let alive = true;
    void api.fetchNotes(todoId).then((res) => {
      if (alive) applyNotes(res);
    });
    return () => {
      alive = false;
    };
  }, [api, todoId, applyNotes]);
  // 고침9 PM 2-B: 기록이 있는지 할 일 줄에 알린다(읽은 뒤·남긴 뒤·지운 뒤)
  const notesKnown = notesState === "ready";
  const hasNotes = notes.length > 0;
  useEffect(() => {
    if (notesKnown) onNotesChange?.(todoId, hasNotes);
  }, [notesKnown, hasNotes, todoId, onNotesChange]);
  function reloadNotes() {
    setNotesState("loading");
    void api.fetchNotes(todoId).then(applyNotes);
  }

  const checked = checkTodoText(text);
  const over = countTodoChars(text) > TODO_TEXT_MAX_LENGTH;
  const changedText = todo.text !== null && checked.ok && checked.text !== todo.text;
  const canSave = online && busy === null && checked.ok && changedText;

  /** 고치기 하나를 보낸다(글·분야 같은 길 api.editTodo — 기기 먼저 저장이면 기기에 먼저). 머리 저장 상태를 바꾼다 */
  async function send(patch: { text?: string; categoryId?: string | null }): Promise<boolean> {
    lastPatchRef.current = patch;
    setBusy("save");
    setSaveState("saving");
    setMessage("");
    const res = await api.editTodo(todo.id, patch);
    setBusy(null);
    if (res.ok) {
      setSaveState("saved");
      onEdited(res.data.todo);
      return true;
    }
    setSaveState("failed");
    return false;
  }

  /** 큰 제목(할 일 글)을 엔터·칸 떠남에 저장. 바뀐 것이 없으면 아무것도 안 한다 */
  async function save() {
    if (!canSave || !checked.ok) return;
    await send({ text: checked.text });
  }

  /** 「저장 안 됨 · 다시 시도」: 마지막 고치기를 같은 값으로 다시 보낸다 */
  async function retrySave() {
    const patch = lastPatchRef.current;
    if (!patch || busy !== null) return;
    if (patch.categoryId !== undefined) setCategoryId(patch.categoryId);
    const ok = await send(patch);
    if (!ok && patch.categoryId !== undefined) setCategoryId(todo.categoryId);
  }

  /**
   * 고침9 PM 3: 시트에서 고르면 바로 저장하고 시트를 닫는다(저장 단추 없음). 저장 길은 지금 분야 바꾸기 그대로(api.editTodo — 기기 먼저 저장이면 기기에 먼저).
   * 같은 것을 고르면 저장하지 않고 닫기만. 실패하면 앞 분야로 되돌리고 안내한다.
   */
  async function pickCategory(next: string | null) {
    setSheetOpen(false);
    if (next === categoryId || busy !== null || !online) return;
    const before = categoryId;
    setCategoryId(next);
    const ok = await send({ categoryId: next });
    if (!ok) setCategoryId(before);
  }

  async function remove() {
    if (busy !== null || !online) return;
    setBusy("remove");
    const res = await api.deleteTodo(todo.id);
    setBusy(null);
    if (res.ok) onDeleted(todo.id);
    else {
      setConfirmRemove(false);
      setMessage(DETAIL_TEXT.removeFailed);
    }
  }

  async function move(direction: -1 | 1) {
    if (busy !== null || !online) return;
    setBusy("move");
    setMessage("");
    const ok = await onMove(todo.id, direction);
    setBusy(null);
    if (!ok) setMessage(DETAIL_TEXT.moveFailed);
  }

  const noteChecked = noteDraft.trim().length > 0;
  const noteOver = countNoteChars(noteDraft) > NOTE_MAX_LENGTH_PUBLIC;

  async function addNote(event?: FormEvent) {
    event?.preventDefault();
    if (noteBusyRef.current || noteOver || !online) return; // 진행 중이면 무시(두 번 눌러도 한 번 저장)
    if (!noteChecked) {
      // 막지 않는다: 빈 칸·띄어쓰기만이면 저장하지 않고 칸에 초점 + 칸 아래 안내
      setNoteEmpty(true);
      noteInputRef.current?.focus();
      return;
    }
    const body = noteDraft.trim();
    // 같은 글로 다시 누르면 같은 id(서버가 한 번만 만든다)
    const previous = noteIdRef.current;
    const id = previous && previous.text === body ? previous.id : crypto.randomUUID();
    noteIdRef.current = { id, text: body };
    noteBusyRef.current = true;
    setNoteBusy(true);
    setNoteMessage("");
    let res: Awaited<ReturnType<ManageApi["addNote"]>>;
    try {
      res = await api.addNote(id, todo.id, body);
    } catch {
      res = { ok: false, error: "unavailable" };
    } finally {
      noteBusyRef.current = false; // 던져도 막힘이 남지 않게
      setNoteBusy(false);
    }
    if (res.ok) {
      noteIdRef.current = null;
      setNotes((prev) => (prev.some((n) => n.id === res.data.note.id) ? prev : [...prev, res.data.note]));
      setNoteDraft("");
      setSaveState("saved");
    } else {
      setNoteMessage(DETAIL_TEXT.noteAddFailed);
    }
  }

  /** 작업 기록 지우기(확인 창 「지우기」가 부른다). 끝나면 확인을 닫고, 지운 그 카드만 목록에서 뺀다 */
  async function removeNote(id: string) {
    if (!online) {
      setConfirmNote(null);
      return;
    }
    setNoteMessage("");
    const res = await api.deleteNote(id);
    setConfirmNote(null);
    if (res.ok || res.error === "not_found") {
      setNotes((prev) => prev.filter((n) => n.id !== id)); // 지운 그 카드만 사라진다
      setSaveState("saved");
    } else setNoteMessage(DETAIL_TEXT.noteDeleteFailed);
  }

  const currentChip = categoryId === null ? null : chips.find((c) => c.id === categoryId);
  // 고른 분야가 칩 목록에 없으면(풀 수 없음·보관) 「읽을 수 없는 분야」, 기타면 「기타」
  const currentName = categoryId === null ? DETAIL_TEXT.none : (currentChip?.name ?? TODO_TEXT.unreadableCategory);
  const currentColor = colorOf(chips, currentChip ? currentChip.id : null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !composing(event)) {
      event.preventDefault();
      onClose();
    }
  }

  // ⋯ 메뉴(Figma 58:92): 열면 첫 항목으로, Esc·항목 고르기로 닫히고 「⋯」로 초점이 돌아온다
  useEffect(() => {
    if (menuOpen) document.querySelector<HTMLButtonElement>("#detail-menu [role=menuitem]:not([disabled])")?.focus();
  }, [menuOpen]);
  function closeMenu(focusMore = true) {
    setMenuOpen(false);
    if (focusMore) requestAnimationFrame(() => document.getElementById("detail-more")?.focus());
  }
  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // 메뉴만 닫는다(할 일 페이지는 남는다)
      closeMenu();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    next?.focus();
  }

  const failed = saveState === "failed";
  // 고침10 F(147:58): 저장 상태는 늘 보인다 — 아직 고친 것이 없으면 「저장됨」(자동 저장 페이지)
  const statusText = saveState === "saving" ? DETAIL_TEXT.saving : failed ? DETAIL_TEXT.saveFailedShort : DETAIL_TEXT.saved;

  return (
    <div
      ref={rootRef}
      className="detail detail-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      onKeyDown={onKeyDown}
    >
      <div className="detail-inner">
        {/* 고침10 A(146:10 · 147:58): 왼쪽 위 머리 단추 「‹」(이전) · 오른쪽 저장 상태 · 「⋯」. 「‹ 할 일」 글 단추와 머리의 「할 일」 글은 없다 */}
        <BackHeader
          onBack={onClose}
          end={
          <div className="detail-page-tools">
            {failed ? (
              <TextButton className="detail-status-retry text-tap" onClick={() => void retrySave()}>
                {DETAIL_TEXT.saveFailedRetry}
              </TextButton>
            ) : (
              <span className="detail-status" aria-hidden="true">
                {statusText}
              </span>
            )}
            {/* O-8: 저장 상태는 이 한 곳(polite)에서 한 문장. 초점은 옮기지 않는다 */}
            <span className="sr-only" role="status">
              {message || statusText}
            </span>
            <div className="detail-menu-wrap">
              <button
                type="button"
                id="detail-more"
                className="detail-more"
                aria-label={DETAIL_TEXT.more}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls="detail-menu"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <span aria-hidden="true">⋯</span>
              </button>
              {menuOpen && <div className="detail-menu-scrim" aria-hidden="true" onClick={() => closeMenu()} />}
              {menuOpen && (
                <ul id="detail-menu" className="detail-menu" role="menu" aria-label={DETAIL_TEXT.menuName} onKeyDown={onMenuKeyDown}>
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!todo.canMoveUp || busy !== null || !online}
                      onClick={() => {
                        closeMenu();
                        void move(-1);
                      }}
                    >
                      {DETAIL_TEXT.moveUp}
                    </button>
                  </li>
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!todo.canMoveDown || busy !== null || !online}
                      onClick={() => {
                        closeMenu();
                        void move(1);
                      }}
                    >
                      {DETAIL_TEXT.moveDown}
                    </button>
                  </li>
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="detail-menu-danger"
                      disabled={busy !== null || !online}
                      onClick={() => {
                        closeMenu(false);
                        setConfirmRemove(true);
                      }}
                    >
                      {DETAIL_TEXT.remove}
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </div>
          }
        />

        <h2 id="detail-title" className="sr-only" tabIndex={-1} ref={titleRef}>
          {DETAIL_TEXT.title}
        </h2>

        {!online && <Notice role="status">{DETAIL_TEXT.offline}</Notice>}

        {/* 큰 제목 = 할 일 글(24 Bold). 고치면 엔터·칸을 떠날 때 저장(「고치기」 단추 없음 — 노션처럼 페이지, d-106) */}
        {todo.text === null ? (
          <p className="detail-big-title">{DETAIL_TEXT.unreadableTodo}</p>
        ) : (
          <input
            id="detail-text"
            className="detail-big-title detail-title-input"
            type="text"
            aria-label={DETAIL_TEXT.editLabel}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMessage("");
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || composing(e)) return;
              e.preventDefault();
              void save();
            }}
            onBlur={() => void save()}
            aria-invalid={over ? true : undefined}
            aria-describedby="detail-help"
            autoComplete="off"
            enterKeyHint="done"
          />
        )}
        <p id="detail-help" className="input-help">
          {over ? `${TODO_TEXT_MAX_LENGTH}자까지 적을 수 있어요. 지금 ${countTodoChars(text)}자예요.` : ""}
        </p>
        {message && <p className="todo-sub detail-message">{message}</p>}

        {/* 속성 줄(Figma 51:55): 끝냄 · 분야 · 하는 날. 이름표 12 보조, 줄 사이 1px 선 */}
        <div className="detail-props">
          {onToggleDone && (
            <div className="detail-prop">
              <span id="detail-done-label" className="detail-prop-label">
                {DETAIL_TEXT.doneLabel}
              </span>
              <label className="check-hit detail-done">
                <input type="checkbox" checked={done === true} onChange={onToggleDone} aria-labelledby="detail-done-label" />
                <span className="check-box" aria-hidden="true" />
              </label>
            </div>
          )}
          {/* 고침9 PM 3: 분야 = 고른 분야 한 줄(Figma 51:55 「분야 · ● 어학 ›」). 줄 전체가 단추(누름 48), 누르면 분야 고르기 시트 */}
          <div className="detail-prop">
            <span id="detail-category-label" className="detail-prop-label">
              {DETAIL_TEXT.categoryLabel}
            </span>
            <button
              type="button"
              id="detail-category-line"
              className="detail-prop-value detail-category-line"
              aria-labelledby="detail-category-label detail-category-name"
              aria-describedby="detail-category-hint"
              aria-haspopup="dialog"
              disabled={!online || busy !== null}
              onClick={() => setSheetOpen(true)}
            >
              <span className="detail-category-dot" style={{ background: currentColor }} aria-hidden="true" />
              <span id="detail-category-name" className="detail-category-name">
                {currentName}
              </span>
              <span className="detail-category-go" aria-hidden="true">
                ›
              </span>
              <span id="detail-category-hint" className="sr-only">
                {DETAIL_TEXT.categoryChange}
              </span>
            </button>
          </div>
          {dayLabel && (
            <div className="detail-prop">
              <span className="detail-prop-label">{DETAIL_TEXT.dayLabel}</span>
              <span className="detail-prop-value detail-day">{dayLabel}</span>
            </div>
          )}
        </div>

        <section className="detail-section detail-notes" aria-labelledby="notes-title">
          <h3 id="notes-title" className="detail-prop-label detail-notes-title">
            {DETAIL_TEXT.notesTitle}
          </h3>
          {notesState === "loading" && (
            <p className="todo-sub" role="status">
              {DETAIL_TEXT.notesLoading}
            </p>
          )}
          {notesState === "error" && (
            <Notice role="alert" actions={<SecondaryButton onClick={reloadNotes}>{DETAIL_TEXT.noteReload}</SecondaryButton>}>
              {DETAIL_TEXT.notesFailed}
            </Notice>
          )}
          {notes.length > 0 && (
            <ul className="note-list note-cards">
              {notes.map((note) => {
                const dayName = noteDayText(note.day);
                return (
                  <li key={note.id} className="note-item note-card">
                    {/* 고침10 F(147:95): 흰 카드(모서리 12, 안쪽 12/16) · 날짜 12 Medium 보조색 + 오른쪽 「지우기」 14 Medium 보조색(누름 44) · 글 16 Regular */}
                    <div className="note-card-head">
                      <p className="note-day">{dayName}</p>
                      <TextButton
                        id={`note-delete-${note.id}`}
                        className="note-delete text-tap"
                        aria-label={`${DETAIL_TEXT.noteDelete}: ${dayName} 기록`}
                        disabled={!online}
                        onClick={() => setConfirmNote(note.id)}
                      >
                        {DETAIL_TEXT.noteDelete}
                      </TextButton>
                    </div>
                    <p className="note-text">{note.readable ? note.text : DETAIL_TEXT.unreadable}</p>
                  </li>
                );
              })}
            </ul>
          )}
          <form onSubmit={addNote} noValidate>
            {/* 칸의 이름표는 위의 「작업 기록」(h3). 칸 안 흐린 글(placeholder) 없음 · 높이 96 · 크기 조절 손잡이 없음 */}
            <textarea
              id="note-input"
              ref={noteInputRef}
              className="note-input detail-note-input"
              rows={3}
              aria-labelledby="notes-title"
              value={noteDraft}
              onChange={(e) => {
                setNoteDraft(e.target.value);
                setNoteMessage("");
                setNoteEmpty(false);
              }}
              aria-invalid={noteOver || noteEmpty ? true : undefined}
              aria-describedby="note-help"
            />
            <p id="note-help" className="input-help note-help" role="status">
              {noteOver
                ? `${NOTE_MAX_LENGTH_PUBLIC}자까지 적을 수 있어요. 지금 ${countNoteChars(noteDraft)}자예요.`
                : noteEmpty
                  ? DETAIL_TEXT.noteEmpty
                  : noteMessage}
            </p>
            <div className="detail-actions note-actions">
              {/* 보조 단추 80×44, 칸 오른쪽 아래. 막지 않는다(빈 칸이어도 눌린다 — 안내로 답한다). 누른 뒤 응답 전에는 「남기는 중」으로 막힌다 */}
              <SecondaryButton type="submit" className="note-add-btn" busy={noteBusy} disabled={noteBusy || noteOver || !online}>
                {noteBusy ? DETAIL_TEXT.noteAdding : DETAIL_TEXT.noteAdd}
              </SecondaryButton>
            </div>
          </form>
        </section>
      </div>
      {/* 고침10 B(147:2 셋째 — 66:12 가로 단추 꼴을 대신함): 「⋯」 → 지우기. 위 「지우기」(「지우는 중」 막힘) · 아래 「그대로 두기」.
          연 메뉴 항목은 이미 없으니, 닫히면 초점은 「⋯」로 */}
      {confirmRemove && (
        <ConfirmDialog
          title={CONFIRM_TEXT.todoRemove.title}
          description={CONFIRM_TEXT.todoRemove.description}
          confirmLabel={CONFIRM_TEXT.todoRemove.confirm}
          busyLabel={CONFIRM_TEXT.todoRemove.busy}
          cancelLabel={CONFIRM_TEXT.todoRemove.cancel}
          busy={busy === "remove"}
          onConfirm={() => remove()}
          onCancel={() => {
            setConfirmRemove(false);
            requestAnimationFrame(() => document.getElementById("detail-more")?.focus());
          }}
        />
      )}
      {/* 고침10 B(147:95 · PM 11): 작업 기록 「지우기」 → 확인. 위 「지우기」(「지우는 중」 막힘) · 아래 「그대로 두기」. 지운 뒤 그 카드만 사라진다 */}
      {confirmNote !== null && (
        <ConfirmDialog
          title={CONFIRM_TEXT.noteRemove.title}
          confirmLabel={CONFIRM_TEXT.noteRemove.confirm}
          busyLabel={CONFIRM_TEXT.noteRemove.busy}
          cancelLabel={CONFIRM_TEXT.noteRemove.cancel}
          onConfirm={() => removeNote(confirmNote)}
          onCancel={() => setConfirmNote(null)}
        />
      )}
      {sheetOpen && (
        <CategorySheet
          chips={chips}
          selectedId={categoryId}
          onPick={(id) => void pickCategory(id)}
          onClose={() => setSheetOpen(false)}
          onAddCategory={onAddCategory}
          limitReached={categoryLimitReached}
        />
      )}
    </div>
  );
}

/** 작업 기록 카드의 날짜 「11월 9일」(옛 「2026-11-09」). 읽을 수 없는 값이면 받은 글 그대로 */
function noteDayText(day: string): string {
  try {
    const d = describeTodoDay(day);
    return `${d.month}월 ${d.dayOfMonth}일`;
  } catch {
    return day;
  }
}

/** 분야 순서(0부터) → 색. 칩 목록은 이름을 읽을 수 있는 분야를 만든 순서로 담고 있다(상태보기·다이얼과 같은 순서). 기타는 기타 색 */
function colorOf(chips: Chip[], id: string | null): string {
  if (id === null) return categoryColorValue(null);
  const index = chips.findIndex((c) => c.id === id);
  return categoryColorValue(index < 0 ? null : index);
}

function CheckMark() {
  return (
    // 고침10 J(77:18): 체크 24 선 아이콘(선 2, 끝 둥글게)
    <svg className="category-sheet-check" width={24} height={24} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.5L10 17.5L19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ADD_REASON_TEXT: Record<Exclude<DetailCategoryAdd, { ok: true }>["reason"], string> = {
  empty: "",
  too_long: "",
  limit: TODO_TEXT.categoryLimit,
  offline: TODO_TEXT.categoryAddOffline,
  failed: TODO_TEXT.categoryAddFailed,
};

/**
 * 고침9 PM 3 분야 고르기 시트(Figma 77:18, 명세 ⑩ PM 3 · ⑮ O-4). 분야 한 줄에 하나(색 원 12 + 이름, 고른 줄 체크) → 「기타」 → 끝 「+ 분야」.
 * 누르면 바로 골라지고 닫힌다(저장 단추 없음). 「닫기」·Esc·안드로이드 뒤로 가기(useOverlayWindow)로 닫히고, 닫히면 분야 줄로 포커스가 돌아간다.
 * 분야 이름은 React 텍스트로만 그린다.
 */
function CategorySheet({
  chips,
  selectedId,
  onPick,
  onClose,
  onAddCategory,
  limitReached,
}: {
  chips: Chip[];
  selectedId: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
  onAddCategory?: (name: string) => Promise<DetailCategoryAdd>;
  limitReached: boolean;
}) {
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  // 열리면 고른 줄(없으면 첫 줄)로 포커스
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || composing(event)) return;
    // 시트만 닫는다(뒤의 할 일 페이지까지 닫지 않는다)
    event.preventDefault();
    event.stopPropagation();
    if (adding && (event.target as HTMLElement).id === "detail-newcat-input") {
      setAdding(false);
      setDraft("");
      return;
    }
    onClose();
  }

  function openAdd() {
    setNotice("");
    if (limitReached) {
      setNotice(TODO_TEXT.categoryLimit); // 한도: 칸을 열지 않고 요청도 보내지 않는다
      return;
    }
    setAdding(true);
  }

  async function submitAdd(event?: FormEvent) {
    event?.preventDefault();
    if (!onAddCategory || busy) return;
    setBusy(true);
    setNotice("");
    const res = await onAddCategory(draft);
    setBusy(false);
    if (res.ok) {
      onPick(res.category ? res.category.id : null);
      return;
    }
    if (res.reason === "too_long") setNotice(categoryOverLimitText(countCategoryChars(draft)));
    else setNotice(ADD_REASON_TEXT[res.reason]);
    inputRef.current?.focus();
  }

  const rows: { id: string | null; name: string }[] = [...chips, { id: null, name: DETAIL_TEXT.none }];
  const firstIndex = Math.max(0, rows.findIndex((r) => r.id === selectedId));
  const over = countCategoryChars(draft) > CATEGORY_NAME_MAX_LENGTH;

  return (
    <div ref={rootRef} className="category-sheet-layer" onKeyDown={onKeyDown}>
      <div className="category-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div className="category-sheet" role="dialog" aria-modal="true" aria-labelledby="category-sheet-title">
        {/* 고침10 A: 왼쪽 위 머리 단추 「✕」(닫기) + 바로 옆 시트 제목. 오른쪽 위 글 「닫기」는 없다 */}
        <BackHeader
          onClose={onClose}
          titleAlign="start"
          title={
            <h2 id="category-sheet-title" className="category-sheet-title">
              {DETAIL_TEXT.sheetTitle}
            </h2>
          }
        />
        <ul className="category-sheet-list">
          {rows.map((row, index) => {
            const picked = row.id === selectedId;
            return (
              <li key={row.id ?? "other"}>
                <button
                  type="button"
                  ref={index === firstIndex ? firstRef : undefined}
                  className={picked ? "category-sheet-row is-picked" : "category-sheet-row"}
                  aria-pressed={picked}
                  data-category-id={row.id ?? "other"}
                  onClick={() => onPick(row.id)}
                >
                  <span className="detail-category-dot" style={{ background: colorOf(chips, row.id) }} aria-hidden="true" />
                  <span className="category-sheet-name">{row.name}</span>
                  {picked && <CheckMark />}
                </button>
              </li>
            );
          })}
          {onAddCategory && !adding && (
            <li>
              <button type="button" id="category-sheet-add" className="category-sheet-row category-sheet-add" onClick={openAdd}>
                <span className="category-sheet-name">{DETAIL_TEXT.addCategory}</span>
              </button>
            </li>
          )}
        </ul>
        {adding && (
          <form className="category-sheet-form" onSubmit={(e) => void submitAdd(e)} noValidate>
            <label htmlFor="detail-newcat-input" className="input-label">
              {DETAIL_TEXT.newCategoryLabel}
            </label>
            <input
              id="detail-newcat-input"
              ref={inputRef}
              className="input"
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setNotice("");
              }}
              aria-invalid={over ? true : undefined}
              aria-describedby="detail-newcat-help"
              autoComplete="off"
              enterKeyHint="done"
            />
            <div className="detail-actions">
              <SecondaryButton type="submit" busy={busy}>
                {busy ? DETAIL_TEXT.newCategoryAdding : DETAIL_TEXT.newCategoryAdd}
              </SecondaryButton>
              <TextButton
                onClick={() => {
                  setAdding(false);
                  setDraft("");
                  setNotice("");
                }}
              >
                {DETAIL_TEXT.newCategoryCancel}
              </TextButton>
            </div>
          </form>
        )}
        <p id="detail-newcat-help" className="cat-notice" role="status">
          {notice}
        </p>
      </div>
    </div>
  );
}
