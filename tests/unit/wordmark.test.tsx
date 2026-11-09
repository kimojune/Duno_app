// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginLayout } from "../../components/login-button";
import { TodoView, type TodoViewProps } from "../../components/todo-view";
import { Wordmark, WORDMARK_LABEL, WORDMARK_PIECE_OFFSET, WORDMARK_TEXT } from "../../components/wordmark";
import { LOGIN_TEXT } from "../../lib/login-text";

vi.mock("../../lib/supabase/client", () => ({ createClient: () => null }));

afterEach(() => cleanup());

const noop = () => {};
const base: TodoViewProps = {
  day: { date: "2026-11-05", year: 2026, month: 11, dayOfMonth: 5, weekday: 4 },
  list: "ready",
  rows: [],
  online: true,
  offlineHelp: false,
  sessionLost: false,
  hasUnsaved: false,
  logoutConfirm: false,
  live: "",
  sheetOpen: false,
  draft: "",
  resume: false,
  categories: "ready",
  chips: [],
  selectedCategoryId: null,
  categoryNotice: "",
  newCategoryOpen: false,
  newCategoryDraft: "",
  addingCategory: false,
  newCategoryHelp: null,
  onOpenSheet: noop,
  onCloseSheet: noop,
  onDraftChange: noop,
  onSubmit: noop,
  onToggleChip: noop,
  onOpenNewCategory: noop,
  onNewCategoryDraftChange: noop,
  onAddCategory: noop,
  onCancelNewCategory: noop,
  onToggle: noop,
  onRetry: noop,
  onRemove: noop,
  onReload: noop,
  onLogout: noop,
  onLogoutConfirm: noop,
  onLogoutCancel: noop,
  onCopy: noop,
  onRelogin: noop,
};

describe("워드마크(명세 ② L1 · 고침9 — Figma 50:139·50:140·60:2)", () => {
  it("먹남색 고리 18(조각 하나가 2px 바깥) + 글자 「duno」, 화면 읽기 이름은 「두노」 하나", () => {
    const { container } = render(<Wordmark />);
    const mark = container.querySelector<HTMLElement>(".wordmark")!;
    expect(WORDMARK_TEXT).toBe("duno");
    expect(WORDMARK_LABEL).toBe("두노");
    expect(mark.getAttribute("role")).toBe("img");
    expect(screen.getByRole("img", { name: "두노" })).toBe(mark);
    // 그림과 보이는 글은 숨긴다(「duno」를 영어 글자로 따로 읽지 않게)
    const svg = mark.querySelector("svg.wordmark-ring")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect([svg.getAttribute("width"), svg.getAttribute("height")]).toEqual(["18", "18"]);
    expect(svg.getAttribute("fill")).toBe("currentColor");
    const text = mark.querySelector(".wordmark-text")!;
    expect(text.textContent).toBe("duno");
    expect(text.getAttribute("aria-hidden")).toBe("true");
    // 고리 하나 + 조각 하나. 조각은 고리 안 빠진 자리에서 오른쪽 위 45°로 2px 옮겨 있다(x +1.414, y −1.414)
    const paths = svg.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    expect(WORDMARK_PIECE_OFFSET).toBe(2);
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(paths[1].getAttribute("transform") ?? "");
    expect(m).not.toBeNull();
    const [dx, dy] = [Number(m![1]) - 10.294, Number(m![2]) - 0.306];
    expect(Math.hypot(dx, dy)).toBeCloseTo(2, 2);
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeLessThan(0);
    // 살구·빛 번짐 없음(색은 놓인 자리의 글자색)
    expect(container.innerHTML).not.toMatch(/accent|#FF8A57|filter|drop-shadow/i);
  });

  it("CSS: 고리 18 · 「duno」 16 Bold · 글자색, 고리 조각은 칸 밖에 그려진다(overflow visible). 로그인 h1 안에서는 작은 고리를 숨기고 글자만 h1 글꼴", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(/\.wordmark \{[^}]*display: inline-flex;[^}]*color: var\(--color-text\);/);
    expect(css).toMatch(/\.wordmark-ring \{[^}]*inline-size: 18px; block-size: 18px; overflow: visible;/);
    expect(css).toMatch(/\.wordmark-text \{ font: 700 16px\/24px var\(--font-family\); \}/);
    expect(css).toMatch(/\.login-name \.wordmark-ring \{ display: none; \}/);
    expect(css).toMatch(/\.login-name \.wordmark-text \{ font: inherit; \}/);
  });

  it("고침10 D(54:14·54:15): 로그인 머리에 큰 L1 고리 — 지름 120 · 두께 24 · 살구 조각 8px 바깥 + 빛 번짐, 장식(화면 읽기에서 숨김), 가운데 정렬", () => {
    const { container } = render(<LoginLayout>{null}</LoginLayout>);
    const svg = container.querySelector("svg.login-ring")!;
    expect(svg.getAttribute("width")).toBe("120");
    expect(svg.getAttribute("height")).toBe("120");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector(".login-ring-body")?.getAttribute("stroke-width")).toBe("24");
    expect(svg.querySelector(".login-ring-piece")).not.toBeNull();
    expect(svg.querySelector(".login-ring-glow")?.getAttribute("filter")).toContain("url(#login-ring-glow)");
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(svg.querySelector("g")?.getAttribute("transform") ?? "");
    expect(Math.hypot(Number(m![1]), Number(m![2]))).toBeCloseTo(8, 2); // 8px 바깥(오른쪽 위 45°)
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![2])).toBeLessThan(0);
    // 큰 고리는 제목 밖(h1은 하나, 「두노」)
    expect(container.querySelector("h1 svg.login-ring")).toBeNull();
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(/\.login-ring \{[^}]*inline-size: 120px; block-size: 120px;[^}]*margin-bottom: 48px;/);
    expect(css).toMatch(/\.login-ring-piece \{ stroke: var\(--color-accent\); \}/);
    expect(css).toMatch(/\.login-head \{[^}]*align-items: center; text-align: center;/);
    expect(css).toMatch(/\.login-name \{ font: 700 32px\/38px var\(--font-family\); \}/);
    expect(css).toMatch(/\.login-sentence \{[^}]*inline-size: 320px;[^}]*font: var\(--font-sub\); color: var\(--color-text-sub\);/);
  });

  it("로그인 화면: 제목은 h1 하나이고 이름이 「두노」다", () => {
    render(<LoginLayout>{null}</LoginLayout>);
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0].tagName).toBe("H1");
    expect(screen.getByRole("heading", { level: 1, name: "두노" })).toBe(headings[0]);
    expect(headings[0].textContent).toBe("duno");
    expect(screen.getByText(LOGIN_TEXT.sentence)).toBeTruthy();
  });

  it("할 일 탭 머리: 워드마크는 제목이 아니고, 제목은 「오늘」 하나뿐이라 이름이 겹치지 않는다", () => {
    const { container } = render(<TodoView {...base} />);
    const mark = container.querySelector(".today-wordmark")!;
    expect(mark.textContent).toBe("duno");
    expect(mark.getAttribute("aria-label")).toBe("두노");
    expect(mark.closest("h1,h2,h3,h4,h5,h6")).toBeNull();
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => h.textContent)).toEqual(["오늘"]);
    // 머리 안에서 워드마크가 제목 앞(위)에 있다
    const h1 = screen.getByRole("heading", { name: "오늘" });
    expect(mark.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
