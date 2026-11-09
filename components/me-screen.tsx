"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SettingsApi } from "../lib/onboarding-api";
import type { PushApi } from "../lib/push/subscribe";
import type { NotifySettings, RatioItem, SettingsData } from "../lib/settings/types";
import { evenRatios } from "../lib/settings/validation";
import { useOnline } from "../lib/use-online";
import { categoryColorValue } from "../lib/category-color";
import { GoalSentenceEditor } from "./goal-sentence";
import { NotifyRow } from "./onboarding";
import { normalizedPercents, OTHER_RATIO_ID, ratioKey, withOtherEntry, type RatioEntry } from "./ratio-editor";
import { RatioSettings } from "./ratio-settings";
import { Notice, TextButton } from "./ui";
import { Wordmark } from "./wordmark";

/**
 * 내 정보 탭(PRD 부록 B): 처음 설정에서 정한 것을 고치는 곳과 알림 설정. 이번 틀의 내용은 임시다(임시값 목록).
 * - 첫 카드 = 목표 한 문장(고침6 ③): 이름표 「목표」(PM d-136) + 문장(20/28 Bold, 두 줄까지 낱말 단위 감쌈) + 「›」. 카드 전체가 단추 하나 → S8-b 「목표」
 *   (components/goal-sentence.tsx)에서 고친다. 내 정보에는 목표 글 칸·저장 단추가 없다. 비었으면 「목표 적기」.
 * - 목표 비율(PM 6 · Figma 50:641): 그 자리에서 고치지 않는다. 카드 = 「목표 비율」 + 작은 띠 한 줄(높이 8, 분야 색 칸 1px 윤곽, 숫자 없음) + 「›」, 카드 전체가 단추 하나 →
 *   S8-a 겹침 화면(components/ratio-settings.tsx, 처음 설정 S1-3 부품을 다시 씀)에서 고치고 저장한다. 저장하면 이 띠가 바뀐다. 띠의 숫자는 화면 읽기 이름에만 있다.
 * - 알림 둘의 켜기·시각(줄 설명 글 없음 — ⑬ 25). 바꾸는 즉시 저장하고 카드 아래 「✓ 저장했어요」를 잠깐 알린다(polite, 명세 ⑭ O-5). 「알림 설정 저장」 단추는 없다.
 *   알림을 켜는 순간(이 기기 구독이 없을 때) 허락 → 구독을 묻고, 안 되면 스위치를 되돌리고 까닭을 알린다. 저장이 실패해도 되돌린다. 맨 위는 워드마크 → 「내 정보」 제목(정합 A5).
 * - 알림 켜기는 알림 허락 → 푸시 구독 저장이다. 푸시 서명 공개 키가 설정에 없으면 켜지 않고 안내한다(보내는 쪽 설정은 PM이 서버 설정에 둔다).
 * - 로그아웃은 맨 아래에도 있다(B18). 적던 글이 있을 때 확인은 할 일 탭이 하므로, 누르면 할 일 탭으로 가서 같은 로그아웃 흐름을 시작한다.
 * 모든 글은 React 텍스트로만 그린다.
 */

