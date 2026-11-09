// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSE_CONFIRM_TEXT, CloseConfirm, CONFIRM_TEXT, ConfirmDialog } from "../../components/close-confirm";
import { cancelConfirmOnBack, useOverlayWindow } from "../../lib/use-overlay-window";
import { COLOR_TOKENS } from "../../lib/design-tokens";
import { FakeHistory } from "./fake-history";
import { confirmTitle, expectConfirmShape } from "./confirm-helpers";

/**
 * 고침10 B 공통 확인 창(components/close-confirm.tsx ConfirmDialog — Figma 146:11 · 147:2 · 150:58).
 * 부품 하나의 약속: 꼴(위 떠나기·지우기 / 아래 안전한 쪽), 첫 초점 = 제목, Tab 가두기, Esc·막·뒤로 가기 = 아래 단추,
 * 막힘(서버 쓰기 — 「지우는 중」 · 두 단추 막힘 · 연타에 한 번), 닫힌 뒤 초점 복귀, CSS 값.
 * 쓰는 곳 다섯은 각 화면 시험이 본다(todo-manage-ui · goal-ui · todo-screen · todo-local · evening-todo-sheet 등).
 */

const CSS = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");

let history: FakeHistory;
beforeEach(() => {
  history = new FakeHistory({ app: 1 }).install();
});
afterEach(() => {
  cleanup();
  history.flush();
  vi.restoreAllMocks();
});

type Props = Partial<Parameters<typeof ConfirmDialog>[0]>;

/** 「열기」 단추 + 확인 창(마운트 = 열림). 닫히면 「열기」가 남는다 */
function Host({ props, start = false }: { props?: Props; start?: boolean }) {
  const [open, setOpen] = useState(start);
  return (
    <>
      <main>
        <button type="button" onClick={() => setOpen(true)}>
          열기
        </button>
        <button type="button">뒤 단추</button>
      </main>
      {open && (
        <ConfirmDialog
          title="이 작업 기록을 지울까요?"
          confirmLabel="지우기"
          busyLabel="지우는 중"
          cancelLabel="그대로 두기"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          {...props}
        />
      )}
    </>
  );
}

