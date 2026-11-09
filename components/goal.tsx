"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { APP_CONFIG } from "../lib/app-config";
import type { GoalsApi } from "../lib/goals-api";
import type { GoalSummary } from "../lib/goals/types";
import { goalProgress } from "../lib/goals/validation";
import type { CategoryMinutes } from "../lib/growth/logic";
import { formatMinutes } from "../lib/time-format";
import { useOnline } from "../lib/use-online";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { categoryColorValue } from "../lib/category-color";
import { BackHeader, BottomActions } from "./back-header";
import { CloseConfirm, CONFIRM_TEXT, ConfirmDialog } from "./close-confirm";
import { Stepper } from "./stepper";
import { Notice, PrimaryButton, TextButton } from "./ui";

/**
 * 이번 주 목표(PRD 7-7, ⑥). 한 주(월~일) 동안 분야마다 쓰려는 시간이다. 쓴 시간이 쌓이는 것을 숫자로 보며 성취감을 느끼게 한다(D-085).
 * - 할 일 탭 맨 위 한 줄: 목표가 없으면 「이번 주 목표 정하기」, 있으면 「이번 주 목표 15시간 중 9시간」(숫자만, 다 채워도 「달성」 같은 말 없음, D-113·D-114).
 *   목표를 따로 권하지 않는다: 한 줄만 두고, 세운 주와 안 세운 주가 생기는 대로 본다(F1 ㄱ).
 * - 입력 모양(임시): 한 화면에서 분야마다 −/+ 1시간 단위(0이면 목표에 안 넣음). 한 주 합은 168시간까지.
 * - 줄의 쓴 시간은 분야마다 목표를 넘기지 않게 센다(목표 밖 시간이 진행처럼 보이지 않게).
 * 목표가 없어도 앱을 쓰는 데 막히지 않는다. 모든 글은 React 텍스트로만 그린다.
 */

export const GOAL_TEXT = {
  set: "이번 주 목표 정하기",
  line: (target: number, done: number) => `이번 주 목표 ${formatMinutes(target)} 중 ${formatMinutes(done)}`,
  title: "이번 주 목표",
  hint: "1시간 단위 · 0시간은 목표에 안 넣음", // 고침9 ⑬ 14(Figma 91:668)
  hours: "시간",
  total: (h: number) => `합계 ${h}시간`,
  over: (max: number) => `한 주는 ${max}시간까지예요.`,
  save: "저장",
  saving: "저장하는 중",
  clear: "목표 없애기",
  // 확인 글은 공통 확인 창 글(components/close-confirm.tsx CONFIRM_TEXT.goalClear, 147:2 넷째)
  failed: "저장하지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 저장할 수 있어요.",
  empty: "분야가 아직 없어요. 할 일을 적을 때 분야를 더해 보세요.",
} as const;

