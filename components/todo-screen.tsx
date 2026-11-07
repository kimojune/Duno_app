"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { signOut } from "../app/actions";
import { addCategory, addTodo, setTodoDone } from "../app/todos/actions";
import type { AddCategoryResult, CategoryItem, CategoryList, CategoryResult } from "../lib/categories/types";
import { CATEGORY_LIMIT, checkCategoryName, countCategoryChars, sameCategoryName } from "../lib/categories/validation";
import type { ManageApi } from "../lib/manage-api";
import type { Outbox, OutboxItem } from "../lib/outbox";
import { fetchToday } from "../lib/read-client";
import type { TodayRead } from "../lib/today-types";
import { describeTodoDay, msUntilNextDayStart, todoDayFor } from "../lib/todos/day";
import type { AddedTodo, TodayTodos, TodoDay, TodoItem, TodoResult } from "../lib/todos/types";
import { checkTodoText, countTodoChars } from "../lib/todos/validation";
import { useAnnouncer } from "../lib/use-announcer";
import { useOnline } from "../lib/use-online";
import {
  categoryAddedText,
  categoryDuplicateText,
  categoryOverLimitText,
  loadedText,
  overLimitText,
  savedOtherDayText,
  TODO_TEXT,
  TodoView,
  type ChipView,
  type NewCategoryHelp,
  type RowView,
} from "./todo-view";
import { CarryOver } from "./carry-over";
import { Notice, TextButton } from "./ui";
import { TodoDetail } from "./todo-detail";

/**
 * 할 일 화면의 진짜 동작(디자인 명세 12절 방향 C).
 * - 처음 목록(할 일 + 분야)은 서버 컴포넌트(app/page.tsx)가 DAL에서 읽어 initial로 넘긴다(없으면 처음에 한 번 GET으로 읽는다).
 * - 다시 불러오기(화면이 다시 보일 때·연결이 돌아올 때·새벽 4시)는 GET /todos/today(lib/read-client)로 한다(MO-17).
 * - 쓰기(적기·체크·분야 더하기)만 Server Action(app/todos/actions.ts)을 부른다.
 * - 적는 창은 모달이 아니다. 창 상태(할 일 칸 글·고른 분야·새 분야 줄·그 칸 글)는 화면이 연 동안 하나로 살고,
 *   창을 닫아도 지우지 않는다(C-D1). 뒤로 가기는 창부터 닫는다(C-D2, history 한 칸).
 * 클라이언트는 user_id·날짜를 보내지 않는다. 브라우저 Supabase 클라이언트로 표를 직접 읽고 쓰지 않는다.
 * 저장 전 글·분야 이름은 기기에 두지 않는다(D6): localStorage·sessionStorage·IndexedDB·서비스 워커 캐시 없음.
 */

type LocalRow = {
  id: string;
  text: string | null;
  done: boolean;
  status: "saved" | "saving" | "failed" | "queued";
  /** 저장이 오래 걸리는 중(SAVING_HINT_DELAY_MS 지남) */
  slow?: boolean;
  checkFailed: boolean;
  /** 분야 번호. null이면 기타 */
  categoryId: string | null;
};

/** 화면이 아는 분야 하나. name이 null이면 이름을 풀 수 없다(칩에 보이지 않고, 목록 표시는 「읽을 수 없는 분야」) */
type CategoryEntry = { id: string; name: string | null };
type CategoryState = "loading" | "ready" | "error";

function fromItem(item: TodoItem): LocalRow {
  return {
    id: item.id,
    text: item.readable ? item.text : null,
    done: item.done,
    status: "saved",
    checkFailed: false,
    categoryId: item.categoryId ?? null,
  };
}

function toEntry(item: CategoryItem): CategoryEntry {
  return { id: item.id, name: item.readable ? item.name : null };
}

/** 임시, 결정 필요: 저장 요청이 이 시간 안에 답이 없으면 그 줄을 「저장하지 못했어요」로 바꾼다 */
export const SAVE_TIMEOUT_MS = 15_000;
/** 임시, 결정 필요: 분야 더하기도 이 시간 안에 답이 없으면 C19(12-12, 할 일 저장과 같은 값) */
export const CATEGORY_ADD_TIMEOUT_MS = SAVE_TIMEOUT_MS;
/** (임시) 저장이 이 시간을 넘겨 걸릴 때만 「저장하는 중」을 눈에 보이게 한다(그 전에는 화면 읽기용으로만 있다) */
export const SAVING_HINT_DELAY_MS = 1000;
/**
 * 창을 열 때 history에 쌓는 칸의 표시(C-D2). 값은 열기마다 새로 만든 고유 문자열이다:
 * 새로고침·앞으로 가기로 옛 표시가 붙은 칸에 돌아와도, 「이번에 연 창의 칸」과 헷갈리지 않게.
 */
export const SHEET_HISTORY_MARK = "dunoTodoSheet";

type HistoryState = Record<string, unknown>;

/** 지금 칸의 state를 복사한다(Next App Router가 넣어 둔 내부 state를 보존하려고). 객체가 아니면 빈 객체 */
function currentHistoryState(): HistoryState {
  const state: unknown = window.history.state;
  return state && typeof state === "object" ? { ...(state as HistoryState) } : {};
}

/** 옛 창 표시를 뺀 복사본(옛 표시를 새 칸에 옮겨 붙이지 않는다) */
function withoutSheetMark(state: HistoryState): HistoryState {
  const copy = { ...state };
  delete copy[SHEET_HISTORY_MARK];
  return copy;
}

const UNAVAILABLE = { ok: false, error: "unavailable" } as const;

async function safely<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call();
  } catch {
    return fallback;
  }
}

type ListState = "loading" | "ready" | "error" | "locked";

/** 서버가 넘긴 처음 결과로 목록 상태를 정한다(load가 결과를 받았을 때와 같은 규칙). 없으면 불러오는 중. */
function initialListState(initial: TodoResult<TodayTodos> | undefined): ListState {
  if (!initial) return "loading";
  if (initial.ok) return "ready";
  return initial.error === "unauthenticated" ? "locked" : "error";
}

