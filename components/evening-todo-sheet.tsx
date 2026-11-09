"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { addTodo, setTodoDone } from "../app/todos/actions";
import { categoryColorValue } from "../lib/category-color";
import type { LocalTodos } from "../lib/local/todos";
import { fetchToday } from "../lib/read-client";
import type { TodayRead } from "../lib/today-types";
import type { AddedTodo, TodoDoneState, TodoItem, TodoResult } from "../lib/todos/types";
import { checkTodoText, countTodoChars, TODO_TEXT_MAX_LENGTH } from "../lib/todos/validation";
import { useOnline } from "../lib/use-online";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { CloseConfirm } from "./close-confirm";
import { ChipScroller } from "./chip-scroller";
import { CategoryChip, CategoryTag, helpText, overLimitText, TODO_TEXT, type ChipView } from "./todo-view";
import { Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";

/**
 * 오늘 기록(옛 저녁 기록) 시간 단계의 「오늘 할 일 n/m ›」 줄과, 누르면 뜨는 「오늘 할 일」 시트(디자인 명세 ⑩ PM 11, 고침 5바퀴).
 * - 할 일 탭과 같은 데이터·같은 저장 길이다. 새 서버 입구·새 표·따로 둔 캐시가 없다.
 *   · 기기 먼저 저장(기본): 할 일 탭이 받는 것과 같은 LocalTodos(local)를 읽고(read·subscribe) 쓴다(addTodo·setDone).
 *     끊겨 있어도 적기·체크가 기기에 먼저 남고 연결되면 보낼 줄이 올린다(할 일 탭과 같다). 계정 확인·로그아웃 지우기도 그 장치가 한다.
 *   · 예전 방식(DUNO_LOCAL_FIRST=off): 할 일 탭과 같은 GET /todos/today(fetchToday)로 읽고 같은 Server Action(addTodo·setTodoDone)을
 *     같은 인자 꼴로 부른다. 서버가 글 길이·하루 한도·인증·내 할 일인지를 그대로 본다. 쓴 뒤 onChanged로 할 일 탭이 다시 읽게 한다.
 *     이 방식에서는 끊겨 있을 때 적기·체크를 하지 않고 안내만 한다(할 일 탭의 보관함은 할 일 탭 혼자 쓴다 — 알려진 한계).
 * - 체크·되돌림·더하기를 하면 그날 끝낸 할 일의 분야 목록(기타 제외)을 onDoneCategoriesChange로 바로 알린다. 오늘 기록은 그 값을
 *   state.doneCategoryIds로 받아 나누기 처음 값의 재료로 쓴다.
 * - 시트는 겹친 창 규칙(lib/use-overlay-window.ts)을 따른다: 안드로이드 뒤로 가기로 닫힘, 창 밖 inert, Esc, 닫으면 「오늘 할 일」 줄로 포커스가 돌아온다.
 * - 할 일 글·분야 이름은 React 텍스트로만 그린다.
 */

export const EVENING_TODO_TEXT = {
  line: "오늘 할 일",
  /** 줄의 접근 이름. 보이는 글 「오늘 할 일 2/3」로 시작한다(2.5.3) */
  lineName: (done: number, all: number) => `오늘 할 일 ${done}/${all}, ${all}개 중 ${done}개 끝냄`,
  title: "오늘 할 일",
  close: "닫기",
  add: "+ 할 일",
  inputLabel: "할 일",
  write: "적기",
  empty: "오늘 적은 할 일이 없어요.",
  loading: "할 일을 불러오는 중",
  saving: "저장하는 중",
} as const;

/**
 * 시트가 할 일 탭과 같은 데이터를 읽고 쓰는 길.
 * local이 있으면 기기 먼저 저장(할 일 탭과 같은 LocalTodos), 없으면 예전 방식(할 일 탭과 같은 GET·Server Action).
 */
export type EveningTodos = {
  local?: LocalTodos;
  /** 예전 방식에서 시트가 서버에 적거나 체크한 뒤 부른다(할 일 탭이 다시 읽게) */
  onChanged?: () => void;
};

/** 그날 끝낸 할 일의 분야 번호(중복 없음, 목록 순서). 기타(분야 없음)는 넣지 않는다 */
export function doneCategoryIdsOf(todos: readonly Pick<TodoItem, "done" | "categoryId">[]): string[] {
  const ids: string[] = [];
  for (const t of todos) {
    if (t.done && t.categoryId !== null && !ids.includes(t.categoryId)) ids.push(t.categoryId);
  }
  return ids;
}

const UNAVAILABLE = { ok: false, error: "unavailable" } as const;

async function safely<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call();
  } catch {
    return fallback;
  }
}

