// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManageApi } from "../../lib/manage-api";
import type { TodayTodos, TodoDay, TodoItem, TodoResult } from "../../lib/todos/types";

vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { PastDays } from "../../components/past-days";
import { DemoCodeView } from "../../components/login-button";
import { CarryOver } from "../../components/carry-over";

const read = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");
const CSS = read("app/globals.css");
const OFFLINE = read("public/offline.html");
/** 한 규칙(선택자 첫 줄 기준)의 안쪽 글 */
function rule(selector: string, src = CSS): string {
  const start = src.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`규칙 없음: ${selector}`);
  return src.slice(start, src.indexOf("}", start));
}

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("고침10 QA1 ① S0 틀린 코드: 오류 줄 자리를 미리 비운다", () => {
  const props = { value: "", busy: false, onChange: () => {}, onSubmit: () => {} };
  it("오류가 없어도 줄 자리(.demo-error-slot)가 있고, 오류는 그 안에 들어온다(칸이 안 밀린다)", () => {
    const { container, rerender } = render(<DemoCodeView {...props} notice={null} />);
    expect(container.querySelector(".demo-error-slot")).not.toBeNull();
    expect(container.querySelector(".demo-error")).toBeNull();
    rerender(<DemoCodeView {...props} notice="wrong_code" />);
    expect(container.querySelector(".demo-error-slot .demo-error")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("코드가 맞지 않아요");
  });
  it("오류 글 12 Medium 한 줄 · 「!」 14 · 줄 자리 = 위 4 + 16", () => {
    expect(rule(".demo-error")).toContain("font: 500 12px/16px var(--font-family)");
    expect(rule(".demo-error-icon")).toContain("inline-size: 14px");
    expect(rule(".demo-error-slot")).toContain("min-height: calc(var(--space-1) + 16px)");
  });
});

describe("고침10 QA1 ② offline.html 주 단추", () => {
  it("폭 가득 · 16 Bold · 고리 위 16 · 카드 위 32", () => {
    expect(OFFLINE).toMatch(/\.btn\{[^}]*inline-size:100%/);
    expect(OFFLINE).toMatch(/\.btn\{[^}]*font:700 16px\/24px/);
    expect(OFFLINE).toMatch(/main\{[^}]*padding:16px var\(--page-x\) 24px/);
    expect(OFFLINE).toMatch(/\.notice\{margin-top:32px;/);
  });
});

describe("고침10 QA1 ③ 어제 못 끝낸 펼침", () => {
  it("「접기」는 제목 줄 오른쪽(.carry-head 안), 주 단추는 아래 칸(.carry-actions)에 폭 가득", async () => {
    const yesterday: TodoItem[] = [{ id: "a", readable: true, text: "어제 일", done: false, createdAt: "2026-11-06T01:00:00.000Z", categoryId: null }];
    const api = { fetchYesterday: vi.fn(async () => ({ ok: true as const, data: { todos: yesterday } })), carryOver: vi.fn() } as unknown as ManageApi;
    const { container } = render(<CarryOver api={api} online onCarried={() => {}} />);
    await act(async () => {});
    await act(async () => screen.getByRole("button", { name: /^어제 못 끝낸 할 일 \d+개 보기$/ }).click());
    expect(container.querySelector(".carry-head .carry-close")?.textContent).toBe("접기");
    expect(container.querySelector(".carry-actions .btn-primary")?.textContent).toBe("1개 가져오기");
    expect(container.querySelector(".carry-actions .carry-close")).toBeNull();
    expect(rule(".carry-actions .btn")).toContain("inline-size: 100%");
    expect(rule(".carry-close")).toContain("color: var(--color-text-sub)");
  });
});

describe("고침10 QA1 ④ 지난 날", () => {
  const day: TodoDay = { date: "2026-11-06", year: 2026, month: 11, dayOfMonth: 6, weekday: 5 };
  it("줄마다 분야 점 + 이름, 분야를 모르면 붙이지 않는다", async () => {
    const todos: TodoItem[] = [
      { id: "a", readable: true, text: "토익 단어", done: true, createdAt: "2026-11-06T01:00:00.000Z", categoryId: "c1" },
      { id: "b", readable: true, text: "빨래", done: false, createdAt: "2026-11-06T01:00:00.000Z", categoryId: null },
    ];
    const api = { fetchDay: vi.fn(async (): Promise<TodoResult<TodayTodos>> => ({ ok: true, data: { day, todos } })), fetchNotes: vi.fn() } as unknown as ManageApi;
    const { container } = render(
      <PastDays api={api} today="2026-11-07" onClose={() => {}} categoryOf={(id) => (id === "c1" ? { name: "어학", color: "#123456" } : null)} />,
    );
    expect(await screen.findByText("토익 단어")).toBeTruthy();
    const rows = container.querySelectorAll(".past-todo");
    expect(rows[0].querySelector(".category-tag-dot")).not.toBeNull();
    expect(rows[0].querySelector(".category-tag")?.textContent).toContain("어학");
    expect(rows[1].querySelector(".category-tag")).toBeNull();
  });
  it("값: 줄 59 · 카드 사이 45 · 이날 기록 한 줄 56(숫자 오른쪽 Bold) · 빈 날 카드 72 · 머리 간격", () => {
    expect(rule(".past-todo")).toContain("min-block-size: 59px");
    expect(rule(".past-card")).toContain("margin: 0 0 45px");
    expect(rule(".past-record")).toContain("min-block-size: 56px");
    expect(rule(".past-record")).toContain("justify-content: space-between");
    expect(rule(".past-record-total")).toContain("font: 700 16px/24px");
    expect(rule(".past-card.card-box")).toContain("min-block-size: 72px");
    expect(rule(".past-title")).toContain("margin: 2px 0 0");
    expect(rule(".past-date-row")).toContain("margin: -8px 0 20px");
  });
});

describe("고침10 QA1 ⑤ ⑥ ⑦ ⑧ ⑨ CSS", () => {
  it("⑤ 목표 칸은 폭 가득(.goal-input)", () => {
    expect(rule(".goal-input")).toContain("inline-size: 100%");
    expect(read("components/goal-field.tsx")).toContain('className="input goal-input"');
  });
  it("⑥ 처음 설정 2: 고른 칩이 S5 칩 꼴(흰 면 + 윤곽 2) · ✓ · 줄 둘 사이 8", () => {
    expect(CSS).toContain('.onboarding .chip[aria-pressed="true"] .chip-face,');
    expect(CSS).toContain(".onboarding .chip-scroller + .chip-scroller { margin-top: var(--space-2); }");
    expect(read("components/onboarding.tsx")).toContain("{selected.includes(c.id) && <ChipCheck />}");
  });
  it("⑦ 「균등 배분」은 아래 주 단추 위에 붙박이(sticky)", () => {
    const m = CSS.match(/\.ratio-foot \{ justify-content: center;[^}]*\}/);
    expect(m, ".ratio-foot 규칙").not.toBeNull();
    expect(m![0]).toContain("position: sticky");
    expect(m![0]).toContain("100px");
  });
  it("⑧ 보조 단추 두 곳이 겹선 없이 보조 단추 꼴 그대로(Bold · 1.5)", () => {
    expect(rule(".btn-secondary")).toContain("box-shadow: inset 0 0 0 1.5px var(--color-primary)");
    expect(rule(".time-wheel-nudge-btn")).not.toMatch(/box-shadow|border/);
    expect(rule(".btn.growth-evening-button")).not.toMatch(/box-shadow|border|background/);
    expect(rule(".btn.growth-evening-button")).toContain("width: 100%");
  });
  it("⑨ 숫자 + 단위를 한 덩어리로 가운데(field-sizing: content)", () => {
    expect(CSS).toContain("@supports (field-sizing: content)");
    expect(CSS).toMatch(/\.num-field \.stepper-input[^}]*field-sizing: content[^}]*text-align: end/);
  });
});