type FocusRequest =
  | { kind: "row"; id: string }
  | { kind: "detailButton"; id: string }
  | { kind: "input" }
  | { kind: "addButton" }
  | { kind: "addCategoryChip" }
  | { kind: "newCategoryInput" };

/** 분야 더하기 한 번(C-D4). 요청 ID는 같은 이름으로 다시 누르면(「다시」·15초 뒤) 그대로 쓴다 */
type CategoryAttempt = {
  requestId: string;
  name: string;
  /** 「취소」·창 닫기로 사용자가 그만둔 시도: 실패하면 아무것도 띄우지 않는다 */
  abandoned: boolean;
  /** 15초 한도로 C19를 이미 띄웠다 */
  timedOut: boolean;
};

export function TodoScreen({
  initial,
  manage,
  topSlot,
  outbox,
}: {
  /** 서버 컴포넌트가 DAL에서 읽은 처음 목록(할 일 + 분야). 없으면 처음에 GET으로 한 번 읽는다. */
  initial?: TodayRead;
  /** 원샷 v2(선택): 있으면 줄마다 「자세히」(고치기·지우기·순서·작업 기록)와 「어제 못 끝낸 할 일」 가져오기를 그린다. 없으면 기존 화면 그대로 */
  manage?: ManageApi;
  /** 원샷 v2(선택): 목록 위에 얹는 것(먼저 할 일 카드·이번 주 목표 줄·저녁 기록 입구 등) */
  topSlot?: ReactNode;
  /** 원샷 v2(선택, PRD 10절): 있으면 오프라인으로도 할 일을 적는다. 못 올린 글(연결 대기·저장 중·실패)을 기기에 두었다가 연결되면 같은 id로 다시 보낸다. 없으면 옛 방식 그대로(오프라인에서는 적을 수 없다) */
  outbox?: Outbox;
}) {
  const initialTodos = initial?.todos;
  const first = initialTodos?.ok ? initialTodos.data : null;
  const initialCategories = initial?.categories;
  const [rows, setRows] = useState<LocalRow[]>(() => (first ? first.todos.map(fromItem) : []));
  const [list, setList] = useState<ListState>(() => initialListState(initialTodos));
  // 머리 날짜는 목록을 받기 전에도 보인다. 화면과 서버가 같은 순수 함수(todoDayFor)를 쓴다.
  const [day, setDay] = useState<TodoDay | null>(() => (first ? first.day : describeTodoDay(todoDayFor(new Date()))));
  /** 방금 올라간 글이 오늘이 아닌 날짜로 저장됐을 때의 안내(A4). 닫을 수 있다 */
  const [otherDayNotice, setOtherDayNotice] = useState<string | null>(null);
  const dayRef = useRef<TodoDay | null>(day);
  const [draft, setDraft] = useState("");
  const [offlineHelp, setOfflineHelp] = useState(false);
  const [sessionLost, setSessionLost] = useState(() => initialTodos?.ok === false && initialTodos.error === "unauthenticated");
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [live, announce] = useAnnouncer(first ? loadedText(first.todos.length) : TODO_TEXT.liveLoading);
  const online = useOnline();
  const router = useRouter(); // 다시 로그인: 서버가 세션을 다시 보고 로그인 화면을 그린다

  // ---- 적는 창(C-D1) ----
  const [sheetOpen, setSheetOpen] = useState(false);
  const [categoryState, setCategoryState] = useState<CategoryState>(() =>
    !initialCategories ? "loading" : initialCategories.ok ? "ready" : "error",
  );
  const [categories, setCategories] = useState<CategoryEntry[]>(() =>
    initialCategories?.ok ? initialCategories.data.categories.map(toEntry) : [],
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categoryNotice, setCategoryNotice] = useState("");
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryDraft, setNewCategoryDraft] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryHelp, setNewCategoryHelp] = useState<NewCategoryHelp>(null);
  /** 분야 더하기가 401로 돌아왔다(C19a): 그때만 새 분야 칸 이름도 「저장 안 된 글」 복사에 넣는다 */
  const [categoryAuthLost, setCategoryAuthLost] = useState(false);
  /** 열려 있는 「할 일 자세히」의 할 일 번호(manage가 있을 때만 쓴다) */
  const [detailId, setDetailId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const newCategoryInputRef = useRef<HTMLInputElement | null>(null);
  const rowsRef = useRef<LocalRow[]>([]);
  const draftRef = useRef("");
  const newCategoryDraftRef = useRef("");
  const categoriesRef = useRef<CategoryEntry[]>(categories);
  const sheetOpenRef = useRef(false);
  /** 창을 열 때 history에 한 칸 쌓았고 아직 거두지 않았다 */
  const historyPushedRef = useRef(false);
  /** 이번에 연 창의 칸 표시(열기마다 새 값) */
  const sheetMarkRef = useRef<string | null>(null);
  /** 「닫기」·Esc가 부른 history.back() 가운데 아직 popstate가 오지 않은 수 */
  const pendingBacksRef = useRef(0);
  /** 이번 화면에서 더한 분야: 그 전에 떠난 다시 읽기 응답이 늦게 와도 칩을 지우지 않게 */
  const addedCategoryIdsRef = useRef(new Set<string>());
  const categoryAttemptRef = useRef<CategoryAttempt | null>(null);
  /** 마지막으로 보낸 분야 더하기 요청 ID와 이름(같은 이름으로 다시 누르면 같은 ID, C-D4) */
  const categoryRequestRef = useRef<{ id: string; name: string } | null>(null);
  const addingCategoryRef = useRef(false);
  const chipScrollRef = useRef<string | null>(null);

  const loadedRef = useRef(first !== null);
  /** 서버가 처음 결과를 넘겼으면 처음 불러오기를 하지 않는다 */
  const hadInitialRef = useRef(initial !== undefined);
  const loadSeqRef = useRef(0);
  /** 줄마다 마지막으로 보낸 체크 순번(D5: 마지막 값이 이긴다) */
  const toggleSeqRef = useRef(new Map<string, number>());
  /** 줄마다 서버가 확인한 마지막 끝냄 값(실패하면 여기로 돌린다) */
  const confirmedRef = useRef(new Map<string, boolean>(first ? first.todos.map((t) => [t.id, t.done]) : []));
  /** 줄마다 가장 최근에 원한 값(연타해도 마지막 값이 맞게) */
  const desiredRef = useRef(new Map<string, boolean>());
  /** 최신 체크가 실패해 돌아간 줄(앞선 낡은 성공 응답이 늦게 오면 그 값에 맞춘다) */
  const latestFailedRef = useRef(new Set<string>());
  /** 저장 전 글: 「다시」는 처음과 같은 id·같은 글로만 보낸다 */
  const pendingTextRef = useRef(new Map<string, string>());
  /** 저장 전 줄의 분야 번호: 「다시」는 처음과 같은 분야 번호로 보낸다(C-D6) */
  const pendingCategoryRef = useRef(new Map<string, string | null>());
  /** 오프라인 보관함(outbox)에 둔 줄의 적은 때(기기 시계). 서버가 최근 72시간 안이면 이 때의 하루로 넣는다 */
  const writtenAtRef = useRef(new Map<string, string>());
  /** 보관함을 처음 읽어 화면에 올린 뒤에만 보관함을 다시 쓴다(읽기 전에 빈 값으로 덮어쓰지 않게) */
  const outboxReadyRef = useRef(false);
  const scrollToRef = useRef<string | null>(null);
  const focusRequestRef = useRef<FocusRequest | null>(null);
  const confirmWasOpenRef = useRef(false);

  // 그린 줄·글과 ref를 화면이 그려지기 전에(layout) 맞춘다. 수동 effect로 두면 그린 직후 누른 체크·빼기가
  // 아직 옛 rowsRef를 읽어 아무 일도 하지 않는 틈이 있다.
  useLayoutEffect(() => {
    rowsRef.current = rows;
    const target = scrollToRef.current;
    if (target) {
      scrollToRef.current = null;
      document.getElementById(`row-${target}`)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [rows]);
  useLayoutEffect(() => {
    dayRef.current = day;
  }, [day]);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useLayoutEffect(() => {
    newCategoryDraftRef.current = newCategoryDraft;
  }, [newCategoryDraft]);
  useLayoutEffect(() => {
    categoriesRef.current = categories;
    // C14: 새 칩이 보이게 칩 줄을 민다
    const chipId = chipScrollRef.current;
    if (chipId) {
      chipScrollRef.current = null;
      document.querySelector(`[data-chip-id="${chipId}"]`)?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    }
  }, [categories, selectedCategoryId]);

  /** 다시 읽은 분야 목록을 받는다. 실패하면 이미 받은 목록은 그대로 둔다. 고른 분야가 새 목록에 없으면 고름만 푼다(D10) */
  const applyCategories = useCallback((res: CategoryResult<CategoryList>) => {
    if (!res.ok) {
      setCategoryState((prev) => (prev === "ready" ? "ready" : "error"));
      return;
    }
    const server = res.data.categories.map(toEntry);
    const serverIds = new Set(server.map((c) => c.id));
    const keep = categoriesRef.current.filter((c) => addedCategoryIdsRef.current.has(c.id) && !serverIds.has(c.id));
    const merged = [...server, ...keep];
    categoriesRef.current = merged;
    setCategories(merged);
    setCategoryState("ready");
    setSelectedCategoryId((prev) => (prev && merged.some((c) => c.id === prev && c.name !== null) ? prev : null));
  }, []);

  const load = useCallback(
    async (mode: "first" | "silent") => {
      const seq = ++loadSeqRef.current;
      const read = await safely<TodayRead>(() => fetchToday(), { todos: UNAVAILABLE, categories: UNAVAILABLE });
      if (seq !== loadSeqRef.current) return; // 더 새 불러오기가 있다
      applyCategories(read.categories);
      const res = read.todos;
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
      setCategoryAuthLost(false);
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
    [announce, applyCategories],
  );

  // 처음 불러오기: 서버 컴포넌트가 처음 목록을 넘기지 않았을 때만
  useEffect(() => {
    if (hadInitialRef.current) return;
    // 서버에서 목록을 가져오는 일(바깥 시스템과 맞추기). setState는 await 뒤에서만 불린다.
    void load("first");
  }, [load]);

  // D10: 화면이 다시 보일 때·연결이 돌아올 때 목록을 다시 불러온다. 창 상태(글·고른 분야·창 열림)는 건드리지 않는다.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void load("silent");
    }
    function onOnline() {
      setOfflineHelp(false);
      setNewCategoryHelp((h) => (h === "offline" ? null : h));
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

  // T15: 켜 둔 채 새벽 4시를 넘기면 날짜와 목록이 새 하루로 바뀐다(창 상태·고른 분야는 그대로, 12-5)
  useEffect(() => {
    const timer = setTimeout(() => void load("silent"), msUntilNextDayStart(Date.now()) + 1000);
    return () => clearTimeout(timer);
  }, [load, day]);

  // ---- 창 열고 닫기(C-D2, C-D8) ----

  const closeSheet = useCallback((via: "button" | "esc" | "popstate") => {
    if (!sheetOpenRef.current) return;
    sheetOpenRef.current = false;
    // 닫을 때 포커스가 목록(체크 칸 등)에 있었으면 그대로 둔다. 아니면 단추로.
    const active = document.activeElement;
    const keepFocus = active instanceof HTMLElement && active.closest(".todo-main") !== null;
    // 창 닫기 뒤에 분야 더하기가 실패하면 아무것도 띄우지 않는다(성공하면 조용히 칩이 생긴다)
    const attempt = categoryAttemptRef.current;
    if (attempt) attempt.abandoned = true;
    setCategoryNotice(""); // 창을 닫으면 한 줄 안내는 사라진다(12-6)
    flushSync(() => setSheetOpen(false));
    if (!keepFocus) document.getElementById("add-todo-button")?.focus();
    sheetMarkRef.current = null;
    if (historyPushedRef.current) {
      historyPushedRef.current = false;
      // 「닫기」·Esc로 닫으면 연 때 쌓은 칸이 남아 있으니 거둔다. 뒤로 가기(popstate)는 이미 그 칸을 떠났다.
      // back()의 popstate는 나중에 온다. 그 popstate를 사용자의 뒤로 가기로 읽지 않게 센다.
      if (via !== "popstate") {
        pendingBacksRef.current += 1;
        window.history.back();
      }
    }
  }, []);

  function openSheet() {
    if (sheetOpenRef.current) return; // 연타해도 창 하나, history 한 칸
    sheetOpenRef.current = true;
    const mark = crypto.randomUUID();
    sheetMarkRef.current = mark;
    try {
      // 늘 새 칸을 쌓는다(옛 표시는 빼고 이번 열기의 고유 표시를 붙인다). 지금 칸에 옛 표시가 있어도(창을 연 채 새로고침,
      // 앞으로 가기로 돌아옴, 「닫기」의 back()이 아직 돌지 않음) 그 칸을 replaceState로 바꿔 쓰지 않는다: 새로고침된 칸의
      // 아래 칸은 새로고침 전 문서의 칸이라, 그 칸으로 가는 back()·뒤로 가기는 popstate 없이 페이지를 다시 불러 글을 잃는다.
      // 새 칸을 쌓으면 첫 뒤로 가기는 같은 문서 안의 popstate가 되고, 표시가 이번 창의 것과 달라 창이 닫힌다.
      // 받아들인 것: 이 경우 창이 닫힌 뒤 앱을 떠나기까지 뒤로 가기를 한 번 더 눌러야 할 수 있다(옛 창 칸이 남는다).
      window.history.pushState({ ...withoutSheetMark(currentHistoryState()), [SHEET_HISTORY_MARK]: mark }, "");
      historyPushedRef.current = true;
    } catch {
      historyPushedRef.current = false;
    }
    // 같은 사용자 동작 안에서 바로 포커스를 준다(C-D8: 안드로이드 크롬이 키보드를 띄울 가능성이 크다)
    flushSync(() => setSheetOpen(true));
    (newCategoryOpen ? newCategoryInputRef : inputRef).current?.focus();
  }

  // 뒤로 가기: 창이 열려 있으면 창만 닫는다(글은 남김). 창이 닫혀 있으면 아무것도 하지 않는다.
  useEffect(() => {
    function onPopState() {
      if (pendingBacksRef.current > 0) {
        // 「닫기」·Esc가 부른 back()이 이제 도착했다(사용자의 뒤로 가기가 아니다).
        pendingBacksRef.current -= 1;
        const mark = sheetMarkRef.current;
        if (sheetOpenRef.current && mark) {
          // 그사이 창을 다시 열었다: 늦게 온 back()이 이번 창의 칸을 떠났으니, 지금 칸 위에 이번 창의 칸을 다시 쌓는다.
          const state = currentHistoryState();
          if (state[SHEET_HISTORY_MARK] !== mark) {
            try {
              window.history.pushState({ ...withoutSheetMark(state), [SHEET_HISTORY_MARK]: mark }, "");
              historyPushedRef.current = true;
            } catch {
              historyPushedRef.current = false;
            }
          }
        }
        return;
      }
      if (!sheetOpenRef.current) return;
      // 아직 이번에 연 창의 칸이면(앞으로 가기로 돌아옴 등) 그대로. 옛 표시가 붙은 칸은 이번 창의 칸이 아니다.
      if (currentHistoryState()[SHEET_HISTORY_MARK] === sheetMarkRef.current) return;
      closeSheet("popstate");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [closeSheet]);

  // ---- 분야 ----

  function readableChips(): ChipView[] {
    return categoriesRef.current.filter((c): c is ChipView => c.name !== null);
  }

  function toggleChip(id: string) {
    setCategoryNotice("");
    setSelectedCategoryId((prev) => (prev === id ? null : id));
  }

  function closeNewCategoryRow() {
    setNewCategoryOpen(false);
    setNewCategoryDraft("");
    newCategoryDraftRef.current = "";
    setNewCategoryHelp(null);
    setCategoryAuthLost(false);
  }

  function openNewCategory() {
    setCategoryNotice("");
    if (categoriesRef.current.length >= CATEGORY_LIMIT) {
      setCategoryNotice(TODO_TEXT.categoryLimit); // C20: 「+ 분야」를 비활성으로 두지 않고 안내로 답한다
      return;
    }
    flushSync(() => setNewCategoryOpen(true));
    newCategoryInputRef.current?.focus();
  }

  function cancelNewCategory() {
    // 「취소」·Esc(새 분야 칸에서): 새 분야 줄만 닫고 적은 이름을 버린다(사용자가 고른 동작). 진행 중 요청은 그대로 간다.
    const attempt = categoryAttemptRef.current;
    if (attempt) attempt.abandoned = true;
    addingCategoryRef.current = false;
    setAddingCategory(false);
    closeNewCategoryRow();
    focusRequestRef.current = { kind: "addCategoryChip" };
  }

  function changeNewCategoryDraft(value: string) {
    setNewCategoryDraft(value);
    setNewCategoryHelp(null);
    setCategoryNotice("");
  }

  /** 분야를 칩 목록 끝에 더한다(없을 때만). 다른 기기에서 만든 분야가 돌아와도 칩 끝에 붙는다(C-D12) */
  function rememberCategory(entry: { id: string; name: string }) {
    addedCategoryIdsRef.current.add(entry.id);
    if (!categoriesRef.current.some((c) => c.id === entry.id)) {
      const next = [...categoriesRef.current, entry];
      categoriesRef.current = next;
      setCategories(next);
    }
    chipScrollRef.current = entry.id;
  }

  /** 분야를 고르고 할 일 칸으로 간다(C14·C17). 새 분야 줄은 그 이름이 아직 칸에 있으면(또는 비었으면) 닫는다 */
  function selectAfterAdd(entry: { id: string; name: string }, name: string, notice: string) {
    rememberCategory(entry);
    setSelectedCategoryId(entry.id);
    if (sameCategoryName(newCategoryDraftRef.current, name) || newCategoryDraftRef.current.trim() === "") {
      closeNewCategoryRow();
    }
    setCategoryNotice(notice);
    if (sheetOpenRef.current) focusRequestRef.current = { kind: "input" };
  }

  function reservedName() {
    // C18: 분야를 만들지 않고 고름을 모두 푼다. 새 분야 줄이 닫힌다
    setSelectedCategoryId(null);
    closeNewCategoryRow();
    setCategoryNotice(TODO_TEXT.categoryReserved);
    focusRequestRef.current = { kind: "input" };
  }

  async function addCategoryNow() {
    if (addingCategoryRef.current) return; // C13: 더하는 중 두 번째 누름은 무시
    setCategoryNotice("");
    const raw = newCategoryDraftRef.current;
    const checked = checkCategoryName(raw);
    if (!checked.ok) {
      if (checked.error === "reserved") {
        reservedName();
        return;
      }
      // C15 빈 이름·C16 넘음: 보내지 않고 포커스가 칸에 남는다. 넘음은 도움말과 같은 글을 LiveRegion에도
      if (checked.error === "too_long") announce(categoryOverLimitText(countCategoryChars(raw)), { again: true });
      newCategoryInputRef.current?.focus();
      return;
    }
    const name = checked.name;
    // C17: 화면이 먼저 알면 요청을 보내지 않는다
    const existing = readableChips().find((c) => sameCategoryName(c.name, name));
    if (existing) {
      selectAfterAdd(existing, name, categoryDuplicateText(existing.name));
      return;
    }
    if (!navigator.onLine) {
      setNewCategoryHelp("offline"); // C21: 이름은 그대로
      newCategoryInputRef.current?.focus();
      return;
    }
    // C-D4: 같은 이름으로 다시 누르면(실패·15초 뒤) 같은 요청 ID. 서버가 같은 ID는 한 번만 만든다
    const previous = categoryRequestRef.current;
    const requestId = previous && sameCategoryName(previous.name, name) ? previous.id : crypto.randomUUID();
    categoryRequestRef.current = { id: requestId, name };
    const attempt: CategoryAttempt = { requestId, name, abandoned: false, timedOut: false };
    categoryAttemptRef.current = attempt;
    addingCategoryRef.current = true;
    setAddingCategory(true);
    setNewCategoryHelp(null);
    announce(TODO_TEXT.liveCategoryAdding);

    const current = () => categoryAttemptRef.current === attempt;
    const stopBusy = () => {
      if (!current()) return;
      addingCategoryRef.current = false;
      setAddingCategory(false);
    };
    const timer = setTimeout(() => {
      if (!current()) return;
      if (attempt.abandoned) {
        stopBusy(); // 창을 닫아 버린 시도여도 「더하는 중」은 남기지 않는다. 알림은 띄우지 않는다
        return;
      }
      attempt.timedOut = true;
      stopBusy();
      setNewCategoryHelp("failed"); // C19: 적은 이름은 지우지 않는다
    }, CATEGORY_ADD_TIMEOUT_MS);
    const res = await safely<AddCategoryResult>(() => addCategory(requestId, name), UNAVAILABLE);
    clearTimeout(timer);
    stopBusy();

    if (res.ok) {
      // 성공은 언제나 칩이 생기고 골라진다: 「취소」·창 닫기·15초 뒤여도(만든 것을 화면이 숨기지 않는다)
      categoryRequestRef.current = null;
      if (res.data.category.readable) {
        const entry = { id: res.data.category.id, name: res.data.category.name };
        if (current()) setNewCategoryHelp(null); // 15초 뒤 늦은 성공: C19 안내를 거둔다
        selectAfterAdd(entry, name, "");
        if (sheetOpenRef.current) announce(categoryAddedText(entry.name)); // 창이 닫혀 있으면 조용히
      }
      return;
    }
    if (res.error === "unauthenticated") {
      // C19a: C19 문구로 원인을 숨기지 않는다. 새 분야 줄과 적은 이름은 그대로
      setSessionLost(true);
      if (newCategoryDraftRef.current.trim()) setCategoryAuthLost(true);
      return;
    }
    // 「취소」나 창 닫기 뒤의 실패, 15초로 이미 C19를 띄운 뒤의 늦은 실패는 아무것도 띄우지 않는다
    if (attempt.abandoned || attempt.timedOut || !current()) return;
    if (res.error === "duplicate") {
      selectAfterAdd(res.existing, name, categoryDuplicateText(res.existing.name));
      return;
    }
    if (res.error === "reserved") {
      reservedName();
      return;
    }
    if (res.error === "category_limit") {
      setNewCategoryHelp("limit"); // C20: C19가 아니라 한도 문구
      return;
    }
    if (res.error === "conflict") categoryRequestRef.current = null; // 요청 ID가 남과 겹쳤다: 다음에는 새 ID
    setNewCategoryHelp("failed"); // C19
  }

  // ---- 할 일 ----

  const send = useCallback(
    async (id: string, text: string, categoryId: string | null, writtenAt?: string) => {
      let failureShown = false;
      const markFailed = () => {
        // 이 시도의 실패는 한 번만 띄운다: 15초 한도로 띄운 뒤 늦게 온 실패 응답이 안내를 다시 읽히지 않고,
        // 그사이 「다시」로 보낸 새 시도의 「저장하는 중」을 실패로 되돌리지 않는다(「다시」는 실패를 띄운 뒤에만 보인다).
        if (failureShown) return;
        failureShown = true;
        // 이미 저장됐거나(앞 시도의 늦은 성공) 줄을 뺐으면, 남은 15초 타이머가 실패를 띄우지 않는다.
        if (!pendingTextRef.current.has(id)) return;
        setRows((prev) => prev.map((r) => (r.id === id && r.status === "saving" ? { ...r, status: "failed", slow: false } : r)));
        announce(TODO_TEXT.saveFailed, { again: true });
      };
      // 15초 안에 답이 없으면 그 줄을 T7로 바꾼다. 같은 id라 「다시」가 겹쳐 만들지 않고, 늦은 성공은 그 줄을 저장됨으로 바꾼다.
      const timer = setTimeout(markFailed, SAVE_TIMEOUT_MS);
      const hintTimer = setTimeout(() => {
        setRows((prev) => prev.map((r) => (r.id === id && r.status === "saving" ? { ...r, slow: true } : r)));
      }, SAVING_HINT_DELAY_MS);
      // writtenAt(오프라인으로 적은 때)은 보관함을 쓰는 줄에만 싣는다. 없으면 옛 호출 꼴 그대로(인자 수가 늘지 않게)
      const res = await safely<TodoResult<AddedTodo>>(
        () => (writtenAt === undefined ? addTodo(id, text, categoryId) : addTodo(id, text, categoryId, writtenAt)),
        UNAVAILABLE,
      );
      clearTimeout(timer);
      clearTimeout(hintTimer);
      if (res.ok) {
        pendingTextRef.current.delete(id);
        pendingCategoryRef.current.delete(id);
        writtenAtRef.current.delete(id);
        confirmedRef.current.set(id, res.data.todo.done);
        const saved = fromItem(res.data.todo);
        const today = dayRef.current;
        if (today && res.data.day && res.data.day.date !== today.date) {
          // 오프라인으로 새벽 4시 전에 적고 4시 뒤에 올린 글: 서버는 적은 때의 하루로 넣었다. 오늘 목록에 「저장됨」으로 두면
          // 사실과 다르니 목록에서 빼고 어느 날짜로 저장됐는지 알린다(날짜 규칙 자체는 PM 물음, 바꾸지 않는다)
          setRows((prev) => prev.filter((r) => r.id !== id));
          const text = savedOtherDayText(res.data.day, today);
          setOtherDayNotice(text);
          announce(text, { again: true });
        } else {
          setRows((prev) => prev.map((r) => (r.id === id ? { ...saved, text: saved.text ?? r.text } : r)));
          announce(TODO_TEXT.liveSaved);
        }
      } else {
        // 남의 분야·없는 분야(invalid_category)도 일반 저장 실패(T7)와 같다
        if (res.error === "unauthenticated") setSessionLost(true);
        markFailed();
      }
    },
    [announce],
  );

  function submit() {
    const input = inputRef.current;
    setCategoryNotice("");
    const checked = checkTodoText(draftRef.current);
    // 빈 글·200자 넘음: 아무것도 만들지 않고 포커스는 칸에 남는다(넘음 안내는 도움말이 이미 보여 준다)
    if (!checked.ok) {
      // 도움말과 같은 글을 화면 읽기 프로그램에도 알린다(R11). 빈 글은 알릴 것이 없다.
      if (checked.error === "too_long") announce(overLimitText(countTodoChars(draftRef.current)), { again: true });
      input?.focus();
      return;
    }
    // 보관함이 있으면 오프라인에서도 적는다(기기에 두었다가 연결되면 저장, PRD 10절). 없으면 옛 방식: 글은 그대로 두고 안내만
    const queueOffline = !navigator.onLine && outbox !== undefined;
    if (!navigator.onLine && !queueOffline) {
      setOfflineHelp(true); // 글·고름은 그대로 둔다(C21)
      announce(TODO_TEXT.offlineHelp, { again: true });
      input?.focus();
      return;
    }
    // C-D6: 그때 고른 분야 번호(없거나 분야를 못 불러왔으면 기타). 칩에 보이는 분야만 보낸다
    const categoryId =
      selectedCategoryId && readableChips().some((c) => c.id === selectedCategoryId) ? selectedCategoryId : null;
    const id = crypto.randomUUID(); // 새로 적는 글마다 새 id (D4)
    pendingTextRef.current.set(id, checked.text);
    pendingCategoryRef.current.set(id, categoryId);
    scrollToRef.current = id;
    if (queueOffline) writtenAtRef.current.set(id, new Date().toISOString());
    setRows((prev) => [...prev, { id, text: checked.text, done: false, status: queueOffline ? "queued" : "saving", checkFailed: false, categoryId }]);
    setDraft(""); // 첫 누름에 칸을 비운다: 연타하면 둘째부터 빈 칸
    draftRef.current = "";
    setSelectedCategoryId(null); // C7: 적은 뒤 고른 분야는 풀린다(PM 임시값, D-125)
    setOfflineHelp(false);
    announce(queueOffline ? TODO_TEXT.liveQueued : TODO_TEXT.liveSaving);
    input?.focus(); // 창은 열린 채, 포커스는 할 일 칸(C-D1)
    if (!queueOffline) void send(id, checked.text, categoryId);
  }

  function changeDraft(value: string) {
    setDraft(value);
    setCategoryNotice("");
  }

  function retry(id: string) {
    const text = pendingTextRef.current.get(id);
    if (text === undefined) return;
    // 「다시」는 줄과 함께 사라진다(저장하는 중). 포커스를 body로 떨어뜨리지 않고 그 줄 체크 칸에 둔다.
    focusRequestRef.current = { kind: "row", id };
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "saving", slow: false } : r)));
    announce(TODO_TEXT.liveSaving);
    void send(id, text, pendingCategoryRef.current.get(id) ?? null, writtenAtRef.current.get(id)); // 같은 id, 같은 글, 같은 분야 번호
  }

  function remove(id: string) {
    // 단추가 줄과 함께 사라지니, 포커스를 바로 아래 줄 체크 칸 → 없으면 위 줄 → 줄이 없으면 할 일 칸(창이 닫혔으면 단추)으로 옮긴다
    const all = rowsRef.current;
    const index = all.findIndex((r) => r.id === id);
    const neighbor = all[index + 1] ?? all[index - 1];
    focusRequestRef.current = neighbor ? { kind: "row", id: neighbor.id } : { kind: "input" };
    pendingTextRef.current.delete(id);
    pendingCategoryRef.current.delete(id);
    writtenAtRef.current.delete(id);
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
      const res = await safely<TodoResult<{ id: string; done: boolean }>>(() => setTodoDone(id, desired), UNAVAILABLE);
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

  // ---- 오프라인 보관함(PRD 10절, outbox가 있을 때만) ----

  // 처음 열 때 기기에 남은 못 올린 글을 줄로 올린다(연결 대기). 기기 저장소 읽기라 서버 렌더와 다르지 않게 마운트 뒤에 올린다.
  useEffect(() => {
    if (!outbox) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      const items: OutboxItem[] = outbox.load();
      const known = new Set(rowsRef.current.map((r) => r.id));
      const fresh = items.filter((i) => !known.has(i.id));
      for (const i of fresh) {
        pendingTextRef.current.set(i.id, i.text);
        pendingCategoryRef.current.set(i.id, i.categoryId);
        writtenAtRef.current.set(i.id, i.writtenAt);
      }
      if (fresh.length > 0) {
        setRows((prev) => [
          ...prev,
          ...fresh.map((i): LocalRow => ({ id: i.id, text: i.text, done: false, status: "queued", checkFailed: false, categoryId: i.categoryId })),
        ]);
      }
      outboxReadyRef.current = true;
    });
    return () => {
      alive = false;
    };
  }, [outbox]);

  // 올라가지 못한 줄(연결 대기·저장 중·실패)이 바뀔 때마다 기기에 다시 적는다. 올라가거나 뺀 줄은 빠진다.
  useEffect(() => {
    if (!outbox || !outboxReadyRef.current) return;
    const items: OutboxItem[] = [];
    for (const r of rows) {
      if (r.status === "saved" || r.text === null) continue;
      const writtenAt = writtenAtRef.current.get(r.id) ?? new Date().toISOString();
      writtenAtRef.current.set(r.id, writtenAt);
      items.push({ id: r.id, text: r.text, categoryId: r.categoryId, writtenAt });
    }
    outbox.save(items);
  }, [rows, outbox]);

  // 연결이 있고 연결 대기 줄이 있으면 같은 id로 보낸다(서버가 같은 id는 한 번만 만든다). 하나씩 저장 중으로 바뀐다.
  const queuedCount = rows.filter((r) => r.status === "queued").length;
  useEffect(() => {
    if (!outbox || !online || queuedCount === 0) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      const queued = rowsRef.current.filter((r) => r.status === "queued" && r.text !== null);
      if (queued.length === 0) return;
      setRows((prev) => prev.map((r) => (r.status === "queued" ? { ...r, status: "saving", slow: false } : r)));
      announce(TODO_TEXT.liveSaving);
      for (const r of queued) void send(r.id, r.text as string, r.categoryId, writtenAtRef.current.get(r.id));
    });
    return () => {
      alive = false;
    };
  }, [outbox, online, queuedCount, send, announce]);

  function reload() {
    // T9·C10 「다시 불러오기」(할 일과 분야를 함께). 단추가 사라지니 포커스를 body로 떨어뜨리지 않고
    // 할 일 칸(창이 닫혔으면 단추)에 둔다.
    focusRequestRef.current = { kind: "input" };
    if (list === "error") {
      setList("loading");
      announce(TODO_TEXT.liveLoading);
    }
    setCategoryState((prev) => (prev === "ready" ? prev : "loading"));
    void load(list === "error" ? "first" : "silent");
  }

  function doSignOut() {
    outbox?.clear(); // 로그아웃하면 기기에 둔 못 올린 글도 지운다(남의 글이 남지 않게)
    void signOut();
  }

  /** 로그아웃 확인이 세는 「아직 저장되지 않은 글」(C-D9): 저장 중·실패 줄, 할 일 칸 글, 새 분야 칸 글(창이 닫혀 있어도) */
  function anyUnsaved(): boolean {
    return (
      rowsRef.current.some((r) => r.status !== "saved") ||
      draftRef.current.trim().length > 0 ||
      newCategoryDraftRef.current.trim().length > 0
    );
  }

  function onLogout() {
    if (anyUnsaved()) setLogoutConfirm(true);
    else doSignOut();
  }

  async function copyUnsaved() {
    const lines = rowsRef.current.filter((r) => r.status !== "saved" && r.text).map((r) => r.text as string);
    const rest = draftRef.current.trim();
    if (rest) lines.push(rest);
    // 새 분야 칸 이름은 분야 더하기가 401일 때(C19a)만 넣는다. 할 일 저장 401(T13)일 때는 넣지 않는다(12-5)
    const categoryName = newCategoryDraftRef.current.trim();
    if (categoryAuthLost && categoryName) lines.push(categoryName);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      announce(TODO_TEXT.liveCopied);
    } catch {
      announce(TODO_TEXT.liveCopyFailed);
    }
  }

  // ---- 원샷 v2 0번: 고치기·지우기·순서·어제 것 가져오기(manage가 있을 때만) ----

  function closeDetail(restoreFocusTo?: FocusRequest) {
    focusRequestRef.current = restoreFocusTo ?? (detailId ? { kind: "detailButton", id: detailId } : null);
    setDetailId(null);
  }

  function onEdited(todo: TodoItem) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === todo.id ? { ...r, text: todo.readable ? todo.text : r.text, categoryId: todo.categoryId ?? null } : r,
      ),
    );
  }

  function onDeleted(id: string) {
    const all = rowsRef.current;
    const index = all.findIndex((r) => r.id === id);
    const neighbor = all[index + 1] ?? all[index - 1];
    pendingTextRef.current.delete(id);
    pendingCategoryRef.current.delete(id);
    confirmedRef.current.delete(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
    closeDetail(neighbor ? { kind: "row", id: neighbor.id } : { kind: "addButton" });
  }

  /** 저장된 줄 가운데 위(-1)·아래(1)로 한 칸. 서버가 순서를 받으면 화면도 바꾼다 */
  async function moveRow(id: string, direction: -1 | 1): Promise<boolean> {
    if (!manage) return false;
    const saved = rowsRef.current.filter((r) => r.status === "saved");
    const from = saved.findIndex((r) => r.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= saved.length) return false;
    const next = [...saved];
    [next[from], next[to]] = [next[to], next[from]];
    const res = await safely(() => manage.reorderTodos(next.map((r) => r.id)), UNAVAILABLE);
    if (!res.ok) {
      if (res.error === "unauthenticated") setSessionLost(true);
      return false;
    }
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      const ordered = next.map((r) => byId.get(r.id)).filter((r): r is LocalRow => r !== undefined);
      return [...ordered, ...prev.filter((r) => r.status !== "saved")];
    });
    return true;
  }

  function onCarried(todos: TodoItem[]) {
    const added = todos.map(fromItem);
    for (const r of added) confirmedRef.current.set(r.id, r.done);
    setRows((prev) => [...prev, ...added.filter((r) => !prev.some((p) => p.id === r.id))]);
    announce(`할 일 ${added.length}개를 가져왔어요`);
  }

  const savedRows = rows.filter((r) => r.status === "saved");
  const detailRow = detailId ? rows.find((r) => r.id === detailId && r.status === "saved") : undefined;
  const detailIndex = detailRow ? savedRows.findIndex((r) => r.id === detailRow.id) : -1;

  const byCategory = new Map(categories.map((c) => [c.id, c]));
  function categoryText(categoryId: string | null): string | null {
    if (!categoryId) return null;
    const entry = byCategory.get(categoryId);
    if (entry) return entry.name ?? TODO_TEXT.unreadableCategory;
    // 분야 목록을 받았는데 그 번호가 없으면(풀 수 없음·보관) 「읽을 수 없는 분야」. 목록을 못 받았으면 붙이지 않는다
    return categoryState === "ready" ? TODO_TEXT.unreadableCategory : null;
  }

  const rowViews: RowView[] = rows.map((r) => ({
    id: r.id,
    text: r.text,
    done: r.done,
    saving: r.status === "saving",
    savingSlow: r.slow === true,
    failed: r.status === "failed",
    queued: r.status === "queued",
    checkFailed: r.checkFailed,
    category: categoryText(r.categoryId),
  }));
  const chips: ChipView[] = categories.filter((c): c is ChipView => c.name !== null);
  const unsavedRows = rows.some((r) => r.status !== "saved");
  const hasDraft = countTodoChars(draft) > 0;
  const hasCategoryDraft = newCategoryDraft.trim().length > 0;
  const hasUnsaved = unsavedRows || hasDraft || hasCategoryDraft;
  // 로그인 풀림 안내의 복사: 할 일 칸 글은 늘, 새 분야 칸 이름은 C19a일 때만
  const copyable = unsavedRows || hasDraft || (categoryAuthLost && hasCategoryDraft);
  // 확인이 떠 있는 동안 저장되지 않은 글이 없어지면(빼기·저장 끝·칸 비움) 확인을 닫는다
  const confirmOpen = logoutConfirm && hasUnsaved;
  if (logoutConfirm && !hasUnsaved) setLogoutConfirm(false);

  // 포커스가 있던 요소가 사라져도 body로 떨어뜨리지 않는다.
  // 요청된 곳(「빼기」의 이웃 줄, 「다시」의 그 줄, 할 일 칸, 「+ 분야」 등)이 앞서고, 없으면 할 일 칸 → 단추.
  // 확인이 닫힐 때 포커스가 확인 안이나 body면 머리 「로그아웃」으로 보낸다. 요소가 사라진 그 커밋 안에서(layout) 옮긴다.
  useLayoutEffect(() => {
    const request = focusRequestRef.current;
    focusRequestRef.current = null;
    if (request) {
      const fallback = () => inputRef.current ?? document.getElementById("add-todo-button");
      let target: HTMLElement | null = null;
      if (request.kind === "row") target = document.querySelector<HTMLElement>(`#row-${request.id} input[type=checkbox]`);
      else if (request.kind === "detailButton") target = document.querySelector<HTMLElement>(`#row-${request.id} .row-actions button`);
      else if (request.kind === "addButton") target = document.getElementById("add-todo-button");
      else if (request.kind === "addCategoryChip") target = document.getElementById("add-category-chip");
      else if (request.kind === "newCategoryInput") target = newCategoryInputRef.current;
      (target ?? fallback())?.focus();
    } else if (confirmWasOpenRef.current && !confirmOpen) {
      const active = document.activeElement;
      if (!active || active === document.body) document.getElementById("logout-button")?.focus();
    }
    confirmWasOpenRef.current = confirmOpen;
  });

  return (
    <TodoView
      day={day}
      list={list}
      rows={rowViews}
      online={online}
      offlineHelp={offlineHelp && !online}
      sessionLost={sessionLost}
      hasUnsaved={copyable}
      logoutConfirm={confirmOpen}
      live={live}
      sheetOpen={sheetOpen}
      draft={draft}
      resume={draft.trim().length > 0 || hasCategoryDraft}
      categories={categoryState}
      chips={chips}
      selectedCategoryId={selectedCategoryId}
      categoryNotice={categoryNotice}
      newCategoryOpen={newCategoryOpen}
      newCategoryDraft={newCategoryDraft}
      addingCategory={addingCategory}
      newCategoryHelp={newCategoryHelp}
      inputRef={inputRef}
      newCategoryInputRef={newCategoryInputRef}
      onOpenSheet={openSheet}
      onCloseSheet={closeSheet}
      onDraftChange={changeDraft}
      onSubmit={submit}
      onToggleChip={toggleChip}
      onOpenNewCategory={openNewCategory}
      onNewCategoryDraftChange={changeNewCategoryDraft}
      onAddCategory={() => void addCategoryNow()}
      onCancelNewCategory={cancelNewCategory}
      onToggle={toggle}
      onRetry={retry}
      onRemove={remove}
      onReload={reload}
      onLogout={onLogout}
      onLogoutConfirm={doSignOut}
      onLogoutCancel={() => setLogoutConfirm(false)}
      onCopy={() => void copyUnsaved()}
      onRelogin={() => router.refresh()}
      onOpenDetail={manage ? (id) => setDetailId(id) : undefined}
      topSlot={
        manage || topSlot || otherDayNotice ? (
          <>
            {otherDayNotice && (
              <Notice role="status" className="notice-top" actions={<TextButton onClick={() => setOtherDayNotice(null)}>닫기</TextButton>}>
                {otherDayNotice}
              </Notice>
            )}
            {topSlot}
            {manage && list === "ready" && <CarryOver api={manage} online={online} onCarried={onCarried} />}
          </>
        ) : undefined
      }
      overlay={
        manage && detailRow ? (
          <TodoDetail
            key={detailRow.id}
            todo={{
              id: detailRow.id,
              text: detailRow.text,
              categoryId: detailRow.categoryId,
              canMoveUp: detailIndex > 0,
              canMoveDown: detailIndex >= 0 && detailIndex < savedRows.length - 1,
            }}
            chips={chips}
            api={manage}
            online={online}
            onClose={() => closeDetail()}
            onEdited={onEdited}
            onDeleted={onDeleted}
            onMove={moveRow}
          />
        ) : undefined
      }
    />
  );
}
