// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalEditor } from "../../components/goal";
import { RatioEditor, type RatioEntry } from "../../components/ratio-editor";
import type { GoalsApi } from "../../lib/goals-api";

/**
 * 고침10 W2b J(49:248~49:287 · 49:254 · 50:109~116 · 77:18 · 50:332): 분야 줄 한 줄 · 숫자 칸 가운데 · 시트 넷(위 모서리 16 + 손잡이 줄 40×4 #E7E1D6 + 막 45%) · 적는 창 칸·단추.
 * 꼴 값은 app/globals.css의 규칙을 읽어 견준다(jsdom은 CSS를 그리지 않는다). 그림은 npm run screens(tests/screens/fix10-b.spec.ts)가 본다.
 */

const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("분야 줄은 한 줄: 점 12 + 이름(남는 폭, 길면 말줄임) + −/숫자 칸/+ 고정 폭", () => {
  it("목표 비율 줄(처음 설정 3단계 · S8-a): 줄 하나 안에 점 → 이름 → 줄이기·숫자 칸·늘리기, 감싸지 않고 이름만 말줄임", () => {
    const longName = "아주아주아주긴분야이름이라서한줄에다안들어갑니다";
    const entries: RatioEntry[] = [
      { id: C1, name: longName, percent: 60 },
      { id: "other", name: "기타", percent: 40 },
    ];
    render(<RatioEditor entries={entries} onChange={vi.fn()} />);
    const row = document.querySelectorAll(".ratio-row")[0];
    expect([...row.children].map((el) => el.className.split(" ")[0])).toEqual(["chip-dot", "ratio-name", "ratio-control"]);
    expect(row.querySelector(".ratio-name")!.textContent).toBe(longName);
    expect(row.querySelectorAll(".step-btn")).toHaveLength(2);
    expect(css).toMatch(/\.ratio-row \{ flex-wrap: nowrap; \}/);
    expect(css).toMatch(/\.ratio-row \.ratio-name-btn[^{]*\{[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap/);
    expect(css).toMatch(/\.ratio-row \.stepper-control, \.ratio-row \.ratio-control \{ flex: none; \}/); // −/숫자 칸/+ 고정 폭
    expect(css).toMatch(/\.ratio-row \.chip-dot \{ inline-size: 12px; block-size: 12px; \}/);
  });
  it("이번 주 목표 줄(Stepper): 점 12 + 이름 + 컨트롤 한 줄, 이름 말줄임", async () => {
    const api: GoalsApi = { fetchSummary: vi.fn(), save: vi.fn(), clear: vi.fn() };
    render(<GoalEditor api={api} categories={[{ id: C1, name: "아주아주아주긴분야이름이라서한줄에다안들어갑니다" }]} goal={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    const row = document.querySelector(".goal-list .ratio-row")!;
    expect(row.children[0].className).toContain("chip-dot");
    expect(row.querySelector(".stepper-label")).toBeTruthy();
    expect(css).toMatch(/\.ratio-row \.stepper \{ flex: 1 1 0; min-width: 0; flex-wrap: nowrap; \}/);
    expect(css).toMatch(/\.ratio-row \.ratio-name-btn, \.ratio-row \.ratio-name, \.ratio-row \.stepper-label \{[^}]*text-overflow: ellipsis/);
  });
  it("숫자 칸 글은 가운데 16 Medium", () => {
    expect(css).toMatch(/\.num-field \.stepper-input, \.ratio-row \.num-field \.stepper-input \{ text-align: center; font: 500 1rem\/1\.5rem/);
  });
});

describe("시트 넷의 틀: 위 모서리 16 · 손잡이 줄 40×4 #E7E1D6 · 막 #1C2340 45%", () => {
  it("적는 창 · 분야 고르기 · 이번 주 목표 · 오늘 할 일 시트가 같은 값을 쓴다", () => {
    expect(css).toMatch(/\.todo-sheet \{ border-radius: 16px 16px 0 0; \}/);
    expect(css).toMatch(/\.category-sheet \{[^}]*border-radius: 16px 16px 0 0/s);
    expect(css).toMatch(/\.goal-sheet \.detail-inner \{[^}]*border-radius: 16px 16px 0 0/);
    expect(css).toMatch(/\.evening-todo-sheet \{[^}]*border-radius: var\(--radius-sheet, 16px\) var\(--radius-sheet, 16px\) 0 0/s);
    // 손잡이 줄: 적는 창 · 분야 고르기 · 이번 주 목표는 ::before, 오늘 할 일 시트는 요소(.evening-todo-grip). 모두 40×4, #E7E1D6 = --color-divider
    expect(css).toMatch(/\.todo-sheet::before, \.category-sheet::before, \.goal-sheet \.detail-inner::before \{[^}]*inline-size: 40px; block-size: 4px;[^}]*background: var\(--color-divider\)/);
    expect(css).toMatch(/\.evening-todo-grip \{[^}]*inline-size: 40px; block-size: 4px;[^}]*background: var\(--color-divider\)/);
    expect(css).toMatch(/--color-divider: #E7E1D6;/);
    // 막: 먹남색(--color-text #1C2340) 45%
    expect(css).toMatch(/--color-text: #1C2340;/);
    for (const rule of [/\.todo-sheet-scrim \{[^}]*color-mix\(in srgb, var\(--color-text\) 45%, transparent\)/, /\.category-sheet-backdrop \{[^}]*45%/, /\.evening-todo-backdrop \{[^}]*45%/, /\.detail\.goal-sheet \{[^}]*45%/]) {
      expect(css).toMatch(rule);
    }
  });
  it("이번 주 목표는 시트다: 막을 누르면 「✕」와 같다(바꾼 것이 없으면 바로 닫힘)", async () => {
    const onClose = vi.fn();
    const api: GoalsApi = { fetchSummary: vi.fn(), save: vi.fn(), clear: vi.fn() };
    render(<GoalEditor api={api} categories={[{ id: C1, name: "어학" }]} goal={null} onClose={onClose} onSaved={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "이번 주 목표" });
    expect(dialog.className).toContain("goal-sheet");
    expect(within(dialog).getByRole("button", { name: "닫기" })).toBeTruthy(); // 머리 「✕」(시트 변형) 그대로
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" })); // 판 안을 누르면 닫히지 않는다(저장은 막혀 있다)
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog); // 막(판 밖)을 누른다
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("이번 주 목표: 바꾼 뒤 막을 누르면 닫지 않고 확인 창이 먼저 뜬다", async () => {
    const onClose = vi.fn();
    const api: GoalsApi = { fetchSummary: vi.fn(), save: vi.fn(), clear: vi.fn() };
    render(<GoalEditor api={api} categories={[{ id: C1, name: "어학" }]} goal={null} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "어학 1시간 늘리기" }));
    await act(async () => fireEvent.click(screen.getByRole("dialog", { name: "이번 주 목표" })));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" })).toBeTruthy();
  });
});

describe("적는 창 칸 236×52 · 「적기」 76, 분야 고르기 시트 체크 24 · 「+ 분야」 14 Bold", () => {
  it("칸과 단추 값", () => {
    expect(css).toMatch(/\.todo-sheet \.input-row \{ gap: var\(--space-4\); \}/); // 236 + 16 + 76 = 328(폭 360 − 옆 16×2)
    expect(css).toMatch(/\.todo-sheet \.input-row \.input \{ min-height: 52px; \}/);
    expect(css).toMatch(/\.todo-sheet \.add-btn \{ min-width: 76px; min-height: 52px; \}/);
    expect(css).toMatch(/\.category-sheet-add \{ font: 700 0\.875rem\/1\.25rem/);
  });
});
