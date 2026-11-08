// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginLayout } from "../../components/login-button";
import { TodoView, type TodoViewProps } from "../../components/todo-view";
import { Wordmark, WORDMARK_TEXT } from "../../components/wordmark";
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

describe("워드마크 「DUNO」 자리표시(G)", () => {
  it("글자 「DUNO」를 React 텍스트로 그린다(요소를 만들지 않는다)", () => {
    const { container } = render(<Wordmark />);
    expect(container.textContent).toBe(WORDMARK_TEXT);
    expect(WORDMARK_TEXT).toBe("DUNO");
    expect(container.querySelectorAll("*")).toHaveLength(1); // span 하나뿐
    expect(container.querySelector(".wordmark")).not.toBeNull();
  });

  it("로그인 화면: 제목은 h1 하나이고 이름이 「DUNO」다", () => {
    render(<LoginLayout>{null}</LoginLayout>);
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0].tagName).toBe("H1");
    expect(headings[0].textContent).toBe("DUNO");
    expect(screen.getByText(LOGIN_TEXT.sentence)).toBeTruthy();
  });

  it("할 일 탭 머리: 워드마크는 제목이 아니고, 제목은 「오늘」 하나뿐이라 이름이 겹치지 않는다", () => {
    const { container } = render(<TodoView {...base} />);
    const mark = container.querySelector(".today-wordmark")!;
    expect(mark.textContent).toBe("DUNO");
    expect(mark.closest("h1,h2,h3,h4,h5,h6")).toBeNull();
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => h.textContent)).toEqual(["오늘"]);
    // 머리 안에서 워드마크가 제목 앞(위)에 있다
    const h1 = screen.getByRole("heading", { name: "오늘" });
    expect(mark.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
