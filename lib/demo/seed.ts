import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordRatioHistory, type RatioHistoryOutcome } from "../settings/ratio-history";
import { encryptCategoryName, encryptTodoText, type TodoKey } from "../todos/crypto";
import { addDays, weekStartFor } from "../week";

/**
 * 시연용 예시 데이터(서버 전용). 체험 코드로 들어온 익명 사용자(app/demo/actions.ts → lib/demo/start.ts)에게 넣는다.
 * 입력은 세션 클라이언트·사용자 번호·키·오늘뿐이라 다른 진입점에서도 그대로 부를 수 있다(시연 계정 시드 스크립트 d-160은 PM이 취소).
 *
 * 규칙
 * - 그 사용자 자기 세션의 Supabase 클라이언트로 표에 직접 넣는다(RLS를 거친다). service role 키는 쓰지 않는다.
 *   앱 서버의 쓰기 길(할 일 72시간·저녁 기록 오늘/어제 제한)을 거치지 않는 까닭: 지난 2~3주치를 넣어야 해서. DB에는 지난 날짜를 막는 제약이 없다.
 * - 글(할 일·분야 이름·목표 한 줄)은 앱과 같은 함수·같은 키·같은 AAD로 암호화한다(lib/todos/crypto.ts).
 * - 다시 돌려도 중복되지 않는다: 분야·할 일·저녁 기록 id는 (사용자, 종류, 번호)에서 정해지는 결정적 uuid이고, 이미 있으면 건너뛴다
 *   (upsert ignoreDuplicates = ON CONFLICT DO NOTHING, insert 권한만 든다). 비율·이번 주 목표·설정은 키가 (사용자[, 분야/주])라 덮어쓴다.
 *   목표 비율 기록(category_ratio_history)은 앱 함수(recordRatioHistory)가 「직전과 같은 묶음이면 안 씀」을 지킨다.
 * - 넣는 순서: 분야(한 줄씩 — created_at이 만든 순서가 되게) → 할 일 → 저녁 기록 → 목표 비율 → 비율 기록 → 이번 주 목표 → 설정(목표 한 줄·처음 설정 끝 표시).
 *   처음 설정 끝 표시가 맨 끝이라, 중간에 실패하면 끝 표시가 남지 않고 다시 돌리면 빠진 것만 채운다.
 * - 실패하면 DemoSeedError(단계 이름과 DB 오류 코드만, 값·사용자 글 없음)를 던진다.
 * - 예시 글은 사용자 입력이 아니라 아래 고정 목록이다.
 */

export const DEMO_SPAN_DAYS = 20; // 오늘 포함 21일(3주) — 지난 2~3주치

/** 분야(만든 순서). 이름은 분야 이름 상한(20자) 안 */
export const DEMO_CATEGORIES = ["어학", "포트폴리오", "자격증", "운동"] as const;

/** 분야별 할 일 글(고정). 마지막 줄은 기타(분야 없음) */
const TODO_TEXTS: readonly (readonly string[])[] = [
  ["토익 스피킹 모의고사 1회", "영어 단어 50개 외우기", "섀도잉 20분", "오픽 답변 스크립트 다듬기"],
  ["프로젝트 회고 글 쓰기", "포트폴리오 표지 고치기", "케이스 스터디 한 편 정리", "자기소개 페이지 문장 다듬기"],
  ["정보처리기사 기출 1회 풀기", "오답 노트 정리", "데이터베이스 단원 복습", "요약 노트 만들기"],
  ["헬스장 상체 운동", "30분 걷기", "스트레칭 15분", "러닝 3km"],
  ["은행 서류 내기", "방 정리", "장보기"],
];

/** 목표 비율(%) — 분야 순서대로, 마지막이 기타. 합 100, 5 단위(RATIO_STEP) */
export const DEMO_RATIOS = [30, 30, 20, 10] as const;
export const DEMO_RATIO_OTHER = 10;

/** 이번 주 목표(분, 1시간 단위) — 분야 순서대로 */
export const DEMO_WEEKLY_MINUTES = [6 * 60, 5 * 60, 4 * 60, 3 * 60] as const;

export const DEMO_GOAL_TEXT = "내년 상반기 안에 원하는 회사에 취업하기";

export type DemoSeedInput = {
  supabase: SupabaseClient;
  userId: string;
  key: TodoKey;
  /** 오늘 두노 하루('YYYY-MM-DD', 새벽 4시 경계 — lib/todos/day.ts todoDayFor) */
  today: string;
  /** 처음 설정 끝 시각(서버 시계). 시험이 고정한다 */
  now?: () => Date;
};

export type DemoSeedCounts = {
  categories: number;
  todos: number;
  eveningLogs: number;
  ratios: number;
  ratioHistory: number;
  weeklyGoals: number;
  settings: number;
};

