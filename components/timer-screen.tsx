"use client";

import { useEffect, useRef, useState } from "react";
import { APP_CONFIG } from "../lib/app-config";
import type { FocusApi } from "../lib/focus-api";
import { remainingSeconds, sessionMinutes } from "../lib/focus/logic";
import type { FocusSession, FocusSurface } from "../lib/focus/types";
import type { TodayRead } from "../lib/today-types";
import { formatMinutes, formatTimer } from "../lib/time-format";
import { useOnline } from "../lib/use-online";
import { ChipScroller } from "./chip-scroller";
import { Notice, PrimaryButton, SecondaryButton } from "./ui";

/**
 * 타이머 탭(PRD 7-6, ④). 타이머는 할 일마다 붙이지 않고 따로 된 기능이다(D-103). 들어가는 길은 둘: 「오늘 먼저 할 일」 카드의 「30분 시작」(⑤)과 이 탭.
 * - 시작하는 순간 먼저 한 기록이 남는다(5분 하고 끝내도, 건넨 것이 아닌 할 일로 켜도). 반대편 여부 둘은 서버가 정한다.
 * - 이 탭에서는 오늘 적은(끝내지 않은) 할 일 가운데 골라 시작하거나, 할 일 없이 분야만 골라 시작한다. 앱의 추천(⑤)은 맨 앞에 놓인다.
 * - 도는 동안 다른 탭을 보고 와도 남은 시간이 이어진다(탭을 지우지 않고 숨긴다). 서버 시각과 기기 시계의 차이를 맞춰 센다.
 * - 정한 길이(30분)가 지나면 「30분이 지났어요」만 알린다(재촉·평가 없음). 끝내기를 누르면 진행한 시간이 남는다.
 * - 오늘 시작한 기록 줄은 숫자만 보인다(예: 「타이머 · 어학 12분」). 「중간에 멈춤」 같은 말은 없다(D-114).
 * 연결이 끊기면 시작하지 않고 안내한다(이번 범위는 할 일만 오프라인). 모든 글은 React 텍스트로만 그린다.
 */

export const TIMER_TEXT = {
  title: "타이머",
  chooseHeading: "무엇을 할까요?",
  todoGroup: "오늘 할 일",
  noTodo: "할 일 없이 시작",
  categoryGroup: "분야 (고르지 않으면 기타)",
  other: "기타",
  start: (m: number) => `${m}분 시작`,
  starting: "시작하는 중",
  end: "끝내기",
  ending: "끝내는 중",
  running: (m: number) => `${m}분 타이머가 돌고 있어요`,
  started: (m: number) => `${m}분 타이머를 시작했어요`,
  over: (m: number) => `${m}분이 지났어요`,
  startFailed: "시작하지 못했어요. 다시 눌러 주세요.",
  alreadyRunning: "이미 타이머가 돌고 있어요.",
  endFailed: "끝내지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 시작할 수 있어요.",
  todosFailed: "오늘 할 일을 불러오지 못했어요. 할 일 없이 시작할 수 있어요.",
  recordsHeading: "오늘 시작한 타이머",
  noRecords: "아직 없어요",
  loadFailed: "타이머를 불러오지 못했어요.",
  reload: "다시 불러오기",
  unreadable: "읽을 수 없는 할 일",
} as const;

type Entry = { id: string; name: string };
type TodoOption = { id: string; text: string; categoryId: string | null };
type Choice = { kind: "todo"; id: string } | { kind: "none" };

export type ActiveTimer = { session: FocusSession; offsetMs: number };

function startedMs(session: FocusSession): number {
  const ms = Date.parse(session.startedAt);
  return Number.isFinite(ms) ? ms : 0;
}

