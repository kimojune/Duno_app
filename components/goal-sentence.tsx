"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SettingsApi } from "../lib/onboarding-api";
import { useOnline } from "../lib/use-online";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { CloseConfirm } from "./close-confirm";
import { BACK_HEADER_TEXT, BackHeader, BottomActions } from "./back-header";
import { GOAL_FIELD_TEXT, GoalField, goalFieldCheck } from "./goal-field";
import { Notice, PrimaryButton } from "./ui";

/**
 * S8-b 「목표」(고침6 ③, Figma 102:314): 내 정보 첫 카드를 누르면 열리는 겹침 화면. 처음 설정 S1-1의 목표 칸(GoalField)을 다시 쓴다.
 * - 머리 왼쪽 위 「‹」(화면 읽기 「이전」 — components/back-header.tsx, 처음 설정·오늘 기록 나누기·S8-a와 같은 부품) · 이름표 「목표」 · 칸(지금 목표로 미리 채움) · 칸 아래 예시 · 주 단추 「저장」. 단계 표시·「건너뛰기」·아래 탭 없음.
 * - 저장은 내 정보가 쓰던 길 그대로: api.saveSettings({ goal }) — 같은 검사(checkGoal: 앞뒤·겹친 띄어쓰기 정리, 길이 상한), 기기 먼저 저장이면 끊겨도 막지 않음.
 *   성공하면 onSaved(새 값, 비웠으면 null) 뒤 닫힌다. 실패하면 닫지 않고 「저장하지 못했어요. 다시 눌러 주세요.」.
 * - 바꾸고 저장하지 않은 채 「‹」·Esc·기기 뒤로 가기: 앱 공통 확인 「저장하지 않고 나갈까요?」(「계속 적기」 = 확인만 닫고 S8-b는 열린 채 · 「나가기」 = 저장 없이 닫힘,
 *   PM d-135). 안 바꿨으면 그냥 닫힌다. 뒤로 가기는 useOverlayWindow holdBack 길(확인을 띄우고 자기 칸으로 돌아간다 — 「계속 적기」 뒤 다시 뒤로 가기 → 다시 확인).
 * 글은 React 텍스트로만 그린다.
 */
export const GOAL_SENTENCE_TEXT = {
  title: "목표",
  example: GOAL_FIELD_TEXT.example,
  save: "저장",
  saving: BACK_HEADER_TEXT.saving, // 「저장 중」(O-7)
  failed: "저장하지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 저장할 수 있어요.",
} as const;

export function GoalSentenceEditor({
  initial,
  api,
  onClose,
  onSaved,
}: {
  /** 지금 목표(없으면 null) */
  initial: string | null;
  api: SettingsApi;
  onClose: () => void;
  /** 저장이 끝났을 때(새 값, 비웠으면 null). 그 뒤 창이 닫힌다 */
  onSaved: (goal: string | null) => void;
}) {
  const start = initial ?? "";
  const [value, setValue] = useState(start);
  const valueRef = useRef(start);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const changed = () => valueRef.current !== start;
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose, {
    holdBack: () => {
      if (!changed()) return false;
      setConfirm(true);
      return true;
    },
  });
  // 기기 먼저 저장(api.localFirst)이면 끊겨 있어도 저장을 막지 않는다(내 정보와 같다)
  const online = useOnline() || api.localFirst === true;
  const { check, over } = goalFieldCheck(value);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function requestClose() {
    if (changed()) setConfirm(true);
    else onClose();
  }

  async function save() {
    if (busyRef.current || !check.ok || !online) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    const res = await api.saveSettings({ goal: check.goal });
    busyRef.current = false;
    setBusy(false);
    if (res.ok) {
      onSaved(check.goal);
      onClose();
    } else {
      setMessage(GOAL_SENTENCE_TEXT.failed);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    requestClose();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!(event.nativeEvent.isComposing || event.keyCode === 229)) void save();
  }

  return (
    <div ref={rootRef} className="detail goal-sentence" role="dialog" aria-modal="true" aria-labelledby="goal-sentence-title" onKeyDown={onKeyDown}>
      <div className="detail-inner screen-fill">
        <BackHeader onBack={requestClose} />
        <h2 id="goal-sentence-title" className="onboarding-title" tabIndex={-1} ref={titleRef}>
          {GOAL_SENTENCE_TEXT.title}
        </h2>
        {!online && <Notice role="status">{GOAL_SENTENCE_TEXT.offline}</Notice>}
        <GoalField
          inputId="goal-sentence-input"
          helpId="goal-sentence-help"
          value={value}
          onChange={(next) => {
            valueRef.current = next;
            setValue(next);
            setMessage("");
          }}
          help={GOAL_SENTENCE_TEXT.example}
          onKeyDown={onInputKeyDown}
          enterKeyHint="done"
        />
        {message && (
          <Notice role="alert" className="onboarding-notice">
            {message}
          </Notice>
        )}
        <BottomActions>
          <PrimaryButton busy={busy} disabled={busy || over || !online} onClick={() => void save()}>
            {busy ? GOAL_SENTENCE_TEXT.saving : GOAL_SENTENCE_TEXT.save}
          </PrimaryButton>
        </BottomActions>
      </div>
      {confirm && <CloseConfirm onKeep={() => setConfirm(false)} onClose={onClose} />}
    </div>
  );
}
