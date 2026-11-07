// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeHistory } from "./fake-history";

vi.mock("../../app/todos/actions", () => ({ addTodo: vi.fn(), setTodoDone: vi.fn(), addCategory: vi.fn() }));
vi.mock("../../app/actions", () => ({ signOut: vi.fn() }));

import { CategoryPage } from "../../components/category-page";
import { EveningRecord } from "../../components/evening-record";
import { GoalEditor } from "../../components/goal";
import { TodoDetail } from "../../components/todo-detail";
import { OVERLAY_HISTORY_MARK } from "../../lib/use-overlay-window";

/**
 * 전체 화면 창 넷(저녁 기록·이번 주 목표·분야 페이지·할 일 자세히)의 공용 장치(B6·B7):
 * 뒤로 가기가 앱이 아니라 창을 닫고, 열린 동안 바깥은 inert, 닫으면 연 단추로 포커스가 돌아온다.
 */

const NEXT_STATE = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "x" } };
const never = () => new Promise<never>(() => {});

const goalApi = { fetchSummary: never, save: vi.fn(), clear: vi.fn() };
const growthApi = { fetchCategoryPage: never, recordView: vi.fn(async () => ({ ok: true })) };
const eveningApi = { fetchState: never, save: vi.fn() };
const manageApi = { fetchNotes: never, addNote: vi.fn(), deleteNote: vi.fn(), editTodo: vi.fn(), deleteTodo: vi.fn() };

type Renderer = (onClose: () => void) => ReactNode;
const WINDOWS: [string, Renderer][] = [
  ["이번 주 목표", (onClose) => <GoalEditor api={goalApi as never} categories={[]} goal={null} onClose={onClose} onSaved={() => {}} />],
  ["분야 페이지", (onClose) => <CategoryPage api={growthApi as never} categoryId={null} name="어학" onClose={onClose} />],
  ["저녁 기록", (onClose) => <EveningRecord api={eveningApi as never} onClose={onClose} />],
  [
    "할 일 자세히",
    (onClose) => (
      <TodoDetail
        todo={{ id: "t1", text: "글", categoryId: null, canMoveUp: false, canMoveDown: false }}
        chips={[]}
        api={manageApi as never}
        online
        onClose={onClose}
        onEdited={() => {}}
        onDeleted={() => {}}
        onMove={async () => true}
      />
    ),
  ],
];

function Harness({ renderWindow, onClosed }: { renderWindow: Renderer; onClosed?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div id="app">
      <main id="body">
        <button type="button" onClick={() => setOpen(true)}>
          창 열기
        </button>
      </main>
      <nav id="tabs">
        <button type="button">탭</button>
      </nav>
      {open &&
        renderWindow(() => {
          onClosed?.();
          setOpen(false);
        })}
    </div>
  );
}

let history: FakeHistory;
beforeEach(() => {
  history = new FakeHistory(NEXT_STATE).install();
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup(); // 열려 있던 창이 닫히며 칸을 거둔다
  history.flush(); // 거둔 칸의 popstate를 모두 돌려 다음 시험에 남기지 않는다
  vi.restoreAllMocks();
});

describe.each(WINDOWS)("%s 창", (_name, renderWindow) => {
  const openWindow = () => fireEvent.click(screen.getByRole("button", { name: "창 열기" }));

  it("열릴 때 history 한 칸을 쌓고 Next의 내부 state를 보존한다", () => {
    render(<Harness renderWindow={renderWindow} />);
    expect(history.entries).toHaveLength(1);
    openWindow();
    expect(history.entries).toHaveLength(2);
    expect(history.state).toMatchObject({ ...NEXT_STATE, [OVERLAY_HISTORY_MARK]: expect.any(String) });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("뒤로 가기는 창만 닫고 앱을 나가지 않는다", () => {
    const onClosed = vi.fn();
    render(<Harness renderWindow={renderWindow} onClosed={onClosed} />);
    openWindow();
    history.userBack();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(history.leftApp).toBe(false);
    expect(history.index).toBe(0);
    // 칸을 이미 떠났으니 history.back()을 더 부르지 않는다
    expect(history.back).not.toHaveBeenCalled();
  });

  it("닫기·Esc로 닫으면 쌓은 칸을 거두고(back 한 번), 늦게 온 popstate를 뒤로 가기로 읽지 않는다", () => {
    const onClosed = vi.fn();
    render(<Harness renderWindow={renderWindow} onClosed={onClosed} />);
    openWindow();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(history.back).toHaveBeenCalledTimes(1);
    history.flush();
    expect(history.index).toBe(0);
    expect(history.leftApp).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1); // popstate로 또 닫히지 않는다(Esc 한 번)
    // 다시 열고 뒤로 가기: 처음처럼 창이 닫힌다(앞선 popstate가 셈에 남지 않았다)
    openWindow();
    history.userBack();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(2);
    expect(history.leftApp).toBe(false);
  });

  it("열린 동안 창 밖(본문·탭 줄)은 inert이고 창은 아니며, 닫으면 거둔다", () => {
    render(<Harness renderWindow={renderWindow} />);
    openWindow();
    expect(document.getElementById("body")!.hasAttribute("inert")).toBe(true);
    expect(document.getElementById("tabs")!.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("dialog").closest("[inert]")).toBeNull();
    history.userBack();
    expect(document.getElementById("body")!.hasAttribute("inert")).toBe(false);
    expect(document.getElementById("tabs")!.hasAttribute("inert")).toBe(false);
  });

  it("닫으면 연 단추로 포커스가 돌아온다", () => {
    render(<Harness renderWindow={renderWindow} />);
    const opener = screen.getByRole("button", { name: "창 열기" });
    opener.focus();
    openWindow();
    expect(document.activeElement).not.toBe(opener); // 포커스는 창 안(제목)으로 갔다
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });
});

describe.each(WINDOWS)("%s 창 — 개발 모드(StrictMode)", (_name, renderWindow) => {
  // StrictMode는 효과를 지웠다 다시 켠다. 첫 켜짐에서 포커스가 창 제목으로 옮겨진 뒤 다시 켜지므로, 연 단추를 그때의 포커스로
  // 잡으면 제목(곧 사라질 요소)을 연 단추로 잘못 기억한다(/dev/v2 화면 사진 시험에서 드러남).
  it("닫으면 연 단추로 포커스가 돌아온다", () => {
    render(
      <StrictMode>
        <Harness renderWindow={renderWindow} />
      </StrictMode>,
    );
    const opener = screen.getByRole("button", { name: "창 열기" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).not.toBe(opener);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });
});

describe("앞으로 가기", () => {
  it("앞으로 가기로 창의 칸에 돌아와도 창은 그대로 열려 있다(표시가 이 창의 것이라서)", () => {
    render(<Harness renderWindow={WINDOWS[0][1]} />);
    fireEvent.click(screen.getByRole("button", { name: "창 열기" }));
    act(() => history.userBack());
    // 사용자가 뒤로 가서 창이 닫혔다. 앞으로 가기는 닫힌 창을 다시 열지 않는다
    expect(screen.queryByRole("dialog")).toBeNull();
    history.userForward();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
