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
import type { Offer } from "../lib/offers/types";
import { defaultSettingsApi } from "../lib/onboarding-api";
import { defaultPushApi, type PushApi } from "../lib/push/subscribe";
import { fetchToday } from "../lib/read-client";
import type { SettingsData } from "../lib/settings/types";
import type { TodayRead } from "../lib/today-types";
import type { ViewEntry } from "../lib/views/core-types";
import type { GoalSummary } from "../lib/goals/types";
import { CategoryPage } from "./category-page";
import { EveningEntry, EveningRecord } from "./evening-record";
import { GoalEditor, GoalLine } from "./goal";
import { AfterSaveShortfall, GrowthScreen } from "./growth-screen";
import { MeScreen } from "./me-screen";
import { OfferCard } from "./offer-card";
import { Onboarding, type OnboardingResult } from "./onboarding";
import { TabBar, type TabId } from "./tab-bar";
import { TimerScreen } from "./timer-screen";
import { TodoScreen } from "./todo-screen";

/**
 * 로그인한 뒤의 앱 전체 틀(클라이언트). 서버 컴포넌트(app/page.tsx)가 읽은 값(home)을 받아 화면들을 이어 붙인다.
 * - 처음 설정을 안 마쳤으면 처음 설정(Onboarding)부터 보여 준다(PRD ①). 설정을 못 읽었을 때는 강요하지 않고 앱을 보여 준다(임시).
 * - 아래 탭: 상태보기 · 할 일(처음 탭) · 타이머. 탭을 옮겨도 다른 탭은 지우지 않고 숨긴다(적던 글·도는 타이머가 살아 있게).
 * - 할 일 화면에는 고치기·지우기·순서·작업 기록·어제 것 가져오기(PRD 0·0-1번)와, 목록 위의 먼저 할 일 카드(⑤)·저녁 기록 입구(②)를 단다.
 * - 저녁 기록(PRD ②)은 알림을 눌러 들어온 주소(/?open=evening)로도 열린다. 저장 직후 한 줄을 누르면 상태보기(입구 after_save)로 간다(③, G3).
 */

type Entry = { id: string; name: string };

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

/** 이 앱이 서버를 부르는 길 모음. 시험은 가짜를 넣는다 */
export type ShellApis = { offers: OffersApi; focus: FocusApi; push: PushApi };
const DEFAULT_APIS: ShellApis = { offers: defaultOffersApi, focus: defaultFocusApi, push: defaultPushApi };

export function AppShell({
  home,
  initialOpen = null,
  apis: apisProp,
}: {
  home: HomeRead;
  initialOpen?: "evening" | null;
  apis?: Partial<ShellApis>;
}) {
  // 부르는 길 모음은 렌더마다 새로 만들지 않는다(자식의 읽기 효과가 다시 돌지 않게)
  const apis = useMemo<ShellApis>(() => ({ ...DEFAULT_APIS, ...apisProp }), [apisProp]);
  const settings = home.settings.ok ? home.settings.data : null;
  const [done, setDone] = useState<OnboardingResult | null>(null);
  const needsOnboarding = settings !== null && !settings.onboardingDone && done === null;

  if (needsOnboarding && settings) {
    const readable: Entry[] = home.today.categories.ok
      ? home.today.categories.data.categories.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name }] : []))
      : [];
    return (
      <Onboarding
        api={defaultSettingsApi}
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
  return <MainShell initial={initial} initialOpen={initialOpen} apis={apis} settings={mySettings} />;
}

