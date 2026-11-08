"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { APP_CONFIG } from "../lib/app-config";
import { buildItems, classifySaveMode, notSplitItems, prefillItems, type EveningItem } from "../lib/evening/logic";
import type { EveningState, SavedEvening } from "../lib/evening/types";
import type { EveningApi } from "../lib/evening-api";
import { formatDeltaMinutes, formatMinutes } from "../lib/time-format";
import { useOnline } from "../lib/use-online";
import { addDays } from "../lib/week";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { rescaleSplit } from "../lib/ratio-dial-calc";
import { categoryColorValue } from "../lib/category-color";
import { RatioDial, type DialSlice } from "./ratio-dial";
import { Stepper } from "./stepper";
import { Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";

/**
 * 저녁 기록(PRD 7-3, ②). 두 단계: 「오늘 몇 시간 썼어요?」 → 분야마다 나누기. 한 화면에서 아래로 내려 보지 않는다.
 * - 첫 단계에 「나누지 않고 저장」이 있다(그날 시간은 전부 기타, 임시).
 * - 둘째 단계는 오늘 끝낸 할 일의 분야와 타이머 시간으로 미리 채워 두고(AI 없이), 나머지는 기타로 둔다.
 * - 저장하면 바로 「오늘 바뀐 분야별 시간」 한 줄을 보인다(값은 목표 대비가 아니라 바뀐 것). 그 줄을 누르면 상태보기로 간다.
 * - 저장할 때마다 저장 방식(미리 채운 그대로·고침·나누지 않음)·대상 날·저장 시각이 남는다(G9, 서버가 시각을 정한다).
 * - 오늘과 어제 중 대상 날을 고를 수 있다. 입력 모양은 PM이 써 보며 확정한다(임시: −/+ 단추와 숫자 칸).
 * - 「분야마다 나누기」 위쪽에 원형 다이얼(고침4 2단계): 원 전체 = 쓴 시간, 조각 = 분야마다 분, 맨 끝 조각 = 기타(쓴 시간 − 나눈 합).
 *   다이얼과 분야마다 Stepper는 같은 값을 쓴다(Stepper는 끌지 않는 길, WCAG 2.5.7). 손잡이 한 걸음은 minuteStep(5분), 끌기도 5분 단위.
 *   나눈 합은 쓴 시간을 넘지 못한다(PM 확정 11-08): Stepper도 기타에 남은 만큼까지만 늘어난다. 쓴 시간 0분이면 다이얼을 그리지 않는다.
 * - 나눈 뒤 앞 단계로 돌아가 쓴 시간을 고치면: 나눈 값을 고친 적이 없으면 새 쓴 시간으로 다시 미리 채우고,
 *   고친 적이 있거나 이미 남긴 기록이면 비율을 지키며 5분 단위로 다시 나눈다(남는 것은 기타).
 * 연결이 끊기면 저장하지 않고(이번 범위는 할 일만 오프라인) 안내한다. 입력한 값은 그대로 둔다.
 */

export const EVENING_TEXT = {
  title: "저녁 기록",
  close: "닫기",
  dayGroup: "기록할 날",
  today: "오늘",
  yesterday: "어제",
  askToday: "오늘 몇 시간 썼어요?",
  askYesterday: "어제 몇 시간 썼어요?",
  hours: "시간",
  minutes: "분",
  total: (m: number) => `합계 ${formatMinutes(m)}`,
  timerFilled: (m: number) => `타이머로 ${formatMinutes(m)} 미리 채웠어요.`,
  existing: "이미 남긴 기록이 있어요. 고쳐서 다시 저장할 수 있어요.",
  skipSplit: "나누지 않고 저장",
  split: "분야마다 나누기",
  splitHeading: "분야마다 나눠 주세요",
  splitHint: "미리 채운 값을 확인하고 고쳐요. 나누지 않은 시간은 기타로 들어가요.",
  other: "기타",
  otherRemain: (m: number) => formatMinutes(m),
  raised: (m: number) => `나눈 시간이 합계보다 많아서 합계를 ${formatMinutes(m)}으로 맞춰 저장해요.`,
  // 임시 글, 디자인 확정 뒤: 나누기 다이얼의 가운데 표시(아무 조각도 안 골랐을 때 = 쓴 시간)
  dialCenter: (m: number) => formatMinutes(m),
  back: "이전",
  save: "저장",
  saving: "저장하는 중",
  saveFailed: "저장하지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 저장할 수 있어요. 넣은 값은 그대로 있어요.",
  loading: "기록을 불러오는 중",
  loadFailed: "기록을 불러오지 못했어요.",
  reload: "다시 불러오기",
  saved: "저장했어요",
  changedToday: "오늘 바뀐 분야별 시간",
  changedYesterday: "어제 바뀐 분야별 시간",
  noChange: "바뀐 시간이 없어요",
  openGrowth: "상태보기에서 보기",
} as const;

function splitMinutes(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

function composing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

type Phase = "time" | "split" | "saved";

/** 나누기 다이얼의 기타 조각 key(분야 id는 uuid라 겹치지 않는다) */
const OTHER_KEY = "other";
/** 나누기 다이얼의 PageUp/PageDown 한 걸음(분). 임시: minuteStep의 6배 = 30분 */
const DIAL_BIG_STEP = APP_CONFIG.minuteStep * 6;

export function EveningRecord({
  api,
  now,
  onClose,
  onSaved,
  onOpenGrowth,
  renderAfterSave,
}: {
  api: EveningApi;
  now?: () => Date;
  onClose: () => void;
  onSaved?: (saved: SavedEvening) => void;
  /** 저장 직후 한 줄을 눌렀을 때(상태보기로 가기). 없으면 한 줄은 글로만 보인다 */
  onOpenGrowth?: () => void;
  /** 저장 직후 한 줄 아래에 얹는 것(상태보기의 「채울」 한 줄 등) */
  renderAfterSave?: (saved: SavedEvening, state: EveningState) => ReactNode;
}) {
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose);
  // 기기 먼저 저장(api.localFirst)이면 끊겨 있어도 저장을 막지 않는다(기기에 먼저 적고 서버에는 뒤에서 보낸다)
  const online = useOnline() || api.localFirst === true;
  const [offsetDays, setOffsetDays] = useState<0 | 1>(0);
  const [load, setLoad] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; state: EveningState }>({ status: "loading" });
  const [phase, setPhase] = useState<Phase>("time");
  const [total, setTotal] = useState(0);
  const [perCategory, setPerCategory] = useState<Record<string, number>>({});
  const prefilledRef = useRef<EveningItem[]>([]);
  /* 나눈 값(perCategory)이 맞춰져 있는 쓴 시간. null이면 아직 나누지 않았다(미리 채울 차례) */
  const splitBaseRef = useRef<number | null>(null);
  /* 나누기 단계에서 사용자가 값을 고쳤나(고친 값은 다시 미리 채우지 않는다) */
  const editedRef = useRef(false);
  const [dialPick, setDialPick] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState<SavedEvening | null>(null);
  const saveKeyRef = useRef<{ key: string; id: string } | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const todayRef = useRef<string | null>(null);

  const apply = useCallback((res: Awaited<ReturnType<EveningApi["fetchState"]>>) => {
    if (!res.ok) {
      setLoad({ status: "error" });
      return;
    }
    const state = res.data;
    todayRef.current = state.today;
    const timerSum = state.timerByCategory.reduce((s, t) => s + t.minutes, 0);
    const existing = state.existing;
    if (existing) {
      setTotal(existing.totalMinutes);
      setPerCategory(Object.fromEntries(existing.items.filter((i) => i.categoryId !== null).map((i) => [i.categoryId as string, i.minutes])));
      prefilledRef.current = existing.items;
      splitBaseRef.current = existing.totalMinutes;
    } else {
      setTotal(timerSum); // 임시: 타이머 합을 총시간 처음 값으로
      setPerCategory({});
      prefilledRef.current = [];
      splitBaseRef.current = null;
    }
    editedRef.current = false;
    setDialPick(state.categories[0]?.id ?? null);
    setLoad({ status: "ready", state });
  }, []);

  // 처음 읽기: 서버에서 가져오는 일(바깥 시스템과 맞추기). 상태는 응답을 받은 뒤에만 바꾼다.
  useEffect(() => {
    let alive = true;
    void api.fetchState().then((res) => {
      if (alive) apply(res);
    });
    return () => {
      alive = false;
    };
  }, [api, apply]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [phase]);

  function chooseDay(next: 0 | 1) {
    if (next === offsetDays || saving) return;
    setOffsetDays(next);
    setMessage("");
    setPhase("time");
    setLoad({ status: "loading" });
    const today = todayRef.current;
    void api.fetchState(next === 1 && today ? addDays(today, -1) : undefined).then(apply);
  }
  function reload() {
    setLoad({ status: "loading" });
    const today = todayRef.current;
    void api.fetchState(offsetDays === 1 && today ? addDays(today, -1) : undefined).then(apply);
  }

  const state = load.status === "ready" ? load.state : null;
  const names = new Map((state?.categories ?? []).map((c) => [c.id, c.name]));
  const nameOf = (id: string | null) => (id === null ? EVENING_TEXT.other : (names.get(id) ?? EVENING_TEXT.other));
  const timerSum = state ? state.timerByCategory.reduce((s, t) => s + t.minutes, 0) : 0;
  const built = buildItems(total, perCategory);
  const otherMinutes = built.items.find((i) => i.categoryId === null)?.minutes ?? 0;
  // 나누기 다이얼: 보이는 분야 조각 + 맨 끝 기타. 보이지 않는 분야(이미 남긴 기록에만 있는 분야)의 분은 원에서 빼 둔다(저장에는 그대로 실린다)
  const splitSum = Object.values(perCategory).reduce((s, m) => s + Math.max(0, m), 0);
  const shownIds = new Set((state?.categories ?? []).map((c) => c.id));
  const hiddenSum = Object.entries(perCategory).reduce((s, [id, m]) => s + (shownIds.has(id) ? 0 : Math.max(0, m)), 0);
  const dialTotal = Math.max(0, total - hiddenSum);
  const dialSlices: DialSlice[] = [
    ...(state?.categories ?? []).map((c, i) => ({ key: c.id, name: c.name, color: categoryColorValue(i), value: perCategory[c.id] ?? 0 })),
    { key: OTHER_KEY, name: EVENING_TEXT.other, color: categoryColorValue(null), value: Math.max(0, total - splitSum) },
  ];

  function toSplit() {
    if (!state) return;
    setMessage("");
    const base = splitBaseRef.current;
    if (base !== null && (state.existing || editedRef.current)) {
      // 이미 나눈 값이 있다: 쓴 시간이 바뀌었으면 비율을 지키며 5분 단위로 다시 나누고 남는 것은 기타(나눈 합 ≤ 쓴 시간)
      if (base !== total) {
        const ids = Object.keys(perCategory);
        const next = rescaleSplit(
          ids.map((id) => perCategory[id]),
          base,
          total,
          APP_CONFIG.minuteStep,
        );
        setPerCategory(Object.fromEntries(ids.map((id, i) => [id, next[i]])));
        splitBaseRef.current = total;
      }
    } else if (!state.existing) {
      const timer: Record<string, number> = {};
      let timerOther = 0;
      for (const t of state.timerByCategory) {
        if (t.categoryId === null) timerOther += t.minutes;
        else timer[t.categoryId] = (timer[t.categoryId] ?? 0) + t.minutes;
      }
      const prefilled = prefillItems({ totalMinutes: total, timer, timerOther, doneCategoryIds: state.doneCategoryIds });
      prefilledRef.current = prefilled;
      const total2 = prefilled.reduce((s, i) => s + i.minutes, 0);
      setTotal(Math.max(total, total2));
      setPerCategory(Object.fromEntries(prefilled.filter((i) => i.categoryId !== null).map((i) => [i.categoryId as string, i.minutes])));
      splitBaseRef.current = Math.max(total, total2);
      editedRef.current = false;
    }
    setPhase("split");
  }

  async function save(skippedSplit: boolean) {
    if (!state || saving) return;
    if (!online) {
      setMessage(EVENING_TEXT.offline);
      return;
    }
    const finalItems = skippedSplit ? notSplitItems(total) : built.items;
    const finalTotal = skippedSplit ? total : built.total;
    const saveMode = classifySaveMode({ skippedSplit, prefilled: prefilledRef.current, final: finalItems });
    const targetDay = state.day;
    // 같은 내용으로 다시 누르면 같은 id(서버가 한 번만 만든다). 내용이 바뀌면 새 id
    const key = JSON.stringify([targetDay, finalTotal, finalItems, saveMode]);
    const id = saveKeyRef.current?.key === key ? saveKeyRef.current.id : crypto.randomUUID();
    saveKeyRef.current = { key, id };
    setSaving(true);
    setMessage("");
    const res = await api.save({
      id,
      targetDay,
      totalMinutes: finalTotal,
      items: finalItems,
      saveMode,
      clientSavedAt: (now ?? (() => new Date()))().toISOString(),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(res.data);
      setPhase("saved");
      onSaved?.(res.data);
    } else {
      setMessage(EVENING_TEXT.saveFailed);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !composing(event)) {
      event.preventDefault();
      onClose();
    }
  }

  const { hours, minutes } = splitMinutes(total);
  const ask = offsetDays === 0 ? EVENING_TEXT.askToday : EVENING_TEXT.askYesterday;
  const deltaTitle = offsetDays === 0 ? EVENING_TEXT.changedToday : EVENING_TEXT.changedYesterday;
  const deltaText = saved
    ? saved.delta.length === 0
      ? EVENING_TEXT.noChange
      : saved.delta.map((d) => `${nameOf(d.categoryId)} ${formatDeltaMinutes(d.minutes)}`).join(" · ")
    : "";

  return (
    <div ref={rootRef} className="detail" role="dialog" aria-modal="true" aria-labelledby="evening-title" onKeyDown={onKeyDown}>
      <div className="detail-inner">
        <div className="detail-head">
          <h2 id="evening-title" className="detail-title" tabIndex={-1} ref={titleRef}>
            {phase === "split" ? EVENING_TEXT.splitHeading : phase === "saved" ? EVENING_TEXT.saved : ask}
          </h2>
          <TextButton className="btn-flush-end" onClick={onClose}>
            {EVENING_TEXT.close}
          </TextButton>
        </div>
        <p className="todo-sub">{EVENING_TEXT.title}</p>

        {load.status === "loading" && (
          <p className="todo-sub" role="status">
            {EVENING_TEXT.loading}
          </p>
        )}
        {load.status === "error" && (
          <Notice role="alert" actions={<SecondaryButton onClick={reload}>{EVENING_TEXT.reload}</SecondaryButton>}>
            {EVENING_TEXT.loadFailed}
          </Notice>
        )}

        {state && phase !== "saved" && (
          <div className="detail-section" role="group" aria-label={EVENING_TEXT.dayGroup}>
            <div className="detail-chips">
              {([0, 1] as const).map((n) => (
                <button key={n} type="button" className="chip" aria-pressed={offsetDays === n} disabled={saving} onClick={() => chooseDay(n)}>
                  <span className="chip-face">
                    <span className="chip-label">{n === 0 ? EVENING_TEXT.today : EVENING_TEXT.yesterday}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {state && !online && phase !== "saved" && <Notice role="status">{EVENING_TEXT.offline}</Notice>}

        {state && phase === "time" && (
          <div className="detail-section">
            {state.existing && <p className="todo-sub">{EVENING_TEXT.existing}</p>}
            {!state.existing && timerSum > 0 && <p className="todo-sub">{EVENING_TEXT.timerFilled(timerSum)}</p>}
            <div className="evening-time">
              <Stepper id="evening-hours" label={EVENING_TEXT.hours} unit={EVENING_TEXT.hours} value={hours} max={24} step={1} onChange={(h) => setTotal(Math.min(APP_CONFIG.maxDayMinutes, h * 60 + minutes))} />
              <Stepper id="evening-minutes" label={EVENING_TEXT.minutes} unit={EVENING_TEXT.minutes} value={minutes} max={59} step={APP_CONFIG.minuteStep} onChange={(m) => setTotal(Math.min(APP_CONFIG.maxDayMinutes, hours * 60 + m))} />
            </div>
            <p className="ratio-total" role="status">
              {EVENING_TEXT.total(total)}
            </p>
            {message && (
              <Notice role="alert" className="onboarding-notice">
                {message}
              </Notice>
            )}
            <div className="detail-actions">
              <SecondaryButton busy={saving} disabled={saving} onClick={() => void save(true)}>
                {EVENING_TEXT.skipSplit}
              </SecondaryButton>
              <PrimaryButton disabled={saving} onClick={toSplit}>
                {EVENING_TEXT.split}
              </PrimaryButton>
            </div>
          </div>
        )}

        {state && phase === "split" && (
          <div className="detail-section">
            <p className="todo-sub">{EVENING_TEXT.splitHint}</p>
            {total > 0 && state.categories.length > 0 && (
              <div className="evening-dial">
                <RatioDial
                  id="evening-dial"
                  slices={dialSlices}
                  total={dialTotal}
                  step={APP_CONFIG.minuteStep}
                  bigStep={DIAL_BIG_STEP}
                  selectedKey={dialPick}
                  onSelect={setDialPick}
                  onChange={(values) => {
                    editedRef.current = true;
                    setPerCategory((prev) => ({ ...prev, ...Object.fromEntries(state.categories.map((c, i) => [c.id, values[i]])) }));
                  }}
                  format={formatMinutes}
                  center={EVENING_TEXT.dialCenter(total)}
                />
              </div>
            )}
            <ul className="ratio-list">
              {state.categories.map((c) => (
                <li key={c.id} className="ratio-row">
                  <Stepper
                    id={`evening-cat-${c.id}`}
                    label={c.name}
                    unit={EVENING_TEXT.minutes}
                    value={perCategory[c.id] ?? 0}
                    // 나눈 합은 쓴 시간을 넘지 못한다: 이 분야는 기타에 남은 만큼까지만 늘어난다
                    max={Math.max(0, total - (splitSum - (perCategory[c.id] ?? 0)))}
                    step={APP_CONFIG.minuteStep}
                    onChange={(m) => {
                      editedRef.current = true;
                      setPerCategory((prev) => ({ ...prev, [c.id]: m }));
                    }}
                  />
                </li>
              ))}
              <li className="ratio-row">
                <span className="ratio-name">{EVENING_TEXT.other}</span>
                <span className="ratio-value">{EVENING_TEXT.otherRemain(otherMinutes)}</span>
              </li>
            </ul>
            <p className="ratio-total" role="status">
              {EVENING_TEXT.total(built.total)}
            </p>
            {built.total > total && <p className="todo-sub">{EVENING_TEXT.raised(built.total)}</p>}
            {message && (
              <Notice role="alert" className="onboarding-notice">
                {message}
              </Notice>
            )}
            <div className="detail-actions">
              <TextButton disabled={saving} onClick={() => setPhase("time")}>
                {EVENING_TEXT.back}
              </TextButton>
              <PrimaryButton busy={saving} disabled={saving} onClick={() => void save(false)}>
                {saving ? EVENING_TEXT.saving : EVENING_TEXT.save}
              </PrimaryButton>
            </div>
          </div>
        )}

        {state && phase === "saved" && saved && (
          <div className="detail-section">
            {onOpenGrowth ? (
              <button type="button" className="after-save-line" onClick={onOpenGrowth}>
                <span className="after-save-title">{deltaTitle}</span>
                <span className="after-save-text">{deltaText}</span>
                <span className="after-save-go">{EVENING_TEXT.openGrowth}</span>
              </button>
            ) : (
              <div className="after-save-line">
                <span className="after-save-title">{deltaTitle}</span>
                <span className="after-save-text">{deltaText}</span>
              </div>
            )}
            {renderAfterSave?.(saved, state)}
            <div className="detail-actions">
              <PrimaryButton onClick={onClose}>{EVENING_TEXT.close}</PrimaryButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 저녁 기록을 여는 단추 글(할 일 탭 입구·상태보기 빈 안내가 같은 글을 쓴다) */
export const EVENING_ENTRY_LABEL = "저녁 기록 남기기";

/** 할 일 화면 위에 얹는 저녁 기록 입구. 저녁(오후 6시~새벽 4시 전)에는 질문 글을 앞세운다 */
export function EveningEntry({ evening, onOpen }: { evening: boolean; onOpen: () => void }) {
  return (
    <section className="entry-card" aria-label={EVENING_TEXT.title}>
      <p className="entry-title">{EVENING_TEXT.title}</p>
      {evening && <p className="todo-sub">{EVENING_TEXT.askToday}</p>}
      <SecondaryButton onClick={onOpen}>{EVENING_ENTRY_LABEL}</SecondaryButton>
    </section>
  );
}
