// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 기기 먼저 저장 API(lib/local/apis)가 부르는 서버 Action은 시험에서 쓰지 않는다(local-apis.test.ts와 같은 가짜)
vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(), dismissOffer: vi.fn() }));
vi.mock("../../lib/push/subscribe", () => ({ defaultPushApi: { enable: vi.fn(async () => "ok") } }));

import { EveningRecord } from "../../components/evening-record";
import { createLocalApis } from "../../lib/local/apis";
import { createMemoryKv, kvKeys } from "../../lib/local/kv";
import { emptyMirror } from "../../lib/local/reduce";
import { createRuntime } from "../../lib/local/runtime";
import type { Mirror, QueuedOp, SendResult } from "../../lib/local/types";
import { saveEveningLogForUser } from "../../lib/evening/core";
import type { EveningState } from "../../lib/evening/types";
import type { EveningApi, EveningSaveInput } from "../../lib/evening-api";
import { encryptCategoryName, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";
import { setNumberField } from "./time-wheel-helpers";

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
/** 「시간」「분」은 두 줄 휠의 숫자 바로 쓰기(고침9), 그 밖(분야 줄)은 숫자 칸 */
const setNumber = setNumberField;
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });
const dial = () => document.querySelector("svg.dial") as unknown as HTMLElement | null;
const handle = (side: "start" | "end" | "both") => document.getElementById(`evening-dial-handle-${side}`)!;
const stepper = (name: string) => Number((screen.getByLabelText(name) as HTMLInputElement).value);
const otherText = () => document.querySelector('.ratio-list [data-row-key="other"] .ratio-value')!.textContent;

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 쓴 시간 2시간, 타이머 어학 30분, 끝낸 할 일 포트폴리오 → 처음 값 어학 30(타이머) · 포트폴리오 30(체크 칩, 기타에서 30분) · 기타 60 (고침 5바퀴 d-115 나·d-116 가) */
async function openSplit120() {
  const r = realApi(state({ doneCategoryIds: [C2], timerByCategory: [{ categoryId: C1, minutes: 30 }] }));
  const m = await mount(r.api);
  setNumber("시간", 2);
  setNumber("분", 0);
  await press("분야마다 나누기");
  return { ...r, ...m };
}

