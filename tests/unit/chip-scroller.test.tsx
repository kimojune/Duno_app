// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHIP_MAX_ROWS, ChipScroller, CHIP_SCROLLER_TEXT, resetChipRowMemory, rowIndexes } from "../../components/chip-scroller";
import { Onboarding } from "../../components/onboarding";
import { TimerScreen } from "../../components/timer-screen";
import { TodoDetail } from "../../components/todo-detail";
import type { FocusApi } from "../../lib/focus-api";
import type { SettingsApi } from "../../lib/onboarding-api";
import type { TodayRead } from "../../lib/today-types";

/**
 * 고침9(PM 16:3x · 23 칩 두 줄): 분야 칩 줄은 두 줄까지 감싸고, 넘치면 둘째 줄 끝 「+n」 → 펼침 + 「접기」(고침5의 한 줄 + 옆으로 넘김을 바꿈).
 * jsdom은 배치를 하지 않아서, 칩 줄 폭(ROW_W)과 칩 글 길이로 칩마다 자리(위)를 셈하는 가짜 배치(flow)를 getBoundingClientRect에 심는다.
 * 실제 화면 배치(줄 수 ≤ 2 · 「+n」 수 = 숨은 칩 수 · 가로 넘침 없음)는 tests/screens/chip-row.ts가 360px·글자 200% 흉내에서 잰다.
 */

const NAMES = ["취업 준비", "운동", "CS 공부", "영어", "독서", "포트폴리오", "사이드 프로젝트", "자격증"];

function Row({ names = NAMES, pressed = null }: { names?: string[]; pressed?: string | null }) {
  return (
    <ChipScroller aria-label="분야">
      {names.map((n) => (
        <button key={n} type="button" className="chip" aria-pressed={n === pressed}>
          <span className="chip-face">
            <span className="chip-label">{n}</span>
          </span>
        </button>
      ))}
    </ChipScroller>
  );
}