function openFromButton() {
  const opener = screen.getByRole("button", { name: "열기" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("꼴과 초점(146:11)", () => {
  it("alertdialog · 이름 = 제목 · 뜨면 초점은 제목 · 위 「지우기」(보조, 테두리) · 아래 「그대로 두기」(주 단추). 보조 글이 없으면 그리지 않는다", () => {
    render(<Host />);
    openFromButton();
    const dialog = screen.getByRole("alertdialog", { name: "이 작업 기록을 지울까요?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expectConfirmShape(dialog, "지우기", "그대로 두기");
    expect(confirmTitle(dialog).tagName).toBe("H2");
    expect(confirmTitle(dialog).getAttribute("tabindex")).toBe("-1");
    expect(dialog.getAttribute("aria-describedby")).toBeNull();
    expect(dialog.querySelector(".close-confirm-desc")).toBeNull();
  });

  it("보조 글이 있으면 제목 아래 한 줄, aria-describedby로 이어진다", () => {
    render(<Host props={{ title: CONFIRM_TEXT.todoRemove.title, description: CONFIRM_TEXT.todoRemove.description }} />);
    openFromButton();
    const dialog = screen.getByRole("alertdialog", { name: "이 할 일을 지울까요?" });
    const desc = dialog.querySelector(".close-confirm-desc")!;
    expect(desc.textContent).toBe("작업 기록도 함께 지워져요.");
    expect(dialog.getAttribute("aria-describedby")).toBe(desc.id);
    expect(confirmTitle(dialog).compareDocumentPosition(desc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("떠 있는 동안 창 밖은 inert, 닫히면 inert를 거두고 초점은 연 단추로", () => {
    render(<Host />);
    const opener = openFromButton();
    expect(opener.closest("[inert]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "그대로 두기" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("연 단추가 이미 없으면(메뉴 항목 등) 초점을 건드리지 않는다 — 부르는 쪽이 정한 자리", () => {
    function MenuHost() {
      const [menu, setMenu] = useState(true);
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" id="more">
            더 보기
          </button>
          {menu && (
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                setOpen(true);
              }}
            >
              메뉴 지우기
            </button>
          )}
          {open && <ConfirmDialog title="확인" confirmLabel="지우기" cancelLabel="그대로 두기" onConfirm={() => {}} onCancel={() => setOpen(false)} />}
        </>
      );
    }
    render(<MenuHost />);
    const item = screen.getByRole("button", { name: "메뉴 지우기" });
    item.focus();
    fireEvent.click(item);
    fireEvent.click(screen.getByRole("button", { name: "그대로 두기" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(item.isConnected).toBe(false);
  });
});

describe("키보드 · 막 · 뒤로 가기 = 아래 단추(아무것도 버리지 않음)", () => {
  it("Tab·Shift+Tab은 창 안(두 단추)에서만 돈다", () => {
    render(<Host />);
    openFromButton();
    const dialog = screen.getByRole("alertdialog");
    const [top, bottom] = within(dialog).getAllByRole("button");
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(top);
    fireEvent.keyDown(top, { key: "Tab" });
    expect(document.activeElement).toBe(bottom);
    fireEvent.keyDown(bottom, { key: "Tab" });
    expect(document.activeElement, "끝에서 Tab → 처음").toBe(top);
    fireEvent.keyDown(top, { key: "Tab", shiftKey: true });
    expect(document.activeElement, "처음에서 Shift+Tab → 끝").toBe(bottom);
    fireEvent.keyDown(bottom, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(top);
  });

  it("Esc · 막 누름 = onCancel(위 단추 동작은 부르지 않는다). Esc는 아래 창으로 새지 않는다", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const outerKey = vi.fn();
    render(
      <div onKeyDown={outerKey}>
        <ConfirmDialog title="확인" confirmLabel="지우기" cancelLabel="그대로 두기" onConfirm={onConfirm} onCancel={onCancel} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(outerKey).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector("[data-confirm-backdrop]")!);
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("겹친 창(useOverlayWindow) 위의 확인: 안드로이드 뒤로 가기 = 아래 단추(확인만 닫히고 창·칸 그대로)", () => {
    const onWindowClose = vi.fn();
    function Window() {
      const [ask, setAsk] = useState(true);
      const ref = useOverlayWindow<HTMLDivElement>(onWindowClose);
      return (
        <div ref={ref} role="dialog" aria-label="창">
          {ask && <ConfirmDialog title="확인" confirmLabel="나가기" cancelLabel="계속 적기" onConfirm={() => {}} onCancel={() => setAsk(false)} />}
        </div>
      );
    }
    render(<Window />);
    expect(history.index).toBe(1);
    history.userBack();
    expect(screen.queryByRole("alertdialog"), "확인만 닫힌다").toBeNull();
    expect(screen.getByRole("dialog", { name: "창" })).toBeTruthy();
    expect(onWindowClose).not.toHaveBeenCalled();
    history.flush(); // 창의 칸으로 돌아간다(forward)
    expect(history.index).toBe(1);
    expect(history.leftApp).toBe(false);
    // 확인이 없으면 뒤로 가기는 원래대로 창을 닫는다
    history.userBack();
    expect(onWindowClose).toHaveBeenCalledTimes(1);
  });

  it("떠 있는 확인이 없으면 cancelConfirmOnBack은 false(창의 뒤로 가기 길이 원래대로)", () => {
    expect(cancelConfirmOnBack()).toBe(false);
    const onCancel = vi.fn();
    const { unmount } = render(<ConfirmDialog title="확인" confirmLabel="나가기" cancelLabel="계속 적기" onConfirm={() => {}} onCancel={onCancel} />);
    expect(cancelConfirmOnBack()).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
    expect(cancelConfirmOnBack()).toBe(false);
  });

  it("겹친 창 없이 뜨는 확인(ownHistory — 로그아웃): 열리면 칸 하나, 뒤로 가기 = onCancel(위 단추 0번), 아래 단추로 닫으면 칸을 거둔다", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    function Own() {
      const [open, setOpen] = useState(true);
      return open ? (
        <ConfirmDialog
          title={CONFIRM_TEXT.logout.title}
          confirmLabel={CONFIRM_TEXT.logout.confirm}
          cancelLabel={CONFIRM_TEXT.logout.cancel}
          ownHistory
          onConfirm={onConfirm}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        />
      ) : null;
    }
    const first = render(<Own />);
    expect(history.index).toBe(1);
    history.userBack();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(history.index).toBe(0);
    expect(history.back).not.toHaveBeenCalled(); // 뒤로 가기로 이미 칸을 떠났다
    expect(history.leftApp).toBe(false);
    first.unmount();

    render(<Own />);
    expect(history.index).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_TEXT.logout.cancel }));
    history.flush();
    expect(history.index).toBe(0);
    expect(history.leftApp).toBe(false);
  });

  it("ownHistory에서 위 단추 동작(Promise)이 끝났는데 창이 그대로면(실패) 「눌렀다」가 풀려, 그 뒤 아래 단추로 닫으면 칸을 거둔다 · error 한 줄은 role alert", async () => {
    let fail: () => void = () => {};
    function Own() {
      const [open, setOpen] = useState(true);
      const [error, setError] = useState(false);
      return open ? (
        <ConfirmDialog
          title="로그아웃할까요?"
          confirmLabel="로그아웃"
          busyLabel="로그아웃 중"
          cancelLabel="계속 쓰기"
          ownHistory
          error={error ? "로그아웃하지 못했어요. 다시 눌러 주세요." : undefined}
          onConfirm={() => new Promise<boolean>((resolve) => (fail = () => { setError(true); resolve(false); }))}
          onCancel={() => setOpen(false)}
        />
      ) : null;
    }
    render(<Own />);
    expect(history.index).toBe(1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "로그아웃" })));
    expect(screen.getByRole("button", { name: "로그아웃 중" })).toBeTruthy();
    await act(async () => fail());
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("alert").textContent).toBe("로그아웃하지 못했어요. 다시 눌러 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "계속 쓰기" }));
    expect(history.back).toHaveBeenCalledTimes(1);
    history.flush();
    expect(history.index).toBe(0);
    expect(history.leftApp).toBe(false);
  });

  it("ownHistory에서 위 단추 Promise가 성공(undefined · true)으로 끝나면 「눌렀다」가 남아, 창이 사라져도(redirect로 화면이 떠남) history.back은 0번", async () => {
    for (const value of [undefined, true]) {
      let finish: () => void = () => {};
      const { unmount } = render(
        <ConfirmDialog
          title="로그아웃할까요?"
          confirmLabel="로그아웃"
          cancelLabel="계속 쓰기"
          ownHistory
          onConfirm={() => new Promise<unknown>((resolve) => (finish = () => resolve(value)))}
          onCancel={() => {}}
        />,
      );
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "로그아웃" })));
      await act(async () => finish());
      unmount(); // 떠나는 이동으로 화면이 사라진다
      expect(history.back, `성공 값 ${String(value)}`).not.toHaveBeenCalled();
    }
  });

  it("ownHistory에서 위 단추 Promise가 거부되면 실패 — 그 뒤 아래 단추로 닫으면 칸을 거둔다", async () => {
    let fail: () => void = () => {};
    function Own() {
      const [open, setOpen] = useState(true);
      return open ? (
        <ConfirmDialog
          title="확인"
          confirmLabel="로그아웃"
          cancelLabel="계속 쓰기"
          ownHistory
          onConfirm={() => new Promise<void>((_, reject) => (fail = () => reject(new Error("x"))))}
          onCancel={() => setOpen(false)}
        />
      ) : null;
    }
    render(<Own />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "로그아웃" })));
    await act(async () => fail());
    fireEvent.click(screen.getByRole("button", { name: "계속 쓰기" }));
    expect(history.back).toHaveBeenCalledTimes(1);
  });

  it("ownHistory에서 위 단추(페이지를 떠나는 동작)를 누르면 닫혀도 칸을 거두지 않는다(떠나는 이동과 back()이 겹치지 않게)", () => {
    function Own() {
      const [open, setOpen] = useState(true);
      return open ? <ConfirmDialog title="로그아웃할까요?" confirmLabel="로그아웃" cancelLabel="계속 쓰기" ownHistory onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} /> : null;
    }
    render(<Own />);
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(history.back).not.toHaveBeenCalled();
  });
});