export function TimerScreen({
  api,
  fetchToday,
  active,
  activation,
  now = Date.now,
  onActiveChange,
  recommended,
}: {
  api: FocusApi;
  fetchToday: () => Promise<TodayRead>;
  /** 이 탭이 지금 보이는가 */
  active: boolean;
  /** 탭을 열 때마다 하나씩 커지는 값(열 때마다 다시 읽는다) */
  activation: number;
  now?: () => number;
  /** 진행 중인 타이머가 바뀔 때(시작·끝냄·불러옴) 알린다 */
  onActiveChange?: (session: FocusSession | null) => void;
  /** 앱의 추천(⑤): 있으면 목록 맨 앞에 놓고 처음에 골라 둔다 */
  recommended?: { offerId: string | null; todoId: string | null; categoryId: string | null; label: string } | null;
}) {
  // 기기 먼저 저장(api.localFirst)이면 끊겨 있어도 시작·끝내기를 막지 않는다(기기에 먼저 적고 서버에는 뒤에서 보낸다)
  const online = useOnline() || api.localFirst === true;
  const [load, setLoad] = useState<"loading" | "error" | "ready">("loading");
  const [running, setRunning] = useState<ActiveTimer | null>(null);
  const [today, setToday] = useState<FocusSession[]>([]);
  const [todos, setTodos] = useState<TodoOption[]>([]);
  const [categories, setCategories] = useState<Entry[]>([]);
  const [todosFailed, setTodosFailed] = useState(false);
  // 사용자가 고른 것(null이면 아직 안 골랐다: 처음 고름을 따른다)
  const [choice, setChoice] = useState<Choice | null>(null);
  // 할 일 없이 시작할 때 고른 분야(undefined면 아직 안 골랐다: 앱의 추천 분야, 없으면 기타)
  const [pickedCategory, setPickedCategory] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState<"start" | "end" | null>(null);
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const startKeyRef = useRef<{ key: string; id: string } | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  // 탭이 보일 때마다 서버에서 다시 읽는다(바깥 시스템과 맞추기). 상태는 응답을 받은 뒤에만 바꾼다.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void Promise.all([api.fetchState(), fetchToday()]).then(([focus, read]) => {
      if (!alive) return;
      if (focus.ok) {
        const offsetMs = Date.parse(focus.data.serverNow) - now();
        const current = focus.data.active ? { session: focus.data.active, offsetMs } : null;
        setRunning(current);
        setToday(focus.data.today);
        setLoad("ready");
        onActiveChange?.(current?.session ?? null);
      } else {
        setLoad((prev) => (prev === "ready" ? prev : "error"));
      }
      if (read.todos.ok) {
        setTodosFailed(false);
        setTodos(
          read.todos.data.todos.flatMap((t) => (t.done ? [] : [{ id: t.id, text: t.readable ? t.text : TIMER_TEXT.unreadable, categoryId: t.categoryId }])),
        );
      } else {
        setTodosFailed(true);
      }
      if (read.categories.ok) {
        setCategories(read.categories.data.categories.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name }] : [])));
      }
    });
    return () => {
      alive = false;
    };
    // onActiveChange·now는 바뀌어도 다시 읽지 않는다(탭을 열 때만 읽는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, fetchToday, active, activation]);

  // 도는 동안 1초마다 남은 시간을 다시 그린다(보이는 탭에서만)
  const isRunning = running !== null;
  useEffect(() => {
    if (!isRunning || !active) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [isRunning, active]);
  void tick;

  // 처음 고름: 추천이 있으면 그 할 일, 없으면 첫 할 일. 사용자가 고른 뒤에는 건드리지 않는다
  const defaultChoice: Choice = (() => {
    if (recommended?.todoId && todos.some((t) => t.id === recommended.todoId)) return { kind: "todo", id: recommended.todoId };
    // 분야만 추천했으면 「할 일 없이 시작」과 그 분야가 처음에 골라져 있다
    if (recommended && recommended.todoId === null) return { kind: "none" };
    if (todos.length > 0) return { kind: "todo", id: todos[0].id };
    return { kind: "none" };
  })();
  const effectiveChoice: Choice = choice && (choice.kind === "none" || todos.some((t) => t.id === choice.id)) ? choice : defaultChoice;

  const noneCategory: string | null = pickedCategory !== undefined ? pickedCategory : (recommended && recommended.todoId === null ? recommended.categoryId : null);
  const setNoneCategory = (id: string | null) => setPickedCategory(id);
  const nameOf = (id: string | null) => (id === null ? TIMER_TEXT.other : (categories.find((c) => c.id === id)?.name ?? TIMER_TEXT.other));

  function pick(next: Choice) {
    setChoice(next);
    setMessage("");
  }

  async function start() {
    if (busy || running) return;
    if (!online) {
      setMessage(TIMER_TEXT.offline);
      return;
    }
    const todo = effectiveChoice.kind === "todo" ? todos.find((t) => t.id === effectiveChoice.id) : undefined;
    const categoryId = todo ? todo.categoryId : noneCategory;
    // 앱의 추천 그대로 켠 것인가: 추천한 할 일을 골랐거나, 할 일 없이 추천한 분야로 켰다
    const fromRecommendation =
      !!recommended &&
      (todo !== undefined ? recommended.todoId === todo.id : recommended.todoId === null && categoryId === recommended.categoryId);
    const surface: FocusSurface = fromRecommendation ? "timer_tab" : "manual";
    const offerId = fromRecommendation ? (recommended?.offerId ?? null) : null;
    // 같은 고름으로 다시 누르면 같은 id(서버가 한 번만 만든다)
    const key = JSON.stringify([todo?.id ?? null, categoryId, surface, offerId]);
    const id = startKeyRef.current?.key === key ? startKeyRef.current.id : crypto.randomUUID();
    startKeyRef.current = { key, id };
    setBusy("start");
    setMessage("");
    const res = await api.start({ id, todoId: todo?.id ?? null, categoryId, offerId, surface, clientStartedAt: new Date(now()).toISOString() });
    setBusy(null);
    if (res.ok) {
      const current = { session: res.data.session, offsetMs: Date.parse(res.data.serverNow) - now() };
      setRunning(current);
      setToday((prev) => (prev.some((s) => s.id === current.session.id) ? prev : [...prev, current.session]));
      setMessage(TIMER_TEXT.started(current.session.plannedMinutes));
      onActiveChange?.(current.session);
      startKeyRef.current = null;
    } else if (res.error === "already_running") {
      // 다른 화면에서 이미 켠 타이머가 있다(B3): 시작을 반복하게 두지 않고 도는 타이머를 불러와 보여 준다
      startKeyRef.current = null;
      setMessage(TIMER_TEXT.alreadyRunning);
      reload();
    } else {
      setMessage(TIMER_TEXT.startFailed);
    }
  }

  async function end() {
    if (busy || !running) return;
    setBusy("end");
    setMessage("");
    const res = await api.end(running.session.id);
    setBusy(null);
    if (res.ok) {
      const ended = res.data.session;
      // 오늘 목록에 있으면 바꾸고, 없으면(어제 시작해 새벽 4시를 넘겨 끝낸 것) 끝에 붙인다
      setToday((prev) => (prev.some((s) => s.id === ended.id) ? prev.map((s) => (s.id === ended.id ? ended : s)) : [...prev, ended]));
      setRunning(null);
      onActiveChange?.(null);
      titleRef.current?.focus();
    } else {
      setMessage(TIMER_TEXT.endFailed);
    }
  }

  function reload() {
    setLoad("loading");
    void api.fetchState().then((focus) => {
      if (!focus.ok) {
        setLoad("error");
        return;
      }
      const current = focus.data.active ? { session: focus.data.active, offsetMs: Date.parse(focus.data.serverNow) - now() } : null;
      setRunning(current);
      setToday(focus.data.today);
      setLoad("ready");
      onActiveChange?.(current?.session ?? null);
    });
  }

  const remaining = running ? remainingSeconds(startedMs(running.session), now() + running.offsetMs, running.session.plannedMinutes) : 0;
  const runningTodo = running?.session.todoId ? todos.find((t) => t.id === running.session.todoId) : undefined;
  const runningLabel = runningTodo ? runningTodo.text : nameOf(running?.session.categoryId ?? null);
  const ended = today.filter((s) => s.endedAt !== null);

  return (
    <section className="timer" aria-labelledby="timer-title">
      <header className="today-header">
        <div>
          <h1 id="timer-title" className="today-title" tabIndex={-1} ref={titleRef}>
            {TIMER_TEXT.title}
          </h1>
        </div>
      </header>
      <div className="growth-body">
        {load === "loading" && (
          <p className="todo-sub" role="status">
            불러오는 중
          </p>
        )}
        {load === "error" && (
          <Notice role="alert" actions={<SecondaryButton onClick={reload}>{TIMER_TEXT.reload}</SecondaryButton>}>
            {TIMER_TEXT.loadFailed}
          </Notice>
        )}
        {!online && <Notice role="status">{TIMER_TEXT.offline}</Notice>}

        {load === "ready" && running && (
          <div className="timer-running">
            <p className="timer-label">{runningLabel}</p>
            <p className="timer-clock" role="timer" aria-label={TIMER_TEXT.running(running.session.plannedMinutes)}>
              {formatTimer(remaining)}
            </p>
            {remaining === 0 && (
              <p className="todo-sub" role="status">
                {TIMER_TEXT.over(running.session.plannedMinutes)}
              </p>
            )}
            <div className="detail-actions">
              <PrimaryButton busy={busy === "end"} disabled={busy !== null} onClick={() => void end()}>
                {busy === "end" ? TIMER_TEXT.ending : TIMER_TEXT.end}
              </PrimaryButton>
            </div>
          </div>
        )}

        {load === "ready" && !running && (
          <div className="timer-choose">
            <h2 className="growth-sub-title">{TIMER_TEXT.chooseHeading}</h2>
            {todosFailed && <p className="todo-sub">{TIMER_TEXT.todosFailed}</p>}
            <fieldset className="timer-fieldset">
              <legend className="sr-only">{TIMER_TEXT.todoGroup}</legend>
              {recommended && recommended.todoId === null && (
                <p className="todo-sub" role="note">
                  {recommended.label}
                </p>
              )}
              {todos.map((t) => (
                <label key={t.id} className="timer-option">
                  <input
                    type="radio"
                    name="timer-choice"
                    checked={effectiveChoice.kind === "todo" && effectiveChoice.id === t.id}
                    onChange={() => pick({ kind: "todo", id: t.id })}
                  />
                  <span className="timer-option-text">
                    {t.text}
                    {t.categoryId && <span className="category-tag done-tag">{nameOf(t.categoryId)}</span>}
                    {recommended?.todoId === t.id && <span className="category-tag done-tag">{recommended.label}</span>}
                  </span>
                </label>
              ))}
              <label className="timer-option">
                <input type="radio" name="timer-choice" checked={effectiveChoice.kind === "none"} onChange={() => pick({ kind: "none" })} />
                <span className="timer-option-text">{TIMER_TEXT.noTodo}</span>
              </label>
            </fieldset>
            {effectiveChoice.kind === "none" && (
              <ChipScroller aria-label={TIMER_TEXT.categoryGroup}>
                <button type="button" className="chip" aria-pressed={noneCategory === null} onClick={() => setNoneCategory(null)}>
                  <span className="chip-face">
                    <span className="chip-label">{TIMER_TEXT.other}</span>
                  </span>
                </button>
                {categories.map((c) => (
                  <button key={c.id} type="button" className="chip" aria-pressed={noneCategory === c.id} onClick={() => setNoneCategory(c.id)}>
                    <span className="chip-face">
                      <span className="chip-label">{c.name}</span>
                    </span>
                  </button>
                ))}
              </ChipScroller>
            )}
            <div className="detail-actions">
              <PrimaryButton busy={busy === "start"} disabled={busy !== null} onClick={() => void start()}>
                {busy === "start" ? TIMER_TEXT.starting : TIMER_TEXT.start(APP_CONFIG.timerMinutes)}
              </PrimaryButton>
            </div>
          </div>
        )}

        <p className="input-help" role="status">
          {message}
        </p>

        {load === "ready" && (
          <section aria-labelledby="timer-records-title">
            <h2 id="timer-records-title" className="growth-sub-title">
              {TIMER_TEXT.recordsHeading}
            </h2>
            {ended.length === 0 ? (
              <p className="todo-sub">{TIMER_TEXT.noRecords}</p>
            ) : (
              <ul className="growth-short">
                {ended.map((s) => (
                  <li key={s.id}>{`타이머 · ${nameOf(s.categoryId)} ${formatMinutes(sessionMinutes(s, now()))}`}</li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
