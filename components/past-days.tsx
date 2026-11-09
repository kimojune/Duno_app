"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ManageApi } from "../lib/manage-api";
import { formatMinutes } from "../lib/time-format";
import { describeTodoDay } from "../lib/todos/day";
import type { TodayTodos } from "../lib/todos/types";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { addDays } from "../lib/week";
import { dayText } from "./todo-view";
import { BackHeader } from "./back-header";
import { Notice, SecondaryButton } from "./ui";

/**
 * 지난 날 할 일 보기(보기만, 고침 3바퀴 PM 답 d-69 ⑦ · 고침10 PM d-173 · d-174 ①). 어제부터 하루씩 거슬러 가며 그날 적은 할 일과 끝냄 여부를 본다.
 * 앞날 적기는 없고(오늘 이후는 못 본다), 지난 날 것을 고치거나 끝냄 표시를 바꾸지도 못한다: 누를 수 있는 것이 할 일 카드 안에 하나도 없다
 * (끝냄 = 채운 원, 안 끝냄 = 빈 원 — 그림일 뿐 체크 칸이 아니다 · 「›」 없음). 「보기만 할 수 있어요.」 글은 두지 않는다.
 * 고침10 W2b(Figma 148:56 · 148:95): 머리 「‹」 → 이름표 「지난 날」(14 Medium 보조색) → 날짜 24 Bold + 오른쪽 원 단추 「‹」「›」(보이는 32 · 누름 48,
 * 「이전 날」「다음 날」, 어제에서는 「›」 막힘) → 할 일 카드(빈 날 = 카드 안 「할 일 0개」) → 「이날 기록」 카드(그날 합계 숫자만).
 * 모든 글은 React 텍스트로만 그린다.
 */

export const PAST_DAYS_TEXT = {
  open: "지난 날 보기",
  title: "지난 날",
  older: "이전 날",
  newer: "다음 날",
  loading: "할 일을 불러오는 중",
  loadFailed: "할 일을 불러오지 못했어요.",
  reload: "다시 불러오기",
  empty: "할 일 0개",
  done: "끝냄",
  notDone: "안 끝냄",
  recordTitle: "이날 기록",
  /** 읽지 못했거나 읽을 수 있는 범위(오늘 기록은 7일) 밖: 「–」, 화면 읽기 이름 */
  recordUnknown: "알 수 없음",
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
  /** 이날 기록의 합계(분). null = 읽는 중, 기록이 없으면 0 */
  const [record, setRecord] = useState<number | "unknown" | null>(null);
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

  // 이날 기록 합계(있으면). 읽지 못해도 할 일 보기는 그대로 — 합계만 0으로 둔다
  useEffect(() => {
    let alive = true;
    const read = api.fetchDayRecord;
    if (!read) {
      void Promise.resolve().then(() => {
        if (alive) setRecord("unknown");
      });
      return () => {
        alive = false;
      };
    }
    void read.call(api, date).then((res) => {
      if (alive) setRecord(res.ok ? (res.data.totalMinutes ?? 0) : "unknown"); // 읽기 실패·범위 밖은 거짓 「0분」이 아니라 「–」
    });
    return () => {
      alive = false;
    };
  }, [api, date]);

  function go(next: string) {
    setLoad({ status: "loading" });
    setRecord(null);
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
        {/* 이름표 「지난 날」(14 Medium 보조색, 창 이름) → 날짜 24 Bold + 오른쪽 원 단추 둘 */}
        <h2 id="past-days-title" className="past-title" tabIndex={-1} ref={titleRef}>
          {PAST_DAYS_TEXT.title}
        </h2>
        <div className="past-date-row">
          <h3 className="past-date">{label}</h3>
          <div className="past-nav">
            <button type="button" className="step-btn" aria-label={PAST_DAYS_TEXT.older} onClick={() => go(addDays(date, -1))}>
              <span className="step-btn-face" aria-hidden="true">
                ‹
              </span>
            </button>
            <button type="button" className="step-btn" aria-label={PAST_DAYS_TEXT.newer} disabled={isNewest} onClick={() => go(addDays(date, 1))}>
              <span className="step-btn-face" aria-hidden="true">
                ›
              </span>
            </button>
          </div>
        </div>

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
        {load.status === "ready" && load.data.todos.length === 0 && (
          <div className="card-box past-card">
            <p className="todo-sub past-empty">{PAST_DAYS_TEXT.empty}</p>
          </div>
        )}
        {load.status === "ready" && load.data.todos.length > 0 && (
          // 보기만: 이 카드 안에는 단추·링크·체크 칸이 하나도 없다(끝냄 = 채운 원, 안 끝냄 = 빈 원은 그림)
          <ul className="past-card past-todos" aria-label={label}>
            {load.data.todos.map((todo) => (
              <li key={todo.id} className="past-todo">
                <span className={todo.done ? "past-dot is-done" : "past-dot"} aria-hidden="true" />
                <span className="sr-only">{todo.done ? PAST_DAYS_TEXT.done : PAST_DAYS_TEXT.notDone}: </span>
                <span className="past-todo-text">{todo.readable ? todo.text : PAST_DAYS_TEXT.unreadable}</span>
              </li>
            ))}
          </ul>
        )}
        {/* 이날 기록 카드 = 그날 합계 숫자만 */}
        {load.status === "ready" && record !== null && (
          <section className="card-box past-record" aria-labelledby="past-record-title">
            <h3 id="past-record-title" className="past-record-title">
              {PAST_DAYS_TEXT.recordTitle}
            </h3>
            {record === "unknown" ? (
              <p className="past-record-total" aria-label={PAST_DAYS_TEXT.recordUnknown}>
                –
              </p>
            ) : (
              <p className="past-record-total">{formatMinutes(record)}</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
