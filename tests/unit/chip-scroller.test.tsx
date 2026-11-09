// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChipScroller, CHIP_SCROLLER_TEXT, scrollEdges } from "../../components/chip-scroller";
import { Onboarding } from "../../components/onboarding";
import { TimerScreen } from "../../components/timer-screen";
import { TodoDetail } from "../../components/todo-detail";
import type { FocusApi } from "../../lib/focus-api";
import type { SettingsApi } from "../../lib/onboarding-api";
import type { TodayRead } from "../../lib/today-types";

/**
 * 고침 5바퀴: 분야 칩 줄 한 줄 + 옆으로 넘김(명세 ⑦-1·④-2, WCAG 2.5.7). jsdom은 배치를 하지 않아서
 * 칩 줄의 폭·내용 폭·스크롤 자리를 요소에 직접 심어 넘침을 만든다. 실제 화면 배치(한 줄 높이·가로 넘침 없음·포커스한 칩이 보이는 칸 안)는
 * tests/screens/screens.spec.ts·v2.spec.ts가 360px·글자 200% 흉내에서 잰다.
 */

const NAMES = ["취업 준비", "운동", "CS 공부", "영어", "독서", "포트폴리오", "사이드 프로젝트", "자격증"];

function Row({ names = NAMES }: { names?: string[] }) {
  return (
    <ChipScroller aria-label="분야">
      {names.map((n) => (
        <button key={n} type="button" className="chip">
          <span className="chip-face">
            <span className="chip-label">{n}</span>
          </span>
        </button>
      ))}
    </ChipScroller>
  );
}

/** 칩 줄 요소에 폭·내용 폭·스크롤 자리를 심는다. scrollTo는 받은 자리로 바로 옮기고 scroll 이벤트를 낸다(브라우저와 같게) */
function fakeGeometry(el: HTMLElement, { clientWidth, scrollWidth, scrollLeft = 0 }: { clientWidth: number; scrollWidth: number; scrollLeft?: number }) {
  let left = scrollLeft;
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => clientWidth });
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get: () => left,
    set: (v: number) => {
      left = Math.min(Math.max(0, v), scrollWidth - clientWidth);
    },
  });
  const scrollTo = vi.fn((opts: ScrollToOptions) => {
    el.scrollLeft = opts.left ?? left;
    fireEvent.scroll(el);
  });
  Object.defineProperty(el, "scrollTo", { configurable: true, value: scrollTo });
  return scrollTo;
}

