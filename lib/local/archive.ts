import { formatMinutes } from "../time-format";
import type { Mirror, Op } from "./types";

/**
 * 보낼 줄의 쓰기를 다루는 순수 함수(고침 4바퀴). 서버 비밀 없음 — 화면 코드도 import해도 된다.
 * - archivedText: 서버가 받지 않은 쓰기에서 사용자가 다시 적을 내용(글)을 뽑는다. 글이 없는 쓰기(끝냄·지우기·순서 등)는 null(보관하지 않는다).
 * - remapCategory: 분야 만들기가 duplicate였을 때, 뒤의 쓰기가 가리키는 분야 번호를 서버에 이미 있는 같은 이름의 분야 번호로 바꾼다.
 */

/** 분야 이름(기기 거울에서). 없거나 풀 수 없으면 「기타」·「분야」 */
function categoryName(mirror: Mirror, id: string | null): string {
  if (id === null) return "기타";
  const found = mirror.categories.find((c) => c.id === id);
  return found && found.readable ? found.name : "분야";
}

/** 서버가 받지 않은 쓰기에서 다시 적을 내용. 글이 없는 쓰기는 null */
export function archivedText(op: Op, mirror: Mirror): string | null {
  switch (op.kind) {
    case "todo.add":
      return op.text;
    case "todo.edit":
      return op.text ?? null;
    case "note.add":
      return op.text;
    case "category.add":
      return op.name;
    case "settings.save":
      return typeof op.patch.goal === "string" && op.patch.goal.length > 0 ? op.patch.goal : null;
    case "evening.save": {
      const { input } = op;
      const items = input.items.map((i) => `${categoryName(mirror, i.categoryId)} ${formatMinutes(i.minutes)}`).join(" · ");
      return `${input.targetDay} ${formatMinutes(input.totalMinutes)}${items ? ` (${items})` : ""}`;
    }
    default:
      return null;
  }
}

/** 분야 번호를 바꾸고, 같은 분야가 둘이 되면 하나로 더한다(분·퍼센트) */
function mergeBy<T extends { categoryId: string | null }>(items: T[], from: string, to: string, add: (a: T, b: T) => T): { items: T[]; changed: boolean } {
  if (!items.some((i) => i.categoryId === from)) return { items, changed: false };
  const out: T[] = [];
  for (const item of items) {
    const next = item.categoryId === from ? { ...item, categoryId: to } : item;
    const at = out.findIndex((o) => o.categoryId === next.categoryId);
    if (at >= 0) out[at] = add(out[at], next);
    else out.push(next);
  }
  return { items: out, changed: true };
}

/** 쓰기 하나가 가리키는 분야 번호 from을 to로 바꾼다. 바꿀 것이 없으면 같은 객체를 돌려준다 */
export function remapCategory(op: Op, from: string, to: string): Op {
  switch (op.kind) {
    case "todo.add":
    case "todo.edit":
      return op.categoryId === from ? { ...op, categoryId: to } : op;
    case "focus.start":
      return op.input.categoryId === from ? { ...op, input: { ...op.input, categoryId: to } } : op;
    case "evening.save": {
      const merged = mergeBy(op.input.items, from, to, (a, b) => ({ ...a, minutes: a.minutes + b.minutes }));
      return merged.changed ? { ...op, input: { ...op.input, items: merged.items } } : op;
    }
    case "goal.save": {
      const merged = mergeBy(op.items, from, to, (a, b) => ({ ...a, minutes: a.minutes + b.minutes }));
      return merged.changed ? { ...op, items: merged.items as { categoryId: string; minutes: number }[] } : op;
    }
    case "ratios.save": {
      const merged = mergeBy(op.ratios, from, to, (a, b) => ({ ...a, percent: a.percent + b.percent }));
      return merged.changed ? { ...op, ratios: merged.items } : op;
    }
    default:
      return op;
  }
}
