"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "../app/actions";
import { addTodo, getTodayTodos, setTodoDone } from "../app/todos/actions";
import { describeTodoDay, todoDayFor } from "../lib/todos/day";
import type { TodoDay, TodoItem, TodoResult } from "../lib/todos/types";
import { checkTodoText, countTodoChars } from "../lib/todos/validation";
import { useAnnouncer } from "../lib/use-announcer";
import { useOnline } from "../lib/use-online";
import { loadedText, overLimitText, TODO_TEXT, TodoView, type RowView } from "./todo-view";

/**
 * 할 일 화면의 진짜 동작. 서버 쪽 함수는 Server Action(app/todos/actions.ts)만 부른다.
 * 클라이언트는 user_id·날짜를 보내지 않는다. 브라우저 Supabase 클라이언트로 todos를 직접 읽고 쓰지 않는다.
 * 저장 전 글은 기기에 두지 않는다(D6): localStorage·sessionStorage·IndexedDB·서비스 워커 캐시 없음.
 */

type LocalRow = {
  id: string;
  text: string | null;
  done: boolean;
  status: "saved" | "saving" | "failed";
  /** 저장이 오래 걸리는 중(SAVING_HINT_DELAY_MS 지남) */
  slow?: boolean;
  checkFailed: boolean;
};

function fromItem(item: TodoItem): LocalRow {
  return { id: item.id, text: item.readable ? item.text : null, done: item.done, status: "saved", checkFailed: false };
}