let reduced = false;
beforeEach(() => {
  reduced = false;
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" ? reduced : false, media: q, addEventListener() {}, removeEventListener() {} })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const group = () => screen.getByRole("group", { name: "분야" });
const nextBtn = () => screen.queryByRole("button", { name: CHIP_SCROLLER_TEXT.next });
const prevBtn = () => screen.queryByRole("button", { name: CHIP_SCROLLER_TEXT.prev });

describe("scrollEdges: 넘길 것이 남은 쪽", () => {
  it("넘치지 않으면 양쪽 다 없음, 처음이면 오른쪽만, 가운데면 양쪽, 끝이면 왼쪽만", () => {
    expect(scrollEdges({ clientWidth: 300, scrollWidth: 300, scrollLeft: 0 })).toEqual({ start: false, end: false });
    expect(scrollEdges({ clientWidth: 300, scrollWidth: 900, scrollLeft: 0 })).toEqual({ start: false, end: true });
    expect(scrollEdges({ clientWidth: 300, scrollWidth: 900, scrollLeft: 300 })).toEqual({ start: true, end: true });
    expect(scrollEdges({ clientWidth: 300, scrollWidth: 900, scrollLeft: 600 })).toEqual({ start: true, end: false });
    // 소수 픽셀(반올림) 1px 안은 끝으로 본다: 단추가 남지 않는다
    expect(scrollEdges({ clientWidth: 300, scrollWidth: 901, scrollLeft: 600 })).toEqual({ start: true, end: false });
  });
});

describe("ChipScroller: 한 줄 칩 줄과 「‹」「›」", () => {
  it("구조: 칩 줄(role=group, .chip-row) 바로 아래 자식은 칩뿐이고, 줄은 .chip-scroller 안에 있다", () => {
    render(<Row />);
    const row = group();
    expect(row.classList.contains("chip-row")).toBe(true);
    expect(row.parentElement!.classList.contains("chip-scroller")).toBe(true);
    const kids = [...row.children];
    expect(kids).toHaveLength(NAMES.length);
    expect(kids.map((k) => k.textContent)).toEqual(NAMES);
    expect(kids.every((k) => k.tagName === "BUTTON" && k.classList.contains("chip"))).toBe(true);
  });

  it("넘치지 않으면 단추가 없고 옅어지는 띠 표시도 없다", () => {
    render(<Row names={["운동"]} />);
    fakeGeometry(group(), { clientWidth: 300, scrollWidth: 300 });
    fireEvent.scroll(group());
    expect(nextBtn()).toBeNull();
    expect(prevBtn()).toBeNull();
    const scroller = group().parentElement!;
    expect(scroller.hasAttribute("data-more-end")).toBe(false);
    expect(scroller.hasAttribute("data-more-start")).toBe(false);
    // 단추가 하나도 없다: 칩 하나뿐
    expect(within(scroller).getAllByRole("button")).toHaveLength(1);
  });

  it("넘치면 처음에는 「›」만 있다. 칩 줄 밖(칩을 가리지 않는 제 칸)이고, Tab 순서 밖이고, 이름이 있고, 칩 줄을 가리킨다", () => {
    render(<Row />);
    fakeGeometry(group(), { clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(group());
    const next = nextBtn()!;
    expect(next).not.toBeNull();
    expect(prevBtn()).toBeNull();
    expect(group().contains(next), "칩 줄 안에 있지 않다").toBe(false);
    expect(next.parentElement).toBe(group().parentElement);
    expect(next.nextElementSibling, "「›」는 칩 줄 뒤(오른쪽)").toBeNull();
    expect(next.previousElementSibling).toBe(group());
    expect(next.getAttribute("tabindex")).toBe("-1");
    expect(next.getAttribute("aria-label")).toBe("분야 더 보기");
    expect(next.getAttribute("aria-controls")).toBe(group().id);
    expect(group().id).not.toBe("");
    // 보이는 면 32는 CSS(.chip-nav-face), 누름 48은 CSS(.chip-nav). 그림은 화면 읽기에서 숨김
    expect(next.classList.contains("chip-nav")).toBe(true);
    expect(next.querySelector(".chip-nav-face")!.getAttribute("aria-hidden")).toBe("true");
    expect(group().parentElement!.hasAttribute("data-more-end")).toBe(true);
    expect(group().parentElement!.hasAttribute("data-more-start")).toBe(false);
  });

  it("「›」를 누르면 scrollLeft가 칩 줄 한 화면 폭(clientWidth)만큼 늘고, 「‹」가 칩 줄 앞(왼쪽)에 생긴다. 「‹」를 누르면 한 화면 폭 돌아간다", () => {
    reduced = true;
    render(<Row />);
    const row = group();
    const scrollTo = fakeGeometry(row, { clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(row);
    expect(row.scrollLeft).toBe(0);
    act(() => fireEvent.click(nextBtn()!));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 300, behavior: "auto" });
    expect(row.scrollLeft, "한 화면 폭만큼 넘어갔다").toBe(300);
    const prev = prevBtn()!;
    expect(prev).not.toBeNull();
    expect(prev.getAttribute("aria-label")).toBe("앞 분야 보기");
    expect(prev.nextElementSibling, "「‹」는 칩 줄 앞(왼쪽)").toBe(row);
    expect(prev.getAttribute("tabindex")).toBe("-1");
    expect(nextBtn(), "아직 넘길 것이 남아 「›」도 있다").not.toBeNull();
    expect(row.parentElement!.hasAttribute("data-more-start")).toBe(true);
    expect(row.parentElement!.hasAttribute("data-more-end")).toBe(true);

    act(() => fireEvent.click(prevBtn()!));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "auto" });
    expect(row.scrollLeft).toBe(0);
    expect(prevBtn(), "처음으로 돌아오면 「‹」를 숨긴다").toBeNull();
    expect(nextBtn()).not.toBeNull();
  });

  it("끝 가까이에서 「›」는 끝까지만 넘기고(넘지 않음), 끝에 닿으면 「›」를 숨긴다", () => {
    reduced = true;
    render(<Row />);
    const row = group();
    const scrollTo = fakeGeometry(row, { clientWidth: 300, scrollWidth: 1000, scrollLeft: 500 });
    fireEvent.scroll(row);
    act(() => fireEvent.click(nextBtn()!));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 700, behavior: "auto" }); // 1000 - 300
    expect(row.scrollLeft).toBe(700);
    expect(nextBtn()).toBeNull();
    expect(prevBtn()).not.toBeNull();
    expect(row.parentElement!.hasAttribute("data-more-end")).toBe(false);
  });

  it("움직임 줄이기가 아니면 부드럽게(smooth), 움직임 줄이기면 바로(auto) 옮긴다", () => {
    render(<Row />);
    const row = group();
    const scrollTo = fakeGeometry(row, { clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(row);
    act(() => fireEvent.click(nextBtn()!));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 300, behavior: "smooth" });
    reduced = true;
    act(() => fireEvent.click(nextBtn()!));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 600, behavior: "auto" });
  });

  it("손가락·트랙패드로 끌어 넘겨도(scroll 이벤트) 단추가 따라 바뀐다", () => {
    render(<Row />);
    const row = group();
    fakeGeometry(row, { clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(row);
    expect(prevBtn()).toBeNull();
    row.scrollLeft = 120;
    fireEvent.scroll(row);
    expect(prevBtn()).not.toBeNull();
    expect(nextBtn()).not.toBeNull();
    row.scrollLeft = 700;
    fireEvent.scroll(row);
    expect(nextBtn()).toBeNull();
  });

  it("단추를 손가락·마우스로 눌러도 포커스를 가져가지 않는다(mousedown 기본 동작 막음)", () => {
    render(<Row />);
    fakeGeometry(group(), { clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(group());
    const notPrevented = fireEvent.mouseDown(nextBtn()!);
    expect(notPrevented).toBe(false);
  });

  it("키보드로 칩에 옮기면(Tab) 그 칩이 보이게 줄이 옆으로 넘어간다: 포커스한 그 칩에 scrollIntoView(inline·block nearest)", () => {
    render(<Row />);
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    const last = within(group()).getByRole("button", { name: "자격증" });
    act(() => last.focus());
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
    expect(scroll.mock.contexts[0], "부른 대상이 포커스한 칩이다").toBe(last);
    expect(document.activeElement).toBe(last);
  });

  it("포커스한 칩을 보이게 넘긴 뒤 「‹」가 생겨 줄이 좁아지면, 그 칩을 한 번 더 보이게 넘긴다(단추로 넘길 때·손으로 넘길 때는 하지 않는다)", () => {
    render(<Row />);
    const row = group();
    fakeGeometry(row, { clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(row);
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    const chip = within(row).getByRole("button", { name: "독서" });
    scroll.mockClear();
    act(() => chip.focus());
    expect(scroll).toHaveBeenCalledTimes(1);
    // 포커스로 줄이 넘어가 「‹」가 생긴다(브라우저에서는 scroll 이벤트)
    row.scrollLeft = 200;
    act(() => {
      fireEvent.scroll(row);
    });
    expect(prevBtn()).not.toBeNull();
    expect(scroll, "단추가 바뀐 뒤 포커스한 칩을 한 번 더 보이게").toHaveBeenCalledTimes(2);
    expect(scroll.mock.contexts[1]).toBe(chip);
    // 한 번뿐: 더 넘겨 단추가 또 바뀌어도(끝에 닿음) 다시 부르지 않는다
    row.scrollLeft = 700;
    act(() => {
      fireEvent.scroll(row);
    });
    expect(nextBtn()).toBeNull();
    expect(scroll).toHaveBeenCalledTimes(2);

    // 포커스 뒤 손으로(포인터) 넘기면 포커스한 칩으로 되돌리지 않는다
    act(() => chip.blur());
    act(() => chip.focus());
    expect(scroll).toHaveBeenCalledTimes(3);
    fireEvent.pointerDown(row);
    row.scrollLeft = 0;
    act(() => {
      fireEvent.scroll(row);
    });
    expect(prevBtn()).toBeNull();
    expect(scroll, "손으로 넘긴 것과 싸우지 않는다").toHaveBeenCalledTimes(3);

    // 포커스가 칩에 남은 채 「›」로 넘겨도 포커스한 칩으로 되돌리지 않는다
    act(() => chip.blur());
    act(() => chip.focus());
    expect(scroll).toHaveBeenCalledTimes(4);
    act(() => fireEvent.click(nextBtn()!));
    expect(row.scrollLeft).toBe(300);
    expect(prevBtn()).not.toBeNull();
    expect(scroll, "단추로 넘긴 것과 싸우지 않는다").toHaveBeenCalledTimes(4);
  });

  it("포커스 순서: 칩만 Tab 순서에 있고(넘김 단추는 -1), 칩 순서는 자식 순서 그대로다", () => {
    render(<Row />);
    fakeGeometry(group(), { clientWidth: 300, scrollWidth: 1000, scrollLeft: 300 });
    fireEvent.scroll(group());
    const all = [...group().parentElement!.querySelectorAll<HTMLElement>("button")];
    expect(all.length).toBe(NAMES.length + 2);
    const tabbable = all.filter((b) => b.tabIndex >= 0);
    expect(tabbable.map((b) => b.textContent)).toEqual(NAMES);
  });

  it("칩이 늘어 넘치게 되면(다시 그림) 「›」가 생긴다", () => {
    const view = render(<Row names={["운동"]} />);
    const row = group();
    let width = 200;
    Object.defineProperty(row, "clientWidth", { configurable: true, get: () => 300 });
    Object.defineProperty(row, "scrollWidth", { configurable: true, get: () => width });
    fireEvent.scroll(row);
    expect(nextBtn()).toBeNull();
    width = 1000;
    view.rerender(<Row names={NAMES} />);
    expect(nextBtn()).not.toBeNull();
  });
});

describe("네 화면의 칩 줄이 ChipScroller다(감싸는 .detail-chips가 아니다)", () => {
  const expectScroller = (row: HTMLElement) => {
    expect(row.classList.contains("chip-row")).toBe(true);
    expect(row.classList.contains("detail-chips")).toBe(false);
    expect(row.parentElement!.classList.contains("chip-scroller")).toBe(true);
    expect(row.children.length).toBeGreaterThan(0);
  };

  it("타이머: 「할 일 없이 시작」의 분야 칩 줄", async () => {
    const read: TodayRead = {
      todos: { ok: true, data: { day: { date: "2026-11-07", year: 2026, month: 11, dayOfMonth: 7, weekday: 6 }, todos: [] } },
      categories: { ok: true, data: { categories: [{ id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", readable: true, name: "어학", createdAt: "x" }] } },
    };
    const api = {
      fetchState: vi.fn(async () => ({ ok: true as const, data: { serverNow: new Date(0).toISOString(), active: null, today: [] } })),
      start: vi.fn(),
      end: vi.fn(),
    } as unknown as FocusApi;
    render(<TimerScreen api={api} fetchToday={async () => read} active activation={1} now={() => 0} onActiveChange={() => {}} />);
    await act(async () => {});
    const row = screen.getByRole("group", { name: "분야 (고르지 않으면 기타)" });
    expectScroller(row);
    expect([...row.children].map((c) => c.textContent)).toEqual(["기타", "어학"]);
  });

  it("처음 설정: 분야 칩 줄과 예시 칩 줄", () => {
    const api = { addCategory: vi.fn(), saveRatios: vi.fn(), saveSettings: vi.fn(), requestPermission: vi.fn() } as unknown as SettingsApi;
    render(
      <Onboarding
        api={api}
        categories={[{ id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", name: "어학" }]}
        initialGoal={null}
        initialRatios={[]}
        initialNotify={{ eveningEnabled: false, eveningMinute: 1170, morningEnabled: false, morningMinute: 600 }}
        onDone={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expectScroller(screen.getByRole("group", { name: "분야" }));
    expectScroller(screen.getByRole("group", { name: "예시" }));
  });

  it("할 일 자세히: 분야 칩 줄", () => {
    const never = () => new Promise<never>(() => {});
    const api = { fetchNotes: never, addNote: vi.fn(), deleteNote: vi.fn(), editTodo: vi.fn(), deleteTodo: vi.fn() };
    render(
      <TodoDetail
        todo={{ id: "t1", text: "글", categoryId: null, canMoveUp: false, canMoveDown: false }}
        chips={[{ id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", name: "어학" }]}
        api={api as never}
        online
        onClose={() => {}}
        onEdited={() => {}}
        onDeleted={() => {}}
        onMove={async () => true}
      />,
    );
    const row = screen.getByRole("group", { name: "분야 (고르지 않으면 기타)" });
    expectScroller(row);
    expect([...row.children].map((c) => c.textContent)).toEqual(["기타", "어학"]);
  });
});