function MainShell({
  initial,
  initialOpen,
  apis,
  settings,
}: {
  initial: TodayRead;
  initialOpen: "evening" | null;
  apis: ShellApis;
  settings: SettingsData | null;
}) {
  const [tab, setTab] = useState<TabId>("todo");
  const [eveningOpen, setEveningOpen] = useState(initialOpen === "evening");
  const [growthEntry, setGrowthEntry] = useState<ViewEntry>("self");
  const [growthActivation, setGrowthActivation] = useState(0);
  const [timerActivation, setTimerActivation] = useState(0);
  const [category, setCategory] = useState<{ id: string | null; name: string } | null>(null);
  // 오늘 먼저 할 일 카드(⑤): 앱을 열 때 한 번 건네받는다. 반응이 없는(new) 것만 보인다
  const [cardOffer, setCardOffer] = useState<Offer | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<"failed" | "offline" | null>(null);
  // 타이머 탭의 추천(⑤): 탭을 열 때마다 건네받는다(같은 제시는 서버가 한 번만 센다)
  const [timerOffer, setTimerOffer] = useState<Offer | null>(null);
  // 이번 주 목표(⑥): 한 줄은 저녁 기록·목표를 저장한 뒤 다시 읽는다
  const [goalVersion, setGoalVersion] = useState(0);
  const [goalEditor, setGoalEditor] = useState<GoalSummary | null>(null);
  const cardStartRef = useRef<string | null>(null);

  // 처음 열 때 카드 제시를 받는다(서버에서 가져오는 일). 상태는 응답을 받은 뒤에만 바꾼다.
  useEffect(() => {
    let alive = true;
    void apis.offers.request("card").then((res) => {
      if (alive && res.ok && res.data.offer && res.data.offer.state === "new") setCardOffer(res.data.offer);
    });
    return () => {
      alive = false;
    };
  }, [apis]);

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
    setTab(next);
  }

  async function startFromCard() {
    const offer = cardOffer;
    if (!offer || cardBusy) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
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
      openTab("timer");
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

  const recommended = timerOffer
    ? {
        offerId: timerOffer.id,
        todoId: timerOffer.todoId,
        categoryId: timerOffer.categoryId,
        label: timerOffer.todoId ? "추천" : `추천 · ${timerOffer.categoryName} ${APP_CONFIG.timerMinutes}분`,
      }
    : null;

  return (
    <div className="app-shell" style={{ "--tabbar-h": "calc(56px + env(safe-area-inset-bottom))" } as React.CSSProperties}>
      <div hidden={tab !== "growth"}>
        <GrowthScreen
          api={defaultGrowthApi}
          active={tab === "growth"}
          activation={growthActivation}
          entry={growthEntry}
          onOpenCategory={(id, name) => setCategory({ id, name })}
        />
      </div>
      <div hidden={tab !== "todo"}>
        <TodoScreen
          initial={initial}
          manage={defaultManageApi}
          topSlot={
            <>
              <GoalLine api={defaultGoalsApi} refreshKey={goalVersion} onOpen={setGoalEditor} />
              {cardOffer && <OfferCard offer={cardOffer} busy={cardBusy} error={cardError} onStart={() => void startFromCard()} onDismiss={() => void dismissCard()} />}
              <EveningEntry evening={isEvening(new Date())} onOpen={() => setEveningOpen(true)} />
            </>
          }
        />
      </div>
      <div hidden={tab !== "timer"}>
        <TimerScreen
          api={apis.focus}
          fetchToday={fetchToday}
          active={tab === "timer"}
          activation={timerActivation}
          recommended={recommended}
          onActiveChange={() => {}}
        />
      </div>
      <div hidden={tab !== "me"}>
        <MeScreen settings={settings} categories={readableCategories(initial)} api={defaultSettingsApi} push={apis.push} />
      </div>
      <TabBar tabs={TABS} current={tab} onSelect={(next) => openTab(next)} />
      {eveningOpen && (
        <EveningRecord
          api={defaultEveningApi}
          onClose={() => setEveningOpen(false)}
          onSaved={() => setGoalVersion((n) => n + 1)}
          onOpenGrowth={() => {
            setEveningOpen(false);
            openTab("growth", "after_save");
          }}
          renderAfterSave={() => <AfterSaveShortfall api={defaultGrowthApi} />}
        />
      )}
      {goalEditor && (
        <GoalEditor
          api={defaultGoalsApi}
          categories={goalEditor.categories}
          goal={goalEditor.goal}
          onClose={() => setGoalEditor(null)}
          onSaved={() => setGoalVersion((n) => n + 1)}
        />
      )}
      {category && <CategoryPage api={defaultGrowthApi} categoryId={category.id} name={category.name} onClose={() => setCategory(null)} />}
    </div>
  );
}
