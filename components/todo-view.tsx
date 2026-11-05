"use client";

import type { FormEvent, ReactNode, RefObject } from "react";
import { countTodoChars, TODO_TEXT_MAX_LENGTH } from "../lib/todos/validation";
import type { TodoDay } from "../lib/todos/types";
import { LiveRegion, Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";

/**
 * 할 일 화면의 그리는 쪽(상태를 받아 그리기만 한다). 진짜 화면(todo-screen.tsx)과
 * 개발용 상태 모음 화면이 같은 컴포넌트를 쓴다. 서버 전용 모듈은 가져오지 않는다.
 * 할 일 글은 항상 React 텍스트로만 넣는다(innerHTML 없음).
 */

export const TODO_TEXT = {
  title: "오늘",
  logout: "로그아웃",
  label: "할 일 적기",
  add: "적기",
  unreadable: "읽을 수 없는 할 일", // (임시)
  empty1: "오늘 적은 할 일이 없어요.",
  emptyA: "아래 칸에 적어 보세요.",
  emptyB: "위 칸에 적어 보세요.",
  saving: "저장하는 중",
  saveFailed: "저장하지 못했어요.",
  retry: "다시",
  remove: "빼기",
  checkFailed: "체크를 바꾸지 못했어요. 다시 눌러 주세요.",
  loadFailed: "할 일을 불러오지 못했어요.",
  reload: "다시 불러오기",
  offline: "인터넷 연결이 끊겼어요. 연결되면 적고 체크할 수 있어요.",
  offlineHelp: "인터넷에 연결되면 적을 수 있어요. 적은 글은 그대로 있어요.",
  sessionUnsaved:
    "로그인이 풀렸어요. 다시 로그인하면 이 화면을 떠나서, 아직 저장되지 않은 글은 사라져요. 필요하면 먼저 복사해 두세요.",
  sessionPlain: "로그인이 풀렸어요. 다시 로그인해 주세요.",
  copy: "저장 안 된 글 복사",
  relogin: "다시 로그인",
  logoutConfirm: "아직 저장되지 않은 글이 있어요. 로그아웃하면 이 글은 사라져요.",
  cancel: "취소",
  liveLoading: "할 일을 불러오는 중",
  liveSaving: "할 일을 저장하는 중",
  liveSaved: "할 일을 저장했어요",
  liveCopied: "복사했어요",
  liveCopyFailed: "복사하지 못했어요", // (임시)
} as const;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function dayText(day: TodoDay): string {
  return `${day.month}월 ${day.dayOfMonth}일 ${WEEKDAYS[day.weekday]}요일`;
}

export function loadedText(count: number): string {
  return `할 일 ${count}개를 불러왔어요`;
}

export function overLimitText(count: number): string {
  return `${TODO_TEXT_MAX_LENGTH}자까지 적을 수 있어요. 지금 ${count}자예요.`;
}

/** 입력 칸 아래 도움말: 넘음 > 오프라인 > 180자부터 셈 */
export function helpText(draft: string, offlineHelp: boolean): string {
  const count = countTodoChars(draft);
  if (count > TODO_TEXT_MAX_LENGTH) return overLimitText(count);
  if (offlineHelp) return TODO_TEXT.offlineHelp;
  if (count >= 180) return `${count}/${TODO_TEXT_MAX_LENGTH}`;
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
  checkFailed: boolean;
};

export type TodoViewProps = {
  direction: "A" | "B";
  day: TodoDay | null;
  /** locked: 첫 불러오기부터 로그인이 풀려, 목록·빈 문구·개수를 그리지 않는다(T13c) */
  list: "loading" | "ready" | "error" | "locked";
  rows: RowView[]; // 적은 순서(오래된 것이 앞). B는 거꾸로 그린다
  draft: string;
  online: boolean;
  offlineHelp: boolean;
  sessionLost: boolean;
  hasUnsaved: boolean;
  logoutConfirm: boolean;
  live: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onToggle: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onReload: () => void;
  onLogout: () => void;
  onLogoutConfirm: () => void;
  onLogoutCancel: () => void;
  onCopy: () => void;
  onRelogin: () => void;
};

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

function Row({
  row,
  onToggle,
  onRetry,
  onRemove,
}: { row: RowView } & Pick<TodoViewProps, "onToggle" | "onRetry" | "onRemove">) {
  const textId = `todo-text-${row.id}`;
  const statusId = `todo-status-${row.id}`;
  // 저장 중·저장 못 한 줄은 서버에 아직 없다: 체크 칸은 보이되 눌러도 바뀌지 않고, 그 줄의 안내에 잇는다
  const notSaved = row.saving || row.failed;
  return (
    <li className="todo-row" id={`row-${row.id}`}>
      <label className="check-hit">
        <input
          type="checkbox"
          checked={row.done}
          onChange={() => onToggle(row.id)}
          aria-labelledby={textId}
          aria-disabled={notSaved ? "true" : undefined}
          aria-describedby={notSaved ? statusId : undefined}
        />
        <span className="check-box" aria-hidden="true" />
      </label>
      <div className="todo-body">
        <p id={textId} className={row.done ? "todo-text is-done" : "todo-text"}>
          {row.text ?? TODO_TEXT.unreadable}
        </p>
        {/* 늘 그린다(체크 칸 aria-describedby가 가리킨다). 처음 SAVING_HINT_DELAY_MS 동안은 화면 읽기용으로만 있다 */}
        {row.saving && (
          <p id={statusId} className={row.savingSlow ? "todo-sub" : "todo-sub sr-only"}>
            {TODO_TEXT.saving}
          </p>
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
    </li>
  );
}

function InputBar({
  draft,
  offlineHelp,
  inputRef,
  onDraftChange,
  onSubmit,
}: Pick<TodoViewProps, "draft" | "offlineHelp" | "inputRef" | "onDraftChange" | "onSubmit">) {
  const help = helpText(draft, offlineHelp);
  const over = countTodoChars(draft) > TODO_TEXT_MAX_LENGTH;
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <form className="input-bar" onSubmit={submit} noValidate>
      <label htmlFor="todo-input" className="input-label">
        {TODO_TEXT.label}
      </label>
      <div className="input-row">
        {/* maxLength를 걸지 않는다: 붙여 넣은 글을 몰래 자르지 않는다(T11) */}
        <input
          id="todo-input"
          ref={inputRef}
          className="input"
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
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
    </form>
  );
}

export function TodoView(props: TodoViewProps) {
  const { direction, day, list, rows, online, sessionLost, hasUnsaved, logoutConfirm } = props;
  const doneCount = rows.filter((r) => r.done).length;
  const dateLine = day ? `${dayText(day)}${list === "ready" ? ` · ${rows.length}개 중 ${doneCount}개 끝냄` : ""}` : "";
  const shown = direction === "B" ? [...rows].reverse() : rows;

  const header = (
    <header className="today-header">
      <div>
        <h1 className="today-title">{TODO_TEXT.title}</h1>
        <p className="today-date">{dateLine}</p>
      </div>
      <TextButton id="logout-button" onClick={props.onLogout}>{TODO_TEXT.logout}</TextButton>
    </header>
  );
  const bar = (
    <InputBar
      draft={props.draft}
      offlineHelp={props.offlineHelp}
      inputRef={props.inputRef}
      onDraftChange={props.onDraftChange}
      onSubmit={props.onSubmit}
    />
  );

  const notices: ReactNode[] = [];
  if (!online) {
    notices.push(
      <Notice key="offline" role="status">
        {TODO_TEXT.offline}
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
        {TODO_TEXT.logoutConfirm}
      </Notice>,
    );
  }

  return (
    <div className={direction === "B" ? "todo-app dir-b" : "todo-app dir-a"}>
      {direction === "B" ? (
        <div className="sticky-top">
          {header}
          {bar}
        </div>
      ) : (
        header
      )}
      {notices.length > 0 && <div className="notices">{notices}</div>}
      <main className="todo-main" aria-busy={list === "loading"}>
        {list === "loading" && <Skeleton />}
        {list === "error" && (
          <Notice role="alert" actions={<SecondaryButton onClick={props.onReload}>{TODO_TEXT.reload}</SecondaryButton>}>
            {TODO_TEXT.loadFailed}
          </Notice>
        )}
        {list === "ready" && rows.length === 0 && (
          <div className="todo-empty">
            <p>{TODO_TEXT.empty1}</p>
            <p>{direction === "B" ? TODO_TEXT.emptyB : TODO_TEXT.emptyA}</p>
          </div>
        )}
        {shown.length > 0 && (
          <ul className="todo-list">
            {shown.map((row) => (
              <Row key={row.id} row={row} onToggle={props.onToggle} onRetry={props.onRetry} onRemove={props.onRemove} />
            ))}
          </ul>
        )}
      </main>
      {direction === "A" && bar}
      <LiveRegion message={props.live} />
    </div>
  );
}
