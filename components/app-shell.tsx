"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { APP_CONFIG, isEvening } from "../lib/app-config";
import { defaultEveningApi } from "../lib/evening-api";
import { defaultFocusApi, type FocusApi } from "../lib/focus-api";
import { defaultGoalsApi } from "../lib/goals-api";
import { defaultGrowthApi } from "../lib/growth-api";
import type { HomeRead } from "../lib/home-types";
import { defaultManageApi } from "../lib/manage-api";
import { defaultOffersApi, type OffersApi } from "../lib/offers-api";
import { readableCategories as readableMirrorCategories } from "../lib/local/derive";
import { readTodayFromMirror, type LocalApis } from "../lib/local/apis";
import { createLocalTodos, type LocalTodos } from "../lib/local/todos";
import type { Runtime } from "../lib/local/runtime";
import type { ArchivedWrite } from "../lib/local/types";
import { clearOtherOutboxes, createOutbox, safeLocalStorage, type Outbox } from "../lib/outbox";
import type { Offer } from "../lib/offers/types";
import { defaultSettingsApi } from "../lib/onboarding-api";
import { msUntilNextDayStart, todoDayFor } from "../lib/todos/day";
import { defaultPushApi, type PushApi } from "../lib/push/subscribe";
import { fetchToday } from "../lib/read-client";
import type { SettingsData } from "../lib/settings/types";
import type { TodayRead } from "../lib/today-types";
import type { ViewEntry } from "../lib/views/core-types";
import type { GoalSummary } from "../lib/goals/types";
import { useTabbarHeight } from "../lib/use-tabbar-height";
import { CategoryPage } from "./category-page";
import { EveningEntry, EveningRecord } from "./evening-record";
import { GoalEditor, GoalLine } from "./goal";
import { AfterSaveShortfall, GrowthScreen } from "./growth-screen";
import { MeScreen } from "./me-screen";
import { OfferCard } from "./offer-card";
import { Onboarding, pushOutcomeText, type OnboardingResult } from "./onboarding";
import { TabBar, type TabId } from "./tab-bar";
import { TimerScreen } from "./timer-screen";
import { TodoScreen } from "./todo-screen";
import { TODO_TEXT } from "./todo-view";
import { Notice, TextButton } from "./ui";

/**
 * 로그인한 뒤의 앱 전체 틀(클라이언트). 서버 컴포넌트(app/page.tsx)가 읽은 값(home)을 받아 화면들을 이어 붙인다.
 * - 처음 설정을 안 마쳤으면 처음 설정(Onboarding)부터 보여 준다(PRD ①). 설정을 못 읽었을 때는 강요하지 않고 앱을 보여 준다(임시).
 * - 아래 탭: 상태보기 · 할 일(처음 탭) · 타이머. 탭을 옮겨도 다른 탭은 지우지 않고 숨긴다(적던 글·도는 타이머가 살아 있게).
 * - 할 일 화면에는 고치기·지우기·순서·작업 기록·어제 것 가져오기(PRD 0·0-1번)와, 목록 위의 먼저 할 일 카드(⑤)·저녁 기록 입구(②)를 단다.
 * - 저녁 기록(PRD ②)은 알림을 눌러 들어온 주소(/?open=evening)로도 열린다. 저장 직후 한 줄을 누르면 상태보기(입구 after_save)로 간다(③, G3).
 */

type Entry = { id: string; name: string };

/**
 * 기기 먼저 저장의 화면 글(고침 4바퀴): 서버가 받지 않은 쓰기 보관 자리 · 「보내지 못함」 · 계정 바뀜 안내.
 * 임시 글, 디자인 확정 뒤 바꾼다. 말투(PM 확정 d-96): 해요체, 숫자 먼저, 말은 최소. 재촉·평가·끊김 탓 없음.
 */
export const LOCAL_SAVE_TEXT = {
  archivedTitle: (n: number) => `${n}개 기록을 서버가 받지 않았어요. 적은 글은 여기 남겨 뒀어요`,
  archivedKind: {
    "todo.add": "할 일",
    "todo.edit": "고친 할 일",
    "note.add": "작업 기록",
    "category.add": "분야",
    "settings.save": "목표 한 문장",
    "evening.save": "저녁 기록",
  } as Partial<Record<string, string>>,
  archivedKindOther: "기록",
  copy: "복사",
  copied: "복사했어요",
  copyFailed: "복사하지 못했어요. 글을 길게 눌러 골라 주세요",
  dismiss: "지우기",
  dismissAll: "모두 지우기",
  stalled: (n: number) => `${n}개 기록을 아직 보내지 못했어요. 계속 보내고 있어요`,
  resetAccount: "다른 계정으로 바뀌었어요. 화면을 다시 열어요",
  resetSignedOut: "다른 탭에서 로그아웃했어요",
  reopen: "다시 열기",
} as const;

