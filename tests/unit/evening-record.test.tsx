// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EveningEntry, EveningRecord } from "../../components/evening-record";
import type { EveningState, SavedEvening } from "../../lib/evening/types";
import type { EveningApi, EveningSaveInput } from "../../lib/evening-api";
import { buildDemoPlan } from "../../lib/demo/seed";
import { setNumberField, wheelTotal, wheelValue } from "./time-wheel-helpers";

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
      { id: C2, name: "글쓰기" },
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
/** 「시간」「분」은 두 줄 휠의 숫자 바로 쓰기(고침9), 그 밖(분야 줄)은 숫자 칸 */
const setNumber = setNumberField;
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
/** 저장 뒤 「이번 주」 카드의 줄: [분야 이름, 바뀐 몫] */
const afterSaveRows = () =>
  Array.from(document.querySelectorAll(".after-save-card .after-save-row")).map((li) => [li.querySelector(".after-save-name")!.textContent, li.querySelector(".after-save-delta")!.textContent]);

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("오늘 기록(옛 저녁 기록) (7-3, ②)", () => {
  it("창 이름은 머리 「오늘 기록」(A1), 머리 아래 큰 제목 「오늘 몇 시간 썼어요?」에 포커스가 간다. 시간 단계에 「합계」 줄은 없다(고침9)", async () => {
    await mount(fakeApi());
    const dialog = screen.getByRole("dialog", { name: "오늘 기록" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const ask = screen.getByRole("heading", { name: "오늘 몇 시간 썼어요?" });
    expect(document.activeElement).toBe(ask);
    expect(ask.className).toBe("evening-ask");
    // 머리 줄(고침10 A): 왼쪽 위 「‹」(이름 「이전」) · 가운데 「오늘 기록」. 오른쪽 위 글 「닫기」는 없다
    const head = dialog.querySelector<HTMLElement>(".screen-head")!;
    expect(head.querySelector(".screen-head-title")!.textContent).toBe("오늘 기록");
    expect(within(head).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["이전"]);
    expect(within(dialog).queryByRole("button", { name: "닫기" })).toBeNull();
    expect(head.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // 큰 제목은 머리 아래
    expect(screen.queryByText(/^합계/)).toBeNull();
    expect(wheelTotal()).toBe(0);
  });

  it("「어제」 왼쪽 · 「오늘」 오른쪽 알약(aria-pressed), 단추는 「분야마다 나누기」(주) 위 · 「나누지 않고 저장」(보조) 아래, 아래 고정 자리(A2) 안", async () => {
    await mount(fakeApi());
    const days = within(screen.getByRole("group", { name: "기록할 날" })).getAllByRole("button");
    expect(days.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["어제", "false"],
      ["오늘", "true"],
    ]);
    const actions = document.querySelector(".bottom-actions")!;
    expect(Array.from(actions.querySelectorAll("button")).map((b) => [b.textContent, b.className])).toEqual([
      ["분야마다 나누기", "btn btn-primary"],
      ["나누지 않고 저장", "btn btn-secondary evening-skip"],
    ]);
  });

  it("쓴 시간은 두 줄 휠: 숫자 바로 쓰기와 「+ 5분」「− 5분」으로 넣고, 저장 총시간이 휠 값이다", async () => {
    const api = fakeApi();
    await mount(api);
    setNumber("시간", 2);
    fireEvent.click(screen.getByRole("button", { name: "+ 5분" }));
    fireEvent.click(screen.getByRole("button", { name: "+ 5분" }));
    expect([wheelValue("시간"), wheelValue("분")]).toEqual([2, 10]);
    fireEvent.click(screen.getByRole("button", { name: "− 5분" }));
    expect(wheelTotal()).toBe(125);
    await press("나누지 않고 저장");
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ totalMinutes: 125, items: [{ categoryId: null, minutes: 125 }] }));
  });

  it("타이머 시간으로 총시간을 미리 채운다. 알림 글 없이 「타이머 45분」 띠만(고침6 PM d-129 ④)", async () => {
    await mount(fakeApi(state({ timerByCategory: [{ categoryId: C1, minutes: 45 }] })));
    expect(screen.queryByText(/미리 채웠어요/)).toBeNull();
    expect(screen.getByText("타이머 45분").className).toBe("evening-timer-chip");
    expect([wheelValue("시간"), wheelValue("분")]).toEqual([0, 45]);
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
    // 저장 뒤 판(S5-3): 같은 창에서 「✓ 저장했어요」 + 「이번 주」 카드. 아래 「닫기」 알약은 없다(닫기는 머리)
    // O-8: 저장 상태는 포커스를 옮겨 읽히지 않는다 — 포커스는 창 자체(누른 단추가 사라져도 창 밖으로 빠지지 않음), 알림은 상태 알림 한 곳
    const savedHead = screen.getByRole("heading", { name: "저장했어요" });
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "오늘 기록" }));
    expect(savedHead.getAttribute("tabindex")).toBeNull();
    expect(Array.from(document.querySelectorAll('[role="status"]')).map((e) => e.textContent).filter(Boolean)).toEqual(["저장했어요. 기타 +3시간."]);
    expect(afterSaveRows()).toEqual([["기타", "+3시간"]]); // 모두 기타로 저장한 날에도 값이 있다(상태보기 데이터 없이 바뀐 몫만)
    expect(document.querySelector(".bottom-actions")).toBeNull();
    expect(within(screen.getByRole("dialog")).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["이전"]); // 머리 「‹」 하나(닫기)
  });

  it("분야마다 나누기: 타이머 분야는 그 시간 그대로, 끝낸 할 일의 분야는 칩이 골라진 채 남은 시간을 똑같이 나눈다(PM d-180 규칙 1·4). 그대로 저장하면 prefilled", async () => {
    const api = fakeApi(state({ doneCategoryIds: [C2, null], timerByCategory: [{ categoryId: C1, minutes: 30 }] }));
    await mount(api);
    setNumber("시간", 2); // 타이머 30분이 처음 총시간이라 분은 30이다
    setNumber("분", 0); // 120분: 타이머 어학 30 + 남은 90은 끝낸 할 일 분야(글쓰기) 하나가 다 받는다(기타 0)
    await press("분야마다 나누기");
    expect(screen.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeTruthy();
    expect((screen.getByLabelText("어학") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("글쓰기") as HTMLInputElement).value).toBe("90");
    await press("저장");
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({
        totalMinutes: 120,
        items: [{ categoryId: C1, minutes: 30 }, { categoryId: C2, minutes: 90 }],
        saveMode: "prefilled",
      }),
    );
    expect(afterSaveRows()).toEqual([
      ["어학", "+30분"],
      ["글쓰기", "+1시간 30분"],
    ]);
  });

  it("저장 중(O-7, Figma 133:48): 응답 전까지 주 단추가 「저장 중」 + 막힘 + aria-busy, 다른 단추도 막힌다. 응답 뒤 저장 뒤 판", async () => {
    let resolve!: (v: Awaited<ReturnType<EveningApi["save"]>>) => void;
    const save = vi.fn(() => new Promise<Awaited<ReturnType<EveningApi["save"]>>>((r) => (resolve = r)));
    await mount(fakeApi(state(), { save }));
    setNumber("시간", 1);
    await press("분야마다 나누기");
    await press("저장");
    const busy = screen.getByRole("button", { name: "저장 중" }) as HTMLButtonElement;
    expect([busy.disabled, busy.getAttribute("aria-busy"), busy.closest(".bottom-actions") !== null]).toEqual([true, "true", true]);
    expect((screen.getByRole("button", { name: "이전" }) as HTMLButtonElement).disabled).toBe(true);
    await press("저장 중"); // 막혀 있어 두 번 가지 않는다
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolve({ ok: true, data: { log: { id: "x", targetDay: "2026-11-07", totalMinutes: 60, items: [{ categoryId: null, minutes: 60 }], saveMode: "prefilled", savedAt: "x" }, delta: [{ categoryId: null, minutes: 60 }] } }),
    );
    expect(screen.getByRole("heading", { name: "저장했어요" })).toBeTruthy();
    cleanup();
    // 「나누지 않고 저장」도 같다
    const save2 = vi.fn(() => new Promise<never>(() => {}));
    await mount(fakeApi(state(), { save: save2 }));
    await press("나누지 않고 저장");
    const skip = screen.getByRole("button", { name: "저장 중" }) as HTMLButtonElement;
    expect([skip.className, skip.disabled, skip.getAttribute("aria-busy")]).toEqual(["btn btn-secondary evening-skip", true, "true"]);
    expect((screen.getByRole("button", { name: "분야마다 나누기" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("처음 값을 고치면 edited, 남은 시간은 기타", async () => {
    const api = fakeApi(state({ doneCategoryIds: [C2] }));
    await mount(api);
    setNumber("시간", 2);
    await press("분야마다 나누기");
    fireEvent.click(screen.getByRole("button", { name: "글쓰기 5분 줄이기" })); // 처음 값 120(남은 시간 전부) → 115, 5분은 기타
    await press("저장");
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ categoryId: C2, minutes: 115 }, { categoryId: null, minutes: 5 }], saveMode: "edited" }),
    );
  });

  it("나눈 합은 쓴 시간을 넘지 못한다: 쓴 시간보다 큰 값을 넣어도 기타에 남은 만큼까지만 들어가고, 저장 총시간은 쓴 시간 그대로(PM 확정 11-08)", async () => {
    const api = fakeApi();
    await mount(api);
    setNumber("시간", 1);
    await press("분야마다 나누기");
    await press("어학, 다이얼에 넣기"); // 고침 5바퀴: 칩으로 넣은 분야만 줄이 있다
    setNumber("어학", 90);
    expect((screen.getByLabelText("어학") as HTMLInputElement).value).toBe("60");
    expect((screen.getByRole("button", { name: "어학 5분 늘리기" }) as HTMLButtonElement).disabled).toBe(true);
    await press("글쓰기, 다이얼에 넣기"); // 칩 둘 = 60분을 30분씩(기타 0분)
    expect((screen.getByLabelText("어학") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("글쓰기") as HTMLInputElement).value).toBe("30");
    expect((screen.getByRole("button", { name: "글쓰기 5분 늘리기" }) as HTMLButtonElement).disabled).toBe(true); // 기타가 0분이라 다른 분야도 못 늘린다
    setNumber("글쓰기", 50);
    expect((screen.getByLabelText("글쓰기") as HTMLInputElement).value).toBe("30");
    expect(screen.queryByText(/나눈 시간이 합계보다 많아서/)).toBeNull();
    expect(screen.getByText("합계 1시간")).toBeTruthy();
    await press("저장");
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ totalMinutes: 60, items: [{ categoryId: C1, minutes: 30 }, { categoryId: C2, minutes: 30 }] }));
  });

  it("저장 뒤 카드 아래 가운데 「상태보기에서 보기 ›」 글 단추를 누르면 상태보기로 간다(onOpenGrowth). 없으면 단추도 없다", async () => {
    const onOpenGrowth = vi.fn();
    await mount(fakeApi(), { onOpenGrowth });
    setNumber("시간", 1);
    await press("나누지 않고 저장");
    const go = screen.getByRole("button", { name: "상태보기에서 보기" });
    expect(go.className).toContain("btn-text");
    expect(document.querySelector(".after-save-card")!.compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // 카드 아래
    fireEvent.click(go);
    expect(onOpenGrowth).toHaveBeenCalledTimes(1);
    cleanup();
    await mount(fakeApi());
    setNumber("시간", 1);
    await press("나누지 않고 저장");
    expect(screen.queryByRole("button", { name: /상태보기에서 보기/ })).toBeNull();
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

  it("저장 뒤 renderAfterSave가 「저장했어요」 아래 카드 자리를 맡는다(저장 결과·읽은 상태를 받는다)", async () => {
    await mount(fakeApi(), { renderAfterSave: (saved, s) => <p>카드 {saved.log.totalMinutes} {s.categories.length}</p> });
    setNumber("시간", 1);
    await press("나누지 않고 저장");
    const card = screen.getByText("카드 60 2");
    expect(screen.getByRole("heading", { name: "저장했어요" }).compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector(".after-save-card")).toBeNull(); // 기본 카드는 그리지 않는다
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
    expect(screen.getByRole("heading", { name: "저장했어요" })).toBeTruthy();
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
    expect(screen.queryByText("이미 남긴 기록이 있어요. 고쳐서 다시 저장할 수 있어요.")).toBeNull(); // PM d-174 ②: 설명 글을 지웠다(고쳐서 다시 저장하는 동작은 그대로)
    expect([wheelValue("시간"), wheelValue("분")]).toEqual([2, 30]);
    await press("분야마다 나누기");
    expect((screen.getByLabelText("어학") as HTMLInputElement).value).toBe("100");
    await press("저장");
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ totalMinutes: 150, saveMode: "prefilled" }));
  });

  it("체험 데이터의 오늘 기록 줄(PM 13)이 「이미 남긴 기록」으로 들어와도 깨지지 않고 그 값으로 열린다", async () => {
    const plan = buildDemoPlan("11111111-1111-4111-8111-111111111111", "2026-11-07");
    const log = plan.eveningLogs.find((l) => l.targetDay === "2026-11-07")!;
    expect(log).toBeTruthy();
    const ids = [C1, C2];
    const existing = {
      id: log.id,
      targetDay: log.targetDay,
      totalMinutes: log.totalMinutes,
      items: log.items.map((i) => ({ categoryId: i.categoryIndex === null ? null : ids[i.categoryIndex % 2], minutes: i.minutes })),
      saveMode: "edited" as const,
      savedAt: "x",
    };
    const api = fakeApi(state({ existing }));
    await mount(api);
    expect([wheelValue("시간"), wheelValue("분")]).toEqual([Math.floor(log.totalMinutes / 60), log.totalMinutes % 60]);
    expect(screen.getByRole("button", { name: "나누지 않고 저장" })).toBeTruthy();
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
    expect(wheelTotal()).toBe(120);
    expect(screen.queryByRole("heading", { name: "저장했어요" })).toBeNull(); // 실패면 저장 뒤 판으로 넘어가지 않는다
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
    expect(wheelTotal()).toBe(120);
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

  it("Esc와 머리 「‹」(시간 단계)로 닫힌다", async () => {
    const { onClose } = await mount(fakeApi());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "이전" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("분야 이름은 글자 그대로 보인다(칩·줄)", async () => {
    const evil = '<img src=x onerror="window.__e=1">';
    const api = fakeApi(state({ categories: [{ id: C1, name: evil }] }));
    await mount(api);
    setNumber("시간", 1);
    await press("분야마다 나누기");
    const chip = screen.getByRole("button", { name: `${evil}, 다이얼에 넣기` });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(chip.textContent).toBe(evil);
    await press(`${evil}, 다이얼에 넣기`);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText(evil)).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect((window as unknown as { __e?: number }).__e).toBeUndefined();
  });

  it("화면 머리·입구 글은 「오늘 기록」(PM 4). 「저녁 기록」 글이 없다", async () => {
    await mount(fakeApi());
    expect(screen.getByText("오늘 기록")).toBeTruthy();
    setNumber("시간", 1);
    await press("분야마다 나누기");
    expect(document.body.textContent).not.toContain("저녁 기록");
    expect(document.body.innerHTML).not.toContain("저녁 기록");
  });
});

describe("EveningEntry", () => {
  it("고침9 ⑬ 10: 입구 아래 「오늘 몇 시간 썼어요?」는 시간대와 상관없이 늘 보인다(고침 11: evening 값 없앰)", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<EveningEntry onOpen={onOpen} />);
    expect(screen.getByText("오늘 몇 시간 썼어요?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "오늘 기록 남기기" }));
    expect(onOpen).toHaveBeenCalled();
    // 고침10 E(50:72): 카드 전체가 하나의 단추(알약 「오늘 기록 남기기」는 없다). 이름 = 「오늘 기록 남기기」, 설명 = 질문 글, 오른쪽 「›」
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(document.querySelector(".entry-card .btn")).toBeNull();
    const card = screen.getByRole("button", { name: "오늘 기록 남기기" });
    expect(document.getElementById(card.getAttribute("aria-describedby")!)!.textContent).toBe("오늘 몇 시간 썼어요?");
    expect(card.querySelector(".entry-go")?.textContent).toBe("›");
    rerender(<EveningEntry onOpen={onOpen} />);
    expect(screen.getByText("오늘 몇 시간 썼어요?")).toBeTruthy(); // 옛판은 낮에 숨김 — Figma 50:28 · 50:52는 늘 보임
    expect(screen.getByRole("button", { name: "오늘 기록 남기기" })).toBeTruthy(); // 다시 그려도 같은 글
    expect(document.body.textContent).not.toContain("저녁 기록");
  });
});
