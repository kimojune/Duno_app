"use client";

import { useState } from "react";
import type { HomeRead } from "../lib/home-types";
import { defaultManageApi } from "../lib/manage-api";
import { defaultSettingsApi } from "../lib/onboarding-api";
import type { NotifySettings, RatioItem } from "../lib/settings/types";
import type { TodayRead } from "../lib/today-types";
import { Onboarding, type OnboardingResult } from "./onboarding";
import { TodoScreen } from "./todo-screen";

/**
 * 로그인한 뒤의 앱 전체 틀(클라이언트). 서버 컴포넌트(app/page.tsx)가 읽은 값(home)을 받아 화면들을 이어 붙인다.
 * - 처음 설정을 안 마쳤으면 처음 설정(Onboarding)부터 보여 준다(PRD ①). 설정을 못 읽었을 때는 강요하지 않고 앱을 보여 준다(임시).
 * - 할 일 화면에는 고치기·지우기·순서·작업 기록·어제 것 가져오기를 단다(PRD 0·0-1번).
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

export function AppShell({ home }: { home: HomeRead }) {
  const settings = home.settings.ok ? home.settings.data : null;
  const [done, setDone] = useState<OnboardingResult | null>(null);
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
  return <TodoScreen initial={initial} manage={defaultManageApi} />;
}
