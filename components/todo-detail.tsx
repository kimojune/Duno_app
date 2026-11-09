"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ManageApi } from "../lib/manage-api";
import { NOTE_MAX_LENGTH_PUBLIC, countNoteChars } from "../lib/notes/public";
import type { NoteItem } from "../lib/notes/types";
import type { TodoItem } from "../lib/todos/types";
import { checkTodoText, countTodoChars, TODO_TEXT_MAX_LENGTH } from "../lib/todos/validation";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { categoryColorValue } from "../lib/category-color";
import { CATEGORY_NAME_MAX_LENGTH, countCategoryChars } from "../lib/categories/validation";
import { categoryOverLimitText, TODO_TEXT } from "./todo-view";
import { Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";

/**
 * 할 일 자세히(PRD 6절 0번 고치기·지우기·순서, 0-1번 작업 기록). 할 일 한 줄의 「자세히」 단추가 연다.
 * 모달처럼 화면을 덮지만 닫으면 목록 그대로다. 열리면 제목으로, Esc나 「닫기」로 닫는다.
 * 글·분야 고치기, 위로·아래로, 지우기(한 번 더 확인), 작업 기록 쓰기·지우기를 한 곳에 둔다. AI 없이 돈다.
 * 모든 글은 React 텍스트로만 그린다(innerHTML 없음).
 */

export const DETAIL_TEXT = {
  title: "할 일 자세히",
  close: "닫기",
  editLabel: "할 일 글",
  // 고침9 PM 3(④-2, Figma 51:55 · 77:18): 칩 줄 대신 고른 분야 한 줄(색 원 + 이름 + 「›」). 누르면 분야 고르기 시트
  categoryLabel: "분야",
  categoryChange: "분야 바꾸기",
  sheetTitle: "분야 고르기",
  sheetClose: "닫기",
  addCategory: "+ 분야",
  newCategoryLabel: "새 분야 이름",
  newCategoryAdd: "더하기",
  newCategoryAdding: "더하는 중",
  newCategoryCancel: "취소",
  save: "고치기",
  saving: "고치는 중",
  saved: "고쳤어요",
  saveFailed: "고치지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 고치거나 지울 수 있어요.",
  moveUp: "위로",
  moveDown: "아래로",
  moveFailed: "순서를 바꾸지 못했어요.",
  remove: "지우기",
  removeConfirm: "이 할 일을 지울까요? 이 할 일에 남긴 작업 기록도 함께 지워져요.",
  removeYes: "지우기",
  removeFailed: "지우지 못했어요. 다시 눌러 주세요.",
  notesTitle: "작업 기록",
  notesLoading: "작업 기록을 불러오는 중",
  notesFailed: "작업 기록을 불러오지 못했어요.",
  noteLabel: "작업 기록 쓰기",
  noteAdd: "작업 기록 남기기",
  noteAdding: "남기는 중",
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
}: TodoDetailProps) {
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose);
  const [text, setText] = useState(todo.text ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(todo.categoryId);
  const [busy, setBusy] = useState<"save" | "remove" | "move" | "category" | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notesState, setNotesState] = useState<"loading" | "ready" | "error">("loading");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMessage, setNoteMessage] = useState("");
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

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!canSave || !checked.ok) return;
    const patch: { text?: string } = { text: checked.text };
    setBusy("save");
    setMessage(DETAIL_TEXT.saving);
    const res = await api.editTodo(todo.id, patch);
    setBusy(null);
    if (res.ok) {
      setMessage(DETAIL_TEXT.saved);
      onEdited(res.data.todo);
    } else {
      setMessage(DETAIL_TEXT.saveFailed);
    }
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
    setBusy("category");
    setMessage(DETAIL_TEXT.saving);
    const res = await api.editTodo(todo.id, { categoryId: next });
    setBusy(null);
    if (res.ok) {
      setMessage(DETAIL_TEXT.saved);
      onEdited(res.data.todo);
    } else {
      setCategoryId(before);
      setMessage(DETAIL_TEXT.saveFailed);
    }
  }

  async function remove() {
    if (busy !== null || !online) return;
    setBusy("remove");
    const res = await api.deleteTodo(todo.id);
    setBusy(null);
    if (res.ok) onDeleted(todo.id);
    else setMessage(DETAIL_TEXT.removeFailed);
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
    if (noteBusy || !noteChecked || noteOver || !online) return;
    const body = noteDraft.trim();
    // 같은 글로 다시 누르면 같은 id(서버가 한 번만 만든다)
    const previous = noteIdRef.current;
    const id = previous && previous.text === body ? previous.id : crypto.randomUUID();
    noteIdRef.current = { id, text: body };
    setNoteBusy(true);
    setNoteMessage("");
    const res = await api.addNote(id, todo.id, body);
    setNoteBusy(false);
    if (res.ok) {
      noteIdRef.current = null;
      setNotes((prev) => (prev.some((n) => n.id === res.data.note.id) ? prev : [...prev, res.data.note]));
      setNoteDraft("");
    } else {
      setNoteMessage(DETAIL_TEXT.noteAddFailed);
    }
  }

  async function removeNote(id: string) {
    if (!online) return;
    setNoteMessage("");
    const res = await api.deleteNote(id);
    if (res.ok || res.error === "not_found") setNotes((prev) => prev.filter((n) => n.id !== id));
    else setNoteMessage(DETAIL_TEXT.noteDeleteFailed);
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

  return (
    <div
      ref={rootRef}
      className="detail"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      onKeyDown={onKeyDown}
    >
      <div className="detail-inner">
        <div className="detail-head">
          <h2 id="detail-title" className="detail-title" tabIndex={-1} ref={titleRef}>
            {DETAIL_TEXT.title}
          </h2>
          <TextButton className="btn-flush-end" onClick={onClose}>
            {DETAIL_TEXT.close}
          </TextButton>
        </div>

        {!online && <Notice role="status">{DETAIL_TEXT.offline}</Notice>}

        <form className="detail-section" onSubmit={save} noValidate>
          <label htmlFor="detail-text" className="input-label">
            {DETAIL_TEXT.editLabel}
          </label>
          {todo.text === null ? (
            <p className="todo-sub">{DETAIL_TEXT.unreadableTodo}</p>
          ) : (
            <input
              id="detail-text"
              className="input"
              type="text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setMessage("");
              }}
              aria-invalid={over ? true : undefined}
              aria-describedby="detail-help"
              autoComplete="off"
              enterKeyHint="done"
            />
          )}
          <p id="detail-help" className="input-help">
            {over ? `${TODO_TEXT_MAX_LENGTH}자까지 적을 수 있어요. 지금 ${countTodoChars(text)}자예요.` : ""}
          </p>
          <div className="detail-actions">
            <PrimaryButton type="submit" busy={busy === "save"} disabled={!canSave}>
              {busy === "save" ? DETAIL_TEXT.saving : DETAIL_TEXT.save}
            </PrimaryButton>
          </div>
          <p className="input-help" role="status">
            {message}
          </p>
        </form>

        {/* 고침9 PM 3: 분야 = 고른 분야 한 줄(Figma 51:55 「분야 · ● 어학 ›」). 줄 전체가 단추(누름 48), 누르면 분야 고르기 시트 */}
        <div className="detail-section detail-prop">
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

        <div className="detail-section">
          <div className="detail-actions">
            <SecondaryButton disabled={!todo.canMoveUp || busy !== null || !online} onClick={() => void move(-1)}>
              {DETAIL_TEXT.moveUp}
            </SecondaryButton>
            <SecondaryButton disabled={!todo.canMoveDown || busy !== null || !online} onClick={() => void move(1)}>
              {DETAIL_TEXT.moveDown}
            </SecondaryButton>
            {!confirmRemove && (
              <TextButton disabled={busy !== null || !online} onClick={() => setConfirmRemove(true)}>
                {DETAIL_TEXT.remove}
              </TextButton>
            )}
          </div>
          {confirmRemove && (
            <Notice
              role="alert"
              actions={
                <>
                  <SecondaryButton busy={busy === "remove"} disabled={busy !== null || !online} onClick={() => void remove()}>
                    {DETAIL_TEXT.removeYes}
                  </SecondaryButton>
                  <TextButton onClick={() => setConfirmRemove(false)}>취소</TextButton>
                </>
              }
            >
              {DETAIL_TEXT.removeConfirm}
            </Notice>
          )}
        </div>

        <section className="detail-section" aria-labelledby="notes-title">
          <h3 id="notes-title" className="detail-sub-title">
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
            <ul className="note-list">
              {notes.map((note) => (
                <li key={note.id} className="note-item">
                  <p className="todo-sub">{note.day}</p>
                  <p className="note-text">{note.readable ? note.text : DETAIL_TEXT.unreadable}</p>
                  <TextButton className="btn-flush-start" aria-label={`${DETAIL_TEXT.noteDelete}: ${note.day} 기록`} onClick={() => void removeNote(note.id)}>
                    {DETAIL_TEXT.noteDelete}
                  </TextButton>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addNote} noValidate>
            <label htmlFor="note-input" className="input-label">
              {DETAIL_TEXT.noteLabel}
            </label>
            <textarea
              id="note-input"
              className="input note-input"
              rows={3}
              value={noteDraft}
              onChange={(e) => {
                setNoteDraft(e.target.value);
                setNoteMessage("");
              }}
              aria-invalid={noteOver ? true : undefined}
              aria-describedby="note-help"
            />
            <p id="note-help" className="input-help" role="status">
              {noteOver
                ? `${NOTE_MAX_LENGTH_PUBLIC}자까지 적을 수 있어요. 지금 ${countNoteChars(noteDraft)}자예요.`
                : noteMessage}
            </p>
            <div className="detail-actions">
              <PrimaryButton type="submit" busy={noteBusy} disabled={noteBusy || !noteChecked || noteOver || !online}>
                {noteBusy ? DETAIL_TEXT.noteAdding : DETAIL_TEXT.noteAdd}
              </PrimaryButton>
            </div>
          </form>
        </section>
      </div>
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

/** 분야 순서(0부터) → 색. 칩 목록은 이름을 읽을 수 있는 분야를 만든 순서로 담고 있다(상태보기·다이얼과 같은 순서). 기타는 기타 색 */
function colorOf(chips: Chip[], id: string | null): string {
  if (id === null) return categoryColorValue(null);
  const index = chips.findIndex((c) => c.id === id);
  return categoryColorValue(index < 0 ? null : index);
}

function CheckMark() {
  return (
    <svg className="category-sheet-check" width={16} height={12} viewBox="0 0 16 12" aria-hidden="true" focusable="false">
      <path d="M1 6L6 11L15 1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
        <div className="category-sheet-head">
          <h2 id="category-sheet-title" className="category-sheet-title">
            {DETAIL_TEXT.sheetTitle}
          </h2>
          <TextButton className="btn-flush-end" onClick={onClose}>
            {DETAIL_TEXT.sheetClose}
          </TextButton>
        </div>
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