export class DemoSeedError extends Error {
  readonly step: string;
  readonly code: string | null;
  constructor(step: string, code: string | null) {
    super(`demo seed failed at ${step}${code ? ` (code=${code})` : ""}`);
    this.name = "DemoSeedError";
    this.step = step;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 계획(순수): 같은 (사용자, 오늘)이면 늘 같은 행 — 그래서 다시 돌려도 같은 id
// ---------------------------------------------------------------------------

/** (사용자, 종류, 번호)에서 정해지는 uuid(v5 꼴 비트). 사용자마다 달라 남의 행과 겹치지 않는다. */
export function demoUuid(userId: string, kind: string, n: number | string): string {
  const h = createHash("sha256").update(`duno.demo|${userId}|${kind}|${n}`, "utf8").digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 날짜로 정해지는 작은 수(사용자와 상관없이 같은 모양 — 시연 화면이 늘 비슷하게) */
function pick(seed: string, mod: number): number {
  return createHash("sha256").update(seed, "utf8").digest().readUInt32BE(0) % mod;
}

export type DemoTodo = { id: string; day: string; categoryIndex: number | null; text: string; done: boolean };
export type DemoEveningLog = {
  id: string;
  targetDay: string;
  totalMinutes: number;
  items: { categoryIndex: number | null; minutes: number }[];
};
export type DemoPlan = {
  categoryIds: string[];
  todos: DemoTodo[];
  eveningLogs: DemoEveningLog[];
  weekStart: string;
};

export function buildDemoPlan(userId: string, today: string): DemoPlan {
  const categoryIds = DEMO_CATEGORIES.map((_, i) => demoUuid(userId, "category", i));
  const todos: DemoTodo[] = [];
  const eveningLogs: DemoEveningLog[] = [];

  for (let back = DEMO_SPAN_DAYS; back >= 0; back -= 1) {
    const day = addDays(today, -back);
    const isToday = back === 0;

    // 할 일: 하루 2~4개. 분야는 날마다 돌려 가며, 가끔 기타
    const count = 2 + pick(`count|${day}`, 3);
    const start = pick(`start|${day}`, TODO_TEXTS.length);
    for (let n = 0; n < count; n += 1) {
      const group = (start + n) % TODO_TEXTS.length;
      const texts = TODO_TEXTS[group];
      const text = texts[pick(`text|${day}|${n}`, texts.length)];
      // 지난날은 대부분 끝냄(약 3/4), 오늘은 첫 하나만 끝냄
      const done = isToday ? n === 0 : pick(`done|${day}|${n}`, 4) !== 0;
      todos.push({
        id: demoUuid(userId, `todo|${day}`, n),
        day,
        categoryIndex: group < DEMO_CATEGORIES.length ? group : null,
        text,
        done,
      });
    }

    // 오늘 기록: 지난날마다 하나(오늘은 아직 저녁 전이라 없음). 30분 단위, 분야 2~3개(가끔 기타 포함), 합 = total
    if (!isToday) {
      const parts = 2 + pick(`parts|${day}`, 2);
      const first = pick(`first|${day}`, DEMO_CATEGORIES.length);
      const items: { categoryIndex: number | null; minutes: number }[] = [];
      for (let p = 0; p < parts; p += 1) {
        const withOther = p === parts - 1 && pick(`other|${day}`, 3) === 0;
        const categoryIndex = withOther ? null : (first + p) % DEMO_CATEGORIES.length;
        if (items.some((i) => i.categoryIndex === categoryIndex)) continue;
        items.push({ categoryIndex, minutes: 30 * (1 + pick(`min|${day}|${p}`, 4)) });
      }
      eveningLogs.push({
        id: demoUuid(userId, "evening", day),
        targetDay: day,
        totalMinutes: items.reduce((s, i) => s + i.minutes, 0),
        items,
      });
    }
  }

  return { categoryIds, todos, eveningLogs, weekStart: weekStartFor(today) };
}

// ---------------------------------------------------------------------------
// 넣기
// ---------------------------------------------------------------------------

function dbCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

function rowsOf(data: unknown): number {
  return Array.isArray(data) ? data.length : 0;
}

/** 예시 데이터를 넣고, 이번에 새로 들어간(또는 덮어쓴) 행 수를 돌려준다. 실패하면 DemoSeedError. */
export async function seedDemoData(input: DemoSeedInput): Promise<DemoSeedCounts> {
  const { supabase, userId, key, today } = input;
  const plan = buildDemoPlan(userId, today);
  const counts: DemoSeedCounts = { categories: 0, todos: 0, eveningLogs: 0, ratios: 0, ratioHistory: 0, weeklyGoals: 0, settings: 0 };
  const categoryId = (index: number | null) => (index === null ? null : plan.categoryIds[index]);

  // 1. 분야: 한 줄씩(요청마다 트랜잭션이 달라 created_at = 만든 순서)
  for (let i = 0; i < DEMO_CATEGORIES.length; i += 1) {
    const res = await supabase
      .from("categories")
      .upsert(
        { id: plan.categoryIds[i], user_id: userId, name_encrypted: encryptCategoryName(DEMO_CATEGORIES[i], userId, key) },
        { onConflict: "id", ignoreDuplicates: true },
      )
      .select("id");
    if (res.error) throw new DemoSeedError("categories", dbCode(res.error));
    counts.categories += rowsOf(res.data);
  }

  // 2. 할 일
  const todoRows = plan.todos.map((t) => ({
    id: t.id,
    user_id: userId,
    day: t.day,
    text_encrypted: encryptTodoText(t.text, userId, key),
    done: t.done,
    category_id: categoryId(t.categoryIndex),
  }));
  const todos = await supabase.from("todos").upsert(todoRows, { onConflict: "id", ignoreDuplicates: true }).select("id");
  if (todos.error) throw new DemoSeedError("todos", dbCode(todos.error));
  counts.todos = rowsOf(todos.data);

  // 3. 오늘 기록(대상 날 저녁 10시 서울 = 기기 시계 자리. 서버 시계 saved_at은 DB 기본값)
  const logRows = plan.eveningLogs.map((l) => ({
    id: l.id,
    user_id: userId,
    target_day: l.targetDay,
    total_minutes: l.totalMinutes,
    items: l.items.map((i) => ({ categoryId: categoryId(i.categoryIndex), minutes: i.minutes })),
    save_mode: "edited",
    client_saved_at: `${l.targetDay}T13:00:00.000Z`,
  }));
  const logs = await supabase.from("evening_logs").upsert(logRows, { onConflict: "id", ignoreDuplicates: true }).select("id");
  if (logs.error) throw new DemoSeedError("evening_logs", dbCode(logs.error));
  counts.eveningLogs = rowsOf(logs.data);

  // 4. 목표 비율(분야 몫) — 기타 몫은 6번 설정 행(ratio_other_percent)
  const ratioRows = plan.categoryIds.map((id, i) => ({ user_id: userId, category_id: id, percent: DEMO_RATIOS[i] }));
  const ratios = await supabase.from("category_ratios").upsert(ratioRows, { onConflict: "user_id,category_id" }).select("category_id");
  if (ratios.error) throw new DemoSeedError("category_ratios", dbCode(ratios.error));
  counts.ratios = rowsOf(ratios.data);

  // 5. 목표 비율 기록 한 줄(고침9). 앱과 같은 함수: 직전과 같은 묶음이면 안 쓴다. 실패해도 앱처럼 비율은 그대로 둔다(로그 코드만)
  const history: RatioHistoryOutcome = await recordRatioHistory(supabase, userId, [
    ...plan.categoryIds.map((id, i) => ({ categoryId: id, percent: DEMO_RATIOS[i] })),
    { categoryId: null, percent: DEMO_RATIO_OTHER },
  ]);
  if (history === "read_failed" || history === "write_failed") throw new DemoSeedError("category_ratio_history", null);
  counts.ratioHistory = history === "written" ? 1 : 0;

  // 6. 이번 주 목표(1시간 단위)
  const goalItems = plan.categoryIds.map((id, i) => ({ categoryId: id, minutes: DEMO_WEEKLY_MINUTES[i] }));
  const weekly = await supabase
    .from("weekly_goals")
    .upsert({ user_id: userId, week_start: plan.weekStart, items: goalItems }, { onConflict: "user_id,week_start" })
    .select("week_start");
  if (weekly.error) throw new DemoSeedError("weekly_goals", dbCode(weekly.error));
  counts.weeklyGoals = rowsOf(weekly.data);

  // 7. 설정: 목표 한 줄 + 기타 몫 + 처음 설정 끝 표시(이미 끝났으면 그 시각을 그대로 둔다). 맨 끝 = 다 들어갔다는 표시
  const existing = await supabase.from("user_settings").select("onboarding_done_at").eq("user_id", userId);
  if (existing.error) throw new DemoSeedError("user_settings", dbCode(existing.error));
  const doneAt = ((existing.data ?? []) as { onboarding_done_at: string | null }[])[0]?.onboarding_done_at ?? null;
  const settings = await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        goal_encrypted: encryptTodoText(DEMO_GOAL_TEXT, userId, key, "goal_text"),
        ratio_other_percent: DEMO_RATIO_OTHER,
        onboarding_done_at: doneAt ?? (input.now ?? (() => new Date()))().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("user_id");
  if (settings.error) throw new DemoSeedError("user_settings", dbCode(settings.error));
  counts.settings = rowsOf(settings.data);

  return counts;
}
