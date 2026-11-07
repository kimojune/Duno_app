"use client";

import { useEffect, useState, type ReactNode } from "react";
import { APP_CONFIG } from "../lib/app-config";
import type { SettingsApi } from "../lib/onboarding-api";
import type { PushApi } from "../lib/push/subscribe";
import type { NotifySettings, RatioItem, SettingsData } from "../lib/settings/types";
import { checkGoal, countGoalChars, evenRatios, GOAL_MAX_LENGTH } from "../lib/settings/validation";
import { useOnline } from "../lib/use-online";
import { NotifyRow } from "./onboarding";
import { entriesToRatios, RatioEditor, ratioKey, withOtherEntry, type RatioEntry } from "./ratio-editor";
import { Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";

/**
 * 내 정보 탭(PRD 부록 B): 처음 설정에서 정한 것을 고치는 곳과 알림 설정. 이번 틀의 내용은 임시다(임시값 목록).
 * - 목표 한 문장 고치기, 처음 정한 비율 고치기(처음 설정과 같은 −/+ 5% 단추. 「고칠 자리와 때」, PRD 7-1 열림), 알림 둘의 켜기·시각.
 * - 알림 켜기는 알림 허락 → 푸시 구독 저장이다. 푸시 서명 공개 키가 설정에 없으면 켜지 않고 안내한다(보내는 쪽 설정은 PM이 서버 설정에 둔다).
 * - 로그아웃은 맨 아래에도 있다(B18). 적던 글이 있을 때 확인은 할 일 탭이 하므로, 누르면 할 일 탭으로 가서 같은 로그아웃 흐름을 시작한다.
 * 모든 글은 React 텍스트로만 그린다.
 */

export const ME_TEXT = {
  title: "내 정보",
  goalHeading: "이루고 싶은 것", // 처음 설정의 첫 질문과 같은 이름
  goalLabel: "목표 한 문장",
  goalSave: "목표 저장",
  ratioHeading: "처음 정한 비율",
  ratioSave: "비율 저장",
  ratioEmpty: "분야가 아직 없어요. 할 일을 적을 때 분야를 더해 보세요.",
  notifyHeading: "알림",
  notifySave: "알림 설정 저장",
  logout: "로그아웃",
  saved: "저장했어요",
  saving: "저장하는 중",
  failed: "저장하지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 저장할 수 있어요.",
  tooLong: (n: number) => `${GOAL_MAX_LENGTH}자까지 적을 수 있어요. 지금 ${n}자예요.`,
  ratioNeed: "하나 이상은 0%보다 커야 해요.",
  permissionDenied: "이 기기에서 알림이 허락되지 않았어요. 브라우저 설정에서 바꿀 수 있어요.",
  unsupported: "이 브라우저는 알림을 받을 수 없어요.",
  missingKey: "알림을 보내는 설정이 아직 없어요. 설정이 끝나면 켤 수 있어요.",
  enableFailed: "알림을 켜지 못했어요. 다시 눌러 주세요.",
  enabled: "이 기기에서 알림을 받아요",
  notEnabled: "이 기기에서는 알림을 받지 않아요",
  unreadableGoal: "목표를 읽을 수 없어요. 새로 적으면 바뀌어요.",
  loadFailed: "내 정보를 불러오지 못했어요. 앱을 다시 열어 주세요.",
  eveningName: "오늘 기록 알림",
  eveningDesc: "저녁에 오늘 쓴 시간을 남기도록 알려 드려요.",
  morningName: "아침 알림",
  morningDesc: "아침에 앱을 열도록 알려 드려요.",
} as const;

type Entry = { id: string; name: string };

export function MeScreen({
  settings,
  categories,
  api,
  push,
  onChanged,
  onLogout,
}: {
  /** 서버가 읽은 설정(못 읽었으면 null) */
  settings: SettingsData | null;
  categories: Entry[];
  api: SettingsApi;
  push: PushApi;
  /** 저장이 끝났을 때(다른 화면이 새 값을 쓰게) */
  onChanged?: (next: { goal?: string | null; ratios?: RatioItem[]; notify?: NotifySettings }) => void;
  /** 맨 아래 「로그아웃」(B18). 없으면 단추를 그리지 않는다 */
  onLogout?: () => void;
}) {
  const logout = onLogout ? (
    <div className="me-logout">
      <TextButton id="me-logout-button" onClick={onLogout}>
        {ME_TEXT.logout}
      </TextButton>
    </div>
  ) : null;
  if (!settings) {
    return (
      <section className="me" aria-labelledby="me-title">
        <header className="today-header">
          <h1 id="me-title" className="today-title">
            {ME_TEXT.title}
          </h1>
        </header>
        <div className="growth-body">
          <Notice role="alert">{ME_TEXT.loadFailed}</Notice>
          {logout}
        </div>
      </section>
    );
  }
  return <MeBody settings={settings} categories={categories} api={api} push={push} onChanged={onChanged} logout={logout} />;
}

function MeBody({
  settings,
  categories,
  api,
  push,
  onChanged,
  logout,
}: {
  settings: SettingsData;
  categories: Entry[];
  api: SettingsApi;
  push: PushApi;
  onChanged?: (next: { goal?: string | null; ratios?: RatioItem[]; notify?: NotifySettings }) => void;
  logout: ReactNode;
}) {
  const online = useOnline();
  // 목표
  const [goal, setGoal] = useState(settings.goal ?? "");
  const [goalMessage, setGoalMessage] = useState("");
  const [goalBusy, setGoalBusy] = useState(false);
  // 비율
  const [percents, setPercents] = useState<Record<string, number>>(() => {
    if (settings.ratios.length > 0) return Object.fromEntries(settings.ratios.map((r) => [ratioKey(r.categoryId), r.percent]));
    return Object.fromEntries(evenRatios(categories.map((c) => c.id)).map((r) => [r.categoryId, r.percent]));
  });
  const [ratioMessage, setRatioMessage] = useState("");
  const [ratioBusy, setRatioBusy] = useState(false);
  // 알림
  const [eveningOn, setEveningOn] = useState(settings.notify.eveningEnabled);
  const [morningOn, setMorningOn] = useState(settings.notify.morningEnabled);
  const [eveningMinute, setEveningMinute] = useState(settings.notify.eveningMinute);
  const [morningMinute, setMorningMinute] = useState(settings.notify.morningMinute);
  const [notifyMessage, setNotifyMessage] = useState("");
  const [notifyBusy, setNotifyBusy] = useState(false);
  // 「받아요」는 실제 구독이 있는지로 정한다(B4). 처음 그릴 때는 허락 상태로 짐작하고, 곧 실제 구독 유무로 바로잡는다
  const [pushOn, setPushOn] = useState(() => push.permission() === "granted" && (settings.notify.eveningEnabled || settings.notify.morningEnabled));
  useEffect(() => {
    let alive = true;
    void push.subscribed().then((actual) => {
      if (alive) setPushOn(actual);
    });
    return () => {
      alive = false;
    };
  }, [push]);

  const goalCheck = checkGoal(goal);
  const goalOver = !goalCheck.ok && goalCheck.error === "too_long";

  async function saveGoal() {
    if (goalBusy || !goalCheck.ok || !online) return;
    setGoalBusy(true);
    setGoalMessage("");
    const res = await api.saveSettings({ goal: goalCheck.goal });
    setGoalBusy(false);
    if (res.ok) {
      setGoalMessage(ME_TEXT.saved);
      onChanged?.({ goal: goalCheck.goal });
    } else {
      setGoalMessage(ME_TEXT.failed);
    }
  }

  // 분야 줄들 뒤에 기타 줄이 하나 더 있다(기타도 비율에 넣을 수 있다)
  const entries: RatioEntry[] = withOtherEntry(
    categories.map((c) => ({ id: c.id, name: c.name, percent: percents[c.id] ?? 0 })),
    percents,
  );
  const ratioTotal = entries.reduce((s, e) => s + e.percent, 0);

  async function saveRatios() {
    if (ratioBusy || !online) return;
    if (ratioTotal <= 0) {
      setRatioMessage(ME_TEXT.ratioNeed);
      return;
    }
    setRatioBusy(true);
    setRatioMessage("");
    const ratios: RatioItem[] = entriesToRatios(entries);
    const res = await api.saveRatios(ratios);
    setRatioBusy(false);
    if (res.ok) {
      setRatioMessage(ME_TEXT.saved);
      onChanged?.({ ratios });
    } else {
      setRatioMessage(ME_TEXT.failed);
    }
  }

  async function saveNotify() {
    if (notifyBusy || !online) return;
    setNotifyBusy(true);
    setNotifyMessage("");
    const wantsAny = eveningOn || morningOn;
    if (wantsAny && !pushOn) {
      // 켜려는데 이 기기에서 아직 구독이 없다: 허락 → 구독
      const result = await push.enable();
      if (result === "ok") {
        setPushOn(true);
      } else {
        setNotifyBusy(false);
        setNotifyMessage(
          result === "denied"
            ? ME_TEXT.permissionDenied
            : result === "unsupported"
              ? ME_TEXT.unsupported
              : result === "missing_key"
                ? ME_TEXT.missingKey
                : ME_TEXT.enableFailed,
        );
        return;
      }
    }
    if (!wantsAny && pushOn) {
      await push.disable();
      setPushOn(false);
    }
    const notify: NotifySettings = { eveningEnabled: eveningOn, eveningMinute, morningEnabled: morningOn, morningMinute };
    const res = await api.saveSettings({ notify });
    setNotifyBusy(false);
    if (res.ok) {
      setNotifyMessage(ME_TEXT.saved);
      onChanged?.({ notify });
    } else {
      setNotifyMessage(ME_TEXT.failed);
    }
  }

  return (
    <section className="me" aria-labelledby="me-title">
      <header className="today-header">
        <h1 id="me-title" className="today-title">
          {ME_TEXT.title}
        </h1>
      </header>
      <div className="growth-body">
        {!online && <Notice role="status">{ME_TEXT.offline}</Notice>}

        <section className="detail-section" aria-labelledby="me-goal-title">
          <h2 id="me-goal-title" className="growth-sub-title">
            {ME_TEXT.goalHeading}
          </h2>
          {!settings.goalReadable && <p className="todo-sub">{ME_TEXT.unreadableGoal}</p>}
          <label htmlFor="me-goal" className="input-label">
            {ME_TEXT.goalLabel}
          </label>
          <input
            id="me-goal"
            className="input"
            type="text"
            value={goal}
            placeholder={APP_CONFIG.goalPlaceholder}
            onChange={(e) => {
              setGoal(e.target.value);
              setGoalMessage("");
            }}
            aria-invalid={goalOver ? true : undefined}
            aria-describedby="me-goal-help"
            autoComplete="off"
          />
          <p id="me-goal-help" className="input-help" role="status">
            {goalOver ? ME_TEXT.tooLong(countGoalChars(goal)) : goalMessage}
          </p>
          <PrimaryButton busy={goalBusy} disabled={goalBusy || goalOver || !online} onClick={() => void saveGoal()}>
            {goalBusy ? ME_TEXT.saving : ME_TEXT.goalSave}
          </PrimaryButton>
        </section>

        <section className="detail-section" aria-labelledby="me-ratio-title">
          <h2 id="me-ratio-title" className="growth-sub-title">
            {ME_TEXT.ratioHeading}
          </h2>
          {categories.length === 0 ? (
            <p className="todo-sub">{ME_TEXT.ratioEmpty}</p>
          ) : (
            <>
              <RatioEditor
                entries={entries}
                onChange={(next) => {
                  setRatioMessage("");
                  setPercents((prev) => ({ ...prev, ...Object.fromEntries(next.map((e) => [e.id, e.percent])) }));
                }}
              />
              <p className="input-help" role="status">
                {ratioMessage}
              </p>
              <SecondaryButton busy={ratioBusy} disabled={ratioBusy || !online} onClick={() => void saveRatios()}>
                {ratioBusy ? ME_TEXT.saving : ME_TEXT.ratioSave}
              </SecondaryButton>
            </>
          )}
        </section>

        <section className="detail-section" aria-labelledby="me-notify-title">
          <h2 id="me-notify-title" className="growth-sub-title">
            {ME_TEXT.notifyHeading}
          </h2>
          <p className="todo-sub">{pushOn ? ME_TEXT.enabled : ME_TEXT.notEnabled}</p>
          <NotifyRow
            id="me-evening"
            name={ME_TEXT.eveningName}
            desc={ME_TEXT.eveningDesc}
            on={eveningOn}
            minute={eveningMinute}
            onToggle={(v) => {
              setEveningOn(v);
              setNotifyMessage("");
            }}
            onMinute={setEveningMinute}
          />
          <NotifyRow
            id="me-morning"
            name={ME_TEXT.morningName}
            desc={ME_TEXT.morningDesc}
            on={morningOn}
            minute={morningMinute}
            onToggle={(v) => {
              setMorningOn(v);
              setNotifyMessage("");
            }}
            onMinute={setMorningMinute}
          />
          <p className="input-help" role="status">
            {notifyMessage}
          </p>
          <SecondaryButton busy={notifyBusy} disabled={notifyBusy || !online} onClick={() => void saveNotify()}>
            {notifyBusy ? ME_TEXT.saving : ME_TEXT.notifySave}
          </SecondaryButton>
        </section>
        {logout}
      </div>
    </section>
  );
}