/**
 * 서버가 받지 않은 쓰기의 내용(보관). 글은 사용자 입력이라 React 텍스트로만 그리고, 길면 줄을 바꿔 감싼다.
 * 「복사」는 그 글을 클립보드에 넣는다(다시 적기는 사용자가 붙여 넣어 한다). 「지우기」는 이 기기 보관에서 뺀다.
 */
export function ArchivedWrites({
  items,
  onDismiss,
  clipboard,
}: {
  items: ArchivedWrite[];
  onDismiss: (key?: string) => void;
  clipboard?: { writeText(text: string): Promise<void> };
}) {
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);
  if (items.length === 0) return null;
  async function copy(item: ArchivedWrite) {
    const board = clipboard ?? (typeof navigator !== "undefined" ? navigator.clipboard : undefined);
    try {
      if (!board) throw new Error("no clipboard");
      await board.writeText(item.text);
      setCopied({ key: item.key, ok: true });
    } catch {
      setCopied({ key: item.key, ok: false });
    }
  }
  return (
    <Notice role="status" className="notice-top" actions={<TextButton onClick={() => onDismiss()}>{LOCAL_SAVE_TEXT.dismissAll}</TextButton>}>
      <p>{LOCAL_SAVE_TEXT.archivedTitle(items.length)}</p>
      <ul aria-label="받지 않은 기록" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {items.map((item) => (
          <li key={item.key} style={{ minWidth: 0 }}>
            <p style={{ margin: 0 }}>{LOCAL_SAVE_TEXT.archivedKind[item.kind] ?? LOCAL_SAVE_TEXT.archivedKindOther}</p>
            <p className="archived-text" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "12em", overflowY: "auto" }}>
              {item.text}
            </p>
            <div className="notice-actions">
              <TextButton onClick={() => void copy(item)}>{LOCAL_SAVE_TEXT.copy}</TextButton>
              <TextButton onClick={() => onDismiss(item.key)}>{LOCAL_SAVE_TEXT.dismiss}</TextButton>
            </div>
            {copied?.key === item.key && <p role="status">{copied.ok ? LOCAL_SAVE_TEXT.copied : LOCAL_SAVE_TEXT.copyFailed}</p>}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/** 처음 설정에서 새로 더한 분야를 오늘 화면의 처음 읽기(initial)에 끼워 넣는다 */
export function withCategories(initial: TodayRead, added: Entry[]): TodayRead {
  if (!initial.categories.ok) return initial;
  const have = new Set(initial.categories.data.categories.map((c) => c.id));
  const extra = added
    .filter((c) => !have.has(c.id))
    .map((c) => ({ id: c.id, readable: true as const, name: c.name, createdAt: new Date().toISOString() }));
  if (extra.length === 0) return initial;
  return { ...initial, categories: { ok: true, data: { categories: [...initial.categories.data.categories, ...extra] } } };
}

/** 읽을 수 있는 분야(보관 안 한 것) */
function readableCategories(initial: TodayRead): Entry[] {
  return initial.categories.ok ? initial.categories.data.categories.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name }] : [])) : [];
}

const TABS: TabId[] = ["growth", "todo", "timer", "me"];

/**
 * 기기 먼저 저장(고침 3바퀴)의 묶음: 운영 장치(기기 거울·보낼 줄)와 그 위에서 화면이 쓰는 API들.
 * 있으면 화면은 서버 왕복을 기다리지 않고 기기 거울을 읽고 쓴다. 없으면 예전 방식(서버에서 읽어 받은 home을 쓰고 서버에 직접 쓴다) 그대로다.
 */
export type LocalBundle = { runtime: Runtime; apis: LocalApis };

/** 이 앱이 서버를 부르는 길 모음. 시험은 가짜를 넣는다 */
export type ShellApis = { offers: OffersApi; focus: FocusApi; push: PushApi };
const DEFAULT_APIS: ShellApis = { offers: defaultOffersApi, focus: defaultFocusApi, push: defaultPushApi };

