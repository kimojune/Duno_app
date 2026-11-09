"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ManageApi } from "../lib/manage-api";
import { describeTodoDay } from "../lib/todos/day";
import type { TodayTodos } from "../lib/todos/types";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { addDays } from "../lib/week";
import { dayText } from "./todo-view";
import { BackHeader } from "./back-header";
import { Notice, SecondaryButton } from "./ui";

/**
 * 지난 날 할 일 보기(보기만, 고침 3바퀴 PM 답 d-69 ⑦). 어제부터 하루씩 거슬러 가며 그날 적은 할 일과 끝냄 여부를 본다.
 * 앞날 적기는 없고(오늘 이후는 못 본다), 지난 날 것을 고치거나 끝냄 표시를 바꾸지도 못한다: 체크 칸·고치기 단추가 없다.
 * 모든 글은 React 텍스트로만 그린다. 새 화면 모양을 정하지 않고 분야 페이지(category-page)와 같은 틀을 쓴다.
 */

export const PAST_DAYS_TEXT = {
  open: "지난 날 보기",
  title: "지난 날",
  readOnly: "보기만 할 수 있어요.",
  older: "이전 날",
  newer: "다음 날",
  loading: "할 일을 불러오는 중",
  loadFailed: "할 일을 불러오지 못했어요.",
  reload: "다시 불러오기",
  empty: "그날 적은 할 일이 없어요.",
  done: "끝냄",
  unreadable: "읽을 수 없는 할 일",
} as const;

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; data: TodayTodos };

function composing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export function PastDays({ api, today, onClose }: { api: ManageApi; today: string; onClose: () => void }) {
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose);
  const yesterday = addDays(today, -1);
  const [date, setDate] = useState(yesterday);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // 서버에서 읽는 일(바깥 시스템과 맞추기). 상태는 응답을 받은 뒤에만 바꾼다.
  useEffect(() => {
    let alive = true;
    const read = api.fetchDay;
    if (!read) return;
    void read.call(api, date).then((res) => {
      if (alive) setLoad(res.ok ? { status: "ready", data: res.data } : { status: "error" });
    });
    return () => {
      alive = false;
    };
  }, [api, date]);

  function go(next: string) {
    setLoad({ status: "loading" });
    setDate(next);
  }
  function reload() {
    setLoad({ status: "loading" });
    void api.fetchDay?.(date).then((res) => setLoad(res.ok ? { status: "ready", data: res.data } : { status: "error" }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !composing(event)) {
      event.preventDefault();
      onClose();
    }
  }

  const label = dayText(describeTodoDay(date));
  const isNewest = date >= yesterday;

  return (
    <div ref={rootRef} className="detail" role="dialog" aria-modal="true" aria-labelledby="past-days-title" onKeyDown={onKeyDown}>
      <div className="detail-inner">
        {/* 고침10 A(146:10 · 148:56): 왼쪽 위 머리 단추 「‹」(이전). 오른쪽 위 글 「닫기」는 없다 */}
        <BackHeader onBack={onClose} />
        <div className="detail-head">
          <h2 id="past-days-title" className="detail-title" tabIndex={-1} ref={titleRef}>
            {PAST_DAYS_TEXT.title}
          </h2>
        </div>
        <p className="todo-sub">{PAST_DAYS_TEXT.readOnly}</p>

        <div className="detail-actions">
          <SecondaryButton onClick={() => go(addDays(date, -1))}>{PAST_DAYS_TEXT.older}</SecondaryButton>
          <SecondaryButton disabled={isNewest} onClick={() => go(addDays(date, 1))}>
            {PAST_DAYS_TEXT.newer}
          </SecondaryButton>
        </div>
        <h3 className="detail-sub-title">{label}</h3>

        {load.status === "loading" && (
          <p className="todo-sub" role="status">
            {PAST_DAYS_TEXT.loading}
          </p>
        )}
        {load.status === "error" && (
          <Notice role="alert" actions={<SecondaryButton onClick={reload}>{PAST_DAYS_TEXT.reload}</SecondaryButton>}>
            {PAST_DAYS_TEXT.loadFailed}
          </Notice>
        )}
        {load.status === "ready" && load.data.todos.length === 0 && <p className="todo-sub">{PAST_DAYS_TEXT.empty}</p>}
        {load.status === "ready" && load.data.todos.length > 0 && (
          <ul className="note-list" aria-label={label}>
            {load.data.todos.map((todo) => (
              <li key={todo.id} className="note-item">
                <p className="note-text">
                  {todo.readable ? todo.text : PAST_DAYS_TEXT.unreadable}
                  {todo.done && <span className="category-tag done-tag">{PAST_DAYS_TEXT.done}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