function composing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/** 할 일 탭과 같은 오늘 읽기. 기기 먼저 저장이면 거울을 따라가고(바뀔 때마다), 예전 방식이면 열 때와 다시 불러올 때 GET */
function useTodayRead(todos: EveningTodos) {
  const { local } = todos;
  const [read, setRead] = useState<TodayRead | null>(() => (local ? local.read() : null));
  const seqRef = useRef(0);

  const reload = useCallback(() => {
    if (local) {
      setRead(local.read());
      return;
    }
    const seq = ++seqRef.current;
    void safely<TodayRead>(() => fetchToday(), { todos: UNAVAILABLE, categories: UNAVAILABLE }).then((res) => {
      if (seq === seqRef.current) setRead(res);
    });
  }, [local]);

  useEffect(() => {
    if (local) {
      // 거울이 바뀔 때마다(내가 쓴 것·서버에서 받아 맞춘 것·로그아웃·계정 바뀜으로 지운 것) 그대로 따른다. 따로 담아 두지 않는다
      let alive = true;
      void Promise.resolve().then(() => {
        if (alive) setRead(local.read());
      });
      const stop = local.subscribe(() => setRead(local.read()));
      return () => {
        alive = false;
        stop();
      };
    }
    // 서버에서 가져오는 일(바깥 시스템과 맞추기). 상태는 응답을 받은 뒤에만 바꾼다
    let alive = true;
    void safely<TodayRead>(() => fetchToday(), { todos: UNAVAILABLE, categories: UNAVAILABLE }).then((res) => {
      if (alive) setRead(res);
    });
    return () => {
      alive = false;
    };
  }, [local]);

  return { read, setRead, reload };
}

/**
 * 시간 단계의 「오늘 할 일 n/m ›」 줄(흰 카드 줄, 누름 48)과 시트. 시트 여닫기 상태는 여기에 둔다.
 * n = 끝낸 수, m = 전체 수(할 일 탭 머리 「m개 중 n개 끝냄」과 같은 셈). 할 일이 없으면 「0/0」(시트에서 더할 수 있게).
 */