export function AppShell({
  home,
  initialOpen = null,
  apis: apisProp,
  userKey,
  outbox: outboxProp,
  local,
}: {
  /** 기기 먼저 저장(고침 3바퀴, 선택): 있으면 화면이 기기 거울을 읽고 쓴다 */
  local?: LocalBundle;
  home: HomeRead;
  initialOpen?: "evening" | null;
  apis?: Partial<ShellApis>;
  /** 사용자 번호(기기에 둘 오프라인 보관함의 열쇠. 화면에 내지 않는다). 없으면 보관함을 쓰지 않는다 */
  userKey?: string;
  /** 시험에서 가짜 보관함을 넣는다 */
  outbox?: Outbox;
}) {
  // 부르는 길 모음은 렌더마다 새로 만들지 않는다(자식의 읽기 효과가 다시 돌지 않게)
  const apis = useMemo<ShellApis>(
    () => ({ ...DEFAULT_APIS, ...(local ? { offers: local.apis.offers, focus: local.apis.focus } : {}), ...apisProp }),
    [apisProp, local],
  );
  // 오프라인으로 적은 할 일을 기기에 두는 보관함(PRD 10절). 서버 렌더에서는 저장소가 없어 아무것도 안 하는 보관함이다
  // (기기 먼저 저장이 켜져 있으면 옛 보관함은 쓰지 않는다: 보낼 줄이 그 일을 한다)
  const outbox = useMemo<Outbox | undefined>(
    () => (local ? undefined : (outboxProp ?? (userKey ? createOutbox(safeLocalStorage(), userKey) : undefined))),
    [outboxProp, userKey, local],
  );
  // 로그인 직후: 이 기기에 남은 다른 사용자의 보관함은 지운다(A6). 시험이 보관함을 직접 넣을 때는 건드리지 않는다
  useEffect(() => {
    if (userKey && !outboxProp && !local) clearOtherOutboxes(safeLocalStorage(), userKey);
  }, [userKey, outboxProp, local]);
  const settings = home.settings.ok ? home.settings.data : null;
  const [done, setDone] = useState<OnboardingResult | null>(null);
  const needsOnboarding = settings !== null && !settings.onboardingDone && done === null;

  if (needsOnboarding && settings) {
    const readable: Entry[] = home.today.categories.ok
      ? home.today.categories.data.categories.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name }] : []))
      : [];
    return (
      <Onboarding
        api={local ? local.apis.settings : defaultSettingsApi}
        categories={readable}
        initialGoal={settings.goal}
        initialRatios={settings.ratios}
        initialNotify={settings.notify}
        onDone={setDone}
      />
    );
  }
  const initial = done ? withCategories(home.today, done.categories) : home.today;
  // 내 정보 탭이 쓰는 설정: 처음 설정을 방금 마쳤으면 그 결과, 아니면 서버가 읽은 값(못 읽었으면 null)
  const mySettings: SettingsData | null = done
    ? { goal: done.goal, goalReadable: true, onboardingDone: true, notify: done.notify, ratios: done.ratios }
    : settings;
  return (
    <MainShell
      initial={initial}
      initialOpen={initialOpen}
      apis={apis}
      settings={mySettings}
      outbox={outbox}
      local={local}
      startNotice={done ? pushOutcomeText(done.pushOutcome) : null}
    />
  );
}