/** 가짜 배치: 칩 줄 폭 ROW_W, 칩 폭 = 글자 수 × 14 + 32(「+n」은 56), 칩 사이 8, 줄 높이 36 + 줄 사이 8 */
let ROW_W = 320;
function chipWidth(el: Element): number {
  if (el.hasAttribute("data-chip-more")) return 56;
  return (el.textContent ?? "").length * 14 + 32;
}
function installFlow() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const row = this.parentElement;
    if (!row || !row.classList.contains("chip-row")) return new DOMRect(0, 0, 0, 0);
    let x = 0;
    let line = 0;
    for (const child of [...row.children]) {
      const w = chipWidth(child);
      if (x > 0 && x + w > ROW_W) {
        line += 1;
        x = 0;
      }
      if (child === this) return new DOMRect(x, line * 44, w, 36);
      x += w + 8;
    }
    return new DOMRect(0, 0, 0, 0);
  });
}
/** 지금 그려진 칩들의 줄 수(가짜 배치로) */
function linesNow(): number {
  return new Set([...group().children].map((c) => (c as HTMLElement).getBoundingClientRect().top)).size;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  resetChipRowMemory(); // 칩 줄 이름마다의 「마지막 칩」 기록은 모듈에 남는다 — 시험마다 비운다
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const group = () => screen.getByRole("group", { name: "분야" });
const moreBtn = () => screen.queryByRole("button", { name: /^분야 \d+개 더 보기$/ });
const collapseBtn = () => screen.queryByRole("button", { name: CHIP_SCROLLER_TEXT.collapse });
const chipNames = () => [...group().children].filter((c) => !c.hasAttribute("data-chip-more")).map((c) => c.textContent);

describe("rowIndexes: 칩 위 → 줄 번호", () => {
  it("위가 같으면 같은 줄, 4px 넘게 내려가면 다음 줄(고른 칩 테두리 1~2px 어긋남은 같은 줄)", () => {
    expect(rowIndexes([])).toEqual([]);
    expect(rowIndexes([0, 0, 0])).toEqual([0, 0, 0]);
    expect(rowIndexes([0, 1, 44, 45, 88])).toEqual([0, 0, 1, 1, 2]);
    expect(rowIndexes([10, 12, 13])).toEqual([0, 0, 0]);
    expect(CHIP_MAX_ROWS).toBe(2);
  });
});

describe("ChipScroller: 두 줄까지 감쌈 + 「+n」 · 펼침 · 「접기」", () => {
  it("두 줄 안이면 칩을 모두 그리고 「+n」·「접기」가 없다. 넘김 단추·옅어지는 띠 표시도 없다", () => {
    installFlow();
    render(<Row names={["운동", "영어", "독서"]} />);
    const row = group();
    expect(row.classList.contains("chip-row")).toBe(true);
    expect(row.parentElement!.classList.contains("chip-scroller")).toBe(true);
    expect(chipNames()).toEqual(["운동", "영어", "독서"]);
    expect(moreBtn()).toBeNull();
    expect(collapseBtn()).toBeNull();
    expect(document.querySelector(".chip-nav")).toBeNull();
    expect(row.parentElement!.hasAttribute("data-more-end")).toBe(false);
  });

  it("두 줄을 넘으면 둘째 줄 끝에 「+n」, n = 숨은 칩 수, 보이는 칩 + 「+n」은 두 줄 안", () => {
    installFlow();
    render(<Row />);
    const more = moreBtn();
    expect(more, "넘치면 「+n」이 있다").not.toBeNull();
    const shown = chipNames();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(NAMES.length);
    expect(shown).toEqual(NAMES.slice(0, shown.length)); // 만든 순서 앞에서부터
    const hidden = NAMES.length - shown.length;
    expect(more!.textContent).toBe(`+${hidden}`);
    expect(more!.getAttribute("aria-label")).toBe(`분야 ${hidden}개 더 보기`);
    expect(more!.getAttribute("aria-expanded")).toBe("false");
    expect(more!.getAttribute("aria-controls")).toBe(group().id);
    expect(linesNow(), "「+n」까지 두 줄 안(하한·상한)").toBe(2);
    expect(group().lastElementChild).toBe(more); // 둘째 줄 끝
    expect(more!.querySelector(".chip-check")).toBeNull(); // 숨은 칩 가운데 고른 것이 없다
  });

  it("숨은 칩 가운데 고른 것이 있으면 「+n」 앞에 체크(✓ +n), 보이는 칩을 골랐으면 체크 없음", () => {
    installFlow();
    const { rerender } = render(<Row pressed="자격증" />);
    expect(chipNames()).not.toContain("자격증");
    expect(moreBtn()!.querySelector(".chip-check")).not.toBeNull();
    rerender(<Row pressed="취업 준비" />);
    expect(chipNames()).toContain("취업 준비");
    expect(moreBtn()!.querySelector(".chip-check")).toBeNull();
  });

  it("「+n」을 누르면 모두 펼침 + 맨 끝 「접기」(aria-expanded=true), 초점은 처음 드러난 칩. 「접기」를 누르면 두 줄로, 초점은 「+n」", () => {
    installFlow();
    render(<Row />);
    const shownBefore = chipNames().length;
    act(() => moreBtn()!.click());
    expect(chipNames()).toEqual(NAMES);
    expect(moreBtn()).toBeNull();
    const collapse = collapseBtn()!;
    expect(collapse.textContent).toBe("접기");
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(collapse.getAttribute("aria-controls")).toBe(group().id);
    expect(group().lastElementChild).toBe(collapse);
    expect(linesNow(), "펼치면 두 줄을 넘는다(줄 수 제한 없음)").toBeGreaterThan(2);
    expect(document.activeElement!.textContent).toBe(NAMES[shownBefore]);
    act(() => collapse.click());
    expect(collapseBtn()).toBeNull();
    expect(chipNames()).toHaveLength(shownBefore);
    expect(document.activeElement).toBe(moreBtn());
    expect(linesNow()).toBe(2);
  });

  it("펼친 채 칩을 고르거나 풀어도(다시 그림) 펼친 채로 둔다. 새로 그리면(화면을 닫았다 열면) 접힘", () => {
    installFlow();
    const { rerender, unmount } = render(<Row />);
    act(() => moreBtn()!.click());
    rerender(<Row pressed="운동" />);
    expect(collapseBtn()).not.toBeNull();
    expect(chipNames()).toEqual(NAMES);
    unmount();
    render(<Row pressed="운동" />);
    expect(moreBtn()).not.toBeNull();
    expect(collapseBtn()).toBeNull();
  });

  it("칩이 늘어 두 줄을 넘게 되면 「+n」이 생긴다, 줄면 사라진다", () => {
    installFlow();
    const { rerender } = render(<Row names={NAMES.slice(0, 3)} />);
    expect(moreBtn()).toBeNull();
    rerender(<Row names={NAMES} />);
    expect(moreBtn()).not.toBeNull();
    rerender(<Row names={NAMES.slice(0, 3)} />);
    expect(moreBtn()).toBeNull();
    expect(chipNames()).toEqual(NAMES.slice(0, 3));
  });

  it("포커스 순서: 보이는 칩 → 「+n」. tabindex로 순서를 바꾸지 않는다", () => {
    installFlow();
    render(<Row />);
    const kids = [...group().children] as HTMLElement[];
    expect(kids.every((k) => k.tagName === "BUTTON" && k.getAttribute("tabindex") === null)).toBe(true);
    expect(kids[kids.length - 1]).toBe(moreBtn());
  });
});

describe("고침9 검토 MEDIUM: 폭이 바뀌면 다시 잰다(좁아져 넘칠 때도)", () => {
  /** 가짜 ResizeObserver: 콜백을 모아 두었다가 「폭이 바뀜」을 흉내 낼 때 부른다 */
  function installRO() {
    const callbacks: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          callbacks.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("chip-row") ? ROW_W : 0;
    });
    return () => act(() => callbacks.forEach((cb) => cb()));
  }
  afterEach(() => {
    ROW_W = 320;
    vi.unstubAllGlobals();
  });

  it("넓음(두 줄 안, 「+n」 없음) → 좁음: 「+n」이 생기고 n = 숨은 칩 수 → 다시 넓음: 「+n」이 사라지고 모두 보임", () => {
    installFlow();
    ROW_W = 2000;
    const resize = installRO();
    render(<Row />);
    resize(); // 처음 폭을 잰다
    expect(moreBtn()).toBeNull();
    expect(chipNames()).toEqual(NAMES);
    ROW_W = 320;
    resize();
    const more = moreBtn();
    expect(more, "좁아져 세 줄로 넘치면 「+n」").not.toBeNull();
    const hidden = NAMES.length - chipNames().length;
    expect(hidden).toBeGreaterThan(0);
    expect(more!.textContent).toBe(`+${hidden}`);
    expect(linesNow()).toBe(2);
    ROW_W = 2000;
    resize();
    expect(moreBtn()).toBeNull();
    expect(chipNames()).toEqual(NAMES);
  });
});

