"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SettingsApi } from "../lib/onboarding-api";
import type { RatioItem } from "../lib/settings/types";
import { useOnline } from "../lib/use-online";
import { useOverlayWindow } from "../lib/use-overlay-window";
import { BACK_HEADER_TEXT, BackHeader, BottomActions } from "./back-header";
import { CloseConfirm } from "./close-confirm";
import { entriesToRatios, normalizedPercents, RatioEditor, type RatioEntry } from "./ratio-editor";
import { Notice, PrimaryButton } from "./ui";

/**
 * S8-a 「목표 비율」(PM 6 · 명세 ⑩ · Figma 81:380, 바꾼 뒤 「‹」 121:389): 내 정보 「목표 비율」 줄을 누르면 열리는 겹침 화면.
 * 처음 설정 S1-3 화면(RatioEditor — 다이얼 · 분야 줄 −/숫자 칸 %/+ 흰 카드 · 「균등 배분」)을 다시 쓴다. 단계 표시·아래 탭·이름표 옆 작은 글 없음.
 * - 머리 왼쪽 위 「‹」(화면 읽기 「이전」 — components/back-header.tsx, 처음 설정·오늘 기록 나누기·S8-b와 같은 부품) · 이름표 「목표 비율」 · 주 단추 「저장」(화면 아래).
 * - 저장은 내 정보가 쓰던 길 그대로: api.saveRatios(entriesToRatios(...)) — 화면은 합 100 고정(RatioEditor), 서버도 비율을 검사한다(그대로).
 *   기기 먼저 저장(api.localFirst)이면 끊겨도 막지 않는다. 성공하면 onSaved(저장한 비율, 화면 줄) 뒤 닫힌다(내 정보의 띠가 바뀐다). 실패하면 열린 채 안내.
 * - 바꾸고 저장하지 않은 채 「‹」·Esc·기기 뒤로 가기: 앱 공통 확인 「저장하지 않고 나갈까요?」(「계속 적기」 / 「나가기」, PM d-135).
 *   안 바꿨으면 그냥 닫힌다. 「바꿈」은 열 때 합 100으로 맞춘 값(normalizedPercents)과 지금 값이 다를 때다(열 때 맞춘 것은 사용자가 바꾼 것이 아니다).
 *   뒤로 가기는 useOverlayWindow holdBack 길(확인을 띄우고 자기 칸으로 돌아간다 — 「계속 적기」 뒤 다시 뒤로 가기 → 다시 확인).
 * 글은 React 텍스트로만 그린다.
 */
export const RATIO_SETTINGS_TEXT = {
  title: "목표 비율",
  save: "저장",
  saving: BACK_HEADER_TEXT.saving, // 「저장 중」(O-7)
  failed: "저장하지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 저장할 수 있어요.",
  ratioNeed: "하나 이상은 0%보다 커야 해요.",
} as const;

export function RatioSettings({
  initial,
  api,
  onClose,
  onSaved,
}: {
  /** 내 정보의 지금 비율 줄(분야들 + 기타 맨 끝) */
  initial: RatioEntry[];
  api: SettingsApi;
  onClose: () => void;
  /** 저장이 끝났을 때(저장한 비율, 합 100으로 맞춘 화면 줄). 그 뒤 창이 닫힌다 */
  onSaved: (ratios: RatioItem[], entries: RatioEntry[]) => void;
}) {
  const [entries, setEntries] = useState<RatioEntry[]>(initial);
  const entriesRef = useRef(initial);
  const [baseline] = useState(() => normalizedPercents(initial));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const changed = () => normalizedPercents(entriesRef.current).some((v, i) => v !== baseline[i]);
  const rootRef = useOverlayWindow<HTMLDivElement>(onClose, {
    holdBack: () => {
      if (!changed()) return false;
      setConfirm(true);
      return true;
    },
  });
  // 기기 먼저 저장(api.localFirst)이면 끊겨 있어도 저장을 막지 않는다(내 정보와 같다)
  const online = useOnline() || api.localFirst === true;

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function requestClose() {
    if (changed()) setConfirm(true);
    else onClose();
  }

  async function save() {
    if (busyRef.current || !online) return;
    const shown = normalizedPercents(entriesRef.current);
    if (shown.reduce((s, v) => s + v, 0) <= 0) {
      setMessage(RATIO_SETTINGS_TEXT.ratioNeed);
      return;
    }
    const next = entriesRef.current.map((e, i) => ({ ...e, percent: shown[i] }));
    const ratios = entriesToRatios(next);
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    const res = await api.saveRatios(ratios);
    busyRef.current = false;
    setBusy(false);
    if (res.ok) {
      onSaved(ratios, next);
      onClose();
    } else {
      setMessage(RATIO_SETTINGS_TEXT.failed);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    requestClose();
  }

  return (
    <div ref={rootRef} className="detail ratio-settings" role="dialog" aria-modal="true" aria-labelledby="ratio-settings-title" onKeyDown={onKeyDown}>
      <div className="detail-inner screen-fill">
        <BackHeader onBack={requestClose} />
        <h2 id="ratio-settings-title" className="onboarding-title" tabIndex={-1} ref={titleRef}>
          {RATIO_SETTINGS_TEXT.title}
        </h2>
        {!online && <Notice role="status">{RATIO_SETTINGS_TEXT.offline}</Notice>}
        <div className="screen-fill-body">
          <RatioEditor
            showCaption={false}
            entries={entries}
            onChange={(next) => {
              entriesRef.current = next;
              setEntries(next);
              setMessage("");
            }}
          />
          {message && (
            <Notice role="alert" className="onboarding-notice">
              {message}
            </Notice>
          )}
        </div>
        <BottomActions>
          <PrimaryButton busy={busy} disabled={busy || !online} onClick={() => void save()}>
            {busy ? RATIO_SETTINGS_TEXT.saving : RATIO_SETTINGS_TEXT.save}
          </PrimaryButton>
        </BottomActions>
      </div>
      {confirm && <CloseConfirm onKeep={() => setConfirm(false)} onClose={onClose} />}
    </div>
  );
}