function MainShell({
  initial,
  initialOpen,
  apis,
  settings,
  outbox,
  local,
  startNotice,
}: {
  local: LocalBundle | undefined;
  initial: TodayRead;
  initialOpen: "evening" | null;
  apis: ShellApis;
  settings: SettingsData | null;
  outbox: Outbox | undefined;
  /** 처음 설정 끝에서 알림을 켜지 못했을 때의 안내(B4). 첫 화면에 남겨 둔다 */
  startNotice: string | null;
}) {
  const [startNoticeOpen, setStartNoticeOpen] = useState(startNotice !== null);
  // 기기 먼저 저장: 서버가 받지 않아 되돌린 쓰기 수(알림을 보이고 닫을 때까지 쌓인다)
  const [rejectedCount, setRejectedCount] = useState(0);
  // 기기 먼저 저장(고침 4바퀴): 서버가 받지 않은 쓰기의 내용(보관)과, 서버가 오래 받지 못하는 중인가(「보내지 못함」)
  const [archived, setArchived] = useState<ArchivedWrite[]>(() => local?.runtime.archivedWrites() ?? []);
  const [stalled, setStalled] = useState<number>(() => (local?.runtime.isStalled() ? local.runtime.pendingCount() : 0));
  // 기기 거울이 바뀌면 이 화면도 다시 그린다(내 정보 탭의 분야 목록 등이 거울을 읽는다)
  const [, setMirrorVersion] = useState(0);
  useEffect(() => {
    if (!local) return;
    const runtime = local.runtime;
    const stopMirror = runtime.subscribe(() => setMirrorVersion((n) => n + 1));
    const stopRejections = runtime.subscribeRejections(() => {
      const taken = runtime.takeRejections().length;
      if (taken > 0) setRejectedCount((n) => n + taken);
      setArchived(runtime.archivedWrites());
    });
    const stopState = runtime.subscribeState(() => {
      setArchived(runtime.archivedWrites());
      setStalled(runtime.isStalled() ? runtime.pendingCount() : 0);
    });
    return () => {
      stopMirror();
      stopRejections();
      stopState();
    };
  }, [local]);
  // 기기 먼저 저장에서 할 일 화면이 쓰는 것
  const localTodos = useMemo<LocalTodos | undefined>(() => (local ? createLocalTodos(local.runtime, local.apis) : undefined), [local]);
  const [tab, setTab] = useState<TabId>("todo");
  const [eveningOpen, setEveningOpen] = useState(initialOpen === "evening");
  const [growthEntry, setGrowthEntry] = useState<ViewEntry>("self");
  const [growthActivation, setGrowthActivation] = useState(0);
  const [timerActivation, setTimerActivation] = useState(0);
  // 내 정보 탭의 분야 목록(A15): 앱을 열 때 읽은 값 그대로 두지 않고, 탭을 열 때마다 다시 읽는다(그사이 더한 분야가 보이게)
  const [meActivation, setMeActivation] = useState(0);
  // 내 정보 맨 아래 「로그아웃」(B18)은 할 일 탭의 로그아웃 흐름(저장 안 된 글 확인)을 부른다
  const [logoutRequest, setLogoutRequest] = useState(0);
  const [meCategories, setMeCategories] = useState<Entry[] | null>(null);
  const [category, setCategory] = useState<{ id: string | null; name: string } | null>(null);
  // 오늘 먼저 할 일 카드(⑤): 앱을 열 때 한 번 건네받는다. 반응이 없는(new) 것만 보인다
  const [cardOffer, setCardOffer] = useState<Offer | null>(null);
  // 카드 제시를 처음 받기 전에는 카드 자리를 비워 둔다(B16)
  const [cardLoaded, setCardLoaded] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<"failed" | "offline" | null>(null);
  // 타이머가 돌고 있는가(B3). 타이머 탭이 알려 준다. 앱을 연 직후에는 모르다가 시작 단추를 눌렀을 때 서버가 「이미 진행 중」으로 알려 준다
  const [timerRunning, setTimerRunning] = useState(false);
  // 타이머 탭의 추천(⑤): 탭을 열 때마다 건네받는다(같은 제시는 서버가 한 번만 센다)
  const [timerOffer, setTimerOffer] = useState<Offer | null>(null);
  // 이번 주 목표(⑥): 한 줄은 저녁 기록·목표를 저장한 뒤 다시 읽는다
  const [goalVersion, setGoalVersion] = useState(0);
  const [goalEditor, setGoalEditor] = useState<GoalSummary | null>(null);
  const cardStartRef = useRef<string | null>(null);
  // 탭 줄의 실제 높이(B9): 글자가 커져 두 줄이 되면 본문 아래 여백도 따라 늘린다
  const { shellRef, shellStyle } = useTabbarHeight();

  // 카드 제시를 받는다(서버에서 가져오는 일). 앱을 열 때, 화면이 다시 보일 때, 새벽 4시를 넘길 때마다 다시 받는다(A13).
  // 같은 제시는 서버가 한 번만 센다. 받은 제시가 반응 없는(new) 오늘 것이 아니면 카드를 거둔다. 못 받았으면 지금 카드를 그대로 둔다.
  useEffect(() => {
    let alive = true;
    function refresh() {
      void apis.offers.request("card").then((res) => {
        if (!alive) return;
        setCardLoaded(true);
        if (!res.ok) return;
        const offer = res.data.offer;
        setCardOffer(offer && offer.state === "new" && offer.day === todoDayFor(new Date()) ? offer : null);
      });
    }
    refresh();
    function onVisible() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    // 켜 둔 채 새벽 4시를 넘기면 새 하루의 카드를 받는다(다음 새벽 4시마다 다시 걸어 둔다)
    let timer: ReturnType<typeof setTimeout>;
    function arm() {
      timer = setTimeout(() => {
        refresh();
        arm();
      }, msUntilNextDayStart(Date.now()) + 1000);
    }
    arm();
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
    };
  }, [apis]);

  // 기기 먼저 저장: 제시는 서버만 정하지만 받은 것은 기기 거울에 있다. 거울이 바뀌면(서버가 다시 건넨 것·내가 시작하거나 넘긴 것) 카드와 추천이 따라간다
  useEffect(() => {
    if (!local) return;
    const runtime = local.runtime;
    return runtime.subscribe(() => {
      const offers = runtime.getMirror().offers;
      const card = offers.card;
      setCardOffer(card && card.state === "new" && card.day === todoDayFor(new Date()) ? card : null);
      const tab = offers.timer_tab;
      setTimerOffer(tab && tab.state !== "started" && tab.state !== "dismissed" ? tab : null);
    });
  }, [local]);

  // 카드의 날짜가 오늘이 아니면(앱을 켜 둔 채 하루가 바뀐 경우 등) 거둔다. 렌더가 아니라 화면이 다시 보일 때 확인한다
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      setCardOffer((prev) => (prev && prev.day !== todoDayFor(new Date()) ? null : prev));
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // 타이머 탭을 열 때마다 앱의 추천을 받는다
  useEffect(() => {
    if (timerActivation === 0) return;
    let alive = true;
    void apis.offers.request("timer_tab").then((res) => {
      if (!alive) return;
      setTimerOffer(res.ok && res.data.offer && res.data.offer.state !== "started" && res.data.offer.state !== "dismissed" ? res.data.offer : null);
    });
    return () => {
      alive = false;
    };
  }, [apis, timerActivation]);

  /** 탭을 연다. 상태보기는 열 때마다 다시 읽고 본 것을 한 번 남긴다(입구와 함께) */
  function openTab(next: TabId, entry: ViewEntry = "self") {
    if (next === "growth") {
      setGrowthEntry(entry);
      setGrowthActivation((n) => n + 1);
    }
    if (next === "timer") setTimerActivation((n) => n + 1);
    if (next === "me") setMeActivation((n) => n + 1);
    setTab(next);
  }

  // 내 정보 탭을 열 때마다 분야 목록을 다시 읽는다. 못 읽었으면 지금 목록을 그대로 둔다
  useEffect(() => {
    if (meActivation === 0) return;
    // 기기 먼저 저장이면 분야 목록은 늘 기기 거울에서 읽는다(아래 meCategoriesNow). 서버에 물을 것이 없다
    if (local) return;
    let alive = true;
    void fetchToday().then(
      (read) => {
        if (alive && read.categories.ok) setMeCategories(readableCategories(read));
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [meActivation, local]);

  async function startFromCard() {
    const offer = cardOffer;
    if (!offer || cardBusy) return;
    if (typeof navigator !== "undefined" && !navigator.onLine && !local) {
      setCardError("offline");
      return;
    }
    // 같은 제시로 다시 누르면 같은 id(서버가 한 번만 만든다)
    const id = cardStartRef.current ?? crypto.randomUUID();
    cardStartRef.current = id;
    setCardBusy(true);
    setCardError(null);
    const res = await apis.focus.start({
      id,
      todoId: offer.todoId,
      categoryId: offer.categoryId,
      offerId: offer.id,
      surface: "card",
      clientStartedAt: new Date().toISOString(),
    });
    setCardBusy(false);
    if (res.ok) {
      cardStartRef.current = null;
      setCardOffer(null);
      setTimerRunning(true);
      openTab("timer");
    } else if (res.error === "already_running") {
      // 이미 돌고 있는 타이머가 있다: 「시작하지 못했어요」를 반복하지 않고 타이머 탭을 안내한다
      cardStartRef.current = null;
      setTimerRunning(true);
    } else {
      setCardError("failed");
    }
  }

  async function dismissCard() {
    const offer = cardOffer;
    if (!offer || cardBusy) return;
    setCardOffer(null); // 카드는 바로 거둔다. 넘김 기록이 실패해도 사용자는 넘긴 것이다
    await apis.offers.dismiss(offer.id);
  }

  const meCategoriesNow = local ? readableMirrorCategories(local.runtime.getMirror()) : (meCategories ?? readableCategories(initial));
  const recommended = timerOffer
    ? {
        offerId: timerOffer.id,
        todoId: timerOffer.todoId,
        categoryId: timerOffer.categoryId,
        label: timerOffer.todoId ? "추천" : `추천 · ${timerOffer.categoryName} ${APP_CONFIG.timerMinutes}분`,
      }
    : null;

  return (
    <div ref={shellRef} className="app-shell" style={shellStyle}>
      <div hidden={tab !== "growth"}>
        <GrowthScreen
          api={local ? local.apis.growth : defaultGrowthApi}
          active={tab === "growth"}
          activation={growthActivation}
          entry={growthEntry}
          onOpenCategory={(id, name) => setCategory({ id, name })}
          onOpenEvening={() => setEveningOpen(true)}
        />
      </div>
      <div hidden={tab !== "todo"}>
        <TodoScreen
          initial={initial}
          manage={local ? local.apis.manage : defaultManageApi}
          local={localTodos}
          outbox={outbox}
          onBeforeSignOut={() => apis.push.disable()}
          logoutRequest={logoutRequest}
          topSlot={
            <>
              {rejectedCount > 0 && (
                <Notice
                  role="status"
                  className="notice-top"
                  actions={<TextButton onClick={() => setRejectedCount(0)}>닫기</TextButton>}
                >
                  {TODO_TEXT.rejected(rejectedCount)}
                </Notice>
              )}
              {local && <ArchivedWrites items={archived} onDismiss={(key) => void local.runtime.dismissArchived(key)} />}
              {stalled > 0 && (
                <Notice role="status" className="notice-top">
                  {LOCAL_SAVE_TEXT.stalled(stalled)}
                </Notice>
              )}
              {startNotice && startNoticeOpen && (
                <Notice
                  role="status"
                  className="notice-top"
                  actions={
                    <TextButton onClick={() => setStartNoticeOpen(false)}>닫기</TextButton>
                  }
                >
                  {startNotice}
                </Notice>
              )}
              <GoalLine api={local ? local.apis.goals : defaultGoalsApi} refreshKey={goalVersion} onOpen={setGoalEditor} />
              {!cardLoaded && !cardOffer && <div className="slot-card" aria-hidden="true" />}
              {cardOffer && (
                <OfferCard
                  offer={cardOffer}
                  busy={cardBusy}
                  error={cardError}
                  running={timerRunning}
                  onOpenTimer={() => openTab("timer")}
                  onStart={() => void startFromCard()}
                  onDismiss={() => void dismissCard()}
                />
              )}
              <EveningEntry evening={isEvening(new Date())} onOpen={() => setEveningOpen(true)} />
            </>
          }
        />
      </div>
      <div hidden={tab !== "timer"}>
        <TimerScreen
          api={apis.focus}
          fetchToday={local ? () => Promise.resolve(readTodayFromMirror(local.runtime)) : fetchToday}
          active={tab === "timer"}
          activation={timerActivation}
          recommended={recommended}
          onActiveChange={(session) => setTimerRunning(session !== null)}
        />
      </div>
      <div hidden={tab !== "me"}>
        <MeScreen settings={settings} categories={meCategoriesNow} api={local ? local.apis.settings : defaultSettingsApi} push={apis.push}
          onLogout={() => {
            openTab("todo");
            setLogoutRequest((n) => n + 1);
          }}
        />
      </div>
      <TabBar tabs={TABS} current={tab} onSelect={(next) => openTab(next)} />
      {eveningOpen && (
        <EveningRecord
          api={local ? local.apis.evening : defaultEveningApi}
          onClose={() => setEveningOpen(false)}
          onSaved={() => setGoalVersion((n) => n + 1)}
          onOpenGrowth={() => {
            setEveningOpen(false);
            openTab("growth", "after_save");
          }}
          renderAfterSave={() => <AfterSaveShortfall api={local ? local.apis.growth : defaultGrowthApi} />}
        />
      )}
      {goalEditor && (
        <GoalEditor
          api={local ? local.apis.goals : defaultGoalsApi}
          categories={goalEditor.categories}
          goal={goalEditor.goal}
          onClose={() => setGoalEditor(null)}
          onSaved={() => setGoalVersion((n) => n + 1)}
        />
      )}
      {category && <CategoryPage api={local ? local.apis.growth : defaultGrowthApi} categoryId={category.id} name={category.name} onClose={() => setCategory(null)} />}
    </div>
  );
}