export function EveningTodoLine({
  todos,
  onDoneCategoriesChange,
}: {
  todos: EveningTodos;
  onDoneCategoriesChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = useTodayRead(todos);
  const list = today.read?.todos.ok ? today.read.todos.data.todos : null;
  const all = list?.length ?? 0;
  const done = list?.filter((t) => t.done).length ?? 0;

  return (
    <>
      <button
        type="button"
        id="evening-todo-line"
        className="evening-todo-line"
        aria-haspopup="dialog"
        aria-label={list ? EVENING_TODO_TEXT.lineName(done, all) : EVENING_TODO_TEXT.line}
        onClick={() => setOpen(true)}
      >
        <span className="evening-todo-line-text">
          {EVENING_TODO_TEXT.line}
          {list && (
            <>
              {" "}
              <b className="evening-todo-count">
                {done}/{all}
              </b>
            </>
          )}
        </span>
        <span className="evening-todo-go" aria-hidden="true">
          ›
        </span>
      </button>
      {open && <EveningTodoSheet todos={todos} today={today} onClose={() => setOpen(false)} onDoneCategoriesChange={onDoneCategoriesChange} />}
    </>
  );
}

type TodayState = ReturnType<typeof useTodayRead>;

function EveningTodoSheet({
  todos,
  today,
  onClose,
  onDoneCategoriesChange,
}: {
  todos: EveningTodos;
  today: TodayState;
  onClose: () => void;
  onDoneCategoriesChange: (ids: string[]) => void;
}) {
  /* PM d-126: 「+ 할 일」 칸에 쓴 글이 있을 때만 닫기 전에 확인한다(빈칸·띄어쓰기만이면 그냥 닫는다. 체크는 바로 저장되므로 묻지 않는다) */
  const [confirmClose, setConfirmClose] = useState(false);
  const hasDraft = () => draftRef.current.trim() !== "";
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose, {
    holdBack: () => {
      if (!hasDraft()) return false;
      setConfirmClose(true);
      return true;
    },
  });
  function requestClose() {
    if (hasDraft()) setConfirmClose(true);
    else onClose();
  }
  const { local, onChanged } = todos;
  const { read, setRead, reload } = today;
  const online = useOnline();
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraftState] = useState("");
  /** 누른 그 순간의 글(연타해도 둘째 누름은 이미 빈 칸을 읽는다 — 할 일 탭과 같다) */
  const draftRef = useRef("");
  const setDraft = (value: string) => {
    draftRef.current = value;
    setDraftState(value);
  };
  const addingRef = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  /** 예전 방식: 실패한 적기를 같은 글·같은 분야로 다시 누르면 같은 id(서버가 한 번만 만든다) */
  const pendingAddRef = useRef<{ id: string; text: string; categoryId: string | null } | null>(null);
  /** 예전 방식: 줄마다 마지막으로 보낸 체크 순번(마지막 값이 이긴다) */
  const toggleSeqRef = useRef(new Map<string, number>());
  const readRef = useRef(read);
  useLayoutEffect(() => {
    readRef.current = read;
  }, [read]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const rows = read?.todos.ok ? read.todos.data.todos : [];
  const categoriesOk = read?.categories.ok === true;
  const allCategories = read?.categories.ok ? read.categories.data.categories : [];
  const readable = allCategories.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name }] : []));
  const order = new Map(readable.map((c, i) => [c.id, i]));
  const chips: ChipView[] = readable;

  function categoryOf(id: string | null): { name: string; color: string | null } | null {
    if (id === null) return null;
    const c = readable.find((x) => x.id === id);
    if (c) return { name: c.name, color: categoryColorValue(order.get(id) ?? 0) };
    // 분야 목록을 받았는데 풀 수 없거나 없는 분야면 「읽을 수 없는 분야」(할 일 탭과 같다). 목록을 못 받았으면 붙이지 않는다
    return categoriesOk ? { name: TODO_TEXT.unreadableCategory, color: null } : null;
  }

  function report(list: readonly TodoItem[]) {
    onDoneCategoriesChange(doneCategoryIdsOf(list));
  }

  /** 예전 방식: 화면의 목록만 바꾼다(서버 응답 전·실패 되돌림) */
  function patchRows(change: (list: TodoItem[]) => TodoItem[]): TodoItem[] {
    const current = readRef.current;
    if (!current || !current.todos.ok) return [];
    const next = change(current.todos.data.todos);
    const nextRead: TodayRead = { ...current, todos: { ok: true, data: { ...current.todos.data, todos: next } } };
    readRef.current = nextRead;
    setRead(nextRead);
    return next;
  }

  function toggle(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const desired = !row.done;
    setMessage("");
    if (local) {
      // 할 일 탭과 같은 길: 기기 거울에 먼저 반영(끊겨 있어도), 서버에는 보낼 줄이 뒤에서 보낸다
      local.setDone(id, desired);
      const after = local.read();
      setRead(after);
      if (after.todos.ok) report(after.todos.data.todos);
      return;
    }
    if (!navigator.onLine) {
      setMessage(TODO_TEXT.offline);
      return;
    }
    const seq = (toggleSeqRef.current.get(id) ?? 0) + 1;
    toggleSeqRef.current.set(id, seq);
    report(patchRows((list) => list.map((t) => (t.id === id ? { ...t, done: desired } : t))));
    void (async () => {
      const res = await safely<TodoResult<TodoDoneState>>(() => setTodoDone(id, desired), UNAVAILABLE);
      if (toggleSeqRef.current.get(id) !== seq) return; // 더 새 체크가 있다
      if (res.ok) {
        onChanged?.();
        return;
      }
      report(patchRows((list) => list.map((t) => (t.id === id ? { ...t, done: !desired } : t))));
      setMessage(TODO_TEXT.checkFailed);
    })();
  }

  function openForm() {
    setMessage("");
    flushSync(() => setFormOpen(true));
    inputRef.current?.focus();
  }

  async function submit() {
    if (addingRef.current) return; // 보내는 중 두 번째 누름은 무시(예전 방식)
    const raw = draftRef.current;
    const checked = checkTodoText(raw);
    if (!checked.ok) {
      setMessage(checked.error === "too_long" ? overLimitText(countTodoChars(raw)) : "");
      inputRef.current?.focus();
      return;
    }
    // 칩에 보이는 분야만 보낸다(할 일 탭과 같다). 고르지 않았으면 기타(null)
    const categoryId = selected && chips.some((c) => c.id === selected) ? selected : null;
    setMessage("");
    if (local) {
      // 할 일 탭과 같은 저장 함수, 같은 인자 꼴. 첫 누름에 칸을 비운다(연타하면 둘째부터 빈 칸이라 아무것도 안 만든다)
      local.addTodo({ id: crypto.randomUUID(), text: checked.text, categoryId });
      setDraft("");
      setSelected(null);
      const after = local.read();
      setRead(after);
      if (after.todos.ok) report(after.todos.data.todos);
      inputRef.current?.focus();
      return;
    }
    if (!navigator.onLine) {
      setMessage(TODO_TEXT.offlineHelp); // 글·고른 분야는 그대로 둔다
      inputRef.current?.focus();
      return;
    }
    const previous = pendingAddRef.current;
    const id = previous && previous.text === checked.text && previous.categoryId === categoryId ? previous.id : crypto.randomUUID();
    pendingAddRef.current = { id, text: checked.text, categoryId };
    addingRef.current = true;
    setAdding(true);
    // 할 일 탭과 같은 Server Action, 같은 인자 꼴(id, 글, 분야 번호)
    const res = await safely<TodoResult<AddedTodo>>(() => addTodo(id, checked.text, categoryId), UNAVAILABLE);
    addingRef.current = false;
    setAdding(false);
    if (!res.ok) {
      setMessage(TODO_TEXT.saveFailed);
      inputRef.current?.focus();
      return;
    }
    pendingAddRef.current = null;
    const added = res.data.todo;
    const sameDay = readRef.current?.todos.ok ? readRef.current.todos.data.day.date === res.data.day.date : true;
    const list = sameDay ? patchRows((l) => (l.some((t) => t.id === added.id) ? l : [...l, added])) : (readRef.current?.todos.ok ? readRef.current.todos.data.todos : []);
    report(list);
    setDraft("");
    setSelected(null);
    onChanged?.();
    inputRef.current?.focus();
  }

  function onFormSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault(); // 조합 중 엔터로 적지 않게 늘 막고, 조합 중이 아닐 때만 「적기」
    if (!composing(event)) void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || composing(event)) return;
    event.preventDefault();
    event.stopPropagation(); // 시트만 닫는다(아래 오늘 기록 창은 그대로)
    requestClose();
  }

  const offlineText = local ? TODO_TEXT.offlineLocal : TODO_TEXT.offline;
  const help = helpText(draft, false);
  const over = countTodoChars(draft) > TODO_TEXT_MAX_LENGTH;

  return (
    <div ref={rootRef} className="evening-todo-layer" onKeyDown={onKeyDown}>
      <div className="evening-todo-backdrop" aria-hidden="true" onClick={requestClose} />
      <div className="evening-todo-sheet" role="dialog" aria-modal="true" aria-labelledby="evening-todo-title">
        <div className="detail-head">
          <h2 id="evening-todo-title" className="detail-title" tabIndex={-1} ref={titleRef}>
            {EVENING_TODO_TEXT.title}
          </h2>
          <TextButton className="btn-flush-end" onClick={requestClose}>
            {EVENING_TODO_TEXT.close}
          </TextButton>
        </div>

        {!online && <Notice role="status">{offlineText}</Notice>}

        {read === null && (
          <p className="todo-sub" role="status">
            {EVENING_TODO_TEXT.loading}
          </p>
        )}
        {read !== null && !read.todos.ok && (
          <Notice role="alert" actions={<SecondaryButton onClick={reload}>{TODO_TEXT.reload}</SecondaryButton>}>
            {TODO_TEXT.loadFailed}
          </Notice>
        )}
        {read?.todos.ok && rows.length === 0 && <p className="todo-sub evening-todo-empty">{EVENING_TODO_TEXT.empty}</p>}
        {rows.length > 0 && (
          <ul className="todo-list evening-todo-list">
            {rows.map((row) => {
              const textId = `evening-todo-text-${row.id}`;
              const tagId = `evening-todo-tag-${row.id}`;
              const category = categoryOf(row.categoryId);
              return (
                <li key={row.id} className="todo-row" id={`evening-todo-row-${row.id}`}>
                  <label className="check-hit">
                    <input
                      type="checkbox"
                      checked={row.done}
                      onChange={() => toggle(row.id)}
                      aria-labelledby={textId}
                      aria-describedby={category ? tagId : undefined}
                    />
                    <span className="check-box" aria-hidden="true" />
                  </label>
                  <div className="todo-body">
                    <p id={textId} className={row.done ? "todo-text is-done" : "todo-text"}>
                      {row.readable ? row.text : TODO_TEXT.unreadable}
                    </p>
                    {category && (
                      <div className="evening-todo-category">
                        {category.color && <span className="evening-todo-dot" style={{ background: category.color }} aria-hidden="true" />}
                        <CategoryTag id={tagId} name={category.name} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {read?.todos.ok &&
          (formOpen ? (
            <form className="evening-todo-form" onSubmit={onFormSubmit} noValidate>
              {/* 보이는 이름표(흐린 안내 글만 쓰지 않는다, WCAG 3.3.2) */}
              <label htmlFor="evening-todo-input" className="input-label">
                {EVENING_TODO_TEXT.inputLabel}
              </label>
              <div className="input-row">
                {/* maxLength를 걸지 않는다: 몰래 자르지 않는다(할 일 탭과 같다). 길이는 서버가 다시 본다 */}
                <input
                  id="evening-todo-input"
                  ref={inputRef}
                  className="input"
                  type="text"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setMessage("");
                  }}
                  onKeyDown={onInputKeyDown}
                  aria-describedby="evening-todo-help"
                  aria-invalid={over ? true : undefined}
                  autoComplete="off"
                  enterKeyHint="send"
                />
                <PrimaryButton type="submit" className="add-btn" busy={adding}>
                  {adding ? EVENING_TODO_TEXT.saving : EVENING_TODO_TEXT.write}
                </PrimaryButton>
              </div>
              <p id="evening-todo-help" className="input-help">
                {help}
              </p>
              <span id="evening-todo-category-label" className="sheet-label sheet-category-label">
                {TODO_TEXT.categoryLabel}
              </span>
              <ChipScroller aria-labelledby="evening-todo-category-label">
                {chips.map((chip) => (
                  <CategoryChip key={chip.id} chip={chip} pressed={chip.id === selected} onToggle={(id) => setSelected((prev) => (prev === id ? null : id))} />
                ))}
              </ChipScroller>
            </form>
          ) : (
            <TextButton id="evening-todo-add" className="evening-todo-add" onClick={openForm}>
              {EVENING_TODO_TEXT.add}
            </TextButton>
          ))}

        <p className="cat-notice" role="status">
          {message}
        </p>
      </div>
      {confirmClose && <CloseConfirm onKeep={() => setConfirmClose(false)} onClose={onClose} />}
    </div>
  );
}
