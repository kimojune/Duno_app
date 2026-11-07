// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EveningEntry, EveningRecord } from "../../components/evening-record";
import type { EveningState, SavedEvening } from "../../lib/evening/types";
import type { EveningApi, EveningSaveInput } from "../../lib/evening-api";

const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const NOW = new Date("2026-11-07T14:00:00.000Z");

function state(over: Partial<EveningState> = {}): EveningState {
  return {
    today: "2026-11-07",
    day: "2026-11-07",
    existing: null,
    doneCategoryIds: [],
    timerByCategory: [],
    categories: [
      { id: C1, name: "어학" },
      { id: C2, name: "포트폴리오" },
    ],
    ...over,
  };
}
function fakeApi(s: EveningState = state(), over: Partial<EveningApi> = {}): EveningApi {
  return {
    fetchState: vi.fn(async (day?: string) => ({ ok: true as const, data: { ...s, day: day ?? s.today } })),
    save: vi.fn(async (input: EveningSaveInput) => {
      const saved: SavedEvening = {
        log: { id: input.id, targetDay: input.targetDay, totalMinutes: input.totalMinutes, items: input.items, saveMode: input.saveMode, savedAt: "x" },
        delta: input.items.map((i) => ({ categoryId: i.categoryId, minutes: i.minutes })),
      };
      return { ok: true as const, data: saved };
    }),
    ...over,
  };
}
async function mount(api: EveningApi, extra: Partial<React.ComponentProps<typeof EveningRecord>> = {}) {
  const onClose = vi.fn();
  const view = render(<EveningRecord api={api} now={() => NOW} onClose={onClose} {...extra} />);
  await screen.findByRole("button", { name: "분야마다 나누기" });
  return { onClose, ...view };
}
const setNumber = (label: string, value: number) => fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("저녁 기록 (7-3, ②)", () => {
  it("질문 「오늘 몇 시간 썼어요?」로 열리고 제목에 포커스가 간다", async () => {
    await mount(fakeApi());
    const dialog = screen.getByRole("dialog", { name: "오늘 몇 시간 썼어요?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "오늘 몇 시간 썼어요?" }));
    expect(screen.getByText("합계 0분")).toBeTruthy();
  });

  it("시간과 분을 −/+ 단추나 숫자 칸으로 넣고, 합계가 숫자로 보인다", async () => {
    await mount(fakeApi());
    setNumber("시간", 2);
    fireEvent.click(screen.getByRole("button", { name: "분 5분 늘리기" }));
    fireEvent.click(screen.getByRole("button", { name: "분 5분 늘리기" }));
    expect(screen.getByText("합계 2시간 10분")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "시간 1시간 줄이기" }));
    expect(screen.getByText("합계 1시간 10분")).toBeTruthy();
  });

  it("타이머 시간으로 총시간을 미리 채운다", async () => {
    await mount(fakeApi(state({ timerByCategory: [{ categoryId: C1, minutes: 45 }] })));
    expect(screen.getByText("타이머로 45분 미리 채웠어요.")).toBeTruthy();
    expect(screen.getByText("합계 45분")).toBeTruthy();
  });

  it("「나누지 않고 저장」: 전부 기타, 저장 방식 not_split, 대상 날·기기 시각을 함께 보낸다", async () => {
    const api = fakeApi();
    await mount(api);
    setNumber("시간", 3);
    await press("나누지 않고 저장");
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save).toHaveBeenCalledWith({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      targetDay: "2026-11-07",
      totalMinutes: 180,
      items: [{ categoryId: null, minutes: 180 }],
      saveMode: "not_split",
      clientSavedAt: NOW.toISOString(),
    });
    expect(screen.getByRole("heading", { name: "저장했어요" })).toBeTruthy();
    expect(screen.getByText("오늘 바뀐 분야별 시간")).toBeTruthy();
    expect(screen.getByText("기타 +3시간")).toBeTruthy(); // 모두 기타로 저장한 날에도 값이 있다
  });

  it("분야마다 나누기: 끝낸 할 일의 분야와 타이머로 미리 채우고, 그대로 저장하면 prefilled", async () => {
    const api = fakeApi(state({ doneCategoryIds: [C2, null], timerByCategory: [{ categoryId: C1, minutes: 30 }] }));
    await mount(api);
    setNumber("시간", 2); // 타이머 30분이 처음 총시간이라 분은 30이다
    setNumber("분", 0); // 120분: 타이머 30 + 나머지 90은 끝낸 할 일의 분야(포트폴리오)에
    await press("분야마다 나누기");
    expect(screen.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeTruthy();
    expect((screen.getByLabelText("어학") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("포트폴리오") as HTMLInputElement).value).toBe("90");
    await press("저장");
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({
        totalMinutes: 120,
        items: [{ categoryId: C1, minutes: 30 }, { categoryId: C2, minutes: 90 }],
        saveMode: "prefilled",
      }),
    );
    expect(screen.getByText("어학 +30분 · 포트폴리오 +1시간 30분")).toBeTruthy();
  });

  it("미리 채운 값을 고치면 edited, 남은 시간은 기타", async () => {
    const api = fakeApi(state({ doneCategoryIds: [C2] }));
    await mount(api);
    setNumber("시간", 2);
    await press("분야마다 나누기");
    fireEvent.click(screen.getByRole("button", { name: "포트폴리오 5분 줄이기" }));
    await press("저장");
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ categoryId: C2, minutes: 115 }, { categoryId: null, minutes: 5 }], saveMode: "edited" }),
    );
  });

  it("나눈 시간이 합계보다 많으면 합계를 늘려 저장한다고 알린다", async () => {
    const api = fakeApi();
    await mount(api);
    setNumber("시간", 1);
    await press("분야마다 나누기");
    setNumber("어학", 90);
    expect(screen.getByText("나눈 시간이 합계보다 많아서 합계를 1시간 30분로 맞춰 저장해요.")).toBeTruthy();
    await press("저장");
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ totalMinutes: 90, items: [{ categoryId: C1, minutes: 90 }] }));
  });

  it("저장 직후 한 줄을 누르면 상태보기로 간다(onOpenGrowth)", async () => {
    const onOpenGrowth = vi.fn();
    await mount(fakeApi(), { onOpenGrowth });
    setNumber("시간", 1);
    await press("나누지 않고 저장");
    fireEvent.click(screen.getByRole("button", { name: /오늘 바뀐 분야별 시간/ }));
    expect(onOpenGrowth).toHaveBeenCalledTimes(1);
  });

  it("바뀐 시간이 없으면 그렇게 알린다", async () => {
    const api = fakeApi(state(), {
      save: vi.fn(async (input: EveningSaveInput) => ({
        ok: true as const,
        data: { log: { id: input.id, targetDay: input.targetDay, totalMinutes: 0, items: [], saveMode: input.saveMode, savedAt: "x" }, delta: [] },
      })),
    });
    await mount(api);
    await press("나누지 않고 저장");
    expect(screen.getByText("바뀐 시간이 없어요")).toBeTruthy();
  });

  it("저장 뒤 renderAfterSave가 한 줄 아래에 얹힌다", async () => {
    await mount(fakeApi(), { renderAfterSave: (saved) => <p>채울 한 줄 {saved.log.totalMinutes}</p> });
    setNumber("시간", 1);
    await press("나누지 않고 저장");
    expect(screen.getByText("채울 한 줄 60")).toBeTruthy();
  });

  it("어제로 바꾸면 어제 날짜로 다시 읽고, 질문과 저장 대상 날이 바뀐다", async () => {
    const api = fakeApi();
    await mount(api);
    fireEvent.click(screen.getByRole("button", { name: "어제" }));
    await screen.findByRole("heading", { name: "어제 몇 시간 썼어요?" });
    expect(api.fetchState).toHaveBeenLastCalledWith("2026-11-06");
    setNumber("시간", 1);
    await press("나누지 않고 저장");
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ targetDay: "2026-11-06" }));
    expect(screen.getByText("어제 바뀐 분야별 시간")).toBeTruthy();
  });

  it("이미 남긴 기록이 있으면 그 값으로 열리고 고쳐 저장할 수 있다", async () => {
    const existing = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetDay: "2026-11-07",
      totalMinutes: 150,
      items: [{ categoryId: C1, minutes: 100 }, { categoryId: null, minutes: 50 }],
      saveMode: "edited" as const,
      savedAt: "x",
    };
    const api = fakeApi(state({ existing }));
    await mount(api);
    expect(screen.getByText("이미 남긴 기록이 있어요. 고쳐서 다시 저장할 수 있어요.")).toBeTruthy();
    expect(screen.getByText("합계 2시간 30분")).toBeTruthy();
    await press("분야마다 나누기");
    expect((screen.getByLabelText("어학") as HTMLInputElement).value).toBe("100");
    await press("저장");
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ totalMinutes: 150, saveMode: "prefilled" }));
  });

  it("저장이 실패하면 안내를 보이고 값은 그대로, 같은 내용으로 다시 누르면 같은 id", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unavailable" })
      .mockImplementation(async (input: EveningSaveInput) => ({
        ok: true,
        data: { log: { id: input.id, targetDay: input.targetDay, totalMinutes: input.totalMinutes, items: input.items, saveMode: input.saveMode, savedAt: "x" }, delta: [] },
      }));
    const api = fakeApi(state(), { save });
    await mount(api);
    setNumber("시간", 2);
    await press("나누지 않고 저장");
    expect(screen.getByRole("alert").textContent).toContain("저장하지 못했어요");
    expect(screen.getByText("합계 2시간")).toBeTruthy();
    await press("나누지 않고 저장");
    expect(save.mock.calls[0][0].id).toBe(save.mock.calls[1][0].id);
    expect(screen.getByRole("heading", { name: "저장했어요" })).toBeTruthy();
  });

  it("내용을 바꾸면 새 id로 저장한다", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unavailable" })
      .mockResolvedValue({ ok: false, error: "unavailable" });
    await mount(fakeApi(state(), { save }));
    setNumber("시간", 2);
    await press("나누지 않고 저장");
    setNumber("시간", 3);
    await press("나누지 않고 저장");
    expect(save.mock.calls[0][0].id).not.toBe(save.mock.calls[1][0].id);
  });

  it("오프라인이면 저장하지 않고 안내하며 넣은 값은 그대로 둔다", async () => {
    const api = fakeApi();
    await mount(api);
    setNumber("시간", 2);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    await press("나누지 않고 저장");
    expect(api.save).not.toHaveBeenCalled();
    expect(screen.getAllByText("인터넷에 연결되면 저장할 수 있어요. 넣은 값은 그대로 있어요.").length).toBeGreaterThan(0);
    expect(screen.getByText("합계 2시간")).toBeTruthy();
  });

  it("읽기가 실패하면 안내와 「다시 불러오기」", async () => {
    const fetchState = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unavailable" })
      .mockResolvedValue({ ok: true, data: state() });
    render(<EveningRecord api={fakeApi(state(), { fetchState })} now={() => NOW} onClose={vi.fn()} />);
    expect(await screen.findByText("기록을 불러오지 못했어요.")).toBeTruthy();
    await press("다시 불러오기");
    expect(await screen.findByRole("button", { name: "분야마다 나누기" })).toBeTruthy();
  });

  it("Esc와 「닫기」로 닫힌다", async () => {
    const { onClose } = await mount(fakeApi());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("분야 이름은 글자 그대로 보인다", async () => {
    const evil = '<img src=x onerror="window.__e=1">';
    const api = fakeApi(state({ categories: [{ id: C1, name: evil }] }));
    await mount(api);
    setNumber("시간", 1);
    await press("분야마다 나누기");
    expect(screen.getByLabelText(evil)).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("EveningEntry", () => {
  it("저녁에는 질문을 앞세우고, 낮에는 조용한 단추", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<EveningEntry evening onOpen={onOpen} />);
    expect(screen.getByText("오늘 몇 시간 썼어요?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "오늘 기록하기" }));
    expect(onOpen).toHaveBeenCalled();
    rerender(<EveningEntry evening={false} onOpen={onOpen} />);
    expect(screen.queryByText("오늘 몇 시간 썼어요?")).toBeNull();
    expect(screen.getByRole("button", { name: "기록 남기기" })).toBeTruthy();
  });
});