/** 지금 시각 다음에 오는 서울 새벽 4시(= UTC 19:00)까지 남은 밀리초 */
function msUntilNextDayStart(now: number): number {
  const next = new Date(now);
  next.setUTCHours(19, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now;
}

/** (임시) 저장 요청이 이 시간 안에 답이 없으면 그 줄을 「저장하지 못했어요」로 바꾼다 */
export const SAVE_TIMEOUT_MS = 15_000;
/** (임시) 저장이 이 시간을 넘겨 걸릴 때만 「저장하는 중」을 눈에 보이게 한다(그 전에는 화면 읽기용으로만 있다) */
export const SAVING_HINT_DELAY_MS = 1000;

async function safely<T>(call: () => Promise<TodoResult<T>>): Promise<TodoResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export function TodoScreen({ direction = "A" }: { direction?: "A" | "B" }) {
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [list, setList] = useState<"loading" | "ready" | "error" | "locked">("loading");
  // 머리 날짜는 목록을 받기 전에도 보인다. 화면과 서버가 같은 순수 함수(todoDayFor)를 쓴다.
  const [day, setDay] = useState<TodoDay | null>(() => describeTodoDay(todoDayFor(new Date())));
  const [draft, setDraft] = useState("");
  const [offlineHelp, setOfflineHelp] = useState(false);
  const [sessionLost, setSessionLost] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [live, announce] = useAnnouncer(TODO_TEXT.liveLoading);
  const online = useOnline();
  const router = useRouter(); // 다시 로그인: 서버가 세션을 다시 보고 로그인 화면을 그린다

  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowsRef = useRef<LocalRow[]>([]);
  const draftRef = useRef("");
  const loadedRef = useRef(false);
  const loadSeqRef = useRef(0);
  /** 줄마다 마지막으로 보낸 체크 순번(D5: 마지막 값이 이긴다) */
  const toggleSeqRef = useRef(new Map<string, number>());
  /** 줄마다 서버가 확인한 마지막 끝냄 값(실패하면 여기로 돌린다) */
  const confirmedRef = useRef(new Map<string, boolean>());
  /** 줄마다 가장 최근에 원한 값(연타해도 마지막 값이 맞게) */
  const desiredRef = useRef(new Map<string, boolean>());
  /** 최신 체크가 실패해 돌아간 줄(앞선 낡은 성공 응답이 늦게 오면 그 값에 맞춘다) */
  const latestFailedRef = useRef(new Set<string>());
  /** 저장 전 글: 「다시」는 처음과 같은 id·같은 글로만 보낸다 */
  const pendingTextRef = useRef(new Map<string, string>());
  const scrollToRef = useRef<string | null>(null);
  const focusRequestRef = useRef<{ kind: "row"; id: string } | { kind: "input" } | null>(null);
  const confirmWasOpenRef = useRef(false);

  useEffect(() => {
    rowsRef.current = rows;
    const target = scrollToRef.current;
    if (target) {
      scrollToRef.current = null;
      document.getElementById(`row-${target}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [rows]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const load = useCallback(
    async (mode: "first" | "silent") => {
      const seq = ++loadSeqRef.current;
      const res = await safely(() => getTodayTodos());
      if (seq !== loadSeqRef.current) return; // 더 새 불러오기가 있다
      if (!res.ok) {
        if (res.error === "unauthenticated") {
          // 로그인이 풀림(T13): 바로 로그인 화면으로 넘기지 않는다. 이미 보이던 줄은 지우지 않는다(개수 = 보이는 줄).
          // 처음 불러오기부터 풀렸으면(보여 줄 목록이 없다) 목록·빈 문구·개수를 그리지 않고 안내만 둔다.
          setSessionLost(true);
          setList(loadedRef.current ? "ready" : "locked");
        } else if (!loadedRef.current) {
          setList("error");
        }
        return;
      }
      loadedRef.current = true;
      setSessionLost(false); // 불러오기가 되면 로그인이 풀렸다는 안내를 거둔다(저장 못 한 줄은 그대로)
      setDay(res.data.day);
      const server = res.data.todos.map(fromItem);
      for (const r of server) if (!toggleSeqRef.current.has(r.id)) confirmedRef.current.set(r.id, r.done);
      setRows((prev) => {
        const byId = new Map(prev.map((r) => [r.id, r]));
        const merged = server.map((r) => {
          const local = byId.get(r.id);
          // 체크를 보내는 중인 줄은 화면에 보이는 값을 지킨다
          if (local && desiredRef.current.has(r.id)) return { ...r, done: local.done };
          return r;
        });
        const serverIds = new Set(server.map((r) => r.id));
        // 저장 중·저장 실패 줄(서버에 아직 없음)은 목록 끝에 붙는다
        return [...merged, ...prev.filter((r) => r.status !== "saved" && !serverIds.has(r.id))];
      });
      setList("ready");
      if (mode !== "silent") announce(loadedText(server.length));
    },
    [announce],
  );

  // 처음 불러오기
  useEffect(() => {
    // 서버에서 목록을 가져오는 일(바깥 시스템과 맞추기). setState는 await 뒤에서만 불린다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load("first");
  }, [load]);

  // D10: 화면이 다시 보일 때·연결이 돌아올 때 목록을 다시 불러온다. 입력 칸 글은 건드리지 않는다.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void load("silent");
    }
    function onOnline() {
      setOfflineHelp(false);
      void load("silent");
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) void load("silent");
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [load]);

  // T15: 켜 둔 채 새벽 4시를 넘기면 날짜와 목록이 새 하루로 바뀐다
  useEffect(() => {
    const timer = setTimeout(() => void load("silent"), msUntilNextDayStart(Date.now()) + 1000);
    return () => clearTimeout(timer);
  }, [load, day]);

  const send = useCallback(
    async (id: string, text: string) => {
      const markFailed = () => {
        setRows((prev) => prev.map((r) => (r.id === id && r.status === "saving" ? { ...r, status: "failed", slow: false } : r)));
        announce(TODO_TEXT.saveFailed, { again: true });
      };
      // 15초 안에 답이 없으면 그 줄을 T7로 바꾼다. 같은 id라 「다시」가 겹쳐 만들지 않고, 늦은 성공은 그 줄을 저장됨으로 바꾼다.
      const timer = setTimeout(markFailed, SAVE_TIMEOUT_MS);
      const hintTimer = setTimeout(() => {
        setRows((prev) => prev.map((r) => (r.id === id && r.status === "saving" ? { ...r, slow: true } : r)));
      }, SAVING_HINT_DELAY_MS);
      const res = await safely(() => addTodo(id, text));
      clearTimeout(timer);
      clearTimeout(hintTimer);
      if (res.ok) {
        pendingTextRef.current.delete(id);
        confirmedRef.current.set(id, res.data.todo.done);
        const saved = fromItem(res.data.todo);
        setRows((prev) => prev.map((r) => (r.id === id ? { ...saved, text: saved.text ?? r.text } : r)));
        announce(TODO_TEXT.liveSaved);
      } else {
        if (res.error === "unauthenticated") setSessionLost(true);
        markFailed();
      }
    },
    [announce],
  );

  function submit() {
    const input = inputRef.current;
    const checked = checkTodoText(draftRef.current);
    // 빈 글·200자 넘음: 아무것도 만들지 않고 포커스는 칸에 남는다(넘음 안내는 도움말이 이미 보여 준다)
    if (!checked.ok) {
      // 도움말과 같은 글을 화면 읽기 프로그램에도 알린다(R11). 빈 글은 알릴 것이 없다.
      if (checked.error === "too_long") announce(overLimitText(countTodoChars(draftRef.current)), { again: true });
      input?.focus();
      return;
    }
    if (!navigator.onLine) {
      setOfflineHelp(true); // 글은 칸에 그대로 둔다
      announce(TODO_TEXT.offlineHelp, { again: true });
      input?.focus();
      return;
    }
    const id = crypto.randomUUID(); // 새로 적는 글마다 새 id (D4)
    pendingTextRef.current.set(id, checked.text);
    scrollToRef.current = id;
    setRows((prev) => [...prev, { id, text: checked.text, done: false, status: "saving", checkFailed: false }]);
    setDraft(""); // 첫 누름에 칸을 비운다: 연타하면 둘째부터 빈 칸
    draftRef.current = "";
    setOfflineHelp(false);
    announce(TODO_TEXT.liveSaving);
    input?.focus();
    void send(id, checked.text);
  }

  function retry(id: string) {
    const text = pendingTextRef.current.get(id);
    if (text === undefined) return;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "saving", slow: false } : r)));
    announce(TODO_TEXT.liveSaving);
    void send(id, text); // 같은 id, 같은 글
  }

  function remove(id: string) {
    // 단추가 줄과 함께 사라지니, 포커스를 바로 아래 줄 체크 칸 → 없으면 위 줄 → 줄이 없으면 입력 칸으로 옮긴다
    const list = rowsRef.current;
    const index = list.findIndex((r) => r.id === id);
    const neighbor = list[index + 1] ?? list[index - 1];
    focusRequestRef.current = neighbor ? { kind: "row", id: neighbor.id } : { kind: "input" };
    pendingTextRef.current.delete(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function toggle(id: string) {
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row) return;
    if (row.status !== "saved") return; // 저장 중·저장 못 한 줄은 서버에 없다. 저장되면 누를 수 있다
    if (!navigator.onLine) {
      announce(TODO_TEXT.offline, { again: true });
      return;
    }
    latestFailedRef.current.delete(id); // 새 체크가 시작되면 앞선 실패 표시는 낡은 것이다
    const desired = !(desiredRef.current.get(id) ?? row.done);
    desiredRef.current.set(id, desired);
    const seq = (toggleSeqRef.current.get(id) ?? 0) + 1;
    toggleSeqRef.current.set(id, seq);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, done: desired, checkFailed: false } : r)));
    void (async () => {
      const res = await safely(() => setTodoDone(id, desired));
      // 낡은 응답이어도 성공이면 서버가 그 값을 받은 것이니 확인값은 갱신한다
      if (res.ok) confirmedRef.current.set(id, res.data.done);
      if (toggleSeqRef.current.get(id) !== seq) {
        // 더 새 체크가 있다: 화면 값은 최신 요청 기준(마지막 값이 이긴다, D5).
        // 다만 최신 요청이 이미 실패해 돌아간 뒤에 낡은 성공이 늦게 오면, 서버 확인값에 맞춘다.
        if (res.ok && latestFailedRef.current.has(id)) {
          latestFailedRef.current.delete(id);
          const confirmed = res.data.done;
          setRows((prev) => prev.map((r) => (r.id === id ? { ...r, done: confirmed, checkFailed: false } : r)));
        }
        return;
      }
      desiredRef.current.delete(id);
      latestFailedRef.current.delete(id);
      if (res.ok) return;
      if (res.error === "unauthenticated") setSessionLost(true);
      latestFailedRef.current.add(id);
      const back = confirmedRef.current.get(id) ?? !desired;
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, done: back, checkFailed: true } : r)));
      announce(TODO_TEXT.checkFailed, { again: true });
    })();
  }

  function reload() {
    setList("loading");
    announce(TODO_TEXT.liveLoading);
    void load("first");
  }

  function doSignOut() {
    void signOut();
  }

  function onLogout() {
    const unsavedRows = rowsRef.current.some((r) => r.status !== "saved");
    if (unsavedRows || draftRef.current.trim().length > 0) setLogoutConfirm(true);
    else doSignOut();
  }

  async function copyUnsaved() {
    const lines = rowsRef.current
      .filter((r) => r.status !== "saved" && r.text)
      .map((r) => r.text as string);
    const rest = draftRef.current.trim();
    if (rest) lines.push(rest);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      announce(TODO_TEXT.liveCopied);
    } catch {
      announce(TODO_TEXT.liveCopyFailed);
    }
  }

  const rowViews: RowView[] = rows.map((r) => ({
    id: r.id,
    text: r.text,
    done: r.done,
    saving: r.status === "saving",
    savingSlow: r.slow === true,
    failed: r.status === "failed",
    checkFailed: r.checkFailed,
  }));
  const unsavedRows = rows.some((r) => r.status !== "saved");
  const hasUnsaved = unsavedRows || countTodoChars(draft) > 0;
  // 확인이 떠 있는 동안 저장되지 않은 글이 없어지면(빼기·저장 끝·입력 칸 비움) 확인을 닫는다
  const confirmOpen = logoutConfirm && hasUnsaved;
  if (logoutConfirm && !hasUnsaved) setLogoutConfirm(false);

  // 포커스가 있던 요소가 사라져도 body로 떨어뜨리지 않는다.
  // 「빼기」 규칙(바로 아래 줄 체크 칸 → 위 줄 → 입력 칸)이 앞서고, 확인이 닫힐 때 포커스가 확인 안이나 body면 머리 「로그아웃」으로 보낸다.
  useEffect(() => {
    const request = focusRequestRef.current;
    focusRequestRef.current = null;
    if (request) {
      const target =
        request.kind === "row" ? document.querySelector<HTMLElement>(`#row-${request.id} input[type=checkbox]`) : inputRef.current;
      (target ?? inputRef.current)?.focus();
    } else if (confirmWasOpenRef.current && !confirmOpen) {
      const active = document.activeElement;
      if (!active || active === document.body) document.getElementById("logout-button")?.focus();
    }
    confirmWasOpenRef.current = confirmOpen;
  });

  return (
    <TodoView
      direction={direction}
      day={day}
      list={list}
      rows={rowViews}
      draft={draft}
      online={online}
      offlineHelp={offlineHelp && !online}
      sessionLost={sessionLost}
      hasUnsaved={hasUnsaved}
      logoutConfirm={confirmOpen}
      live={live}
      inputRef={inputRef}
      onDraftChange={setDraft}
      onSubmit={submit}
      onToggle={toggle}
      onRetry={retry}
      onRemove={remove}
      onReload={reload}
      onLogout={onLogout}
      onLogoutConfirm={doSignOut}
      onLogoutCancel={() => setLogoutConfirm(false)}
      onCopy={() => void copyUnsaved()}
      onRelogin={() => router.refresh()}
    />
  );
}
