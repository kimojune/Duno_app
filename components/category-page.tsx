"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { GrowthApi } from "../lib/growth-api";
import type { CategoryPageData } from "../lib/notes/types";
import { describeTodoDay } from "../lib/todos/day";
import { Notice, SecondaryButton, TextButton } from "./ui";
import { dayText } from "./todo-view";

/**
 * 분야 페이지(PRD 7-4, G13-a, ③). 상태보기에서 분야를 누르면 열린다.
 * 그 분야 할 일들의 작업 기록이 날짜별로 모이고, 그날 어떤 일을 했는지 보인다(끝낸 일은 「끝냄」 글로).
 * 기타를 누르면 분야 없는 할 일이 모인다. 화면이 그려지면 본 것을 한 번 남긴다(스스로 연 것, G8).
 * 모든 글은 React 텍스트로만 그린다.
 */

export const CATEGORY_PAGE_TEXT = {
  close: "닫기",
  loading: "분야 페이지를 불러오는 중",
  loadFailed: "분야 페이지를 불러오지 못했어요.",
  reload: "다시 불러오기",
  empty: "이 분야에 적은 할 일이 아직 없어요.",
  done: "끝냄",
  unreadable: "읽을 수 없는 할 일",
  unreadableNote: "읽을 수 없는 글",
  noNote: "작업 기록 없음",
} as const;

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; data: CategoryPageData };

function composing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export function CategoryPage({
  api,
  categoryId,
  name,
  onClose,
}: {
  api: GrowthApi;
  categoryId: string | null;
  name: string;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const recordedRef = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // 서버에서 읽는 일(바깥 시스템과 맞추기). 상태는 응답을 받은 뒤에만 바꾼다.
  useEffect(() => {
    let alive = true;
    void api.fetchCategoryPage(categoryId).then((res) => {
      if (alive) setLoad(res.ok ? { status: "ready", data: res.data } : { status: "error" });
    });
    return () => {
      alive = false;
    };
  }, [api, categoryId]);

  const ready = load.status === "ready";
  useEffect(() => {
    if (!ready || recordedRef.current) return;
    recordedRef.current = true;
    void api.recordView({ id: crypto.randomUUID(), screen: "category", entry: "self" });
  }, [api, ready]);

  function reload() {
    setLoad({ status: "loading" });
    void api.fetchCategoryPage(categoryId).then((res) => setLoad(res.ok ? { status: "ready", data: res.data } : { status: "error" }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !composing(event)) {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-labelledby="category-page-title" onKeyDown={onKeyDown}>
      <div className="detail-inner">
        <div className="detail-head">
          <h2 id="category-page-title" className="detail-title" tabIndex={-1} ref={titleRef}>
            {name}
          </h2>
          <TextButton className="btn-flush-end" onClick={onClose}>
            {CATEGORY_PAGE_TEXT.close}
          </TextButton>
        </div>

        {load.status === "loading" && (
          <p className="todo-sub" role="status">
            {CATEGORY_PAGE_TEXT.loading}
          </p>
        )}
        {load.status === "error" && (
          <Notice role="alert" actions={<SecondaryButton onClick={reload}>{CATEGORY_PAGE_TEXT.reload}</SecondaryButton>}>
            {CATEGORY_PAGE_TEXT.loadFailed}
          </Notice>
        )}
        {load.status === "ready" && load.data.days.length === 0 && <p className="todo-sub">{CATEGORY_PAGE_TEXT.empty}</p>}
        {load.status === "ready" &&
          load.data.days.map((day) => (
            <section key={day.day} className="detail-section" aria-label={dayText(describeTodoDay(day.day))}>
              <h3 className="detail-sub-title">{dayText(describeTodoDay(day.day))}</h3>
              <ul className="note-list">
                {day.todos.map((todo) => (
                  <li key={todo.id} className="note-item">
                    <p className="note-text">
                      {todo.text ?? CATEGORY_PAGE_TEXT.unreadable}
                      {todo.done && <span className="category-tag done-tag">{CATEGORY_PAGE_TEXT.done}</span>}
                    </p>
                    {todo.notes.length === 0 ? (
                      <p className="todo-sub">{CATEGORY_PAGE_TEXT.noNote}</p>
                    ) : (
                      <ul className="note-sublist">
                        {todo.notes.map((note) => (
                          <li key={note.id} className="note-text">
                            {note.readable ? note.text : CATEGORY_PAGE_TEXT.unreadableNote}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  );
}
