"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ManageApi } from "../lib/manage-api";
import { NOTE_MAX_LENGTH_PUBLIC, countNoteChars } from "../lib/notes/public";
import type { NoteItem } from "../lib/notes/types";
import type { TodoItem } from "../lib/todos/types";
import { checkTodoText, countTodoChars, TODO_TEXT_MAX_LENGTH } from "../lib/todos/validation";
import { useOverlayWindow } from "../lib/use-overlay-window";
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
  categoryLabel: "분야 (고르지 않으면 기타)",
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
  notesEmpty: "남긴 기록이 없어요. 하는 중에, 끝낸 뒤에, 저녁에 몰아서 적어도 돼요.",
  notesLoading: "작업 기록을 불러오는 중",
  notesFailed: "작업 기록을 불러오지 못했어요.",
  noteLabel: "작업 기록 쓰기",
  noteAdd: "기록 남기기",
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
};

function composing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export function TodoDetail({ todo, chips, api, online, onClose, onEdited, onDeleted, onMove }: TodoDetailProps) {
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose);
  const [text, setText] = useState(todo.text ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(todo.categoryId);
  const [busy, setBusy] = useState<"save" | "remove" | "move" | null>(null);
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
  function reloadNotes() {
    setNotesState("loading");
    void api.fetchNotes(todoId).then(applyNotes);
  }

  const checked = checkTodoText(text);
  const over = countTodoChars(text) > TODO_TEXT_MAX_LENGTH;
  const changedText = todo.text !== null && checked.ok && checked.text !== todo.text;
  const changedCategory = categoryId !== todo.categoryId;
  const canSave = online && busy === null && checked.ok && (changedText || changedCategory);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!canSave || !checked.ok) return;
    const patch: { text?: string; categoryId?: string | null } = {};
    if (changedText) patch.text = checked.text;
    if (changedCategory) patch.categoryId = categoryId;
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
          <span id="detail-category-label" className="input-label">
            {DETAIL_TEXT.categoryLabel}
          </span>
          <div className="detail-chips" role="group" aria-labelledby="detail-category-label">
            <button type="button" className="chip" aria-pressed={categoryId === null} onClick={() => setCategoryId(null)}>
              <span className="chip-face">
                <span className="chip-label">{DETAIL_TEXT.none}</span>
              </span>
            </button>
            {chips.map((chip) => (
              <button key={chip.id} type="button" className="chip" aria-pressed={categoryId === chip.id} onClick={() => setCategoryId(chip.id)}>
                <span className="chip-face">
                  <span className="chip-label">{chip.name}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="detail-actions">
            <PrimaryButton type="submit" busy={busy === "save"} disabled={!canSave}>
              {busy === "save" ? DETAIL_TEXT.saving : DETAIL_TEXT.save}
            </PrimaryButton>
          </div>
          <p className="input-help" role="status">
            {message}
          </p>
        </form>

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
          {notesState === "ready" && notes.length === 0 && <p className="todo-sub">{DETAIL_TEXT.notesEmpty}</p>}
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
    </div>
  );
}