describe("막힘(서버 쓰기 — O-7, 150:58)", () => {
  it("위 단추가 Promise를 돌려주면: 누른 단추 글 「지우는 중」 · 두 단추 막힘(disabled · aria-busy) · 창 aria-busy · 연타·Enter에도 한 번 · 막힌 동안 Esc·막은 아무것도 안 함 · 끝나면 풀림", async () => {
    let finish: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onCancel = vi.fn();
    render(<ConfirmDialog title="확인" confirmLabel="지우기" busyLabel="지우는 중" cancelLabel="그대로 두기" onConfirm={onConfirm} onCancel={onCancel} />);
    const dialog = screen.getByRole("alertdialog");
    const [top, bottom] = within(dialog).getAllByRole("button") as HTMLButtonElement[];
    await act(async () => {
      fireEvent.click(top);
      fireEvent.click(top);
      fireEvent.keyDown(top, { key: "Enter" });
      fireEvent.click(top);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(top.textContent).toBe("지우는 중");
    expect(bottom.textContent).toBe("그대로 두기");
    expect(top.disabled).toBe(true);
    expect(bottom.disabled).toBe(true);
    expect(top.getAttribute("aria-busy")).toBe("true");
    expect(bottom.getAttribute("aria-busy")).toBe("true");
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(confirmTitle(dialog));
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(document.querySelector("[data-confirm-backdrop]")!);
    expect(onCancel).not.toHaveBeenCalled();
    // Tab은 막힌 동안에도 창 밖으로 새지 않는다(누를 단추가 없으면 제목에 머문다)
    fireEvent.keyDown(confirmTitle(dialog), { key: "Tab" });
    expect(document.activeElement).toBe(confirmTitle(dialog));
    await act(async () => finish());
    expect(top.disabled).toBe(false);
    expect(top.textContent).toBe("지우기");
    expect(dialog.getAttribute("aria-busy")).toBeNull();
  });

  it("busy를 넘기면(로그아웃 — 페이지를 떠날 때까지) Promise와 상관없이 막히고 글은 「로그아웃 중」", () => {
    const t = CONFIRM_TEXT.logout;
    render(<ConfirmDialog title={t.title} description={t.description} confirmLabel={t.confirm} busyLabel={t.busy} cancelLabel={t.cancel} busy onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const [top, bottom] = within(screen.getByRole("alertdialog")).getAllByRole("button") as HTMLButtonElement[];
    expect(top.textContent).toBe("로그아웃 중");
    expect(top.disabled && bottom.disabled).toBe(true);
  });

  it("정상: 한 번 누르면 위 단추 동작 1번", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="확인" confirmLabel="지우기" cancelLabel="그대로 두기" onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("147:2 글(한 곳)과 CloseConfirm", () => {
  it("쓰는 곳 다섯의 글", () => {
    expect(CLOSE_CONFIRM_TEXT).toEqual({ title: "저장하지 않고 나갈까요?", keep: "계속 적기", close: "나가기" });
    expect(CONFIRM_TEXT.noteRemove).toMatchObject({ title: "이 작업 기록을 지울까요?", confirm: "지우기", busy: "지우는 중", cancel: "그대로 두기" });
    expect(CONFIRM_TEXT.todoRemove).toMatchObject({ title: "이 할 일을 지울까요?", description: "작업 기록도 함께 지워져요.", confirm: "지우기", cancel: "그대로 두기" });
    expect(CONFIRM_TEXT.goalClear).toMatchObject({ title: "이번 주 목표를 없앨까요?", confirm: "없애기", cancel: "그대로 두기" });
    expect(CONFIRM_TEXT.logout).toMatchObject({
      title: "로그아웃할까요?",
      description: "아직 저장되지 않은 기록은 이 기기에서 지워져요.",
      confirm: "로그아웃",
      busy: "로그아웃 중",
      cancel: "계속 쓰기",
    });
  });

  it("CloseConfirm: 위 「나가기」 = onClose, 아래 「계속 적기」 = onKeep, Esc = onKeep", () => {
    const onKeep = vi.fn();
    const onClose = vi.fn();
    render(<CloseConfirm onKeep={onKeep} onClose={onClose} />);
    const dialog = screen.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
    expectConfirmShape(dialog, "나가기", "계속 적기");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onKeep).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "계속 적기" }));
    expect(onKeep).toHaveBeenCalledTimes(2);
    fireEvent.click(within(dialog).getByRole("button", { name: "나가기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CSS 값(146:11 · 150:58)", () => {
  it("창 312 · 흰 바탕 · 모서리 16 · 안 여백 위 28 / 옆 24 / 아래 24 · 막 먹남색 45%", () => {
    const box = CSS.match(/\.close-confirm \{([^}]*)\}/)?.[1] ?? "";
    expect(box).toMatch(/max-width: 312px/);
    expect(box).toMatch(/background: var\(--color-surface\)/);
    expect(box).toMatch(/border-radius: var\(--radius-card, 16px\)/);
    expect(box).toMatch(/padding: 28px var\(--space-6\) var\(--space-6\)/);
    expect(CSS.match(/\.close-confirm \{/g), "창 꼴 규칙은 한 곳").toHaveLength(1);
    expect(CSS).toMatch(/\.close-confirm-backdrop \{ position: absolute; inset: 0; background: color-mix\(in srgb, var\(--color-text\) 45%, transparent\); \}/);
    expect(COLOR_TOKENS["--color-surface"]).toBe("#FFFFFF");
  });

  it("제목 18 Bold · 보조 글 14 Regular 보조색 · 단추 둘 세로(폭 가득 · 높이 48 · 사이 12 · 글 16 Bold) · 위 테두리 1.5 글색 바탕 없음 · 아래 글색 채움 흰 글 · 눌림 #2E3350 / #E7E1D6", () => {
    expect(CSS).toMatch(/\.close-confirm-title \{ margin: 0; font: 700 1\.125rem\/1\.375rem var\(--font-family\);/);
    expect(CSS).toMatch(/\.close-confirm-desc \{[^}]*font: var\(--font-sub\); color: var\(--color-text-sub\);/);
    expect(CSS).toMatch(/\.close-confirm-actions \{ display: grid; gap: var\(--space-3\);/);
    expect(CSS).toMatch(/\.close-confirm-actions > \.btn \{ width: 100%; min-height: var\(--tap-min\); font: var\(--font-body\); font-weight: 700; \}/);
    expect(CSS).toMatch(/\.close-confirm-actions > \.btn-secondary \{ box-shadow: inset 0 0 0 1\.5px var\(--color-text\); color: var\(--color-text\); background: transparent; \}/);
    expect(CSS).toMatch(/\.close-confirm-actions > \.btn-primary \{ background: var\(--color-text\); border-color: var\(--color-text\); color: var\(--color-on-primary\); \}/);
    expect(CSS).toMatch(/\.close-confirm-actions > \.btn-primary:active \{ background: var\(--color-primary-pressed\);/);
    expect(CSS).toMatch(/\.close-confirm-actions > \.btn-secondary:active \{ background: var\(--color-secondary-pressed\); \}/);
    expect(COLOR_TOKENS["--color-primary-pressed"]).toBe("#2E3350");
    expect(COLOR_TOKENS["--color-secondary-pressed"]).toBe("#E7E1D6");
    // 초점: 단추 둘레 2px 먹남색 링, 2px 틈(앱 공통 :focus-visible)
    expect(CSS).toMatch(/:focus-visible \{ outline: var\(--focus-ring\); outline-offset: var\(--focus-offset\); \}/);
    expect(CSS).toMatch(/--focus-ring: 2px solid var\(--color-primary\);/);
    expect(CSS).toMatch(/--focus-offset: 2px;/);
  });
});
