"use client";

import { useState } from "react";
import { isEvening } from "../lib/app-config";
import { defaultEveningApi } from "../lib/evening-api";
import { defaultFocusApi } from "../lib/focus-api";
import { defaultGrowthApi } from "../lib/growth-api";
import type { HomeRead } from "../lib/home-types";
import { defaultManageApi } from "../lib/manage-api";
import { defaultSettingsApi } from "../lib/onboarding-api";
import { fetchToday } from "../lib/read-client";
import type { NotifySettings, RatioItem } from "../lib/settings/types";
import type { TodayRead } from "../lib/today-types";
import type { ViewEntry } from "../lib/views/core-types";
import { CategoryPage } from "./category-page";
import { EveningEntry, EveningRecord } from "./evening-record";
import { AfterSaveShortfall, GrowthScreen } from "./growth-screen";
import { Onboarding, type OnboardingResult } from "./onboarding";
import { TabBar, type TabId } from "./tab-bar";
import { TimerScreen } from "./timer-screen";
import { TodoScreen } from "./todo-screen";

/**
 * 로그인한 뒤의 앱 전체 틀(클라이언트). 서버 컴포넌트(app/page.tsx)가 읽은 값(home)을 받아 화면들을 이어 붙인다.
 * - 처음 설정을 안 마쳤으면 처음 설정(Onboarding)부터 보여 준다(PRD ①). 설정을 못 읽었을 때는 강요하지 않고 앱을 보여 준다(임시).
 * - 아래 탭: 상태보기 · 할 일(처음 탭) · 타이머. 탭을 옮겨도 다른 탭은 지우지 않고 숨긴다(적던 글·도는 타이머가 살아 있게).
 * - 할 일 화면에는 고치기·지우기·순서·작업 기록·어제 것 가져오기를 단다(PRD 0·0-1번).
 * - 저녁 기록(PRD ②)은 할 일 화면 위의 입구로 열고, 알림을 눌러 들어온 주소(/?open=evening)로도 열린다.
 *   저장 직후 한 줄을 누르면 상태보기(입구 after_save)로 간다(PRD ③, G3).
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

const TABS: TabId[] = ["growth", "todo", "timer"];

export function AppShell({ home, initialOpen = null }: { home: HomeRead; initialOpen?: "evening" | null }) {
  const settings = home.settings.ok ? home.settings.data : null;
  const [done, setDone] = useState<OnboardingResult | null>(null);
  const [tab, setTab] = useState<TabId>("todo");
  const [eveningOpen, setEveningOpen] = useState(initialOpen === "evening");
  const [growthEntry, setGrowthEntry] = useState<ViewEntry>("self");
  const [growthActivation, setGrowthActivation] = useState(0);
  const [timerActivation, setTimerActivation] = useState(0);
  const [category, setCategory] = useState<{ id: string | null; name: string } | null>(null);
  const needsOnboarding = settings !== null && !settings.onboardingDone && done === null;

  const readable: Entry[] = home.today.categories.ok
    ? home.today.categories.data.categories.flatMap((c) => (c.readable ? [{ id: c.id, name: c.name }] : []))
    : [];

  if (needsOnboarding && settings) {
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
  const ratios: RatioItem[] = done ? done.ratios : (settings?.ratios ?? []);
  const notify: NotifySettings | null = done ? done.notify : (settings?.notify ?? null);
  void ratios;
  void notify;

  /** 탭을 연다. 상태보기는 열 때마다 다시 읽고 본 것을 한 번 남긴다(입구와 함께) */
  function openTab(next: TabId, entry: ViewEntry = "self") {
    if (next === "growth") {
      setGrowthEntry(entry);
      setGrowthActivation((n) => n + 1);
    }
    if (next === "timer") setTimerActivation((n) => n + 1);
    setTab(next);
  }

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
          topSlot={<EveningEntry evening={isEvening(new Date())} onOpen={() => setEveningOpen(true)} />}
        />
      </div>
      <div hidden={tab !== "timer"}>
        <TimerScreen api={defaultFocusApi} fetchToday={fetchToday} active={tab === "timer"} activation={timerActivation} />
      </div>
      <TabBar tabs={TABS} current={tab} onSelect={(next) => openTab(next)} />
      {eveningOpen && (
        <EveningRecord
          api={defaultEveningApi}
          onClose={() => setEveningOpen(false)}
          onOpenGrowth={() => {
            setEveningOpen(false);
            openTab("growth", "after_save");
          }}
          renderAfterSave={() => <AfterSaveShortfall api={defaultGrowthApi} />}
        />
      )}
      {category && <CategoryPage api={defaultGrowthApi} categoryId={category.id} name={category.name} onClose={() => setCategory(null)} />}
    </div>
  );
}