describe("저녁 기록 나누기 다이얼 (고침4 2단계)", () => {
  it("나누기 단계 위쪽에 다이얼이 있고, 처음 값이 그대로 그려진다. 원 전체 = 쓴 시간, 다이얼과 Stepper가 같은 값", async () => {
    await openSplit120();
    const svg = dial()!;
    expect(svg).toBeTruthy();
    const list = document.querySelector("ul.ratio-list")!;
    expect(svg.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(3); // 어학 · 포트폴리오 · 기타
    expect(stepper("어학")).toBe(30);
    expect(stepper("포트폴리오")).toBe(30);
    expect(otherText()).toBe("1시간");
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
    expect(document.getElementById("evening-dial-changes")!.textContent).toBe("포트폴리오 30분, 고름");
    key(handle("end"), "PageUp"); // 포트폴리오·기타 경계: 포트폴리오 +30분 ← 기타 −30분
    expect(stepper("포트폴리오")).toBe(60);
    expect(otherText()).toBe("30분");
    expect(document.getElementById("evening-dial-changes")!.textContent).toBe("포트폴리오 30분 → 1시간, 기타 1시간 → 30분");
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
    // 고침6 PM d-129 ②: 손잡이는 0분 조각(포트폴리오)을 건너뛰어 어학·기타 사이에 선다(옛 규칙은 어학·포트폴리오 0 사이라 그대로였다)
    expect(handle("end").getAttribute("aria-label")).toContain("어학·기타 사이");
    key(handle("end"), "PageUp"); // 어학 +30분 ← 기타(포트폴리오 0은 0 그대로)
    expect(stepper("어학")).toBe(60);
    expect(stepper("포트폴리오")).toBe(0);
    expect(otherText()).toBe("1시간");
    key(handle("end"), "End"); // 기타를 다 가져가도 기타 0에서 멈춘다
    expect(stepper("어학")).toBe(120);
    expect(otherText()).toBe("0분");
    expect(screen.queryAllByRole("slider")).toHaveLength(0); // 0분 아닌 조각이 어학 하나 — 손잡이가 없다(12시에도)
    setNumber("어학", 30); // Stepper로 줄이면 기타로 돌아간다
    expect(otherText()).toBe("1시간 30분");
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

  it("쓴 시간이 0분이면 다이얼을 그리지 않는다(칩과 Stepper는 그대로 — 칩을 고르면 0분 줄)", async () => {
    await mount(realApi().api);
    await press("분야마다 나누기");
    expect(screen.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeTruthy();
    expect(dial()).toBeNull();
    expect(screen.queryByLabelText("어학")).toBeNull(); // 고르지 않은 분야는 줄이 없다
    await press("어학, 다이얼에 넣기");
    expect(stepper("어학")).toBe(0);
    expect(dial()).toBeNull();
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
    key(handle("end"), "PageUp"); // 어학 30 · 포트폴리오 60 · 기타 30
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

  it("쓴 시간이 5의 배수가 아닐 때(타이머가 62분을 채움 — 고침9 휠은 손으로 5분 단위만 쓴다): 휠은 1시간 02분을 그대로 보이고, 나눈 값은 5분 단위, 남는 2분은 기타. 끝까지 밀면 기타 2분까지 다 가져갈 수 있다", async () => {
    const { sent, results } = await (async () => {
      const r = realApi(state({ timerByCategory: [{ categoryId: null, minutes: 62 }] }));
      await mount(r.api);
      return r;
    })();
    expect(screen.getByRole("spinbutton", { name: "시간" }).getAttribute("aria-valuenow")).toBe("1");
    expect(screen.getByRole("spinbutton", { name: "분" }).getAttribute("aria-valuenow")).toBe("2");
    expect(screen.getByRole("spinbutton", { name: "분" }).querySelector(".time-wheel-center")!.textContent).toBe("02");
    await press("분야마다 나누기");
    expect(otherText()).toBe("1시간 2분"); // 기타 100%
    await press("어학, 다이얼에 넣기"); // 기타에서 30분
    await press("포트폴리오, 다이얼에 넣기"); // 기타에서 30분 → 기타 2분
    expect(stepper("어학")).toBe(30);
    expect(stepper("포트폴리오")).toBe(30);
    expect(otherText()).toBe("2분");
    expect(handle("start").getAttribute("aria-valuenow")).toBe("30"); // 고른 조각(포트폴리오, 마지막으로 고른 칩)
    key(handle("end"), "End"); // 기타 2분을 다 가져간다(5분 걸음이어도 끝은 끝값)
    expect(stepper("포트폴리오")).toBe(32);
    expect(otherText()).toBe("0분");
    await press("저장");
    expect(sent[0].totalMinutes).toBe(62);
    expect(sent[0].items).toEqual([{ categoryId: C1, minutes: 30 }, { categoryId: C2, minutes: 32 }]);
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

  it("키보드만으로: 다이얼에서 조각을 고르고 손잡이로 바꾼다. 다이얼·손잡이에서 Esc를 누르면 창 닫기 규칙을 탄다(값을 바꿨으니 닫기 전 확인, PM d-126)", async () => {
    const { onClose } = await openSplit120();
    const svg = dial()!;
    act(() => svg.focus());
    expect(document.activeElement).toBe(svg);
    key(svg, "ArrowRight");
    act(() => handle("start").focus());
    key(handle("start"), "PageUp"); // 포트폴리오 +30분(어학에서)
    expect(stepper("어학")).toBe(0);
    expect(stepper("포트폴리오")).toBe(60);
    // 고침6 PM d-129 ②: 어학이 0분이라 앞 경계가 12시에 닿아 앞 손잡이가 사라진다 → 포커스는 같은 조각의 남은 손잡이(포트폴리오·기타)로
    expect(document.getElementById("evening-dial-handle-start")).toBeNull();
    expect(document.activeElement).toBe(handle("end"));
    expect(handle("end").getAttribute("aria-label")).toContain("포트폴리오·기타 사이");
    expect(onClose).not.toHaveBeenCalled();
    // 손잡이에서 Esc: 바꾼 값이 있으니 확인이 뜬다(창은 아직 닫히지 않는다). 확인에서 Esc = 계속 적기
    fireEvent.keyDown(handle("end"), { key: "Escape" });
    const confirm = screen.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(stepper("포트폴리오")).toBe(60);
    // 다이얼에서 Esc: 다시 같은 확인 → 「나가기」면 창이 닫힌다(PM d-135 글)
    fireEvent.keyDown(svg, { key: "Escape" });
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "나가기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
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

describe("저녁 나누기 다이얼: 다이얼 고침1", () => {
  it("끝까지 밀어 손잡이가 사라진 뒤(포커스는 다이얼로) Stepper에 쳐도 포커스가 다이얼·손잡이로 안 간다", async () => {
    await openSplit120();
    const end = handle("end"); // 어학·포트폴리오 경계
    act(() => end.focus());
    key(end, "End"); // 어학이 포트폴리오를 다 가져간다
    expect(stepper("어학")).toBe(60);
    expect(stepper("포트폴리오")).toBe(0);
    // 고침6 PM d-129 ②: 끝 손잡이는 0분 포트폴리오를 건너뛰어 어학·기타 사이로 옮겨 서고, 포커스가 그 손잡이에 있다
    expect(document.activeElement).toBe(handle("end"));
    expect(handle("end").getAttribute("aria-label")).toContain("어학·기타 사이");
    key(handle("end"), "End"); // 어학이 기타까지 다 가져간다 → 0분 아닌 조각이 하나라 손잡이가 없다
    expect(stepper("어학")).toBe(120);
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
    expect(document.activeElement).toBe(dial()); // 포커스를 잃지 않고 다이얼(원 전체)로
    key(dial()!, "End"); // 다이얼 키: 기타 고름(값은 그대로)
    expect(stepper("어학")).toBe(120);
    const input = screen.getByLabelText("포트폴리오") as HTMLInputElement;
    act(() => input.focus());
    // 어학을 줄여 기타에 자리를 만든 뒤 포트폴리오에 친다 — 칠 때마다 다이얼이 다시 그려진다
    // (단추를 눌러도 포커스는 숫자 칸에 둔 채로 다시 그린다 — 여기서 손잡이로 가면 안 된다)
    fireEvent.click(screen.getByRole("button", { name: "어학 5분 줄이기" }));
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "5" } });
    expect(stepper("포트폴리오")).toBe(5);
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "0" } });
    expect(document.activeElement).toBe(input);
  });

  it("숨은 분야(이미 남긴 기록에만 있는 분야)가 쓴 시간을 다 차지해 원의 합이 0이어도 띠가 NaN을 그리지 않는다", async () => {
    const HIDDEN = "c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9";
    const existing = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      targetDay: "2026-11-07",
      totalMinutes: 60,
      items: [{ categoryId: HIDDEN, minutes: 60 }],
      saveMode: "edited" as const,
      savedAt: "x",
    };
    const { api } = realApi(state({ existing }));
    await mount(api);
    await press("분야마다 나누기");
    const svg = dial()!;
    expect(svg).toBeTruthy();
    expect(document.querySelector(".dial-glow")).toBeNull(); // 고른 조각 표시(나옴·빛)도 없다
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(0);
    expect(svg.outerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("기기 먼저 저장 + 끊김: 다이얼로 나눈 값이 기기 쪽 저장 요청(보낼 줄)에 그대로 실리고, 서버에는 아직 안 간다", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const mirror: Mirror = {
      ...emptyMirror(),
      synced: true,
      categories: [
        { id: C1, readable: true, name: "어학", createdAt: "2026-11-01T00:00:00.000Z" },
        { id: C2, readable: true, name: "포트폴리오", createdAt: "2026-11-01T00:00:00.000Z" },
      ],
    };
    const kv = createMemoryKv();
    await kv.set(kvKeys.base(USER), mirror);
    const sent: QueuedOp[] = [];
    const send = vi.fn(async (q: QueuedOp): Promise<SendResult> => {
      sent.push(q);
      return { ok: true };
    });
    const runtime = createRuntime({ userKey: USER, kv, send, fetchSnapshot: async () => ({ ok: false, error: "unavailable" }), now: () => NOW.getTime(), online: () => false });
    await runtime.boot();
    const apis = createLocalApis(runtime);
    expect(apis.evening.localFirst).toBe(true);
    await mount(apis.evening);
    expect(screen.queryByText("인터넷에 연결되면 저장할 수 있어요. 넣은 값은 그대로 있어요.")).toBeNull(); // 기기 먼저 저장은 끊겨도 막지 않는다
    setNumber("시간", 2);
    await press("분야마다 나누기");
    expect(screen.queryByLabelText("어학")).toBeNull(); // 처음 값 = 기타 100%(고른 칩 없음)
    expect(otherText()).toBe("2시간");
    // 칩으로 넣고(각 30분) 다이얼(키보드)로 나눈다: 포트폴리오 고름 → 기타 쪽 손잡이 PageUp(+30분) → 어학 고름 → 끝 손잡이 PageUp(+30분, 포트폴리오에서) → 다시 포트폴리오 끝 PageUp
    await press("포트폴리오, 다이얼에 넣기");
    await press("어학, 다이얼에 넣기");
    expect(stepper("어학")).toBe(30);
    expect(stepper("포트폴리오")).toBe(30);
    key(dial()!, "ArrowRight"); // 어학 → 포트폴리오
    key(handle("end"), "PageUp"); // 포트폴리오 60 · 기타 30
    key(dial()!, "Home");
    key(handle("end"), "PageUp"); // 어학 60 · 포트폴리오 30
    key(handle("end"), "PageDown"); // 어학 30 · 포트폴리오 60
    key(dial()!, "ArrowRight");
    key(handle("end"), "PageDown"); // 포트폴리오 30 · 기타 60
    expect(stepper("어학")).toBe(30);
    expect(stepper("포트폴리오")).toBe(30);
    expect(otherText()).toBe("1시간");
    await press("저장");
    expect(screen.getByRole("heading", { name: "저장했어요" })).toBeTruthy();
    const op = runtime.pendingOps().at(-1)?.op;
    expect(op).toMatchObject({
      kind: "evening.save",
      input: {
        totalMinutes: 120,
        items: [{ categoryId: C1, minutes: 30 }, { categoryId: C2, minutes: 30 }, { categoryId: null, minutes: 60 }],
        saveMode: "edited",
      },
    });
    expect(sent).toHaveLength(0); // 끊겨 있어 서버에는 아직 보내지 않았다
  });
});

/**
 * 고침 5바퀴(PM 10 — d-114 가 · d-115 나 · d-116 가): 칩 = 다이얼에 넣을 분야 고르기. 다이얼과 아래 줄 = 고른 분야 + 맨 끝 기타.
 * 저장은 진짜 저장 함수(서버 검증 포함)를 가짜 DB 위에서 부른다.
 */
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const chip = (name: string) => screen.getByRole("button", { name: `${name}, 다이얼에 넣기` });
const pressed = (name: string) => chip(name).getAttribute("aria-pressed");
const rowKeys = () => [...document.querySelectorAll(".ratio-list li")].map((li) => li.getAttribute("data-row-key"));
const pickedRow = () => document.querySelector(".ratio-list li.is-picked")?.getAttribute("data-row-key") ?? null;
const sliceLabels = () => [...document.querySelectorAll(".dial-slice")].map((p) => p.getAttribute("aria-label"));
const minutesOf = (text: string) => {
  const h = /(\d+)시간/.exec(text);
  const m = /(\d+)분/.exec(text);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
};
/** 화면에 보이는 나눈 값: 고른 분야 Stepper 값 + 기타 줄 */
const screenItems = (names: Record<string, string>) => {
  const out: { categoryId: string | null; minutes: number }[] = [];
  for (const [id, name] of Object.entries(names)) {
    const input = screen.queryByLabelText(name) as HTMLInputElement | null;
    if (input && Number(input.value) > 0) out.push({ categoryId: id, minutes: Number(input.value) });
  }
  const other = minutesOf(otherText()!);
  if (other > 0) out.push({ categoryId: null, minutes: other });
  return out;
};
const NAMES = { [C1]: "어학", [C2]: "포트폴리오" };

async function openWith(s: EveningState, hours: number, mins = 0) {
  const r = realApi(s);
  const m = await mount(r.api);
  setNumber("시간", hours);
  setNumber("분", mins);
  await press("분야마다 나누기");
  return { ...r, ...m };
}

describe("오늘 기록 나누기: 칩으로 고른 분야만 다이얼에 (고침 5바퀴, PM 10)", () => {
  it("처음 값: 기타 100% — 고른 칩 없음, 줄은 기타뿐, 조각 하나에 손잡이 없음, 가운데 「{합계}」「기타」. 이름표·기타 줄·안내 글이 보인다", async () => {
    await openWith(state(), 2);
    expect(pressed("어학")).toBe("false");
    expect(pressed("포트폴리오")).toBe("false");
    expect(rowKeys()).toEqual(["other"]);
    expect(otherText()).toBe("2시간");
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(1);
    expect((document.querySelector(".dial-slice") as SVGElement).style.fill).toBe("var(--color-category-other)");
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
    expect(document.querySelector(".dial-glow")).toBeNull(); // 원을 다 채운 조각은 나오지 않는다
    expect(document.querySelector(".dial-center-value")!.textContent).toBe("2시간");
    expect(document.querySelector(".dial-center-name")!.textContent).toBe("기타");
    // 이름표 「분야 · 여러 개」(창구 덧붙임 11:3x)가 칩 줄의 이름이다
    const label = screen.getByText("분야 · 여러 개");
    const row = chip("어학").closest(".chip-row")!;
    expect(row.getAttribute("aria-labelledby")).toBe(label.id);
    expect(row.getAttribute("role")).toBe("group");
    // 기타 줄: 이름 「기타」 한 줄뿐(고침6 PM d-129 ③ · PM d-130 가 — 이름 아래 「나누지 않은 시간」은 뺐다. 같은 말이 안내 글과 두 번 나오지 않는다)
    const otherRow = document.querySelector('.ratio-list [data-row-key="other"]')!;
    expect(otherRow.querySelector(".evening-other-sub")).toBeNull();
    expect(otherRow.querySelector(".ratio-name")!.textContent).toBe("기타");
    expect(otherRow.querySelector(".ratio-name")!.children).toHaveLength(0);
    expect(screen.getAllByText(/나누지 않은 시간/)).toHaveLength(1); // 안내 글 하나뿐
    // 이름은 줄 가운데: 줄은 가운데 정렬 flex, 이름을 두 줄 세로 칸으로 만들던 규칙은 없다
    const css0 = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css0).toMatch(/\.ratio-row \{ display: flex; align-items: center;/);
    expect(css0).not.toMatch(/\.evening-other-name \{/);
    expect(css0).not.toMatch(/\.evening-other-sub/);
    // 안내 글(고침6 PM d-129 ③): 「나누지 않은 시간은 기타로 들어가요.」 한 줄만, 분야 줄(목록) 아래 · 합계 위. 앞 문장은 없다
    const hint = screen.getByText("나누지 않은 시간은 기타로 들어가요.");
    expect(hint.className).toBe("evening-split-hint");
    expect(screen.queryByText(/미리 채운 값을 확인하고 고쳐요/)).toBeNull();
    const list = document.querySelector("ul.ratio-list")!;
    expect(list.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hint.previousElementSibling).toBe(list);
    // 고침9(Figma 87:2): 안내 글이 흰 카드의 끝이고, 맨 아래 「합계」 줄은 없다 — 합계는 제목 같은 줄 오른쪽(12 보조)
    expect(hint.nextElementSibling).toBeNull();
    expect(hint.parentElement!.className).toBe("card-box evening-split-card");
    const total = screen.getByText("합계 2시간");
    expect(total.className).toBe("evening-split-total");
    expect(total.previousElementSibling!.textContent).toBe("분야마다 나눠 주세요");
    expect(screen.getAllByText(/^합계/)).toHaveLength(1);
    // 12 보조 글: CSS 규칙(글자 크기 0.75rem = 12, 보조 색 토큰)
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toMatch(/\.evening-split-hint \{[^}]*font: 400 0\.75rem\/1rem var\(--font-family\);[^}]*color: var\(--color-text-sub\);/);
    expect(screen.getByText("합계 2시간")).toBeTruthy();
  });

  it("타이머로 잰 분야만 칩이 골라지고 그 시간만큼 채운다. 그 조각이 골라져 있다(손잡이·줄 바탕)", async () => {
    await openWith(state({ timerByCategory: [{ categoryId: C1, minutes: 45 }] }), 2);
    expect(pressed("어학")).toBe("true");
    expect(pressed("포트폴리오")).toBe("false");
    expect(rowKeys()).toEqual([C1, "other"]);
    expect(stepper("어학")).toBe(45);
    expect(otherText()).toBe("1시간 15분");
    expect(sliceLabels()).toEqual(["어학 45분, 고름", "기타 1시간 15분"]);
    expect(handle("end").getAttribute("aria-valuenow")).toBe("45");
    expect(pickedRow()).toBe(C1);
    expect(document.querySelectorAll(".dial-glow")).toHaveLength(1);
  });

  it("칩을 고르면 기타에서 30분을 떼어 조각이 생기고 그 조각이 골라진다. 합은 그대로. 색은 고른 순서가 아니라 분야 순서", async () => {
    await openWith(state(), 2);
    await press("포트폴리오, 다이얼에 넣기");
    expect(pressed("포트폴리오")).toBe("true");
    expect(chip("포트폴리오").querySelector(".chip-check")).toBeTruthy(); // 고른 칩 = 체크
    expect(chip("어학").querySelector(".chip-check")).toBeNull();
    expect(stepper("포트폴리오")).toBe(30);
    expect(otherText()).toBe("1시간 30분");
    expect(screen.getByText("합계 2시간")).toBeTruthy();
    expect(rowKeys()).toEqual([C2, "other"]);
    expect(pickedRow()).toBe(C2);
    expect(handle("end").getAttribute("aria-valuenow")).toBe("30");
    expect(handle("end").getAttribute("aria-label")).toContain("포트폴리오·기타");
    const fills = [...document.querySelectorAll(".dial-slice")].map((p) => (p as SVGElement).style.fill);
    expect(fills).toEqual(["var(--color-category-2)", "var(--color-category-other)"]); // 포트폴리오는 두 번째 분야 → 2번 색
    await press("어학, 다이얼에 넣기");
    expect(rowKeys()).toEqual([C1, C2, "other"]); // 다이얼·줄은 분야 순서(만든 순서), 기타 맨 끝
    expect(sliceLabels()).toEqual(["어학 30분, 고름", "포트폴리오 30분", "기타 1시간"]);
  });

  it("기타가 30분보다 적으면 기타 전부를 뗀다. 칩을 풀면 그 시간이 기타로 돌아가고 조각·줄이 사라진다. 합은 늘 그대로", async () => {
    await openWith(state(), 0, 40);
    await press("어학, 다이얼에 넣기");
    expect(stepper("어학")).toBe(30);
    await press("포트폴리오, 다이얼에 넣기");
    expect(stepper("포트폴리오")).toBe(10); // 기타 10분 전부
    expect(otherText()).toBe("0분");
    expect(screen.getByText("합계 40분")).toBeTruthy();
    await press("어학, 다이얼에 넣기"); // 풀기
    expect(pressed("어학")).toBe("false");
    expect(screen.queryByLabelText("어학")).toBeNull();
    expect(rowKeys()).toEqual([C2, "other"]);
    expect(otherText()).toBe("30분");
    expect(sliceLabels().some((l) => l!.startsWith("어학"))).toBe(false);
    expect(screen.getByText("합계 40분")).toBeTruthy();
    await press("포트폴리오, 다이얼에 넣기"); // 다 풀면 기타 100%
    expect(rowKeys()).toEqual(["other"]);
    expect(otherText()).toBe("40분");
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
    expect(document.querySelector(".dial-center-name")!.textContent).toBe("기타");
  });

  it("기타가 0분일 때 고른 칩은 0분 줄로만 보이고, 다이얼에는 칠하지 않으며 고름을 옮기지 않는다(12시에 0분 조각·손잡이가 새로 서지 않는다)", async () => {
    const cats = [{ id: C1, name: "어학" }, { id: C2, name: "포트폴리오" }, { id: C3, name: "운동" }];
    await openWith(state({ categories: cats }), 1);
    await press("포트폴리오, 다이얼에 넣기");
    await press("운동, 다이얼에 넣기"); // 기타 0분
    expect(otherText()).toBe("0분");
    expect(pickedRow()).toBe(C3);
    const before = screen.getAllByRole("slider").map((h) => h.getAttribute("aria-label"));
    await press("어학, 다이얼에 넣기"); // 0분 — 다이얼 순서상 맨 앞(12시)
    expect(pressed("어학")).toBe("true");
    expect(stepper("어학")).toBe(0);
    expect(rowKeys()).toEqual([C1, C2, C3, "other"]);
    expect(sliceLabels()).toEqual(["포트폴리오 30분", "운동 30분, 고름"]); // 0분 조각은 칠하지 않는다
    expect(pickedRow()).toBe(C3); // 고름이 그대로
    expect(document.getElementById("evening-dial-handle-both")).toBeNull();
    const after = screen.getAllByRole("slider").map((h) => h.getAttribute("aria-label"));
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((l) => l!.includes("어학"))).toBe(false); // 0분 어학 쪽 손잡이 없음
    expect(after).toEqual(before);
    expect(screen.getByText("합계 1시간")).toBeTruthy();
  });

  it("조각 고르기는 조각이나 아래 줄을 눌러서: 고른 줄 = 연한 면 바탕 + 이름 Bold, 고른 조각 = 「…, 고름」 + 나옴 + 손잡이. 칩은 고름을 바꾸지 않는다", async () => {
    await openSplit120(); // 어학 30 · 포트폴리오 30 · 기타 60, 어학 고름
    expect(pickedRow()).toBe(C1);
    fireEvent.click(document.querySelector(`.ratio-list [data-row-key="${C2}"]`)!);
    expect(pickedRow()).toBe(C2);
    expect(sliceLabels()).toEqual(["어학 30분", "포트폴리오 30분, 고름", "기타 1시간"]);
    expect(document.querySelectorAll(".dial-slice")[1].getAttribute("class")).toContain("is-picked");
    expect(handle("start").getAttribute("aria-valuenow")).toBe("30");
    fireEvent.click(document.querySelectorAll(".dial-slice")[2]); // 기타 조각
    expect(pickedRow()).toBe("other");
    expect(handle("start").getAttribute("aria-label")).toContain("기타");
    fireEvent.click(document.querySelectorAll(".dial-slice")[0]); // 어학 조각
    expect(pickedRow()).toBe(C1);
    // 줄 안에 포커스가 가도(키보드) 그 조각이 골라진다
    act(() => (screen.getByLabelText("포트폴리오") as HTMLInputElement).focus());
    expect(pickedRow()).toBe(C2);
    // 줄 바탕·Bold는 CSS(연한 면 토큰)
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toMatch(/\.evening-row\.is-picked \{ background: var\(--color-notice-bg\); \}/);
    expect(css).toMatch(/\.evening-row\.is-picked \.stepper-label, \.evening-row\.is-picked \.ratio-name \{ font-weight: 700; \}/);
    expect(css).toMatch(/\.evening-chips \.chip\[aria-pressed="true"\] \.chip-face \{[^}]*border: 2px solid var\(--color-primary\)/);
  });

  it("저장 요청 items가 화면 값(Stepper·기타 줄)과 같고 지금 저장 검증을 지난다", async () => {
    const { sent, results } = await openSplit120();
    await press("포트폴리오, 다이얼에 넣기"); // 풀기 → 기타 90
    fireEvent.click(screen.getByRole("button", { name: "어학 5분 늘리기" }));
    key(dial()!, "End"); // 기타 고름
    key(handle("start"), "PageUp"); // 기타 +30(어학에서)
    await press("포트폴리오, 다이얼에 넣기"); // 다시 고름 → 30분
    const shown = screenItems(NAMES);
    expect(shown.reduce((s, i) => s + i.minutes, 0)).toBe(120);
    await press("저장");
    expect(sent).toHaveLength(1);
    expect(sent[0].items).toEqual(shown);
    expect(sent[0].items).toEqual([{ categoryId: C1, minutes: 5 }, { categoryId: C2, minutes: 30 }, { categoryId: null, minutes: 85 }]);
    expect(sent[0].totalMinutes).toBe(120);
    expect(sent[0].saveMode).toBe("edited");
    expect(results).toEqual([true]);
  });

  it("저장 방식(G9): 처음 값 그대로면 prefilled(기타 100%도), 칩을 풀었다 다시 골라 같은 값이면 prefilled, 바꾸면 edited, 나누지 않으면 not_split", async () => {
    let r: { api: EveningApi; sent: EveningSaveInput[]; results: boolean[] } = await openSplit120();
    await press("저장");
    expect(r.sent[0]).toMatchObject({ saveMode: "prefilled", items: [{ categoryId: C1, minutes: 30 }, { categoryId: C2, minutes: 30 }, { categoryId: null, minutes: 60 }] });
    cleanup();
    r = await openWith(state(), 2);
    await press("저장");
    expect(r.sent[0]).toMatchObject({ saveMode: "prefilled", items: [{ categoryId: null, minutes: 120 }] });
    cleanup();
    r = await openSplit120();
    await press("포트폴리오, 다이얼에 넣기");
    await press("포트폴리오, 다이얼에 넣기");
    await press("저장");
    expect(r.sent[0].saveMode).toBe("prefilled");
    cleanup();
    r = await openSplit120();
    await press("포트폴리오, 다이얼에 넣기");
    await press("저장");
    expect(r.sent[0]).toMatchObject({ saveMode: "edited", items: [{ categoryId: C1, minutes: 30 }, { categoryId: null, minutes: 90 }] });
    cleanup();
    r = realApi(state({ doneCategoryIds: [C2] }));
    await mount(r.api);
    setNumber("시간", 2);
    await press("나누지 않고 저장");
    expect(r.sent[0]).toMatchObject({ saveMode: "not_split", items: [{ categoryId: null, minutes: 120 }] });
    expect(r.results).toEqual([true]);
  });

  it("끝낸 할 일 분야(d-116 가): 나누기에 들어갈 때의 값으로 처음 값을 만든다(시트에서 바뀌어 들어온 값). 나눈 값을 고친 뒤에는 덮지 않는다", async () => {
    const s = state();
    const r = realApi(s);
    // 같은 상태 객체를 돌려줘 화면 안에서 끝낸 할 일이 바뀌는 것(E2의 시트)을 흉내 낸다
    (r.api.fetchState as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: true as const, data: s }));
    await mount(r.api);
    setNumber("시간", 2);
    s.doneCategoryIds = [C2];
    await press("분야마다 나누기");
    expect(pressed("포트폴리오")).toBe("true");
    expect(pressed("어학")).toBe("false");
    await press("이전");
    s.doneCategoryIds = [C2, C1, null];
    await press("분야마다 나누기");
    expect(pressed("어학")).toBe("true");
    expect(stepper("어학")).toBe(30);
    expect(stepper("포트폴리오")).toBe(30);
    expect(otherText()).toBe("1시간");
    fireEvent.click(screen.getByRole("button", { name: "어학 5분 늘리기" })); // 고침
    await press("이전");
    s.doneCategoryIds = [];
    await press("분야마다 나누기");
    expect(stepper("어학")).toBe(35); // 덮지 않는다
    expect(pressed("포트폴리오")).toBe("true");
  });

  it("이미 남긴 기록을 고치러 오면 그 기록의 분야(0분 넘는 것)가 골라진 채 시작한다", async () => {
    const existing = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      targetDay: "2026-11-07",
      totalMinutes: 150,
      items: [{ categoryId: C2, minutes: 100 }, { categoryId: null, minutes: 50 }],
      saveMode: "edited" as const,
      savedAt: "x",
    };
    const { api } = realApi(state({ existing, doneCategoryIds: [C1], timerByCategory: [{ categoryId: C1, minutes: 20 }] }));
    await mount(api);
    await press("분야마다 나누기");
    expect(pressed("포트폴리오")).toBe("true");
    expect(pressed("어학")).toBe("false"); // 기록에 없는 분야는 타이머·체크가 있어도 고르지 않는다(기록 값 그대로)
    expect(rowKeys()).toEqual([C2, "other"]);
    expect(stepper("포트폴리오")).toBe(100);
    expect(pickedRow()).toBe(C2);
  });

  it("악용: 칩 고르기·풀기·Stepper·다이얼을 어떤 순서로 섞어도 화면 합 = 쓴 시간이고, 저장 items 합 = 쓴 시간(서버 검증 통과)", async () => {
    const { sent, results } = await openWith(state(), 1, 35); // 95분
    let seed = 11;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let checks = 0;
    for (let step = 0; step < 60; step++) {
      const r = rand();
      const name = rand() < 0.5 ? "어학" : "포트폴리오";
      if (r < 0.35) await press(`${name}, 다이얼에 넣기`);
      else if (r < 0.6 && screen.queryByLabelText(name)) {
        const btn = screen.getByRole("button", { name: `${name} 5분 ${rand() < 0.5 ? "늘리기" : "줄이기"}` }) as HTMLButtonElement;
        if (!btn.disabled) fireEvent.click(btn);
      } else if (r < 0.8 && dial()) key(dial()!, ["ArrowRight", "ArrowLeft", "Home", "End"][Math.floor(rand() * 4)]);
      else {
        const hs = screen.queryAllByRole("slider");
        if (hs.length > 0) key(hs[Math.floor(rand() * hs.length)], ["PageUp", "PageDown", "End", "Home", "ArrowRight"][Math.floor(rand() * 5)]);
      }
      const shown = screenItems(NAMES);
      expect(shown.reduce((s, i) => s + i.minutes, 0)).toBe(95);
      expect(screen.getByText("합계 1시간 35분")).toBeTruthy();
      checks++;
    }
    expect(checks).toBe(60);
    await press("저장");
    expect(sent[0].totalMinutes).toBe(95);
    expect(sent[0].items.reduce((s, i) => s + i.minutes, 0)).toBe(95);
    expect(results).toEqual([true]);
  });
});

describe("오늘 기록 나누기 「+ 분야」 (고침 5바퀴, 지금 앱의 분야 더하기 길)", () => {
  function withAdd(s: EveningState, addCategory: EveningApi["addCategory"]) {
    const r = realApi(s);
    r.api.addCategory = addCategory;
    return r;
  }
  const typeName = (v: string) => fireEvent.change(screen.getByLabelText("새 분야 이름"), { target: { value: v } });

  it("그 자리에서 이름 칸이 열리고, 더하면 골라진 칩 = 새 조각 30분. 같은 이름으로 다시 눌러도 같은 요청 id", async () => {
    const add = vi.fn(async (id: string, name: string) => ({ ok: true as const, data: { category: { id: C3, readable: true as const, name, createdAt: "x" } } }));
    const { api } = withAdd(state(), add);
    await mount(api);
    setNumber("시간", 2);
    await press("분야마다 나누기");
    await press("+ 분야");
    typeName("운동");
    await press("더하기");
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][1]).toBe("운동");
    expect(add.mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(pressed("운동")).toBe("true");
    expect(stepper("운동")).toBe(30);
    expect(otherText()).toBe("1시간 30분");
    expect(pickedRow()).toBe(C3);
    expect((document.querySelector(".dial-slice") as SVGElement).style.fill).toBe("var(--color-category-3)"); // 세 번째 분야
  });

  it("이미 있는 이름이면 요청 없이 그 칩을 고른다. 「기타」·빈 이름은 보내지 않는다", async () => {
    const add = vi.fn();
    const { api } = withAdd(state(), add);
    await mount(api);
    setNumber("시간", 2);
    await press("분야마다 나누기");
    await press("+ 분야");
    typeName("기타");
    await press("더하기");
    expect(screen.getByText("기타는 더하지 않아도 돼요. 분야를 고르지 않으면 기타로 들어가요.")).toBeTruthy();
    typeName("   ");
    await press("더하기");
    typeName("어학");
    await press("더하기");
    expect(add).not.toHaveBeenCalled();
    expect(pressed("어학")).toBe("true");
    expect(screen.getByText("이미 있는 분야라서 골랐어요: 어학")).toBeTruthy();
  });

  it("악용: 분야가 50개면 「+ 분야」가 이름 칸을 열지 않고 한도 안내만(요청 없음). 서버가 한도로 거절해도 같은 안내", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`, name: `분야${i}` }));
    const add = vi.fn();
    const { api } = withAdd(state({ categories: many }), add);
    await mount(api);
    setNumber("시간", 2);
    await press("분야마다 나누기");
    await press("+ 분야");
    expect(screen.queryByLabelText("새 분야 이름")).toBeNull();
    expect(screen.getByText("분야는 50개까지 둘 수 있어요.")).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
    cleanup();
    const limited = vi.fn(async () => ({ ok: false as const, error: "category_limit" as const }));
    const r2 = withAdd(state(), limited);
    await mount(r2.api);
    setNumber("시간", 2);
    await press("분야마다 나누기");
    await press("+ 분야");
    typeName("운동");
    await press("더하기");
    expect(limited).toHaveBeenCalledTimes(1);
    expect(screen.getByText("분야는 50개까지 둘 수 있어요.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "운동, 다이얼에 넣기" })).toBeNull();
  });

  it("악용: 분야 이름의 HTML은 글자 그대로(칩·줄·조각 이름), 요소가 되지 않는다. 정상 이름도 그대로 지난다", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const add = vi.fn(async (id: string, name: string) => ({ ok: true as const, data: { category: { id: C3, readable: true as const, name, createdAt: "x" } } }));
    const { api } = withAdd(state({ categories: [{ id: C1, name: evil }, { id: C2, name: "포트폴리오" }] }), add);
    await mount(api);
    setNumber("시간", 2);
    await press("분야마다 나누기");
    expect(chip(evil).querySelector(".chip-label")!.textContent).toBe(evil);
    await press(`${evil}, 다이얼에 넣기`);
    expect(screen.getByLabelText(evil)).toBeTruthy();
    expect(sliceLabels()[0]).toBe(`${evil} 30분, 고름`);
    await press("+ 분야");
    typeName("<b>굵게</b>");
    await press("더하기");
    expect(chip("<b>굵게</b>").querySelector(".chip-label")!.textContent).toBe("<b>굵게</b>");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".chip-label b")).toBeNull();
    expect(pressed("포트폴리오")).toBe("false");
  });

  it("「+ 분야」는 지금 앱의 분야 더하기 함수를 그대로 부른다(서버: app/todos/actions addCategory · 기기 먼저: settings.addCategory — 한도 50)", async () => {
    // 기기 먼저 저장: 분야가 50개면 category_limit, 아니면 기기에 더해지고 보낼 줄에 category.add
    const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`, readable: true as const, name: `분야${i}`, createdAt: "2026-11-01T00:00:00.000Z" }));
    for (const [cats, want] of [[fifty, "category_limit"], [fifty.slice(0, 2), "ok"]] as const) {
      const kv = createMemoryKv();
      await kv.set(kvKeys.base(USER), { ...emptyMirror(), synced: true, categories: [...cats] } as Mirror);
      const runtime = createRuntime({ userKey: USER, kv, send: vi.fn(async () => ({ ok: true }) as SendResult), fetchSnapshot: async () => ({ ok: false, error: "unavailable" }), now: () => NOW.getTime(), online: () => false });
      await runtime.boot();
      const apis = createLocalApis(runtime);
      expect(typeof apis.evening.addCategory).toBe("function");
      const res = await apis.evening.addCategory!("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "운동");
      if (want === "ok") {
        expect(res.ok).toBe(true);
        expect(runtime.pendingOps().at(-1)?.op).toMatchObject({ kind: "category.add", name: "운동" });
      } else {
        expect(res).toEqual({ ok: false, error: "category_limit" });
      }
    }
    const src = readFileSync(path.resolve(__dirname, "../../lib/evening-api.ts"), "utf-8");
    expect(src).toMatch(/import \{ addCategory \} from "\.\.\/app\/todos\/actions";/);
    expect(src).toMatch(/return await addCategory\(id, name\);/);
  });
});

