"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { APP_CONFIG } from "../lib/app-config";
import { checkCategoryName, sameCategoryName } from "../lib/categories/validation";
import type { EnableOutcome, SettingsApi } from "../lib/onboarding-api";
import type { NotifySettings, RatioItem } from "../lib/settings/types";
import { evenRatios } from "../lib/settings/validation";
import { formatClock } from "../lib/time-format";
import { entriesToRatios, RatioEditor, ratioKey, withOtherEntry, type RatioEntry } from "./ratio-editor";
import { ChipScroller } from "./chip-scroller";
import { GOAL_FIELD_TEXT, GoalField, goalFieldCheck } from "./goal-field";
import { Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";

/**
 * 처음 설정(PRD 7-1, ①). 네 단계: 목표 한 문장 → 분야 → 처음 정한 비율 → 알림.
 * - 비율은 사용자가 직접 넣는다(AI가 채우지 않는다). 반드시 정한다(G4-2 가): 분야 하나 이상, 합이 0보다 커야 다음으로 간다.
 * - 분야는 적고 넓게. 예시 칩은 lib/app-config.ts 한 곳에서 읽는다(마감 있는 일 없음, D-132).
 * - 알림은 끝에서 허락을 묻는다(D-102⑤). 허락하면 둘 다 켜진 채 시작한다. 나중에 해도 앱을 쓴다.
 * - AI 없이 돈다. 이 화면에 AI는 없다(AI 자리 ① 분야 초안은 다음 판).
 * 모든 글은 React 텍스트로만 그린다.
 */

export const ONBOARDING_TEXT = {
  title: "시작하기",
  step: (n: number, total: number) => `${total}단계 중 ${n}단계`,
  goalHeading: "이루고 싶은 것을 한 문장으로 적어 주세요",
  goalLabel: GOAL_FIELD_TEXT.label, // 칸은 components/goal-field.tsx(S8-b와 같이 씀)
  goalHint: "흐릿해도 괜찮아요. 건너뛰어도 돼요.",
  categoryHeading: "시간을 나눠 쓸 분야를 골라 주세요",
  categoryHint: "적고 넓게 시작해요. 쓰면서 나눌 수 있어요.",
  categoryGroup: "분야",
  exampleGroup: "예시",
  newCategoryLabel: "새 분야 이름",
  addCategory: "더하기",
  addingCategory: "더하는 중",
  categoryNeed: "분야를 하나 이상 골라 주세요.",
  categoryFailed: "분야를 더하지 못했어요. 다시 눌러 주세요.",
  categoryAlready: (name: string) => `이미 있는 분야라서 골랐어요: ${name}`,
  categoryReserved: "기타는 더하지 않아도 돼요. 분야를 고르지 않은 할 일은 기타로 들어가요.",
  ratioHeading: "분야마다 시간을 얼마나 쓰고 싶은지 정해 주세요",
  ratioNeed: "하나 이상은 0%보다 커야 해요.",
  notifyHeading: "알림을 받을까요?",
  notifyHint: "정한 시각에 알려 드려요. 시각은 나중에 바꿀 수 있어요.",
  eveningName: "오늘 기록 알림",
  eveningDesc: "저녁에 오늘 쓴 시간을 남기도록 알려 드려요.",
  morningName: "아침 알림",
  morningDesc: "아침에 앱을 열도록 알려 드려요.",
  next: "다음",
  back: "이전",
  skipGoal: "건너뛰기",
  startAllow: "허락하고 시작하기",
  startLater: "나중에 하고 시작하기",
  saving: "저장하는 중",
  saveFailed: "저장하지 못했어요. 다시 눌러 주세요.",
  denied: "알림이 허락되지 않았어요. 브라우저 설정에서 바꿀 수 있어요.",
  pushUnsupported: "이 브라우저는 알림을 받을 수 없어요.",
  pushMissingKey: "알림을 보내는 설정이 아직 없어서 알림은 켜지 않았어요. 설정이 끝나면 내 정보에서 켤 수 있어요.",
  pushFailed: "알림을 켜지 못했어요. 내 정보에서 다시 켤 수 있어요.",
  tooLong: GOAL_FIELD_TEXT.tooLong,
} as const;

type CategoryEntry = { id: string; name: string };
type Step = 1 | 2 | 3 | 4;
const TOTAL_STEPS = 4;

export type OnboardingResult = {
  goal: string | null;
  ratios: RatioItem[];
  categories: CategoryEntry[];
  notify: NotifySettings;
  /** 「허락하고 시작하기」를 눌렀을 때 알림 켜기 결과. 누르지 않았으면 null(B4: 첫 화면이 이 결과를 알린다) */
  pushOutcome?: EnableOutcome | null;
};

/** 알림 켜기가 granted가 아닐 때 사용자에게 보일 글(granted·null은 글이 없다) */
export function pushOutcomeText(outcome: EnableOutcome | null | undefined): string | null {
  switch (outcome) {
    case "denied":
    case "default":
      return ONBOARDING_TEXT.denied;
    case "unsupported":
      return ONBOARDING_TEXT.pushUnsupported;
    case "missing_key":
      return ONBOARDING_TEXT.pushMissingKey;
    case "failed":
      return ONBOARDING_TEXT.pushFailed;
    default:
      return null;
  }
}

function timeOptions(): number[] {
  return Array.from({ length: 48 }, (_, i) => i * 30);
}

export function Onboarding({
  api,
  categories,
  initialGoal,
  initialRatios,
  initialNotify,
  onDone,
}: {
  api: SettingsApi;
  /** 이미 있는 분야(보관 안 한 것, 이름을 풀 수 있는 것) */
  categories: CategoryEntry[];
  initialGoal: string | null;
  initialRatios: RatioItem[];
  initialNotify: NotifySettings;
  onDone: (result: OnboardingResult) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [goal, setGoal] = useState(initialGoal ?? "");
  const [catalog, setCatalog] = useState<CategoryEntry[]>(categories);
  const [selected, setSelected] = useState<string[]>(() => {
    const withRatio = initialRatios.flatMap((r) => (r.categoryId !== null && categories.some((c) => c.id === r.categoryId) ? [r.categoryId] : []));
    return withRatio.length > 0 ? withRatio : categories.map((c) => c.id);
  });
  const [percents, setPercents] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialRatios.map((r) => [ratioKey(r.categoryId), r.percent])),
  );
  const [newName, setNewName] = useState("");
  const [addingName, setAddingName] = useState<string | null>(null);
  const [categoryMessage, setCategoryMessage] = useState("");
  const [eveningOn, setEveningOn] = useState(true);
  const [morningOn, setMorningOn] = useState(true);
  const [eveningMinute, setEveningMinute] = useState(initialNotify.eveningMinute);
  const [morningMinute, setMorningMinute] = useState(initialNotify.morningMinute);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const requestIds = useRef(new Map<string, string>());

  // 단계가 바뀌면 그 단계 제목으로 포커스(화면 읽기 프로그램이 새 단계를 읽는다)
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const { check: goalCheck, over: goalOver } = goalFieldCheck(goal);

  // 고른 분야 줄들 뒤에 기타 줄이 하나 더 있다(기타도 비율에 넣을 수 있다, 처음에는 0%)
  const entries: RatioEntry[] = withOtherEntry(
    selected
      .map((id) => catalog.find((c) => c.id === id))
      .filter((c): c is CategoryEntry => c !== undefined)
      .map((c) => ({ id: c.id, name: c.name, percent: percents[c.id] ?? 0, colorOrder: catalog.findIndex((x) => x.id === c.id) })),
    percents,
  );
  const total = entries.reduce((s, e) => s + e.percent, 0);

  function toggleCategory(id: string) {
    setCategoryMessage("");
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function addNamed(raw: string) {
    if (addingName !== null) return;
    setCategoryMessage("");
    const checked = checkCategoryName(raw);
    if (!checked.ok) {
      if (checked.error === "reserved") setCategoryMessage(ONBOARDING_TEXT.categoryReserved);
      return;
    }
    const name = checked.name;
    const have = catalog.find((c) => sameCategoryName(c.name, name));
    if (have) {
      setSelected((prev) => (prev.includes(have.id) ? prev : [...prev, have.id]));
      setCategoryMessage(ONBOARDING_TEXT.categoryAlready(have.name));
      setNewName("");
      return;
    }
    // 같은 이름으로 다시 누르면 같은 요청 번호(서버가 한 번만 만든다)
    const key = name.toLowerCase();
    const requestId = requestIds.current.get(key) ?? crypto.randomUUID();
    requestIds.current.set(key, requestId);
    setAddingName(name);
    const res = await api.addCategory(requestId, name);
    setAddingName(null);
    if (res.ok) {
      const cat = res.data.category;
      if (cat.readable) {
        setCatalog((prev) => (prev.some((c) => c.id === cat.id) ? prev : [...prev, { id: cat.id, name: cat.name }]));
        setSelected((prev) => (prev.includes(cat.id) ? prev : [...prev, cat.id]));
        setNewName("");
      }
      return;
    }
    if (res.error === "duplicate") {
      const existing = res.existing;
      setCatalog((prev) => (prev.some((c) => c.id === existing.id) ? prev : [...prev, existing]));
      setSelected((prev) => (prev.includes(existing.id) ? prev : [...prev, existing.id]));
      setCategoryMessage(ONBOARDING_TEXT.categoryAlready(existing.name));
      setNewName("");
      return;
    }
    if (res.error === "reserved") {
      setCategoryMessage(ONBOARDING_TEXT.categoryReserved);
      return;
    }
    setCategoryMessage(ONBOARDING_TEXT.categoryFailed);
  }

  function goNext() {
    setMessage("");
    if (step === 1) {
      if (goalOver) return;
      setStep(2);
    } else if (step === 2) {
      if (selected.length === 0) {
        setCategoryMessage(ONBOARDING_TEXT.categoryNeed);
        return;
      }
      // 비율을 처음 넣는 분야는 고르게 나눈 값으로 시작한다(고칠 수 있다)
      const split = evenRatios(selected);
      setPercents((prev) => {
        const known = selected.filter((id) => prev[id] !== undefined);
        if (known.length > 0) return { ...prev, ...Object.fromEntries(selected.filter((id) => prev[id] === undefined).map((id) => [id, 0])) };
        return Object.fromEntries(split.map((r) => [r.categoryId, r.percent]));
      });
      setStep(3);
    } else if (step === 3) {
      if (total <= 0) {
        setMessage(ONBOARDING_TEXT.ratioNeed);
        return;
      }
      setStep(4);
    }
  }

  function goBack() {
    setMessage("");
    if (step > 1) setStep((step - 1) as Step);
  }

  async function finish(allow: boolean) {
    if (saving) return;
    setSaving(true);
    setMessage("");
    let notifyOn = false;
    let pushOutcome: EnableOutcome | null = null;
    if (allow) {
      // 알림이 안 켜져도 처음 설정은 저장하고 끝낸다(A3). 결과는 첫 화면이 알린다(B4)
      try {
        pushOutcome = await api.requestPermission();
      } catch {
        pushOutcome = "failed";
      }
      notifyOn = pushOutcome === "granted";
      const text = pushOutcomeText(pushOutcome);
      if (text) setMessage(text);
    }
    const ratios: RatioItem[] = entriesToRatios(entries);
    const notify: NotifySettings = {
      eveningEnabled: notifyOn && eveningOn,
      eveningMinute,
      morningEnabled: notifyOn && morningOn,
      morningMinute,
    };
    const savedRatios = await api.saveRatios(ratios);
    if (!savedRatios.ok) {
      setSaving(false);
      setMessage(ONBOARDING_TEXT.saveFailed);
      return;
    }
    const savedSettings = await api.saveSettings({
      goal: goalCheck.ok ? goalCheck.goal : null,
      notify,
      completeOnboarding: true,
    });
    setSaving(false);
    if (!savedSettings.ok) {
      setMessage(ONBOARDING_TEXT.saveFailed);
      return;
    }
    onDone({ goal: goalCheck.ok ? goalCheck.goal : null, ratios, categories: catalog, notify, pushOutcome });
  }

  function onGoalKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!(event.nativeEvent.isComposing || event.keyCode === 229)) goNext();
  }
  function onNewNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!(event.nativeEvent.isComposing || event.keyCode === 229)) void addNamed(newName);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
  }

  const examples = APP_CONFIG.categoryExamples.filter((name) => !catalog.some((c) => sameCategoryName(c.name, name)));

  return (
    <main className="onboarding" aria-labelledby="onboarding-heading">
      <p className="onboarding-step">{ONBOARDING_TEXT.step(step, TOTAL_STEPS)}</p>
      <form onSubmit={submit} noValidate>
        {step === 1 && (
          <section>
            <h1 id="onboarding-heading" className="onboarding-title" tabIndex={-1} ref={headingRef}>
              {ONBOARDING_TEXT.goalHeading}
            </h1>
            <GoalField
              inputId="goal-input"
              helpId="goal-help"
              value={goal}
              onChange={setGoal}
              help={ONBOARDING_TEXT.goalHint}
              placeholder={APP_CONFIG.goalPlaceholder}
              onKeyDown={onGoalKeyDown}
              enterKeyHint="next"
            />
          </section>
        )}

        {step === 2 && (
          <section>
            <h1 id="onboarding-heading" className="onboarding-title" tabIndex={-1} ref={headingRef}>
              {ONBOARDING_TEXT.categoryHeading}
            </h1>
            <p className="todo-sub">{ONBOARDING_TEXT.categoryHint}</p>
            <ChipScroller aria-label={ONBOARDING_TEXT.categoryGroup}>
              {catalog.map((c) => (
                <button key={c.id} type="button" className="chip" aria-pressed={selected.includes(c.id)} onClick={() => toggleCategory(c.id)}>
                  <span className="chip-face">
                    <span className="chip-label">{c.name}</span>
                  </span>
                </button>
              ))}
            </ChipScroller>
            {examples.length > 0 && (
              <ChipScroller aria-label={ONBOARDING_TEXT.exampleGroup}>
                {examples.map((name) => (
                  <button key={name} type="button" className="chip chip-add" onClick={() => void addNamed(name)} disabled={addingName !== null}>
                    <span className="chip-face">
                      <span className="chip-label">+ {name}</span>
                    </span>
                  </button>
                ))}
              </ChipScroller>
            )}
            <label htmlFor="new-category-input" className="input-label sheet-todo-label">
              {ONBOARDING_TEXT.newCategoryLabel}
            </label>
            <div className="input-row">
              <input
                id="new-category-input"
                className="input"
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setCategoryMessage("");
                }}
                onKeyDown={onNewNameKeyDown}
                autoComplete="off"
                enterKeyHint="done"
              />
              <SecondaryButton busy={addingName !== null} disabled={addingName !== null} onClick={() => void addNamed(newName)}>
                {addingName !== null ? ONBOARDING_TEXT.addingCategory : ONBOARDING_TEXT.addCategory}
              </SecondaryButton>
            </div>
            <p className="input-help" role="status">
              {categoryMessage}
            </p>
          </section>
        )}

        {step === 3 && (
          <section>
            <h1 id="onboarding-heading" className="onboarding-title" tabIndex={-1} ref={headingRef}>
              {ONBOARDING_TEXT.ratioHeading}
            </h1>
            <RatioEditor
              entries={entries}
              onChange={(next) => setPercents((prev) => ({ ...prev, ...Object.fromEntries(next.map((e) => [e.id, e.percent])) }))}
            />
          </section>
        )}

        {step === 4 && (
          <section>
            <h1 id="onboarding-heading" className="onboarding-title" tabIndex={-1} ref={headingRef}>
              {ONBOARDING_TEXT.notifyHeading}
            </h1>
            <p className="todo-sub">{ONBOARDING_TEXT.notifyHint}</p>
            <NotifyRow
              id="evening"
              name={ONBOARDING_TEXT.eveningName}
              desc={ONBOARDING_TEXT.eveningDesc}
              on={eveningOn}
              minute={eveningMinute}
              onToggle={setEveningOn}
              onMinute={setEveningMinute}
            />
            <NotifyRow
              id="morning"
              name={ONBOARDING_TEXT.morningName}
              desc={ONBOARDING_TEXT.morningDesc}
              on={morningOn}
              minute={morningMinute}
              onToggle={setMorningOn}
              onMinute={setMorningMinute}
            />
          </section>
        )}

        {message && (
          <Notice role="alert" className="onboarding-notice">
            {message}
          </Notice>
        )}

        <div className="onboarding-actions">
          {step > 1 && (
            <TextButton disabled={saving} onClick={goBack}>
              {ONBOARDING_TEXT.back}
            </TextButton>
          )}
          {step === 1 && (
            <TextButton
              onClick={() => {
                setGoal("");
                setStep(2);
              }}
            >
              {ONBOARDING_TEXT.skipGoal}
            </TextButton>
          )}
          {step < 4 && (
            <PrimaryButton disabled={step === 1 && goalOver} onClick={goNext}>
              {ONBOARDING_TEXT.next}
            </PrimaryButton>
          )}
          {step === 4 && (
            <>
              <SecondaryButton disabled={saving} onClick={() => void finish(false)}>
                {ONBOARDING_TEXT.startLater}
              </SecondaryButton>
              <PrimaryButton busy={saving} disabled={saving} onClick={() => void finish(true)}>
                {saving ? ONBOARDING_TEXT.saving : ONBOARDING_TEXT.startAllow}
              </PrimaryButton>
            </>
          )}
        </div>
      </form>
    </main>
  );
}