export const ME_TEXT = {
  title: "내 정보",
  goalHeading: "목표", // 첫 카드 이름표(12 Medium 보조, PM d-136 — 옛 「이루고 싶은 것」)
  goalEmpty: "목표 적기", // 목표가 비었을 때 카드 글(16 Medium)
  goalCardName: (goal: string | null) => (goal ? `목표, ${goal}, 고치기` : "목표, 목표 적기"), // 카드 단추의 화면 읽기 이름
  ratioHeading: "목표 비율",
  /** 목표 비율 카드 단추의 화면 읽기 이름(띠에 숫자가 없어 이름에 싣는다) */
  ratioCardName: (parts: { name: string; percent: number }[]) =>
    ["목표 비율", ...parts.map((p) => `${p.name} ${p.percent}%`), "고치기"].join(", "),
  ratioEmpty: "분야가 아직 없어요. 할 일을 적을 때 분야를 더해 보세요.",
  notifyHeading: "알림",
  logout: "로그아웃",
  saved: "저장했어요",
  saving: "저장하는 중",
  failed: "저장하지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 저장할 수 있어요.",
  permissionDenied: "이 기기에서 알림이 허락되지 않았어요. 브라우저 설정에서 바꿀 수 있어요.",
  unsupported: "이 브라우저는 알림을 받을 수 없어요.",
  missingKey: "알림을 보내는 설정이 아직 없어요. 설정이 끝나면 켤 수 있어요.",
  enableFailed: "알림을 켜지 못했어요. 다시 눌러 주세요.",
  enabled: "이 기기에서 알림을 받아요",
  notEnabled: "이 기기에서는 알림을 받지 않아요",
  unreadableGoal: "목표를 읽을 수 없어요. 새로 적으면 바뀌어요.",
  loadFailed: "내 정보를 불러오지 못했어요. 앱을 다시 열어 주세요.",
  eveningName: "오늘 기록 알림",
  morningName: "아침 알림",
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
      <TextButton id="me-logout-button" className="text-tap" onClick={onLogout}>
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
  // 기기 먼저 저장(api.localFirst)이면 끊겨 있어도 저장을 막지 않는다(기기에 먼저 적고 서버에는 뒤에서 보낸다). 알림 켜기만은 서버·브라우저가 함께 해야 한다
  const online = useOnline() || api.localFirst === true;
  // 목표 한 문장(저장된 값). 고치기는 S8-b 창에서
  const [goal, setGoal] = useState<string | null>(settings.goal);
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  // 비율
  const [percents, setPercents] = useState<Record<string, number>>(() => {
    if (settings.ratios.length > 0) return Object.fromEntries(settings.ratios.map((r) => [ratioKey(r.categoryId), r.percent]));
    return Object.fromEntries(evenRatios(categories.map((c) => c.id)).map((r) => [r.categoryId, r.percent]));
  });
  const [ratioMessage, setRatioMessage] = useState("");
  const [ratioEditorOpen, setRatioEditorOpen] = useState(false);
  // 알림
  const [eveningOn, setEveningOn] = useState(settings.notify.eveningEnabled);
  const [morningOn, setMorningOn] = useState(settings.notify.morningEnabled);
  const [eveningMinute, setEveningMinute] = useState(settings.notify.eveningMinute);
  const [morningMinute, setMorningMinute] = useState(settings.notify.morningMinute);
  const [notifyMessage, setNotifyMessage] = useState("");
  const [notifySaved, setNotifySaved] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const notifyBusyRef = useRef(false);
  // 「✓ 저장했어요」는 잠깐(4초) 보이고 사라진다(O-5)
  useEffect(() => {
    if (!notifySaved) return;
    const timer = window.setTimeout(() => setNotifySaved(false), 4000);
    return () => window.clearTimeout(timer);
  }, [notifySaved]);
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

  function goalSaved(next: string | null) {
    setGoal(next);
    onChanged?.({ goal: next });
  }

  // 분야 줄들 뒤에 기타 줄이 하나 더 있다(기타도 비율에 넣을 수 있다)
  const entries: RatioEntry[] = withOtherEntry(
    categories.map((c, i) => ({ id: c.id, name: c.name, percent: percents[c.id] ?? 0, colorOrder: i })),
    percents,
  );
  // 띠 칸: S8-a가 그릴 값(합 100으로 맞춘 값)과 같은 값. 0% 칸은 그리지 않는다
  const shownPercents = normalizedPercents(entries);
  const bandCells = entries
    .map((e, i) => ({ id: e.id, name: e.name, percent: shownPercents[i], color: categoryColorValue(e.id === OTHER_RATIO_ID ? null : (e.colorOrder ?? i)) }))
    .filter((c) => c.percent > 0);

  // S8-a에서 저장이 끝났을 때: 띠를 새 값으로, 다른 화면도 새 값을 쓰게
  function ratiosSaved(ratios: RatioItem[], next: RatioEntry[]) {
    setPercents((prev) => ({ ...prev, ...Object.fromEntries(next.map((e) => [e.id, e.percent])) }));
    setRatioMessage(ME_TEXT.saved);
    onChanged?.({ ratios });
  }

  function applyNotify(n: NotifySettings) {
    setEveningOn(n.eveningEnabled);
    setEveningMinute(n.eveningMinute);
    setMorningOn(n.morningEnabled);
    setMorningMinute(n.morningMinute);
  }

  /** 알림 스위치·시각을 바꾸는 즉시 저장한다(O-5). 실패하면 앞 값으로 되돌린다 */
  async function changeNotify(patch: Partial<NotifySettings>) {
    if (notifyBusyRef.current || !online) return;
    const prev: NotifySettings = { eveningEnabled: eveningOn, eveningMinute, morningEnabled: morningOn, morningMinute };
    const next: NotifySettings = { ...prev, ...patch };
    applyNotify(next);
    notifyBusyRef.current = true;
    setNotifyBusy(true);
    setNotifyMessage("");
    setNotifySaved(false);
    const finish = () => {
      notifyBusyRef.current = false;
      setNotifyBusy(false);
    };
    const wantsAny = next.eveningEnabled || next.morningEnabled;
    if (wantsAny && !pushOn) {
      // 켜는 순간(또는 켜 둔 알림이 있는데 이 기기에 실제 구독이 없을 때 — B4 다시 시도): 허락 → 구독
      const result = await push.enable();
      if (result === "ok") {
        setPushOn(true);
      } else {
        applyNotify(prev);
        finish();
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
    const res = await api.saveSettings({ notify: next });
    finish();
    if (res.ok) {
      setNotifySaved(true);
      onChanged?.({ notify: next });
    } else {
      applyNotify(prev);
      setNotifyMessage(ME_TEXT.failed);
    }
  }

  return (
    <section className="me" aria-labelledby="me-title">
      <header className="today-header">
        <Wordmark className="today-wordmark" />
        <h1 id="me-title" className="today-title">
          {ME_TEXT.title}
        </h1>
      </header>
      <div className="growth-body">
        {!online && <Notice role="status">{ME_TEXT.offline}</Notice>}

        <section className="detail-section me-goal">
          <button type="button" className="me-goal-card" aria-label={ME_TEXT.goalCardName(goal)} onClick={() => setGoalEditorOpen(true)}>
            <span className="me-goal-body">
              <span className="me-goal-label">{ME_TEXT.goalHeading}</span>
              {goal ? <span className="me-goal-text">{goal}</span> : <span className="me-goal-empty">{ME_TEXT.goalEmpty}</span>}
            </span>
            <span className="me-goal-chevron" aria-hidden="true">
              ›
            </span>
          </button>
          {!settings.goalReadable && goal === settings.goal && <p className="todo-sub">{ME_TEXT.unreadableGoal}</p>}
        </section>

        <section className="me-section me-ratio">
          {categories.length === 0 ? (
            <div className="card-box">
              <h2 className="me-card-title">{ME_TEXT.ratioHeading}</h2>
              <p className="todo-sub">{ME_TEXT.ratioEmpty}</p>
            </div>
          ) : (
            <button
              type="button"
              className="me-ratio-card card-box"
              aria-label={ME_TEXT.ratioCardName(bandCells)}
              onClick={() => {
                setRatioMessage("");
                setRatioEditorOpen(true);
              }}
            >
              <span className="me-ratio-head">
                <span className="me-card-title">{ME_TEXT.ratioHeading}</span>
                <span className="me-chevron" aria-hidden="true">
                  ›
                </span>
              </span>
              <span className="me-ratio-band" aria-hidden="true">
                {bandCells.map((c) => (
                  <span key={c.id} className="me-ratio-cell" data-ratio-id={c.id} style={{ flexGrow: c.percent, background: c.color }} />
                ))}
              </span>
            </button>
          )}
          <p className="input-help" role="status">
            {ratioMessage}
          </p>
        </section>

        <section className="me-section card-box" aria-labelledby="me-notify-title">
          <h2 id="me-notify-title" className="me-card-title">
            {ME_TEXT.notifyHeading}
          </h2>
          <p className="todo-sub">{pushOn ? ME_TEXT.enabled : ME_TEXT.notEnabled}</p>
          <NotifyRow
            id="me-evening"
            name={ME_TEXT.eveningName}
            on={eveningOn}
            minute={eveningMinute}
            disabled={notifyBusy || !online}
            onToggle={(v) => void changeNotify({ eveningEnabled: v })}
            onMinute={(m) => void changeNotify({ eveningMinute: m })}
          />
          <NotifyRow
            id="me-morning"
            name={ME_TEXT.morningName}
            on={morningOn}
            minute={morningMinute}
            disabled={notifyBusy || !online}
            onToggle={(v) => void changeNotify({ morningEnabled: v })}
            onMinute={(m) => void changeNotify({ morningMinute: m })}
          />
          <p className="input-help me-notify-status" role="status">
            {notifyMessage ||
              (notifySaved ? (
                <>
                  <span aria-hidden="true">✓ </span>
                  {ME_TEXT.saved}
                </>
              ) : null)}
          </p>
        </section>
        {logout}
      </div>
      {goalEditorOpen && <GoalSentenceEditor initial={goal} api={api} onClose={() => setGoalEditorOpen(false)} onSaved={goalSaved} />}
      {ratioEditorOpen && <RatioSettings initial={entries} api={api} onClose={() => setRatioEditorOpen(false)} onSaved={ratiosSaved} />}
    </section>
  );
}