/**
 * 고침6 PM d-129 ②: 오늘 기록 나누기 손잡이는 0분이 아닌 조각 사이에만 — 0분 조각은 건너뛴다. 기타 0분이어도 12시에 손잡이가 없다.
 * 기타 0분에서 마지막 분야를 기타로 돌려주는 끌기 길은 없고, 줄의 −(Stepper)가 맡는다.
 */
/** 손잡이의 자리(바퀴 0~1, 0 = 12시) */
function turnOfHandle(el: Element): number {
  const m = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(el.getAttribute("transform") ?? "");
  if (!m) throw new Error("손잡이 자리 없음");
  const t = Math.atan2(Number(m[2]), Number(m[1])) / (2 * Math.PI) + 0.25;
  return ((t % 1) + 1) % 1;
}
const fromNoon = (el: Element) => {
  const t = turnOfHandle(el);
  return Math.min(t, 1 - t);
};

describe("오늘 기록 나누기: 기타 0분에서 12시 손잡이 없음 (고침6 PM d-129 ②)", () => {
  it("기타 0분 + 마지막 분야 고름: 손잡이는 앞(어학·포트폴리오) 하나뿐이고 자리는 12시가 아니다", async () => {
    await openWith(state(), 1);
    await press("어학, 다이얼에 넣기");
    await press("포트폴리오, 다이얼에 넣기"); // 어학 30 · 포트폴리오 30 · 기타 0, 포트폴리오(마지막 분야) 고름
    expect(otherText()).toBe("0분");
    expect(pickedRow()).toBe(C2);
    const hs = screen.getAllByRole("slider");
    expect(hs).toHaveLength(1);
    expect(hs[0].id).toBe("evening-dial-handle-start");
    expect(hs[0].getAttribute("aria-label")).toContain("포트폴리오·어학 사이");
    expect(hs[0].getAttribute("transform")).toBe("translate(0.00 81.00)"); // 30/60 = 6시
    expect(fromNoon(hs[0])).toBeGreaterThan(0.4);
    expect(document.getElementById("evening-dial-handle-end")).toBeNull();
    // 첫 분야를 골라도 12시 손잡이 없음(끝 손잡이 하나, 6시)
    fireEvent.click(document.querySelector(`.ratio-list [data-row-key="${C1}"]`)!);
    expect(screen.getAllByRole("slider").map((h) => h.id)).toEqual(["evening-dial-handle-end"]);
    expect(fromNoon(handle("end"))).toBeGreaterThan(0.4);
    // 기타(0분) 줄을 골라도 손잡이 없음(자리가 12시)
    fireEvent.click(document.querySelector('.ratio-list [data-row-key="other"]')!);
    expect(pickedRow()).toBe("other");
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
  });

  it("기타 0분에서 마지막 분야를 기타로 돌려주기: 끌기 손잡이는 없고, 줄의 −(Stepper)가 돌려준다. 그 뒤에는 포트폴리오·기타 경계 손잡이가 선다. 저장은 서버 검증을 지난다", async () => {
    const { sent, results } = await openWith(state(), 1);
    await press("어학, 다이얼에 넣기");
    await press("포트폴리오, 다이얼에 넣기");
    expect(document.getElementById("evening-dial-handle-end")).toBeNull(); // 기타로 돌려줄 끌기 길이 없다
    fireEvent.click(screen.getByRole("button", { name: "포트폴리오 5분 줄이기" }));
    expect(stepper("포트폴리오")).toBe(25);
    expect(otherText()).toBe("5분");
    expect(stepper("어학")).toBe(30);
    expect(screen.getByText("합계 1시간")).toBeTruthy();
    // 기타 > 0이 되면 지금과 같다: 포트폴리오의 끝 손잡이(포트폴리오·기타)가 12시가 아닌 자리에 선다
    fireEvent.click(document.querySelector(`.ratio-list [data-row-key="${C2}"]`)!);
    expect(screen.getAllByRole("slider").map((h) => h.id)).toEqual(["evening-dial-handle-start", "evening-dial-handle-end"]);
    expect(handle("end").getAttribute("aria-label")).toContain("포트폴리오·기타 사이");
    expect(fromNoon(handle("end"))).toBeGreaterThan(0);
    key(handle("end"), "ArrowLeft"); // 포트폴리오 −5 → 기타(끌기 길도 다시 있다)
    expect(stepper("포트폴리오")).toBe(20);
    expect(otherText()).toBe("10분");
    await press("저장");
    expect(sent[0]).toMatchObject({
      totalMinutes: 60,
      items: [{ categoryId: C1, minutes: 30 }, { categoryId: C2, minutes: 20 }, { categoryId: null, minutes: 10 }],
      saveMode: "edited",
    });
    expect(results).toEqual([true]);
  });

  it("0분 분야(가운데)를 건너뛴 손잡이: 어학·운동 경계 하나, 키보드로 바꿔도 0분 포트폴리오는 0 그대로", async () => {
    const cats = [{ id: C1, name: "어학" }, { id: C2, name: "포트폴리오" }, { id: C3, name: "운동" }];
    await openWith(state({ categories: cats }), 1);
    await press("어학, 다이얼에 넣기");
    await press("운동, 다이얼에 넣기"); // 어학 30 · 운동 30 · 기타 0
    await press("포트폴리오, 다이얼에 넣기"); // 기타 0분 → 0분 줄(가운데)
    expect(rowKeys()).toEqual([C1, C2, C3, "other"]);
    expect(stepper("포트폴리오")).toBe(0);
    fireEvent.click(document.querySelector(`.ratio-list [data-row-key="${C1}"]`)!);
    expect(screen.getAllByRole("slider").map((h) => h.id)).toEqual(["evening-dial-handle-end"]);
    expect(handle("end").getAttribute("aria-label")).toContain("어학·운동 사이");
    key(handle("end"), "PageUp"); // 어학 +30(운동에서)
    expect(stepper("어학")).toBe(60);
    expect(stepper("포트폴리오")).toBe(0);
    expect(stepper("운동")).toBe(0);
    // 0분 포트폴리오 줄을 고르면: 앞뒤 0분 아닌 조각이 어학 하나뿐(자리 12시) — 손잡이 없음, 줄의 +로는 키울 수 없다(기타 0분)
    fireEvent.click(document.querySelector(`.ratio-list [data-row-key="${C2}"]`)!);
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
    expect((screen.getByRole("button", { name: "포트폴리오 5분 늘리기" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("악용: 기타 0분에서 시작해 끌기·손잡이 키보드·다이얼 키·Stepper −/+ 를 섞어도 화면 합 = 쓴 시간, 12시에 손잡이가 서지 않고, 저장 items 합 = 쓴 시간(서버 검증 통과)", async () => {
    const { sent, results } = await openWith(state(), 1);
    await press("어학, 다이얼에 넣기");
    await press("포트폴리오, 다이얼에 넣기"); // 기타 0분에서 시작
    expect(otherText()).toBe("0분");
    const svg = dial()!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    const pt = (t: number) => {
      const a = t * 2 * Math.PI - Math.PI / 2;
      return { clientX: 100 + 90 * Math.cos(a), clientY: 100 + 90 * Math.sin(a), pointerId: 1 };
    };
    let seed = 1109;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let drags = 0;
    let checks = 0;
    for (let step = 0; step < 80; step++) {
      const r = rand();
      const name = rand() < 0.5 ? "어학" : "포트폴리오";
      const hs = screen.queryAllByRole("slider");
      if (r < 0.3 && hs.length > 0) {
        const h = hs[Math.floor(rand() * hs.length)];
        const from = turnOfHandle(h);
        const to = from + (rand() - 0.5) * 1.2; // 12시를 넘을 만큼도
        fireEvent.pointerDown(h, pt(from));
        for (let i = 1; i <= 8; i++) fireEvent.pointerMove(svg, pt(from + ((to - from) * i) / 8));
        fireEvent.pointerUp(svg, { pointerId: 1 });
        drags++;
      } else if (r < 0.5 && hs.length > 0) {
        key(hs[Math.floor(rand() * hs.length)], ["PageUp", "PageDown", "End", "Home", "ArrowRight", "ArrowLeft"][Math.floor(rand() * 6)]);
      } else if (r < 0.7) {
        key(svg, ["ArrowRight", "ArrowLeft", "Home", "End"][Math.floor(rand() * 4)]);
      } else if (screen.queryByLabelText(name)) {
        const btn = screen.getByRole("button", { name: `${name} 5분 ${rand() < 0.6 ? "줄이기" : "늘리기"}` }) as HTMLButtonElement;
        if (!btn.disabled) fireEvent.click(btn);
      }
      for (const h of screen.queryAllByRole("slider")) expect(fromNoon(h)).toBeGreaterThan(0.01); // 12시에 손잡이 없음
      const shown = screenItems(NAMES);
      expect(shown.reduce((s, i) => s + i.minutes, 0)).toBe(60);
      expect(screen.getByText("합계 1시간")).toBeTruthy();
      checks++;
    }
    expect(checks).toBe(80);
    expect(drags).toBeGreaterThan(5); // 끌기가 실제로 섞였다
    await press("저장");
    expect(sent[0].totalMinutes).toBe(60);
    expect(sent[0].items.reduce((s, i) => s + i.minutes, 0)).toBe(60);
    expect(sent[0].items.every((i) => Number.isInteger(i.minutes) && i.minutes >= 0)).toBe(true);
    expect(results).toEqual([true]);
  });

  it("악성 거절·정상 통과 대조: 서버 저장 검증은 합 > 쓴 시간인 저장을 거절하고, 합 = 쓴 시간이면 받는다(합 고정이 앱과 서버 두 층)", async () => {
    const { api, results } = realApi(state());
    const base = { targetDay: "2026-11-07", totalMinutes: 60, saveMode: "edited" as const, clientSavedAt: NOW.toISOString() };
    const bad = await api.save({ ...base, id: "abababab-abab-4bab-8bab-abababababab", items: [{ categoryId: C1, minutes: 60 }, { categoryId: null, minutes: 5 }] });
    expect(bad).toEqual({ ok: false, error: "invalid_input" });
    const good = await api.save({ ...base, id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd", items: [{ categoryId: C1, minutes: 55 }, { categoryId: null, minutes: 5 }] });
    expect(good.ok).toBe(true);
    expect(results).toEqual([false, true]);
  });
});

describe("오늘 기록 나누기 화면 꼴(고침9 Figma 87:2 · 87:96 · 49:26 · 49:83)", () => {
  it("머리 「‹ 오늘 기록」(고침10 A — 오른쪽 위 글 「닫기」 없음) · 제목 옆 「합계」 · 「오늘/어제」 알약 없음 · 흰 카드 하나에 이름표·칩 줄·다이얼·줄·안내 · 「이전」 글 단추 없음 · 「저장」은 아래 고정(A2)", async () => {
    await openSplit120();
    const dialog = screen.getByRole("dialog", { name: "오늘 기록" });
    const back = within(dialog).getByRole("button", { name: "이전" });
    expect(back.className).toBe("head-btn head-btn-back");
    expect(back.closest(".screen-head")).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: "닫기" })).toBeNull();
    expect(within(dialog).queryByRole("group", { name: "기록할 날" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "오늘" })).toBeNull();
    expect(within(dialog).queryAllByRole("button", { name: "이전" })).toHaveLength(1); // 글 단추 「이전」 없음 — 「‹」 하나
    const card = dialog.querySelector(".card-box.evening-split-card")!;
    expect(Array.from(card.children).map((c) => c.className)).toEqual([
      "evening-category-label",
      "chip-scroller",
      "input-help",
      "evening-dial",
      "ratio-list evening-rows",
      "evening-split-hint",
    ]);
    expect(card.querySelector(".evening-category-label")!.textContent).toBe("분야 · 여러 개");
    const actions = dialog.querySelector(".bottom-actions")!;
    expect(Array.from(actions.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["저장"]);
    expect(card.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 「‹」는 시간 단계로(쓴 시간 그대로)
    await act(async () => fireEvent.click(back));
    expect(screen.getByRole("heading", { name: "오늘 몇 시간 썼어요?" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "시간" }).getAttribute("aria-valuenow")).toBe("2");
  });

  it("다이얼 가운데: 시간 24 Bold 위 · 분야 12 보조 아래(값이 위). 12시 작은 세로 눈금은 없다(처음 정한 비율 다이얼은 그대로 있다)", async () => {
    await openSplit120();
    const value = document.querySelector(".evening-dial .dial-center-value")!;
    const name = document.querySelector(".evening-dial .dial-center-name")!;
    expect(value.textContent).toBe("30분"); // 고른 조각 = 어학(타이머 30분)
    expect(name.textContent).toBe("어학");
    expect(value.getAttribute("class")).toBe("dial-center-value dial-center-big");
    expect(name.getAttribute("class")).toBe("dial-center-name dial-center-small");
    expect(Number(value.getAttribute("y"))).toBeLessThan(Number(name.getAttribute("y")));
    expect(value.querySelector("tspan")).toBeNull(); // 숫자와 단위가 같은 크기
    expect(document.getElementById("evening-dial-noon")).toBeNull();
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toMatch(/\.dial-center-big \{ font: var\(--font-title\);/);
    expect(css).toMatch(/\.dial-center-small \{ font: 400 0\.75rem\/1rem var\(--font-family\); \}/);
  });

  it("기타 줄은 −/+·숫자 칸 없이 오른쪽 끝 값만(14 Medium · 고정폭 숫자, PM d-148 가). 분야 줄은 A3 −/+(원 32)·칸 안 단위", async () => {
    await openSplit120();
    const other = document.querySelector('.ratio-list [data-row-key="other"]')!;
    expect(other.querySelectorAll("button, input")).toHaveLength(0);
    const value = other.querySelector(".evening-other-value")!;
    expect(value.textContent).toBe("1시간");
    expect(other.lastElementChild).toBe(value);
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toMatch(/\.evening-row \.evening-other-value \{[^}]*margin-inline-start: auto;[^}]*text-align: end; font: 500 0\.875rem\/1\.25rem var\(--font-family\); font-variant-numeric: tabular-nums;/);
    const row = document.querySelector(`.ratio-list [data-row-key="${C1}"]`)!;
    expect(row.querySelectorAll(".step-btn .step-btn-face")).toHaveLength(2);
    expect(row.querySelector(".num-field .stepper-unit")!.textContent).toBe("분");
  });

  it("나눈 합이 합계보다 많으면(이미 남긴 기록의 숨은 분야 등) 카드 아래 안내 상자, 제목 옆 합계는 맞춘 합(Figma 49:83)", async () => {
    const existing = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      targetDay: "2026-11-07",
      totalMinutes: 240,
      items: [{ categoryId: C1, minutes: 180 }, { categoryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", minutes: 60 }],
      saveMode: "edited" as const,
      savedAt: "x",
    };
    const r = realApi(state({ existing }));
    await mount(r.api);
    setNumber("시간", 3); // 쓴 시간을 줄였다(나눈 값은 비율대로 다시 나뉨)
    await press("분야마다 나누기");
    expect(screen.getByText(/^합계/).className).toBe("evening-split-total");
  });
});

describe("악용: 두 줄 휠 바로 쓰기로 범위 밖 시간 저장(앱 검사 + 서버 저장 검증 그대로)", () => {
  it("25시간·음수·1e9·분 7을 넣어도 저장 인자는 0~1440분이고 진짜 저장 함수(서버 검증)를 지난다. 정상 값도 지난다", async () => {
    const r = realApi();
    await mount(r.api);
    setNumber("시간", 25);
    await press("나누지 않고 저장");
    expect(r.sent[0]).toMatchObject({ totalMinutes: 1440, items: [{ categoryId: null, minutes: 1440 }] });
    expect(r.results).toEqual([true]);
    cleanup();
    for (const [h, m, expected] of [
      [-3, 0, 0],
      ["1e9", 0, 1440],
      [1, 7, 65],
      [2, 30, 150],
    ] as const) {
      const rr = realApi();
      await mount(rr.api);
      setNumberField("시간", h as number);
      setNumberField("분", m);
      expect(Number(screen.getByRole("spinbutton", { name: "시간" }).getAttribute("aria-valuenow")) * 60 + Number(screen.getByRole("spinbutton", { name: "분" }).getAttribute("aria-valuenow"))).toBe(expected);
      await press("나누지 않고 저장");
      expect(rr.sent[0].totalMinutes).toBe(expected);
      expect(rr.sent[0].totalMinutes % 5).toBe(0);
      expect(rr.results).toEqual([true]);
      cleanup();
    }
  });
});
