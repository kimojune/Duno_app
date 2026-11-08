import type { CategoryItem } from "../categories/types";
import type { EveningLog } from "../evening/types";
import type { EveningSaveInput } from "../evening-api";
import type { FocusStartInput } from "../focus-api";
import type { FocusSession } from "../focus/types";
import type { CategoryMinutes } from "../growth/logic";
import type { NoteItem } from "../notes/types";
import type { Offer } from "../offers/types";
import type { RatioItem, SettingsData, NotifySettings } from "../settings/types";
import type { ViewEntry, ViewScreen } from "../views/core-types";

/**
 * 기기 먼저 저장(local-first)의 자료 모양(고침 3바퀴). 서버 비밀·암호화 코드 없음 — 화면 코드도 import해도 된다.
 *
 * 기기에는 두 가지를 둔다.
 *  1) 거울(Mirror): 서버에서 받은 내 자료의 사본(할 일 최근 8일·분야·설정·저녁 기록·이번 주 목표·타이머 기록). 글은 평문이다(PM 확정: 혼자 쓰는 동안 허용).
 *  2) 보낼 줄(outbox): 아직 서버에 못 보낸 쓰기(Op)들. 사용자가 누르면 거울에 먼저 반영하고 줄에 넣는다. 화면은 거울만 본다.
 * 화면이 보는 값 = 서버에서 받은 거울(base)에 보낼 줄의 쓰기를 차례로 다시 입힌 것(replay). 서버가 쓰기를 거절하면 그 쓰기를 줄에서 빼고 다시 입히면 되돌려진다.
 */

/** 거울의 할 일 한 줄. text가 null이면 풀 수 없는 글 */
export type MirrorTodo = {
  id: string;
  /** 두노 하루 'YYYY-MM-DD' */
  day: string;
  text: string | null;
  done: boolean;
  createdAt: string;
  categoryId: string | null;
  /** 순서(위로/아래로로 정한 것). 안 정했으면 null */
  position: number | null;
};

export type MirrorOffers = { card: Offer | null; timer_tab: Offer | null };

export type Mirror = {
  /** 서버에서 받은 사본을 한 번이라도 받았나(처음 쓰는 기기는 false: 아직 목록이 없는 것이지 비어 있는 것이 아니다) */
  synced: boolean;
  todos: MirrorTodo[];
  categories: CategoryItem[];
  settings: SettingsData | null;
  /** 날마다 가장 늦게 저장한 저녁 기록(목표·상태보기·미리 채우기가 읽는다) */
  logs: EveningLog[];
  /** 이번 주 목표: 주(월요일) → 분야와 분(목표가 없으면 null) */
  goals: Record<string, CategoryMinutes[] | null>;
  /** 타이머 기록(최근 8일) */
  sessions: FocusSession[];
  /** 할 일마다 작업 기록(열어 본 것만 있다. 새로 적은 할 일은 빈 목록으로 시작) */
  notes: Record<string, NoteItem[]>;
  /** 마지막으로 받은 먼저 할 일 제시(제시는 서버만 정한다: 기록 위조 막기) */
  offers: MirrorOffers;
};

/** 서버가 한 번에 내려주는 사본. 칸이 null이면 그 칸을 못 읽은 것이라 기기의 옛 값을 그대로 둔다 */
export type MirrorSnapshot = {
  /** 서버 시각(ISO) */
  serverNow: string;
  /** 이 사본의 주인(세션 사용자 번호, 고침 4바퀴). 기기 운영 장치의 사용자와 다르면 받지 않는다(옛 서버가 주는 사본에는 없을 수 있다) */
  userId?: string;
  todos: MirrorTodo[] | null;
  categories: CategoryItem[] | null;
  settings: SettingsData | null;
  logs: EveningLog[] | null;
  goal: { weekStart: string; items: CategoryMinutes[] | null } | null;
  sessions: FocusSession[] | null;
};

/** 기기 거울이 담는 할 일의 기간(오늘부터 거슬러 이만큼 날). 저녁 기록 대상 날(7일)과 지난 날 보기가 읽는다 */
export const MIRROR_TODO_DAYS = 8;

/** 보낼 줄에 넣는 쓰기. 한 종류마다 서버가 받는 Server Action이 하나씩 있다(lib/local/sender.ts) */
export type Op =
  | { kind: "todo.add"; id: string; text: string; categoryId?: string | null }
  | { kind: "todo.done"; id: string; done: boolean }
  | { kind: "todo.edit"; id: string; text?: string; categoryId?: string | null }
  | { kind: "todo.delete"; id: string }
  | { kind: "todo.reorder"; ids: string[] }
  | { kind: "todo.carry"; items: { from: string; id: string }[] }
  | { kind: "note.add"; id: string; todoId: string; text: string }
  | { kind: "note.delete"; id: string; todoId?: string }
  | { kind: "category.add"; id: string; name: string }
  | { kind: "evening.save"; input: EveningSaveInput }
  | { kind: "focus.start"; input: FocusStartInput }
  | { kind: "focus.end"; id: string }
  | { kind: "goal.save"; items: { categoryId: string; minutes: number }[] }
  | { kind: "goal.clear" }
  | { kind: "settings.save"; patch: { goal?: string | null; notify?: Partial<NotifySettings>; completeOnboarding?: boolean } }
  | { kind: "ratios.save"; ratios: RatioItem[] }
  | { kind: "view.record"; id: string; screen: ViewScreen; entry: ViewEntry }
  | { kind: "offer.dismiss"; id: string };

export type OpKind = Op["kind"];

/**
 * 보낼 줄의 한 칸. key는 줄 안의 순서(시각 순으로 커지는 문자열)이자 기기 저장소의 열쇠다.
 * clientAt은 누른 때(기기 시계, ISO): 하루 경계(서울 새벽 4시)를 이 때로 정해 서버에 함께 보낸다. attempts는 서버가 일시 오류로 답한 횟수.
 */
export type QueuedOp = { key: string; clientAt: string; attempts: number; op: Op };

/**
 * 보내기 결과. network는 서버에 닿지 못한 것(끊김·시간 초과)이라 횟수에 세지 않는다.
 * existing은 분야 만들기가 duplicate일 때 서버가 알려 준 같은 이름의 내 분야(고침 4바퀴: 뒤의 쓰기의 분야 번호를 이것으로 바꿔 보낸다).
 * account_mismatch는 서버의 세션 사용자가 이 기기 운영 장치의 사용자와 다르다는 뜻이다(보내지 않고 이 사용자 것을 지운다).
 */
export type SendResult = { ok: true } | { ok: false; error: string; network?: boolean; existing?: { id: string; name: string } };
export type Sender = (queued: QueuedOp) => Promise<SendResult>;

/** 서버가 거절한 쓰기(기기 것은 되돌렸다). 화면이 한 줄로 알린다 */
export type Rejection = { kind: OpKind; error: string };

/**
 * 서버가 받지 않은 쓰기의 내용(고침 4바퀴). 이 사용자 기기 저장소에 남겨 화면에서 보고 복사할 수 있다(다시 적기는 사용자가 붙여 넣어 한다).
 * text는 사용자가 적은 글(할 일·작업 기록·분야 이름·목표 한 문장) 또는 저녁 기록의 시간 줄. 사용자 입력이니 화면은 텍스트로만 그린다.
 */
export type ArchivedWrite = {
  /** 보낼 줄의 열쇠(보관 열쇠로도 쓴다) */
  key: string;
  kind: OpKind;
  error: string;
  /** 누른 때(기기 시계, ISO) */
  clientAt: string;
  text: string;
};