function composing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/** 할 일 탭 맨 위 한 줄. refreshKey가 바뀔 때마다(저녁 기록·목표 저장 뒤) 다시 읽는다 */
export function GoalLine({
  api,
  refreshKey,
  onOpen,
}: {
  api: GoalsApi;
  refreshKey: number;
  onOpen: (summary: GoalSummary) => void;
}) {
  const [data, setData] = useState<GoalSummary | null>(null);
  // 첫 응답 전에는 자리를 비워 둔다(B16): 응답이 늦어도 아래 목록이 밀리지 않게
  const [loaded, setLoaded] = useState(false);

  // 서버에서 읽는 일(바깥 시스템과 맞추기). 상태는 응답을 받은 뒤에만 바꾼다. 읽기 실패는 옛 값을 그대로 둔다.
  useEffect(() => {
    let alive = true;
    void api.fetchSummary().then((res) => {
      if (!alive) return;
      if (res.ok) setData(res.data);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [api, refreshKey]);

  if (!data) return loaded ? null : <div className="slot-goal" aria-hidden="true" />;
  const goal = data.goal;
  const progress = goal ? goalProgress(goal, data.thisWeek) : null;
  return (
    <button type="button" className="goal-line" onClick={() => onOpen(data)}>
      {progress ? GOAL_TEXT.line(progress.targetMinutes, progress.doneMinutes) : GOAL_TEXT.set}
    </button>
  );
}

/** 이번 주 목표 정하기·고치기 창(전체 화면 대화상자) */
export function GoalEditor({
  api,
  categories,
  goal,
  onClose,
  onSaved,
}: {
  api: GoalsApi;
  categories: { id: string; name: string }[];
  goal: CategoryMinutes[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // 고침9 O-3(Figma 133:2 꼴, PM d-135 글): 시간을 바꾼 뒤 「닫기」·Esc·뒤로 가기는 확인 「저장하지 않고 나갈까요?」. 안 바꿨으면 그냥 닫힘
  const [confirmClose, setConfirmClose] = useState(false);
  const changedRef = useRef(false);
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose, {
    holdBack: () => {
      if (!changedRef.current) return false;
      setConfirmClose(true);
      return true;
    },
  });
  // 기기 먼저 저장(api.localFirst)이면 끊겨 있어도 저장을 막지 않는다(기기에 먼저 적고 서버에는 뒤에서 보낸다)
  const online = useOnline() || api.localFirst === true;
  const [initialHours] = useState<Record<string, number>>(() =>
    Object.fromEntries((goal ?? []).flatMap((g) => (g.categoryId ? [[g.categoryId, Math.round(g.minutes / 60)]] : []))),
  );
  const [hours, setHours] = useState<Record<string, number>>(initialHours);
  const changed = categories.some((c) => (hours[c.id] ?? 0) !== (initialHours[c.id] ?? 0));
  useEffect(() => {
    changedRef.current = changed;
  }, [changed]);
  function requestClose() {
    if (changed) setConfirmClose(true);
    else onClose();
  }
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  // 고침10 B(147:2 넷째 — 50:332 아래 붙은 카드 꼴을 대신함): 「목표 없애기」 → 공통 확인 창. 닫히면 초점은 「목표 없애기」로(확인 창이 돌려준다)
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState("");
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const total = Object.values(hours).reduce((s, h) => s + h, 0);
  const over = total > APP_CONFIG.maxWeekGoalHours;
  const canSave = online && busy === null && total > 0 && !over;

  async function save() {
    if (!canSave) return;
    setBusy("save");
    setMessage("");
    const items = categories.flatMap((c) => ((hours[c.id] ?? 0) > 0 ? [{ categoryId: c.id, minutes: (hours[c.id] ?? 0) * 60 }] : []));
    const res = await api.save(items);
    setBusy(null);
    if (res.ok) {
      onSaved();
      onClose();
    } else {
      setMessage(GOAL_TEXT.failed);
    }
  }

  async function clear() {
    if (busy !== null || !online) return;
    setBusy("clear");
    setMessage("");
    const res = await api.clear();
    setBusy(null);
    if (res.ok) {
      onSaved();
      onClose();
    } else {
      setConfirmClear(false);
      setMessage(GOAL_TEXT.failed);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !composing(event)) {
      event.preventDefault();
      requestClose();
    }
  }

  return (
    <div ref={rootRef} className="detail" role="dialog" aria-modal="true" aria-labelledby="goal-title" onKeyDown={onKeyDown}>
      {/* 고침9 Figma 50:332: 제목 24 → 12 보조 한 줄 → 흰 카드(색 점 · 이름 · −/칸/+) → 「합계」 오른쪽 Bold → 폭 가득 「저장」 · 가운데 「목표 없애기」.
          고침10 A: 머리 = 왼쪽 위 머리 단추 「✕」(닫기, 시트 변형). 오른쪽 위 글 「닫기」는 없다 */}
      <div className="detail-inner screen-fill">
        <BackHeader onClose={requestClose} />
        <div className="detail-head">
          <h2 id="goal-title" className="detail-title" tabIndex={-1} ref={titleRef}>
            {GOAL_TEXT.title}
          </h2>
        </div>
        <p className="ratio-caption goal-hint">{GOAL_TEXT.hint}</p>
        {!online && <Notice role="status">{GOAL_TEXT.offline}</Notice>}
        {categories.length === 0 ? (
          <p className="todo-sub">{GOAL_TEXT.empty}</p>
        ) : (
          <ul className="ratio-list card-box goal-list">
            {categories.map((c, index) => (
              <li key={c.id} className="ratio-row">
                <span className="chip-dot" style={{ background: categoryColorValue(index) }} aria-hidden="true" />
                <Stepper
                  id={`goal-${c.id}`}
                  label={c.name}
                  unit={GOAL_TEXT.hours}
                  value={hours[c.id] ?? 0}
                  max={APP_CONFIG.maxWeekGoalHours}
                  step={1}
                  onChange={(h) => {
                    setMessage("");
                    setHours((prev) => ({ ...prev, [c.id]: h }));
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="ratio-total goal-total" role="status">
          {GOAL_TEXT.total(total)}
        </p>
        {over && <p className="todo-sub">{GOAL_TEXT.over(APP_CONFIG.maxWeekGoalHours)}</p>}
        {message && (
          <Notice role="alert" className="onboarding-notice">
            {message}
          </Notice>
        )}
        <BottomActions className="goal-actions">
          <PrimaryButton busy={busy === "save"} disabled={!canSave} onClick={() => void save()}>
            {busy === "save" ? GOAL_TEXT.saving : GOAL_TEXT.save}
          </PrimaryButton>
          {goal && goal.length > 0 && (
            <TextButton id="goal-clear" className="text-tap" disabled={busy !== null || !online} onClick={() => setConfirmClear(true)}>
              {GOAL_TEXT.clear}
            </TextButton>
          )}
        </BottomActions>
      </div>
      {confirmClose && <CloseConfirm onKeep={() => setConfirmClose(false)} onClose={onClose} />}
      {confirmClear && (
        <ConfirmDialog
          title={CONFIRM_TEXT.goalClear.title}
          confirmLabel={CONFIRM_TEXT.goalClear.confirm}
          busyLabel={CONFIRM_TEXT.goalClear.busy}
          cancelLabel={CONFIRM_TEXT.goalClear.cancel}
          busy={busy === "clear"}
          onConfirm={() => clear()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