describe("고침9 K: 분야를 더한 직후에는 펼친 채(새 칩이 「+n」 뒤로 숨지 않게)", () => {
  it("두 줄을 넘는 줄에 골라진 새 칩이 생기면 펼친 채 두고(「접기」 aria-expanded true) 새 칩이 보이고 초점이 간다", () => {
    installFlow();
    const { rerender } = render(<Row />);
    expect(moreBtn(), "더하기 전에는 접혀 있다").not.toBeNull();
    rerender(<Row names={[...NAMES, "새 분야"]} pressed="새 분야" />);
    expect(moreBtn()).toBeNull();
    const collapse = collapseBtn()!;
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(chipNames()).toEqual([...NAMES, "새 분야"]);
    const fresh = within(group()).getByRole("button", { name: "새 분야" });
    expect(fresh.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(fresh);
  });

  it("두 줄 안이면 펼치지 않고 초점도 옮기지 않는다. 골라지지 않은 새 칩(다른 기기에서 더함)은 접힌 채", () => {
    installFlow();
    const { rerender } = render(<Row names={["운동", "영어"]} />);
    const before = document.activeElement;
    rerender(<Row names={["운동", "영어", "독서"]} pressed="독서" />);
    expect(collapseBtn()).toBeNull();
    expect(document.activeElement).toBe(before);
    cleanup();
    const second = render(<Row />);
    second.rerender(<Row names={[...NAMES, "남이 더함"]} />);
    expect(collapseBtn()).toBeNull();
    expect(moreBtn()).not.toBeNull();
    expect(chipNames()).not.toContain("남이 더함");
  });

  it("이미 펼친 줄에 새 칩이 생기면 그대로 펼친 채 새 칩으로 초점", () => {
    installFlow();
    const { rerender } = render(<Row />);
    act(() => moreBtn()!.click());
    rerender(<Row names={[...NAMES, "새 분야"]} pressed="새 분야" />);
    expect(collapseBtn()).not.toBeNull();
    expect(document.activeElement).toBe(within(group()).getByRole("button", { name: "새 분야" }));
  });

  it("칩 줄이 새로 그려져도(「+ 분야」 칸이 칩 줄 자리를 잠시 차지했다 돌아옴) 방금 생긴 골라진 칩이면 펼친 채", () => {
    installFlow();
    const first = render(<Row />);
    expect(moreBtn()).not.toBeNull();
    first.unmount(); // 새 분야 칸이 칩 줄 자리에
    render(<Row names={[...NAMES, "새 분야"]} pressed="새 분야" />);
    expect(collapseBtn()).not.toBeNull();
    expect(moreBtn()).toBeNull();
    expect(document.activeElement).toBe(within(group()).getByRole("button", { name: "새 분야" }));
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
    const row = screen.getByRole("group", { name: "분야" });
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

  it("할 일 자세히(고침9 PM 3): 칩 줄 대신 고른 분야 한 줄, 누르면 시트(칩 줄 아님 — 분야 한 줄에 하나)", () => {
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
    expect(screen.queryByRole("group", { name: "분야" })).toBeNull();
    expect(document.querySelector(".chip-scroller")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "분야 기타" }));
    const sheet = screen.getByRole("dialog", { name: "분야 고르기" });
    expect(sheet.querySelector(".chip-scroller")).toBeNull();
    expect(within(within(sheet).getByRole("list")).getAllByRole("button").map((c) => c.textContent)).toEqual(["어학", "기타"]);
  });
});
