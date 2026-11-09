"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { APP_CONFIG } from "../lib/app-config";
import { checkCategoryName, sameCategoryName } from "../lib/categories/validation";
import { categoryColorValue } from "../lib/category-color";
import type { EnableOutcome, SettingsApi } from "../lib/onboarding-api";
import type { NotifySettings, RatioItem } from "../lib/settings/types";
import { evenRatios } from "../lib/settings/validation";
import { NOTIFY_ITEMS } from "../lib/push/next";
import { formatClock } from "../lib/time-format";
import { BACK_HEADER_TEXT, BackHeader, BottomActions } from "./back-header";
import { entriesToRatios, RATIO_TEXT, RatioEditor, ratioKey, withOtherEntry, type RatioEntry } from "./ratio-editor";
import { ChipScroller } from "./chip-scroller";
import { GOAL_FIELD_TEXT, GoalField, goalFieldCheck } from "./goal-field";
import { Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";

/**
 * 처음 설정(PRD 7-1, ①). 네 단계: 목표 한 문장 → 분야 → 목표 비율 → 알림. 단계 제목은 모두 이름표(「목표」「분야」「목표 비율」「알림」, PM 7 · 명세 ③-O).
 * - 머리(components/back-header.tsx, Figma 49:178·49:194·49:232·50:4): 2~4단계는 왼쪽 위 「‹」(화면 읽기 「이전」, 포커스 순서 첫째 — PM 1-A) + 「4단계 중 n단계」 + 진행 막대 넷.
 *   아래 단추 줄에는 「이전」이 없고 주 단추 하나(1단계만 「건너뛰기」 글 단추가 그 위에), 화면 아래에 붙는다(정합 A2).
 * - 비율은 사용자가 직접 넣는다(AI가 채우지 않는다). 반드시 정한다(G4-2 가): 분야 하나 이상, 합이 0보다 커야 다음으로 간다.
 * - 분야는 적고 넓게. 예시 칩은 lib/app-config.ts 한 곳에서 읽는다(마감 있는 일 없음, D-132).
 * - 알림(S1-4): 줄 둘(켬이 기본) + 줄마다 시각과 실제 알림 글 미리 보기(⑬ 4·5·6, 글은 lib/push/next.ts NOTIFY_ITEMS 한 곳에서). 끝 단추는 「시작하기」 하나(PM 1).
 *   누르면 켠 알림이 있을 때만 브라우저 허락을 묻고 구독한다(D-102⑤). 다 껐으면 허락을 묻지 않는다(requestPermission 호출 없음). 허락하지 않아도 앱으로 들어간다.
 *   줄마다 이름 아래 시각 칸 「오후 7:30 ▾」(내 정보와 같은 NotifyRow, PM d-157 ① · 명세 ⑲ — 보이는 「시각」 글은 없고 화면 읽기 이름 「… 시각」), 그 아래 미리 보기. 처음 값은 오후 7:30 · 오전 10:00, 고른 값이 저장 인자(notify eveningMinute·morningMinute)로 간다.
 *   미리 보기는 실제 알림 글 그대로(PM d-157 ②): 저녁 = 본문, 아침 = 제목(분야 이름 없음). 글 원본은 lib/push/next.ts NOTIFY_ITEMS 한 곳.
 * - AI 없이 돈다. 이 화면에 AI는 없다(AI 자리 ① 분야 초안은 다음 판).
 * 모든 글은 React 텍스트로만 그린다.
 */

export const ONBOARDING_TEXT = {
  title: "시작하기",
  step: BACK_HEADER_TEXT.step,
  goalHeading: "목표",
  goalLabel: GOAL_FIELD_TEXT.label, // 칸은 components/goal-field.tsx(S8-b와 같이 씀)
  goalHint: GOAL_FIELD_TEXT.example, // 칸 아래 예시(⑬ 1, 칸 안 흐린 글이 아님 — UI-06)
  categoryHeading: "분야",
  categorySub: "시간을 나눠 쓸 곳 · 여러 개", // 이름표 아래 보조 한 줄(⑬ 2)
  categoryGroup: "분야",
  exampleGroup: "예시",
  newCategoryLabel: "새 분야 이름",
  addCategory: "더하기",
  addingCategory: "더하는 중",
  categoryNeed: "분야를 하나 이상 골라 주세요.",
  categoryFailed: "분야를 더하지 못했어요. 다시 눌러 주세요.",
  categoryAlready: (name: string) => `이미 있는 분야라서 골랐어요: ${name}`,
  categoryReserved: "기타는 더하지 않아도 돼요. 분야를 고르지 않은 할 일은 기타로 들어가요.",
  ratioHeading: "목표 비율",
  ratioNeed: "하나 이상은 0%보다 커야 해요.",
  notifyHeading: "알림",
  eveningName: "오늘 기록 알림",
  morningName: "아침 알림",
  /** 시각 칸 아래 미리 보기(명세 ⑲ · PM d-157 ②, Figma 50:4 고침): “실제 알림 글”. 저녁 = 알림 본문, 아침 = 알림 제목(실제 푸시 글 그대로 — 분야 이름 없음). 시각은 위 시각 칸에 있다 */
  eveningPreview: () => `“${NOTIFY_ITEMS.evening.body}”`,
  morningPreview: () => `“${NOTIFY_ITEMS.morning.title}”`,
  next: "다음",
  skipGoal: "건너뛰기",
  start: "시작하기",
  saving: BACK_HEADER_TEXT.saving, // 「저장 중」(O-7)
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
  /** 켠 알림이 있어 「시작하기」가 허락을 물었을 때 알림 켜기 결과. 묻지 않았으면 null(B4: 첫 화면이 이 결과를 알린다) */
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

/** 고른 칩 앞 ✓(S5 칩과 같은 꼴) */
function ChipCheck() {
  return (
    <svg className="chip-check" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
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

  async function finish() {
    if (saving) return;
    setSaving(true);
    setMessage("");
    // 켠 알림이 있을 때만 허락을 묻는다(D-102⑤). 다 껐으면 묻지도 구독하지도 않는다
    const allow = eveningOn || morningOn;
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
    <main className="onboarding screen-fill" aria-labelledby="onboarding-heading">
      <BackHeader onBack={step > 1 ? goBack : undefined} backDisabled={saving} step={{ n: step, total: TOTAL_STEPS }} />
      <form className="screen-fill-body" onSubmit={submit} noValidate>
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
            <p className="onboarding-sub">{ONBOARDING_TEXT.categorySub}</p>
            <ChipScroller aria-label={ONBOARDING_TEXT.categoryGroup}>
              {/* 고침10 J(49:194): 칩 = 색 점 10 + 이름. 안 고른 칩 앞에 「+」를 붙이지 않는다 */}
              {catalog.map((c, index) => (
                <button key={c.id} type="button" className="chip" aria-pressed={selected.includes(c.id)} onClick={() => toggleCategory(c.id)}>
                  <span className="chip-face">
                    {selected.includes(c.id) && <ChipCheck />}
                    <span className="chip-dot" style={{ background: categoryColorValue(index) }} aria-hidden="true" />
                    <span className="chip-label">{c.name}</span>
                  </span>
                </button>
              ))}
            </ChipScroller>
            {examples.length > 0 && (
              <ChipScroller aria-label={ONBOARDING_TEXT.exampleGroup}>
                {examples.map((name, index) => (
                  <button key={name} type="button" className="chip chip-add" onClick={() => void addNamed(name)} disabled={addingName !== null}>
                    <span className="chip-face">
                      {/* 점 색 = 이 칩이 분야가 되면 갖게 될 자리의 색(지금 분야 수 + 예시 순서). 이름 앞 「+」는 없다 */}
                      <span className="chip-dot" style={{ background: categoryColorValue(catalog.length + index) }} aria-hidden="true" />
                      <span className="chip-label">{name}</span>
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
            <div className="onboarding-title-row">
              <h1 id="onboarding-heading" className="onboarding-title" tabIndex={-1} ref={headingRef}>
                {ONBOARDING_TEXT.ratioHeading}
              </h1>
              <p className="ratio-caption">{RATIO_TEXT.caption}</p>
            </div>
            <RatioEditor
              showCaption={false}
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
            <div className="card-box notify-card">
              <NotifyRow
                id="evening"
                name={ONBOARDING_TEXT.eveningName}
                preview={ONBOARDING_TEXT.eveningPreview()}
                on={eveningOn}
                minute={eveningMinute}
                onToggle={setEveningOn}
                onMinute={setEveningMinute}
                hideTimeLabel
              />
              <NotifyRow
                id="morning"
                name={ONBOARDING_TEXT.morningName}
                preview={ONBOARDING_TEXT.morningPreview()}
                on={morningOn}
                minute={morningMinute}
                onToggle={setMorningOn}
                onMinute={setMorningMinute}
                hideTimeLabel
              />
            </div>
          </section>
        )}

        {message && (
          <Notice role="alert" className="onboarding-notice">
            {message}
          </Notice>
        )}

        <BottomActions>
          {step === 1 && (
            <TextButton
              className="text-tap"
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
            <PrimaryButton busy={saving} disabled={saving} onClick={() => void finish()}>
              {saving ? ONBOARDING_TEXT.saving : ONBOARDING_TEXT.start}
            </PrimaryButton>
          )}
        </BottomActions>
      </form>
    </main>
  );
}

/**
 * 알림 한 줄(처음 설정 S1-4와 내 정보 S8이 같이 쓴다): 이름 + 오른쪽 켜고 끄기(스위치 모양의 체크 상자, 이름이 접근성 이름).
 * - preview가 있으면 시각 칸 아래에 실제 알림 글 미리 보기(처음 설정, ⑬ 5·6 · ⑲).
 * - onMinute가 있으면 줄 아래에 「시각」 고르기(30분 단위 — 처음 설정·내 정보). 끈 알림은 시각을 못 고른다. 줄 설명 글은 없다(⑬ 25 뺀 채로).
 * - busy(내 정보 바로 저장 중)는 disabled가 아니라 aria-disabled로 막는다: 바꾸기는 무시하고 키보드 포커스는 그 자리에 남는다(검토 LOW).
 *   disabled(오프라인)는 진짜로 막는다.
 */
export function NotifyRow({
  id,
  name,
  preview,
  on,
  minute,
  onToggle,
  onMinute,
  disabled,
  busy,
  hideTimeLabel,
}: {
  id: string;
  name: string;
  preview?: string;
  on: boolean;
  minute?: number;
  onToggle: (on: boolean) => void;
  onMinute?: (minute: number) => void;
  /** 오프라인이면 켜고 끄기·시각을 막는다(내 정보 바로 저장, O-5) */
  disabled?: boolean;
  /** 저장 중: aria-disabled로 알리고 바꾸기를 무시한다(포커스는 남음) */
  busy?: boolean;
  /** 시각 칸 앞 「시각」 글을 화면 읽기에만 둔다(처음 설정 — Figma 50:4) */
  hideTimeLabel?: boolean;
}) {
  const options = timeOptions();
  // 30분 단위가 아닌 값(옛 설정)도 고를 수 있게 목록에 끼워 둔다
  const list = minute === undefined || options.includes(minute) ? options : [...options, minute].sort((a, b) => a - b);
  return (
    <div className="notify-row">
      <label className="notify-toggle">
        <span className="notify-name">{name}</span>
        <input
          type="checkbox"
          className="notify-switch-input"
          checked={on}
          disabled={disabled}
          aria-disabled={busy ? true : undefined}
          onChange={(e) => {
            if (busy) return; // 저장 중: 바꾸지 않는다(controlled라 화면은 그대로)
            onToggle(e.target.checked);
          }}
          aria-describedby={preview ? `${id}-preview` : undefined}
        />
        <span className="notify-switch" aria-hidden="true" />
      </label>
      {onMinute && minute !== undefined && (
        <div className="notify-time">
          <label htmlFor={`${id}-time`} className={hideTimeLabel ? "sr-only" : "notify-time-label"}>
            <span className="sr-only">{name} </span>시각
          </label>
          <select
            id={`${id}-time`}
            className="input notify-time-select"
            value={minute}
            disabled={!on || disabled}
            aria-disabled={busy ? true : undefined}
            onChange={(e) => {
              if (busy) return;
              onMinute(Number(e.target.value));
            }}
          >
            {list.map((m) => (
              <option key={m} value={m}>
                {formatClock(m)}
              </option>
            ))}
          </select>
        </div>
      )}
      {preview && (
        <p id={`${id}-preview`} className="notify-preview">
          {preview}
        </p>
      )}
    </div>
  );
}
