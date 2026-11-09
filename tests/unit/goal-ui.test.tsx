// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalEditor, GoalLine } from "../../components/goal";
import { expectConfirmShape } from "./confirm-helpers";
import type { GoalsApi } from "../../lib/goals-api";
import type { GoalSummary } from "../../lib/goals/types";

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";

function summary(over: Partial<GoalSummary> = {}): GoalSummary {
  return { weekStart: "2026-11-02", categories: [{ id: C1, name: "어학" }, { id: C2, name: "포트폴리오" }], thisWeek: [], goal: null, ...over };
}
const summaryApi = (data: GoalSummary | null): GoalsApi => ({
  fetchSummary: vi.fn(async () => (data ? { ok: true as const, data } : { ok: false as const, error: "unavailable" as const })),
  save: vi.fn(),
  clear: vi.fn(),
});
function goalsApi(over: Partial<GoalsApi> = {}): GoalsApi {
  return {
    fetchSummary: vi.fn(),
    save: vi.fn(async (items) => ({ ok: true as const, data: { weekStart: "2026-11-02", items } })),
    clear: vi.fn(async () => ({ ok: true as const, data: { weekStart: "2026-11-02" } })),
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("이번 주 목표 한 줄 (D-113, D-114)", () => {
  it("목표가 없으면 「이번 주 목표 정하기」 한 줄", async () => {
    const onOpen = vi.fn();
    render(<GoalLine api={summaryApi(summary())} refreshKey={0} onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole("button", { name: "이번 주 목표 정하기" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ goal: null }));
  });
  it("목표가 있으면 숫자만: 「이번 주 목표 15시간 중 9시간」(분야마다 목표를 넘기지 않게 센다)", async () => {
    const data = summary({
      goal: [{ categoryId: C1, minutes: 300 }, { categoryId: C2, minutes: 600 }],
      thisWeek: [{ categoryId: C1, minutes: 480 }, { categoryId: C2, minutes: 240 }],
    });
    render(<GoalLine api={summaryApi(data)} refreshKey={0} onOpen={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "이번 주 목표 15시간 중 9시간" })).toBeTruthy();
  });
  it("다 채워도 평가하는 말을 붙이지 않는다", async () => {
    const data = summary({ goal: [{ categoryId: C1, minutes: 300 }], thisWeek: [{ categoryId: C1, minutes: 600 }] });
    render(<GoalLine api={summaryApi(data)} refreshKey={0} onOpen={vi.fn()} />);
    const line = await screen.findByRole("button", { name: "이번 주 목표 5시간 중 5시간" });
    expect(line.textContent).not.toMatch(/달성|완료|성공|축하|대단/);
  });
  it("읽지 못하면 아무것도 그리지 않고, refreshKey가 바뀌면 다시 읽는다", async () => {
    const api = summaryApi(null);
    const { rerender, container } = render(<GoalLine api={api} refreshKey={0} onOpen={vi.fn()} />);
    await act(async () => {});
    expect(container.textContent).toBe("");
    rerender(<GoalLine api={api} refreshKey={1} onOpen={vi.fn()} />);
    await act(async () => {});
    expect(api.fetchSummary).toHaveBeenCalledTimes(2);
  });
});

describe("이번 주 목표 정하기 창", () => {
  const categories = [{ id: C1, name: "어학" }, { id: C2, name: "포트폴리오" }];
  const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

  it("분야마다 시간을 1시간 단위로 넣고 합계가 보이며, 0시간인 분야는 목표에 넣지 않는다", async () => {
    const api = goalsApi();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<GoalEditor api={api} categories={categories} goal={null} onClose={onClose} onSaved={onSaved} />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "이번 주 목표" }));
    // 고침9 ⑬ 14: 안내는 「1시간 단위 · 0시간은 목표에 안 넣음」 한 줄(옛 두 문장 없음)
    expect(screen.getByText("1시간 단위 · 0시간은 목표에 안 넣음")).toBeTruthy();
    expect(screen.queryByText(/쓰고 싶은 시간을 1시간 단위로 정해요/)).toBeNull();
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true); // 합 0
    fireEvent.click(screen.getByRole("button", { name: "어학 1시간 늘리기" }));
    fireEvent.click(screen.getByRole("button", { name: "어학 1시간 늘리기" }));
    fireEvent.change(screen.getByLabelText("포트폴리오"), { target: { value: "10" } });
    expect(screen.getByText("합계 12시간")).toBeTruthy();
    await press("저장");
    expect(api.save).toHaveBeenCalledWith([{ categoryId: C1, minutes: 120 }, { categoryId: C2, minutes: 600 }]);
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("고칠 때는 지금 목표로 열리고, 목표 없애기가 있다", async () => {
    const api = goalsApi();
    const onSaved = vi.fn();
    render(<GoalEditor api={api} categories={categories} goal={[{ categoryId: C1, minutes: 300 }]} onClose={vi.fn()} onSaved={onSaved} />);
    expect((screen.getByLabelText("어학") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("포트폴리오") as HTMLInputElement).value).toBe("0");
    // 고침10 B(147:2 넷째 — 50:332 아래 붙은 카드 꼴을 대신함): 「목표 없애기」는 공통 확인 창 — 위 「없애기」 · 아래 「그대로 두기」
    const clearButton = screen.getByRole("button", { name: "목표 없애기" });
    clearButton.focus();
    await press("목표 없애기");
    expect(api.clear).not.toHaveBeenCalled();
    const box = screen.getByRole("alertdialog", { name: "이번 주 목표를 없앨까요?" });
    expectConfirmShape(box, "없애기", "그대로 두기");
    expect(screen.getByRole("button", { name: "목표 없애기" }).closest("[inert]"), "확인 밖은 inert").not.toBeNull();
    await act(async () => fireEvent.click(within(box).getByRole("button", { name: "그대로 두기" })));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "목표 없애기" }));
    expect(api.clear).not.toHaveBeenCalled();
    // Esc = 「그대로 두기」
    await press("목표 없애기");
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: "이번 주 목표" }), "Esc는 확인만 닫는다").toBeTruthy();
    expect(api.clear).not.toHaveBeenCalled();
    // 「없애기」 연타에도 한 번
    await press("목표 없애기");
    const yes = within(screen.getByRole("alertdialog")).getByRole("button", { name: "없애기" });
    await act(async () => {
      fireEvent.click(yes);
      fireEvent.click(yes);
    });
    expect(api.clear).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalled();
  });

  it("목표가 없는 주에는 「목표 없애기」가 없다", () => {
    render(<GoalEditor api={goalsApi()} categories={categories} goal={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "목표 없애기" })).toBeNull();
  });

  it("한 주 168시간을 넘으면 저장이 막히고 안내가 보인다", () => {
    render(<GoalEditor api={goalsApi()} categories={categories} goal={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("어학"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("포트폴리오"), { target: { value: "69" } });
    expect(screen.getByText("한 주는 168시간까지예요.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("저장이 실패하면 안내를 보이고 창은 그대로, 오프라인이면 저장을 막는다", async () => {
    const api = goalsApi({ save: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) });
    const onClose = vi.fn();
    render(<GoalEditor api={api} categories={categories} goal={[{ categoryId: C1, minutes: 60 }]} onClose={onClose} onSaved={vi.fn()} />);
    await press("저장");
    expect(screen.getByText("저장하지 못했어요. 다시 눌러 주세요.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("인터넷에 연결되면 저장할 수 있어요.")).toBeTruthy();
  });

  it("분야가 없으면 안내만, Esc로 닫힌다", () => {
    const onClose = vi.fn();
    render(<GoalEditor api={goalsApi()} categories={[]} goal={null} onClose={onClose} onSaved={vi.fn()} />);
    expect(screen.getByText("분야가 아직 없어요. 할 일을 적을 때 분야를 더해 보세요.")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("분야 이름은 글자 그대로 보인다", () => {
    const evil = '<img src=x onerror="window.__q=1">';
    render(<GoalEditor api={goalsApi()} categories={[{ id: C1, name: evil }]} goal={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText(evil)).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
