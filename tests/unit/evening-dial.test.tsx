// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EveningRecord } from "../../components/evening-record";
import { saveEveningLogForUser } from "../../lib/evening/core";
import type { EveningState } from "../../lib/evening/types";
import type { EveningApi, EveningSaveInput } from "../../lib/evening-api";
import { encryptCategoryName, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

/**
 * 저녁 기록 「분야마다 나누기」의 원형 다이얼(고침4 2단계). 원 전체 = 쓴 시간, 조각 = 분야마다 분, 맨 끝 = 기타.
 * 저장 요청은 진짜 저장 함수(saveEveningLogForUser, 가짜 DB)에 그대로 넣어 지금 검증을 지나는지 본다.
 */

const KEY = parseTodoKey(Buffer.alloc(32, 3).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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

/** 저장은 진짜 저장 함수(서버 검증 포함)를 가짜 DB 위에서 부른다 */
function realApi(s: EveningState = state()) {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const [id, name] of [[C1, "어학"], [C2, "포트폴리오"]] as const) {
    store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName(name, ME, KEY!), archived_at: null });
  }
  const sent: EveningSaveInput[] = [];
  const results: boolean[] = [];
  const api: EveningApi = {
    fetchState: vi.fn(async (day?: string) => ({ ok: true as const, data: { ...s, day: day ?? s.today } })),
    save: vi.fn(async (input: EveningSaveInput) => {
      sent.push(input);
      const res = await saveEveningLogForUser({ supabase: fakeTablesClient(store, { sub: ME }), key: KEY, now: () => NOW }, input);
      results.push(res.ok);
      return res;
    }),
  };
  return { api, sent, results };
}

async function mount(api: EveningApi) {
  const onClose = vi.fn();
  render(<EveningRecord api={api} now={() => NOW} onClose={onClose} />);
  await screen.findByRole("button", { name: "분야마다 나누기" });
  return { onClose };
}
const setNumber = (label: string, value: number) => fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });
const dial = () => document.querySelector("svg.dial") as unknown as HTMLElement | null;
const handle = (side: "start" | "end" | "both") => document.getElementById(`evening-dial-handle-${side}`)!;
const stepper = (name: string) => Number((screen.getByLabelText(name) as HTMLInputElement).value);
const otherText = () => document.querySelectorAll(".ratio-list .ratio-row")[2].querySelector(".ratio-value")!.textContent;

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 쓴 시간 2시간, 타이머 어학 30분, 끝낸 할 일 포트폴리오 → 미리 채움 어학 30 · 포트폴리오 90 · 기타 0 */
async function openSplit120() {
  const r = realApi(state({ doneCategoryIds: [C2], timerByCategory: [{ categoryId: C1, minutes: 30 }] }));
  const m = await mount(r.api);
  setNumber("시간", 2);
  setNumber("분", 0);
  await press("분야마다 나누기");
  return { ...r, ...m };
}

