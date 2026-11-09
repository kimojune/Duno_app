import type { ItemDelta } from "../evening/logic";
import { minutesOf } from "./logic";
import { buildStatusChart } from "./status-chart";
import type { GrowthData } from "./types";

/**
 * 오늘 기록 저장 직후 「이번 주」 카드(S5-3, 명세 ⑦-7 · Figma 49:142 · 59:2)의 값. 화면 없는 순수 함수.
 * - 줄 = 이번 기록으로 바뀐 분야만(저장 결과 delta, 0분 바뀜은 없음). 많으면 바뀐 크기 큰 순(delta 순서 그대로) 넷 + 「그 밖 n개」.
 * - 막대 = 이번 주 그 분야 쓴 시간(상태보기 GrowthData.thisWeek — 저장 뒤 다시 읽은 값). 앞 칸 = 전에 있던 몫, 뒤 칸 = 이번에 더한 몫(delta, 빗금).
 *   줄었으면(고쳐서 다시 저장) 빗금 몫 없이 지금 값만.
 * - 목표 세운 주(이번 주 목표 항목이 하나 이상): 그 분야 목표 눈금 + 「n 더」(남을 때) / 「목표 n」(닿았을 때). 목표에 없는 분야는 둘 다 없음.
 *   목표 없는 주: 「이번 주 n% / 목표 n%」 — 상태보기 목표 비율 뷰와 같은 셈(buildStatusChart). 처음 정한 비율이 없으면 「이번 주 n%」만.
 * - 막대 길이는 보이는 줄끼리 같은 잣대(그 줄들의 쓴 시간·목표 가운데 가장 큰 값 = 끝까지).
 */

export const AFTER_SAVE_MAX_ROWS = 4;

export type AfterSaveRow = {
  categoryId: string | null;
  /** 이번 기록으로 바뀐 분(음수면 줄어듦) */
  delta: number;
  /** 이번 주 지금 쓴 시간(분) */
  spent: number;
  /** 막대 앞 칸(전에 있던 몫, 분) */
  before: number;
  /** 막대 뒤 칸(이번에 더한 몫 = 빗금, 분) */
  added: number;
  /** 목표 세운 주의 그 분야 목표(분). 목표 없는 주나 목표에 없는 분야는 null */
  goal: number | null;
  /** 목표까지 남은 분(목표가 있을 때만) */
  remaining: number | null;
  /** 목표 없는 주: 이번 주 몫 %와 처음 정한 비율 %(비율이 없으면 null) */
  spentPercent: number | null;
  ratioPercent: number | null;
};

export type AfterSaveView = {
  basis: "goal" | "ratio";
  rows: AfterSaveRow[];
  /** 「그 밖 n개」 */
  others: number;
  /** 막대 끝 = 이 분 */
  scale: number;
};

export function buildAfterSave(delta: readonly ItemDelta[], data: GrowthData): AfterSaveView {
  const changed = delta.filter((d) => d.minutes !== 0 && Number.isFinite(d.minutes));
  const shown = changed.slice(0, AFTER_SAVE_MAX_ROWS);
  const goalItems = data.goal?.items ?? [];
  const basis: AfterSaveView["basis"] = goalItems.length > 0 ? "goal" : "ratio";
  const chart = basis === "ratio" ? buildStatusChart({ categoryIds: data.categories.map((c) => c.id), ratios: data.ratios, totals: data.thisWeek }) : null;

  const rows = shown.map((d): AfterSaveRow => {
    const spent = Math.max(0, minutesOf(data.thisWeek, d.categoryId));
    const added = Math.min(spent, Math.max(0, d.minutes));
    const goalItem = goalItems.find((g) => g.categoryId === d.categoryId);
    const goal = basis === "goal" && goalItem && goalItem.minutes > 0 ? goalItem.minutes : null;
    const chartRow = chart?.rows.find((r) => r.categoryId === d.categoryId) ?? null;
    return {
      categoryId: d.categoryId,
      delta: d.minutes,
      spent,
      before: spent - added,
      added,
      goal,
      remaining: goal === null ? null : Math.max(0, goal - spent),
      spentPercent: chartRow ? chartRow.spentPercent : null,
      ratioPercent: chartRow && chart && !chart.ratioEmpty ? chartRow.ratioPercent : null,
    };
  });
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.spent, r.goal ?? 0)));
  return { basis, rows, others: changed.length - shown.length, scale };
}

/** 막대 칸의 폭(%, 소수 둘째 자리). 잣대가 0이면 0 */
export function barWidth(minutes: number, scale: number): number {
  if (scale <= 0 || minutes <= 0) return 0;
  return Math.min(100, Math.round((minutes / scale) * 10000) / 100);
}