/** 알림 한 줄: 켜고 끄기 + 시각 고르기(30분 단위). 시각 글은 어미 없이 */
export function NotifyRow({
  id,
  name,
  desc,
  on,
  minute,
  onToggle,
  onMinute,
}: {
  id: string;
  name: string;
  desc: string;
  on: boolean;
  minute: number;
  onToggle: (on: boolean) => void;
  onMinute: (minute: number) => void;
}) {
  const options = timeOptions();
  // 30분 단위가 아닌 값(옛 설정)도 고를 수 있게 목록에 끼워 둔다
  const list = options.includes(minute) ? options : [...options, minute].sort((a, b) => a - b);
  return (
    <div className="notify-row">
      <label className="notify-toggle">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} aria-describedby={`${id}-desc`} />
        <span className="notify-name">{name}</span>
      </label>
      <p id={`${id}-desc`} className="todo-sub">
        {desc}
      </p>
      <label htmlFor={`${id}-time`} className="input-label">
        {name} 시각
      </label>
      <select id={`${id}-time`} className="input" value={minute} disabled={!on} onChange={(e) => onMinute(Number(e.target.value))}>
        {list.map((m) => (
          <option key={m} value={m}>
            {formatClock(m)}
          </option>
        ))}
      </select>
    </div>
  );
}