describe("저녁 기록 나누기 다이얼 (고침4 2단계)", () => {
  it("나누기 단계 위쪽에 다이얼이 있고, 미리 채운 값이 그대로 그려진다. 원 전체 = 쓴 시간, 다이얼과 Stepper가 같은 값", async () => {
    await openSplit120();
    const svg = dial()!;
    expect(svg).toBeTruthy();
    const list = document.querySelector("ul.ratio-list")!;
    expect(svg.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(2); // 기타 0분은 폭이 없다
    expect(stepper("어학")).toBe(30);
    expect(stepper("포트폴리오")).toBe(90);
    const end = handle("end"); // 처음에는 첫 분야(어학)를 고른다
    expect(end.getAttribute("aria-valuenow")).toBe("30");
    expect(end.getAttribute("aria-valuemax")).toBe("120");
    expect(end.getAttribute("aria-valuetext")).toBe("30분");
    expect(end.getAttribute("aria-label")).toContain("5분씩");
    expect(document.querySelector(".dial-center-value")!.textContent).toBe("30분");
    // 아무것도 안 골랐을 때 가운데 표시 = 쓴 시간
    key(svg, "ArrowLeft"); // 첫 조각에서 더 앞은 없다 — 고름이 그대로
    fireEvent.click(document.querySelectorAll(".dial-slice")[0]); // 고른 조각을 다시 누르면 고름이 풀린다
    expect(document.querySelector(".dial-center-value")!.textContent).toBe("2시간");
  });

  it("다이얼로 바꾼 값이 Stepper·기타 줄과 저장 요청에 그대로 가고, 지금 저장 검증을 지난다. 기타와 이웃한 경계를 움직이면 기타가 늘고 준다", async () => {
    const { sent, results } = await openSplit120();
    const svg = dial()!;
    key(svg, "ArrowRight"); // 포트폴리오 고름
    expect(document.getElementById("evening-dial-changes")!.textContent).toBe("포트폴리오 고름, 1시간 30분");
    key(handle("end"), "PageDown"); // 포트폴리오·기타 경계: 포트폴리오 −30분 → 기타 +30분
    expect(stepper("포트폴리오")).toBe(60);
    expect(otherText()).toBe("30분");
    expect(document.getElementById("evening-dial-changes")!.textContent).toBe("포트폴리오 1시간 30분 → 1시간, 기타 0분 → 30분");
    key(handle("end"), "ArrowRight"); // +5분(기타에서)
    expect(stepper("포트폴리오")).toBe(65);
    expect(otherText()).toBe("25분");
    key(handle("start"), "ArrowRight"); // 어학·포트폴리오 경계: 포트폴리오 +5분(어학에서)
    expect(stepper("어학")).toBe(25);
    expect(stepper("포트폴리오")).toBe(70);
    await press("저장");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      totalMinutes: 120,
      items: [{ categoryId: C1, minutes: 25 }, { categoryId: C2, minutes: 70 }, { categoryId: null, minutes: 25 }],
      saveMode: "edited",
    });
    expect(results).toEqual([true]); // 지금 저장 검증(합 = 총시간, 0~1440 정수, 분야 한 번씩)을 그대로 지났다
  });

  it("나눈 합은 쓴 시간을 넘지 못한다: 다이얼로 끝까지 밀어도 기타가 0에서 멈추고, Stepper도 그 이상 못 늘린다", async () => {
    const { sent, results } = await openSplit120();
    key(dial()!, "End"); // 기타 고름
    const start = handle("start");
    key(start, "End"); // 기타가 포트폴리오를 다 가져간다
    expect(stepper("포트폴리오")).toBe(0);
    expect(otherText()).toBe("1시간 30분");
    key(dial()!, "Home"); // 어학 고름
    key(handle("end"), "End"); // 어학이 바로 뒤(포트폴리오 0)에서 더 가져올 것이 없다 → 그대로
    expect(stepper("어학")).toBe(30);
    setNumber("어학", 500); // Stepper 숫자 칸: 기타에 남은 만큼(90)까지만
    expect(stepper("어학")).toBe(120);
    expect(otherText()).toBe("0분");
    expect((screen.getByRole("button", { name: "포트폴리오 5분 늘리기" }) as HTMLButtonElement).disabled).toBe(true);
    setNumber("어학", -20);
    expect(stepper("어학")).toBe(0);
    setNumber("어학", 45);
    await press("저장");
    expect(sent[0].totalMinutes).toBe(120);
    const sum = sent[0].items.reduce((s, i) => s + i.minutes, 0);
    expect(sum).toBe(120);
    expect(sent[0].items.every((i) => Number.isInteger(i.minutes) && i.minutes >= 0)).toBe(true);
    expect(results).toEqual([true]);
  });

  it("쓴 시간이 0분이면 다이얼을 그리지 않는다(Stepper는 그대로)", async () => {
    await mount(realApi().api);
    await press("분야마다 나누기");
    expect(screen.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeTruthy();
    expect(dial()).toBeNull();
    expect(screen.getByLabelText("어학")).toBeTruthy();
  });

  it("앞 단계로 돌아가 쓴 시간을 고치면: 고친 적이 없으면 새 쓴 시간으로 다시 미리 채운다(저장 방식 prefilled)", async () => {
    const { sent } = await openSplit120();
    await press("이전");
    setNumber("시간", 1); // 60분: 타이머 30은 어학, 나머지 30은 포트폴리오
    await press("분야마다 나누기");
    expect(stepper("어학")).toBe(30);
    expect(stepper("포트폴리오")).toBe(30);
    expect(handle("end").getAttribute("aria-valuemax")).toBe("60");
    await press("저장");
    expect(sent[0]).toMatchObject({ totalMinutes: 60, saveMode: "prefilled" });
  });

  it("고친 뒤 쓴 시간을 고치면 비율을 지키며 5분 단위로 다시 나누고 남는 것은 기타(나눈 합 ≤ 쓴 시간)", async () => {
    const { sent, results } = await openSplit120();
    key(dial()!, "ArrowRight");
    key(handle("end"), "PageDown"); // 어학 30 · 포트폴리오 60 · 기타 30
    await press("이전");
    setNumber("시간", 1); // 120 → 60분
    await press("분야마다 나누기");
    expect(stepper("어학")).toBe(15);
    expect(stepper("포트폴리오")).toBe(30);
    expect(otherText()).toBe("15분");
    await press("저장");
    expect(sent[0]).toMatchObject({
      totalMinutes: 60,
      items: [{ categoryId: C1, minutes: 15 }, { categoryId: C2, minutes: 30 }, { categoryId: null, minutes: 15 }],
    });
    expect(results).toEqual([true]);
  });

  it("쓴 시간이 5의 배수가 아닐 때(62분): 나눈 값은 5분 단위, 남는 2분은 기타. 끝까지 밀면 기타 2분까지 다 가져갈 수 있다", async () => {
    const { sent, results } = await openSplit120();
    key(dial()!, "ArrowRight");
    key(handle("end"), "PageDown"); // 30 · 60 · 기타 30
    await press("이전");
    setNumber("시간", 1);
    setNumber("분", 2); // 62분
    await press("분야마다 나누기");
    expect(stepper("어학")).toBe(15);
    expect(stepper("포트폴리오")).toBe(30);
    expect(otherText()).toBe("17분");
    expect(handle("end").getAttribute("aria-valuenow")).toBe("30"); // 고른 조각(포트폴리오)은 단계를 오가도 그대로
    key(handle("end"), "ArrowRight"); // 30 → 35 (5분 단위)
    expect(stepper("포트폴리오")).toBe(35);
    key(handle("end"), "End"); // 기타 12분을 다 가져간다
    expect(stepper("포트폴리오")).toBe(47);
    expect(otherText()).toBe("0분");
    await press("저장");
    expect(sent[0].totalMinutes).toBe(62);
    expect(sent[0].items.reduce((s, i) => s + i.minutes, 0)).toBe(62);
    expect(results).toEqual([true]);
  });

  it("이미 남긴 기록: 그 값이 다이얼에 그려지고, 쓴 시간을 줄이면 비율을 지켜 다시 나눈다", async () => {
    const existing = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      targetDay: "2026-11-07",
      totalMinutes: 150,
      items: [{ categoryId: C1, minutes: 100 }, { categoryId: null, minutes: 50 }],
      saveMode: "edited" as const,
      savedAt: "x",
    };
    const { api, sent, results } = realApi(state({ existing }));
    await mount(api);
    await press("분야마다 나누기");
    expect(handle("end").getAttribute("aria-valuenow")).toBe("100");
    expect(handle("end").getAttribute("aria-valuemax")).toBe("150");
    await press("이전");
    setNumber("시간", 1);
    setNumber("분", 0); // 150 → 60
    await press("분야마다 나누기");
    expect(stepper("어학")).toBe(40);
    expect(otherText()).toBe("20분");
    await press("저장");
    expect(sent[0]).toMatchObject({ totalMinutes: 60, items: [{ categoryId: C1, minutes: 40 }, { categoryId: null, minutes: 20 }] });
    expect(results).toEqual([true]);
  });

  it("키보드만으로: 다이얼에서 조각을 고르고 손잡이로 바꾼다. 다이얼·손잡이에서 Esc를 누르면 창이 닫힌다(창 닫기 규칙 그대로)", async () => {
    const { onClose } = await openSplit120();
    const svg = dial()!;
    act(() => svg.focus());
    expect(document.activeElement).toBe(svg);
    key(svg, "ArrowRight");
    key(handle("start"), "PageUp"); // 포트폴리오 +30분(어학에서)
    expect(stepper("어학")).toBe(0);
    expect(stepper("포트폴리오")).toBe(120);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(handle("start"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("분야 9개 이상·긴 이름·꺾쇠도 다이얼이 깨지지 않고 글로 나온다", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}c${i}c${i}c${i}-0000-4000-8000-00000000000${i}`, name: i === 0 ? "<img src=x onerror=alert(1)>" : `아주긴분야이름${i}번째입니다` }));
    const { api } = realApi(state({ categories: many, doneCategoryIds: many.map((c) => c.id) }));
    await mount(api);
    setNumber("시간", 10);
    await press("분야마다 나누기");
    expect(document.querySelectorAll(".dial-slice").length).toBeGreaterThanOrEqual(10);
    expect(document.querySelector("img")).toBeNull();
    expect(handle("end").getAttribute("aria-label")).toContain("<img src=x onerror=alert(1)>");
  });
});
