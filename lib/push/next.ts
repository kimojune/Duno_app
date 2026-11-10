import type { NotifySettings } from "../settings/types";
import { minutesSince } from "./due";

/**
 * 「지금 보낼 알림이 무엇인가」(PRD 7-8, 고침 3바퀴 PM 답 d-69). 순수 계산, 화면·서버 어디서나 쓴다.
 * 푸시 신호에는 본문이 없다. 신호를 받은 서비스 워커가 서버(GET /api/notify/next)에 이것을 물어 종류·글·여는 주소를 받는다.
 * 그래서 아침·저녁 알림 시각은 어디에 두어도 된다(옛 판은 서비스 워커가 「서울 오후 3시 전/후」로 짐작해 저녁 알림을 오후 3시 전에 두면 아침 알림 글이 나왔다).
 *
 * 규칙: 켜 둔 알림 가운데 정한 시각이 가장 최근에 지난 것이 지금 알림이다(신호가 늦게 닿아도 맞는다).
 * 다른 알림도 정한 시각이 창(예약 실행 간격) 안이면 함께 보낸다(두 시각이 같을 때). 둘 다 꺼 뒀으면 빈 목록(서비스 워커가 중립 글을 보인다).
 */
export type NotifyKind = "evening" | "morning";

export type NotifyItem = {
  kind: NotifyKind;
  title: string;
  body: string;
  /** 같은 종류의 알림은 하나로 합쳐 보이게 하는 표시 */
  tag: string;
  /** 알림을 누르면 여는 주소(앱 안) */
  url: string;
};

/** 알림 글. 저녁 알림 이름은 「오늘 기록」, 아침 알림 이름은 「오늘 먼저 할 일」(임시, docs/oneshot-v2/임시값.md ⑦). 재촉·평가하는 말 없음 */
export const NOTIFY_ITEMS: Record<NotifyKind, NotifyItem> = {
  evening: { kind: "evening", title: "오늘 기록", body: "오늘 몇 시간 썼는지 적어 둘까요?", tag: "duno-evening", url: "/?open=evening" },
  morning: { kind: "morning", title: "오늘 먼저 할 일", body: "앱을 열어 오늘 할 일을 시작해 보세요", tag: "duno-morning", url: "/?open=offer" },
};

export function pickNotifications(args: { notify: NotifySettings; nowMinute: number; windowMinutes: number }): NotifyItem[] {
  const candidates: { kind: NotifyKind; elapsed: number }[] = [];
  if (args.notify.eveningEnabled) candidates.push({ kind: "evening", elapsed: minutesSince(args.notify.eveningMinute, args.nowMinute) });
  if (args.notify.morningEnabled) candidates.push({ kind: "morning", elapsed: minutesSince(args.notify.morningMinute, args.nowMinute) });
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => a.elapsed - b.elapsed);
  const [first, ...rest] = candidates;
  const picked = [first, ...rest.filter((c) => c.elapsed < args.windowMinutes)];
  return picked.map((c) => NOTIFY_ITEMS[c.kind]);
}
