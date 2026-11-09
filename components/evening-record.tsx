"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { APP_CONFIG } from "../lib/app-config";
import { CATEGORY_LIMIT, checkCategoryName, countCategoryChars, sameCategoryName } from "../lib/categories/validation";
import type { AddCategoryResult } from "../lib/categories/types";
import { buildItems, classifySaveMode, initialSelection, notSplitItems, otherOf, pickChip, unpickChip, type EveningItem } from "../lib/evening/logic";
import type { EveningState, SavedEvening } from "../lib/evening/types";
import type { EveningApi } from "../lib/evening-api";
import { formatDeltaMinutes, formatMinutes } from "../lib/time-format";
import { useOnline } from "../lib/use-online";
import { addDays } from "../lib/week";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { rescaleSplit } from "../lib/ratio-dial-calc";
import { categoryColorValue } from "../lib/category-color";
import { RatioDial, type DialSlice } from "./ratio-dial";
import { EveningTodoLine, type EveningTodos } from "./evening-todo-sheet";
import { ChipScroller } from "./chip-scroller";
import { Stepper } from "./stepper";
import { categoryDuplicateText, categoryOverLimitText, TODO_TEXT } from "./todo-view";
import { Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";

/**
 * 오늘 기록(옛 이름 저녁 기록, PM 4 — 코드 이름은 evening 그대로. PRD 7-3, ②). 두 단계: 「오늘 몇 시간 썼어요?」 → 분야마다 나누기. 한 화면에서 아래로 내려 보지 않는다.
 * - 첫 단계에 「나누지 않고 저장」이 있다(그날 시간은 전부 기타, 임시).
 * - 저장하면 바로 「오늘 바뀐 분야별 시간」 한 줄을 보인다(값은 목표 대비가 아니라 바뀐 것). 그 줄을 누르면 상태보기로 간다.
 * - 저장할 때마다 저장 방식(미리 채운 그대로·고침·나누지 않음)·대상 날·저장 시각이 남는다(G9, 서버가 시각을 정한다).
 * - 오늘과 어제 중 대상 날을 고를 수 있다. 입력 모양은 PM이 써 보며 확정한다(임시: −/+ 단추와 숫자 칸).
 * - 나누기 단계(고침 5바퀴, PM 10 — d-114 가 · d-115 나 · d-116 가):
 *   - 위에 분야 칩 줄(이름표 「분야」). 칩 = 다이얼에 넣을 분야 고르기(여럿). 맨 끝 「+ 분야」는 그 자리에서 새 분야를 더하고 골라진 칩이 된다.
 *   - 다이얼과 아래 −/+ 줄 = 고른 분야 조각 + 맨 끝 기타 조각만. 고르지 않은 분야는 조각도 줄도 없다. 12시 고정(첫 조각 시작·기타 끝이 12시).
 *   - 칩을 새로 고르면 기타에서 30분(기타가 적으면 기타 전부)을 떼어 그 분야 조각이 생기고 그 조각이 골라진다. 칩을 풀면 그 시간이 기타로 돌아간다. 합(쓴 시간)은 늘 그대로.
 *   - 0분 조각(기타가 0분일 때 고른 칩 등)은 다이얼에 칠하지 않고(폭 0) 줄에서만 보인다. 0분으로 생긴 칩은 다이얼 고름을 옮기지 않아
 *     12시에 0분 조각·손잡이가 새로 서지 않는다(E1 판단). 사용자가 그 줄을 눌러 고르면 키울 수 있게 그 경계에 손잡이가 선다(d-113 규칙 그대로).
 *   - 조각 고르기는 칩이 아니라 조각이나 아래 줄을 눌러서. 고른 줄 = 연한 면 바탕 + 이름 Bold.
 *   - 처음 값: 기타 100%(가운데 「{합계}」「기타」, 손잡이 없음). 타이머로 잰 분야와 그날 끝낸 할 일의 분야만 칩이 골라진 채 시작(lib/evening/logic.ts initialSelection).
 *     나누기 단계에 들어갈 때 나눈 값을 고친 적이 없으면 그때의 끝낸 할 일(state.doneCategoryIds)로 다시 만든다. 고친 뒤에는 덮지 않는다.
 *   - 이미 남긴 기록을 고치러 오면 그 기록의 분야(0분 넘는 것)가 골라진 채 시작한다.
 *   다이얼과 줄의 Stepper는 같은 값을 쓴다(Stepper는 끌지 않는 길, WCAG 2.5.7). 손잡이 한 걸음은 minuteStep(5분), 끌기도 5분 단위.
 *   나눈 합은 쓴 시간을 넘지 못한다(PM 확정 11-08): Stepper도 기타에 남은 만큼까지만 늘어난다. 쓴 시간 0분이면 다이얼을 그리지 않는다.
 * - 나눈 뒤 앞 단계로 돌아가 쓴 시간을 고치면: 나눈 값을 고친 적이 없으면 새 쓴 시간으로 처음 값을 다시 만들고,
 *   고친 적이 있거나 이미 남긴 기록이면 비율을 지키며 5분 단위로 다시 나눈다(남는 것은 기타).
 * 연결이 끊기면 저장하지 않고(이번 범위는 할 일만 오프라인) 안내한다. 입력한 값은 그대로 둔다.
 * 모든 글(분야 이름 포함)은 React 텍스트로만 그린다.
 */

export const EVENING_TEXT = {
  title: "오늘 기록",
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
  /** 고침 5바퀴: 타이머로 미리 채웠을 때 시간 입력 아래 작은 표시 */
  timerChip: (m: number) => `타이머 ${formatMinutes(m)}`,
  existing: "이미 남긴 기록이 있어요. 고쳐서 다시 저장할 수 있어요.",
  skipSplit: "나누지 않고 저장",
  split: "분야마다 나누기",
  splitHeading: "분야마다 나눠 주세요",
  splitHint: "미리 채운 값을 확인하고 고쳐요. 나누지 않은 시간은 기타로 들어가요.",
  other: "기타",
  otherRemain: (m: number) => formatMinutes(m),
  // 나누기 아래 기타 줄의 이름 아래 작은 글(창구 덧붙임 11-09 11:3x)
  otherSub: "나누지 않은 시간",
  raised: (m: number) => `나눈 시간이 합계보다 많아서 합계를 ${formatMinutes(m)}으로 맞춰 저장해요.`,
  // 나누기 칩 줄(PM 10): 이름표 「분야 · 여러 개」(창구 덧붙임 11-09 11:3x — 여럿 고를 수 있음을 보임), 칩의 화면 읽기 이름 「{분야}, 다이얼에 넣기」(켬/끔은 aria-pressed)
  categoryLabel: "분야 · 여러 개",
  chip: (name: string) => `${name}, 다이얼에 넣기`,
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

const has = (o: Record<string, number>, id: string) => Object.prototype.hasOwnProperty.call(o, id);

type Phase = "time" | "split" | "saved";

/** 나누기 다이얼의 기타 조각 key(분야 id는 uuid라 겹치지 않는다) */
const OTHER_KEY = "other";
/** 나누기 다이얼의 PageUp/PageDown 한 걸음(분). 임시: minuteStep의 6배 = 30분 */
const DIAL_BIG_STEP = APP_CONFIG.minuteStep * 6;

/**
 * 처음 고른 조각: 고른 칩 가운데 만든 순서로 0분 넘는 첫 조각. 고른 칩이 없으면 기타(기타 100% — 가운데 「{합계}」「기타」, 손잡이 없음).
 * 고른 칩이 모두 0분이면 아무것도 고르지 않는다(0분 조각을 골라 12시에 손잡이를 세우지 않는다).
 */
function initialPick(catalogIds: string[], perCategory: Record<string, number>): string | null {
  const chosen = catalogIds.filter((id) => has(perCategory, id));
  const first = chosen.find((id) => perCategory[id] > 0);
  if (first) return first;
  return chosen.length === 0 ? OTHER_KEY : null;
}

function CheckIcon() {
  return (
    <svg className="chip-check" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function EveningRecord({
  api,
  now,
  onClose,
  onSaved,
  onOpenGrowth,
  renderAfterSave,
  todos,
}: {
  api: EveningApi;
  /** 시간 단계의 「오늘 할 일 n/m ›」 줄과 시트(할 일 탭과 같은 데이터, 고침 5바퀴). 없으면 줄을 그리지 않는다 */
  todos?: EveningTodos;
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
  /* 나눈 값. 열쇠 = 골라진 칩(0분 포함)과 숨은 분야(이미 남긴 기록·타이머에만 있고 칩이 없는 분야). 기타는 쓴 시간 − 합 */
  const [perCategory, setPerCategory] = useState<Record<string, number>>({});
  /* 이벤트 처리기(분야 더하기의 await 뒤 포함)가 읽는 지금 값. 그리기 중에는 바꾸지 않고, 그린 뒤와 처리기에서 맞춘다 */
  const perRef = useRef(perCategory);
  useEffect(() => {
    perRef.current = perCategory;
  }, [perCategory]);
  /* 「+ 분야」로 이번에 더한 분야(다시 읽기 전까지 칩 목록 끝에 붙는다) */
  const [added, setAdded] = useState<{ id: string; name: string }[]>([]);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatDraft, setNewCatDraft] = useState("");
  const [newCatBusy, setNewCatBusy] = useState(false);
  const [newCatHelp, setNewCatHelp] = useState("");
  const newCatRequestRef = useRef<{ id: string; name: string } | null>(null);
  const newCatInputRef = useRef<HTMLInputElement | null>(null);
  const prefilledRef = useRef<EveningItem[]>([]);
  /* 나눈 값(perCategory)이 맞춰져 있는 쓴 시간. null이면 아직 나누지 않았다(처음 값을 만들 차례) */
  const splitBaseRef = useRef<number | null>(null);
  /* 나누기 단계에서 사용자가 값을 고쳤나(칩 고르기·풀기 포함. 고친 값은 처음 값으로 다시 덮지 않는다) */
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
      // 이미 남긴 기록: 그 기록의 분야(0분 넘는 것)가 골라진 채
      const values = Object.fromEntries(existing.items.filter((i) => i.categoryId !== null && i.minutes > 0).map((i) => [i.categoryId as string, i.minutes]));
      setTotal(existing.totalMinutes);
      setPerCategory(values);
      prefilledRef.current = existing.items;
      splitBaseRef.current = existing.totalMinutes;
      setDialPick(initialPick(state.categories.map((c) => c.id), values));
    } else {
      setTotal(timerSum); // 임시: 타이머 합을 총시간 처음 값으로
      setPerCategory({});
      prefilledRef.current = [];
      splitBaseRef.current = null;
      setDialPick(OTHER_KEY);
    }
    editedRef.current = false;
    setAdded([]);
    setNewCatOpen(false);
    setNewCatDraft("");
    setNewCatHelp("");
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
  // 칩 목록 = 고를 수 있는 분야(만든 순서) + 이번에 더한 분야. 색은 이 목록의 자리(lib/category-color.ts — 다른 화면과 같은 순서)
  const catalog = state ? [...state.categories, ...added.filter((a) => !state.categories.some((c) => c.id === a.id))] : [];
  const catalogIds = catalog.map((c) => c.id);
  const colorOf = (id: string) => categoryColorValue(catalogIds.indexOf(id));
  const names = new Map(catalog.map((c) => [c.id, c.name]));
  const nameOf = (id: string | null) => (id === null ? EVENING_TEXT.other : (names.get(id) ?? EVENING_TEXT.other));
  const timerSum = state ? state.timerByCategory.reduce((s, t) => s + t.minutes, 0) : 0;
  // 저장 항목은 분야 순서(만든 순서) → 숨은 분야 → 기타. 칩을 고른 순서와 상관없이 화면 줄 순서와 같다
  const built = buildItems(total, {
    ...Object.fromEntries(catalogIds.filter((id) => has(perCategory, id)).map((id) => [id, perCategory[id]])),
    ...Object.fromEntries(Object.entries(perCategory).filter(([id]) => !names.has(id))),
  });
  const otherMinutes = built.items.find((i) => i.categoryId === null)?.minutes ?? 0;
  // 고른 칩(만든 순서). 다이얼과 아래 줄에는 이것과 맨 끝 기타만
  const chosen = catalog.filter((c) => has(perCategory, c.id));
  // 숨은 분야(칩이 없는 분야 — 이미 남긴 기록·타이머에만 있음)의 분은 원에서 빼 둔다(저장에는 그대로 실린다)
  const splitSum = Object.values(perCategory).reduce((s, m) => s + Math.max(0, m), 0);
  const hiddenSum = Object.entries(perCategory).reduce((s, [id, m]) => s + (names.has(id) ? 0 : Math.max(0, m)), 0);
  const dialTotal = Math.max(0, total - hiddenSum);
  const dialSlices: DialSlice[] = [
    ...chosen.map((c) => ({ key: c.id, name: c.name, color: colorOf(c.id), value: perCategory[c.id] ?? 0 })),
    { key: OTHER_KEY, name: EVENING_TEXT.other, color: categoryColorValue(null), value: otherOf(total, perCategory) },
  ];

  function toSplit() {
    if (!state) return;
    setMessage("");
    const base = splitBaseRef.current;
    if (base !== null && (state.existing || editedRef.current)) {
      // 이미 나눈 값이 있다: 쓴 시간이 바뀌었으면 비율을 지키며 5분 단위로 다시 나누고 남는 것은 기타(나눈 합 ≤ 쓴 시간). 고른 칩은 그대로
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
      // 처음 값(나눈 값을 고친 적이 없을 때마다 그때의 끝낸 할 일·타이머로 다시 만든다): 기타 100% + 타이머 분야 + 끝낸 할 일 분야 30분씩
      const timer: Record<string, number> = {};
      let timerOther = 0;
      for (const t of state.timerByCategory) {
        if (t.categoryId === null) timerOther += t.minutes;
        else timer[t.categoryId] = (timer[t.categoryId] ?? 0) + t.minutes;
      }
      const init = initialSelection({ totalMinutes: total, timer, timerOther, doneCategoryIds: state.doneCategoryIds, catalogOrder: catalogIds });
      prefilledRef.current = init.items;
      setTotal(init.total);
      setPerCategory(init.perCategory);
      splitBaseRef.current = init.total;
      editedRef.current = false;
      setDialPick(initialPick(catalogIds, init.perCategory));
    }
    setPhase("split");
  }

  /** 칩을 고른다: 기타에서 30분(적으면 전부)을 떼어 조각을 만들고, 0분이 아니면 그 조각을 고른다 */
  function chooseChip(id: string) {
    const prev = perRef.current;
    if (has(prev, id)) return;
    const res = pickChip(total, prev, id);
    editedRef.current = true;
    perRef.current = res.perCategory;
    setPerCategory(res.perCategory);
    if (res.taken > 0) setDialPick(id);
  }
  function toggleChip(id: string) {
    setNewCatHelp("");
    const prev = perRef.current;
    if (!has(prev, id)) {
      chooseChip(id);
      return;
    }
    // 칩을 푼다: 그 시간은 기타로 돌아가고 조각·줄이 사라진다. 고른 조각이었으면 고름도 풀린다(남은 칩이 없으면 기타 — 기타 100%)
    editedRef.current = true;
    const next = unpickChip(prev, id);
    perRef.current = next;
    setPerCategory(next);
    if (dialPick === id) setDialPick(catalogIds.some((c) => c !== id && has(next, c)) ? null : OTHER_KEY);
  }

  // ---- 「+ 분야」: 지금 앱의 분야 더하기 길(검사·같은 이름·한도 50·같은 요청 id 재시도)을 그대로 쓴다. 새 입구 없음 ----
  function openNewCategory() {
    setNewCatHelp("");
    if (catalog.length >= CATEGORY_LIMIT) {
      setNewCatHelp(TODO_TEXT.categoryLimit); // 「+ 분야」를 비활성으로 두지 않고 안내로 답한다(C20과 같게)
      return;
    }
    setNewCatOpen(true);
    requestAnimationFrame(() => newCatInputRef.current?.focus());
  }
  function closeNewCategory() {
    setNewCatOpen(false);
    setNewCatDraft("");
  }
  async function addCategoryNow() {
    if (newCatBusy) return;
    setNewCatHelp("");
    const checked = checkCategoryName(newCatDraft);
    if (!checked.ok) {
      if (checked.error === "reserved") setNewCatHelp(TODO_TEXT.categoryReserved);
      else if (checked.error === "too_long") setNewCatHelp(categoryOverLimitText(countCategoryChars(newCatDraft)));
      newCatInputRef.current?.focus();
      return;
    }
    const name = checked.name;
    const have = catalog.find((c) => sameCategoryName(c.name, name));
    if (have) {
      chooseChip(have.id);
      setNewCatHelp(categoryDuplicateText(have.name));
      closeNewCategory();
      return;
    }
    if (catalog.length >= CATEGORY_LIMIT) {
      setNewCatHelp(TODO_TEXT.categoryLimit);
      return;
    }
    if (!api.addCategory) {
      setNewCatHelp(TODO_TEXT.categoryAddFailed);
      return;
    }
    if (!online) {
      setNewCatHelp(TODO_TEXT.categoryAddOffline); // 적은 이름은 그대로
      return;
    }
    // 같은 이름으로 다시 누르면 같은 요청 id(서버가 한 번만 만든다)
    const previous = newCatRequestRef.current;
    const requestId = previous && sameCategoryName(previous.name, name) ? previous.id : crypto.randomUUID();
    newCatRequestRef.current = { id: requestId, name };
    setNewCatBusy(true);
    let res: AddCategoryResult;
    try {
      res = await api.addCategory(requestId, name);
    } catch {
      res = { ok: false, error: "unavailable" };
    }
    setNewCatBusy(false);
    const remember = (entry: { id: string; name: string }) => {
      setAdded((prev) => (prev.some((c) => c.id === entry.id) ? prev : [...prev, entry]));
      chooseChip(entry.id);
      closeNewCategory();
    };
    if (res.ok) {
      newCatRequestRef.current = null;
      if (res.data.category.readable) remember({ id: res.data.category.id, name: res.data.category.name });
      return;
    }
    if (res.error === "duplicate") {
      remember(res.existing);
      setNewCatHelp(categoryDuplicateText(res.existing.name));
      return;
    }
    if (res.error === "reserved") setNewCatHelp(TODO_TEXT.categoryReserved);
    else if (res.error === "category_limit") setNewCatHelp(TODO_TEXT.categoryLimit);
    else {
      if (res.error === "conflict") newCatRequestRef.current = null;
      setNewCatHelp(TODO_TEXT.categoryAddFailed);
    }
  }
  function onNewCatKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && !composing(event)) {
      // 새 분야 칸의 Esc는 칸만 닫는다(창은 닫지 않는다)
      event.preventDefault();
      event.stopPropagation();
      closeNewCategory();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!composing(event)) void addCategoryNow();
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
            {!state.existing && timerSum > 0 && <p className="evening-timer-chip">{EVENING_TEXT.timerChip(timerSum)}</p>}
            {/* 오늘을 고른 때만(어제 할 일은 시트에서 다루지 않는다). 시트에서 체크·되돌림·더하기 → 끝낸 할 일 분야 목록이 바로 바뀐다 */}
            {todos && offsetDays === 0 && (
              <EveningTodoLine
                todos={todos}
                onDoneCategoriesChange={(ids) => setLoad((l) => (l.status === "ready" ? { status: "ready", state: { ...l.state, doneCategoryIds: ids } } : l))}
              />
            )}
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
            <p id="evening-category-label" className="input-label sheet-category-label">
              {EVENING_TEXT.categoryLabel}
            </p>
            {newCatOpen ? (
              <div className="newcat">
                <label htmlFor="evening-newcat-input" className="sheet-label input-label">
                  {TODO_TEXT.newCategoryLabel}
                </label>
                <div className="newcat-row">
                  <div className="newcat-field">
                    {/* maxLength를 걸지 않는다: 몰래 자르지 않는다(넘으면 안내) */}
                    <input
                      id="evening-newcat-input"
                      ref={newCatInputRef}
                      className="input"
                      type="text"
                      value={newCatDraft}
                      onChange={(e) => {
                        setNewCatDraft(e.target.value);
                        setNewCatHelp("");
                      }}
                      onKeyDown={onNewCatKeyDown}
                      aria-describedby="evening-category-help"
                      autoComplete="off"
                      enterKeyHint="done"
                    />
                  </div>
                  <div className="newcat-actions">
                    <SecondaryButton busy={newCatBusy} onClick={() => void addCategoryNow()}>
                      {newCatBusy ? TODO_TEXT.addingCategory : TODO_TEXT.addCategory}
                    </SecondaryButton>
                    <TextButton onClick={closeNewCategory}>{TODO_TEXT.cancel}</TextButton>
                  </div>
                </div>
              </div>
            ) : (
              <ChipScroller className="evening-chips" aria-labelledby="evening-category-label">
                {catalog.map((c) => {
                  const pressed = has(perCategory, c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="chip"
                      aria-pressed={pressed}
                      aria-label={EVENING_TEXT.chip(c.name)}
                      data-chip-id={c.id}
                      onClick={() => toggleChip(c.id)}
                    >
                      <span className="chip-face">
                        {pressed && <CheckIcon />}
                        <span className="chip-dot" style={{ background: colorOf(c.id) }} aria-hidden="true" />
                        <span className="chip-label">{c.name}</span>
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  id="evening-add-category-chip"
                  className="chip chip-add"
                  onClick={openNewCategory}
                >
                  <span className="chip-face">
                    <span className="chip-label">{TODO_TEXT.addCategoryChip}</span>
                  </span>
                </button>
              </ChipScroller>
            )}
            <p id="evening-category-help" className="input-help" role="status">
              {newCatHelp}
            </p>
            {total > 0 && (
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
                    setPerCategory((prev) => ({ ...prev, ...Object.fromEntries(chosen.map((c, i) => [c.id, values[i]])) }));
                  }}
                  format={formatMinutes}
                  center={EVENING_TEXT.dialCenter(total)}
                />
              </div>
            )}
            <ul className="ratio-list">
              {/* 줄을 누르거나(−/+·숫자 칸 포함) 줄 안에 포커스가 가면 그 조각이 골라진다(PM 10) */}
              {chosen.map((c) => (
                <li
                  key={c.id}
                  className={"ratio-row evening-row" + (dialPick === c.id ? " is-picked" : "")}
                  data-row-key={c.id}
                  onClick={() => setDialPick(c.id)}
                  onFocus={() => setDialPick(c.id)}
                >
                  <span className="chip-dot" style={{ background: colorOf(c.id) }} aria-hidden="true" />
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
              <li
                className={"ratio-row evening-row" + (dialPick === OTHER_KEY ? " is-picked" : "")}
                data-row-key={OTHER_KEY}
                onClick={() => setDialPick(OTHER_KEY)}
              >
                <span className="chip-dot" style={{ background: categoryColorValue(null) }} aria-hidden="true" />
                <span className="ratio-name evening-other-name">
                  {EVENING_TEXT.other}
                  <span className="evening-other-sub">{EVENING_TEXT.otherSub}</span>
                </span>
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

/** 할 일 탭 입구 단추 글. 이름은 EVENING_TEXT.title 한 곳에서 온다(상태보기 빈 상태 단추는 이름 그대로 EVENING_TEXT.title — 명세 ⑩ PM 4). PM 4: 사용자에게 보이는 「저녁 기록」 → 「오늘 기록」 */
export const EVENING_ENTRY_LABEL = `${EVENING_TEXT.title} 남기기`;

/** 할 일 화면 위에 얹는 오늘 기록 입구. 저녁(오후 6시~새벽 4시 전)에는 질문 글을 앞세운다 */
export function EveningEntry({ evening, onOpen }: { evening: boolean; onOpen: () => void }) {
  return (
    <section className="entry-card" aria-label={EVENING_TEXT.title}>
      <p className="entry-title">{EVENING_TEXT.title}</p>
      {evening && <p className="todo-sub">{EVENING_TEXT.askToday}</p>}
      <SecondaryButton onClick={onOpen}>{EVENING_ENTRY_LABEL}</SecondaryButton>
    </section>
  );
}
