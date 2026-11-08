// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RatioEditor, type RatioEntry } from "../../components/ratio-editor";

afterEach(cleanup);

const E = (id: string, name: string, percent: number): RatioEntry => ({ id, name, percent });

function Host({ initial, seen }: { initial: RatioEntry[]; seen?: RatioEntry[][] }) {
  const [entries, setEntries] = useState(initial);
  return (
    <>
      <RatioEditor
        entries={entries}
        onChange={(next) => {
          seen?.push(next);
          setEntries(next);
        }}
      />
      <button type="button" onClick={() => setEntries((prev) => prev.filter((e) => e.id !== "a"))}>
        어학 빼기
      </button>
    </>
  );
}
const slider = (side: "start" | "end" | "both") => document.getElementById(`ratio-dial-handle-${side}`)!;
const field = (name: string) => screen.getByLabelText(`${name} 비율(%)`) as HTMLInputElement;
const values = (...names: string[]) => names.map((n) => Number(field(n).value));
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
/** 숫자 칸에 글을 넣고 칸을 떠난다(Enter면 Enter로 마친다) */
function type(name: string, text: string, how: "blur" | "enter" = "blur") {
  const el = field(name);
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: text } });
  if (how === "enter") fireEvent.keyDown(el, { key: "Enter" });
  else fireEvent.blur(el);
}

describe("RatioEditor 위의 원형 다이얼 — 합 100 고정(PM 확정 11-08)", () => {
  it("−/+ 목록 위쪽에 다이얼이 있고, 합계는 100%다", () => {
    render(<Host initial={[E("a", "어학", 50), E("b", "코딩", 50), E("other", "기타", 0)]} />);
    const dial = document.querySelector("svg.dial")!;
    const list = document.querySelector("ul.ratio-list")!;
    expect(dial.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("합계 100%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "고르게 나누기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "어학 5% 줄이기" })).toBeTruthy();
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(2); // 기타 0%는 폭이 없다
    expect(screen.queryByText(/합이 100이 아니어도/)).toBeNull(); // 거짓이 된 글은 없다
  });

  it("다이얼·−/+·숫자 칸이 같은 상태다: 어느 길로 바꿔도 셋이 같은 값을 보이고 합이 늘 100이다", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 50), E("b", "코딩", 50), E("other", "기타", 0)]} seen={seen} />);
    fireEvent.keyDown(slider("end"), { key: "PageUp" }); // 다이얼: 어학 +5, 코딩 −5
    expect(values("어학", "코딩", "기타")).toEqual([55, 45, 0]);
    expect(slider("end").getAttribute("aria-valuenow")).toBe("55");
    fireEvent.click(screen.getByRole("button", { name: "코딩 5% 줄이기" })); // −: 줄인 몫은 뒤 줄(기타)로
    expect(values("어학", "코딩", "기타")).toEqual([55, 40, 5]);
    type("어학", "70"); // 숫자 칸: 뒤 줄(코딩)에서 떼어 온다
    expect(values("어학", "코딩", "기타")).toEqual([70, 25, 5]);
    expect(slider("end").getAttribute("aria-valuenow")).toBe("70");
    fireEvent.keyDown(slider("end"), { key: "ArrowLeft" });
    expect(values("어학", "코딩", "기타")).toEqual([69, 26, 5]);
    expect(screen.getByText("합계 100%")).toBeTruthy();
    for (const next of seen) {
      expect(sum(next.map((e) => e.percent))).toBe(100);
      expect(next.every((e) => Number.isInteger(e.percent) && e.percent >= 0 && e.percent <= 100)).toBe(true);
    }
  });

  it("열 때 합이 100이 아니면 비율을 지켜 합 100의 정수로 맞추고 바깥에도 알린다(30·30·0 → 50·50·0)", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 30), E("b", "코딩", 30), E("other", "기타", 0)]} seen={seen} />);
    expect(seen.at(-1)!.map((e) => e.percent)).toEqual([50, 50, 0]);
    expect(values("어학", "코딩", "기타")).toEqual([50, 50, 0]);
    expect(screen.getByText("합계 100%")).toBeTruthy();
    expect(slider("end").getAttribute("aria-valuenow")).toBe("50");
  });

  it("열 때 모두 0이면(새 사용자) 분야끼리 균등 배분, 기타 0으로 시작한다", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 0), E("b", "코딩", 0), E("c", "운동", 0), E("other", "기타", 0)]} seen={seen} />);
    expect(values("어학", "코딩", "운동", "기타")).toEqual([35, 35, 30, 0]);
    expect(seen.at(-1)!.map((e) => e.percent)).toEqual([35, 35, 30, 0]);
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(3);
  });

  it("분야가 빠져 합이 100 밑으로 내려가면 다시 합 100으로 맞춘다. 고른 줄이 빠지면 다이얼도 목록도 아무것도 안 고른 것으로 보인다", () => {
    render(<Host initial={[E("a", "어학", 40), E("b", "코딩", 30), E("other", "기타", 30)]} />);
    expect(screen.getByRole("button", { name: "어학", pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "어학 빼기" }));
    expect(values("코딩", "기타")).toEqual([50, 50]);
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(document.querySelectorAll('[role="slider"]')).toHaveLength(0);
  });

  it("처음 정한 비율 40·30·20·10을 손잡이·−/+·숫자 칸으로 만들 수 있다", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 0), E("b", "코딩", 0), E("c", "운동", 0), E("other", "기타", 0)]} seen={seen} />);
    expect(values("어학", "코딩", "운동", "기타")).toEqual([35, 35, 30, 0]);
    // 손잡이(키보드): 어학이 골라져 있다 → 끝 손잡이 PageUp으로 어학 +5(코딩에서)
    expect(screen.getByRole("button", { name: "어학", pressed: true })).toBeTruthy();
    fireEvent.keyDown(slider("end"), { key: "PageUp" });
    expect(values("어학", "코딩", "운동", "기타")).toEqual([40, 30, 30, 0]);
    // −/+: 운동 −5 → 줄인 몫은 뒤 줄(기타)로
    fireEvent.click(screen.getByRole("button", { name: "운동 5% 줄이기" }));
    expect(values("어학", "코딩", "운동", "기타")).toEqual([40, 30, 25, 5]);
    // 숫자 칸: 기타 10 → 맨 끝 줄이라 앞 줄(운동)에서
    type("기타", "10", "enter");
    expect(values("어학", "코딩", "운동", "기타")).toEqual([40, 30, 20, 10]);
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(4);
    expect(seen.at(-1)!.map((e) => e.percent)).toEqual([40, 30, 20, 10]);
  });

  it("고른 조각은 다이얼과 목록이 같이 쓴다: 목록의 이름을 누르면 그 조각에 손잡이가 선다. 0% 분야·기타도 고르고 키울 수 있다", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 60), E("b", "코딩", 40), E("c", "운동", 0), E("other", "기타", 0)]} seen={seen} />);
    expect(screen.getByRole("button", { name: "어학", pressed: true })).toBeTruthy(); // 처음에는 첫 조각
    fireEvent.click(screen.getByRole("button", { name: "운동" }));
    expect(screen.getByRole("button", { name: "운동", pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "어학", pressed: false })).toBeTruthy();
    expect(document.querySelectorAll('[role="slider"]')).toHaveLength(1); // 폭 0: 겹친 손잡이 하나
    fireEvent.keyDown(slider("both"), { key: "PageUp" }); // 운동 0 → 5 (뒤 이웃 기타가 0이라 코딩에서)
    expect(seen.at(-1)!.map((e) => e.percent)).toEqual([60, 35, 5, 0]);
    expect(field("운동").value).toBe("5");
    // 기타는 늘 맨 끝 조각: 앞 손잡이만 있다
    fireEvent.click(screen.getByRole("button", { name: "기타" }));
    expect(document.querySelectorAll('[role="slider"]')).toHaveLength(1);
    expect(document.getElementById("ratio-dial-handle-end")).toBeNull();
    fireEvent.keyDown(slider("start"), { key: "ArrowRight" });
    expect(seen.at(-1)!.map((e) => e.percent)).toEqual([60, 35, 4, 1]);
    // 어느 분야든 손잡이로 0%까지 내려갈 수 있다
    fireEvent.click(screen.getByRole("button", { name: "어학" }));
    for (let i = 0; i < 13; i++) fireEvent.keyDown(slider("end"), { key: "PageDown" });
    expect(seen.at(-1)!.map((e) => e.percent)).toEqual([0, 95, 4, 1]);
    for (const next of seen) {
      expect(sum(next.map((e) => e.percent))).toBe(100);
      expect(next.every((e) => Number.isInteger(e.percent) && e.percent >= 0 && e.percent <= 100)).toBe(true);
    }
  });

  it("바뀐 내용 안내가 다이얼 아래에 글로 나온다. 분야 이름의 꺾쇠는 글이다", () => {
    render(<Host initial={[E("a", "<b>어학</b>", 50), E("b", "코딩", 50), E("other", "기타", 0)]} />);
    fireEvent.keyDown(slider("end"), { key: "ArrowRight" });
    const live = document.getElementById("ratio-dial-changes")!;
    expect(live.textContent).toBe("<b>어학</b> 50% → 51%, 코딩 50% → 49%");
    expect(document.querySelector("b")).toBeNull();
  });

  it("「고르게 나누기」는 분야끼리 합 100 균등 배분, 기타 0%로 돌리고 다이얼도 따라 바뀐다", () => {
    render(<Host initial={[E("a", "어학", 50), E("b", "코딩", 30), E("other", "기타", 20)]} />);
    fireEvent.click(screen.getByRole("button", { name: "고르게 나누기" }));
    expect(values("어학", "코딩", "기타")).toEqual([50, 50, 0]);
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(2);
  });

  it("분야 하나(처음 쓰는 사람): 조각 하나가 원을 다 채우고, 기타와의 경계 손잡이 하나(12시 자리)로 기타에 나눠 줄 수 있다", () => {
    render(<Host initial={[E("a", "어학", 0), E("other", "기타", 0)]} />);
    expect(values("어학", "기타")).toEqual([100, 0]);
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(1);
    expect(document.querySelectorAll('[role="slider"]')).toHaveLength(1);
    fireEvent.keyDown(slider("end"), { key: "PageDown" });
    expect(values("어학", "기타")).toEqual([95, 5]);
  });

  it("기타 줄뿐이면 늘 100%이고 손잡이가 없으며 −/+·숫자 칸으로도 바뀌지 않는다", () => {
    render(<Host initial={[E("other", "기타", 0)]} />);
    expect(values("기타")).toEqual([100]);
    expect(document.querySelectorAll('[role="slider"]')).toHaveLength(0);
    expect((screen.getByRole("button", { name: "기타 5% 줄이기" }) as HTMLButtonElement).disabled).toBe(true);
    type("기타", "40");
    expect(values("기타")).toEqual([100]);
  });

  it("분야 이름이 아주 길어도 목록 이름 단추에는 전체가, 다이얼 가운데에는 줄인 글이 있다", () => {
    const long = "아주아주아주긴분야이름이어서가운데에는다안들어갑니다";
    render(<Host initial={[E("a", long, 50), E("b", "코딩", 50), E("other", "기타", 0)]} />);
    expect(screen.getByRole("button", { name: long })).toBeTruthy();
    const shown = document.querySelector(".dial-center-name")!.textContent!;
    expect(shown.endsWith("…")).toBe(true);
    expect([...shown].length).toBeLessThanOrEqual(7);
    expect(slider("end").getAttribute("aria-label")).toContain(long);
  });

  it("분야 50개도 합 100으로 열리고(균등 배분) 다이얼이 깨지지 않는다", () => {
    const many = Array.from({ length: 50 }, (_, i) => E(`c${i}`, `분야${i + 1}`, 0));
    render(<Host initial={[...many, E("other", "기타", 0)]} />);
    expect(screen.getByText("합계 100%")).toBeTruthy();
    const all = values(...many.map((e) => e.name), "기타");
    expect(sum(all)).toBe(100);
    expect(document.querySelectorAll(".dial-slice").length).toBe(all.filter((v) => v > 0).length);
  });
});

describe("숫자 칸: 0~100 정수만(나쁜 입력은 이전 값으로)", () => {
  it("빈 칸·글자·소수·음수·100 넘음·지수·붙여넣은 글은 이전 값으로 돌아가고 값이 바뀌지 않는다", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 40), E("b", "코딩", 30), E("other", "기타", 30)]} seen={seen} />);
    for (const bad of ["", "abc", "12.7", "-5", "150", "1e9", "40%", "４０", "<img src=x>"]) {
      type("어학", bad);
      expect(field("어학").value, bad).toBe("40");
      type("코딩", bad, "enter");
      expect(field("코딩").value, bad).toBe("30");
    }
    // 붙여넣기: 붙여넣은 글도 칸을 떠날 때 같은 규칙으로 읽는다
    const el = field("어학");
    fireEvent.paste(el, { clipboardData: { getData: () => "12.7" } });
    fireEvent.change(el, { target: { value: "12.7" } });
    fireEvent.blur(el);
    expect(field("어학").value).toBe("40");
    expect(seen).toHaveLength(0);
    expect(document.querySelector("img")).toBeNull();
  });

  it("쓰는 동안은 글 그대로 두고, 칸을 떠나거나 Enter를 누를 때 반영한다. 0과 100도 받는다", () => {
    render(<Host initial={[E("a", "어학", 40), E("b", "코딩", 30), E("other", "기타", 30)]} />);
    const el = field("어학");
    fireEvent.change(el, { target: { value: "" } });
    expect(el.value).toBe(""); // 지우는 중에는 되돌리지 않는다
    fireEvent.change(el, { target: { value: "100" } });
    fireEvent.keyDown(el, { key: "Enter" });
    expect(values("어학", "코딩", "기타")).toEqual([100, 0, 0]);
    type("어학", "0");
    expect(values("어학", "코딩", "기타")).toEqual([0, 100, 0]);
  });
});

describe("키보드만으로 조각 고르기와 바꾸기", () => {
  it("다이얼에 포커스 → 화살표로 조각 고르기 → Tab으로 손잡이 → 화살표로 바꾸기. 목록도 같은 고른 조각을 보인다", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 40), E("b", "코딩", 30), E("c", "운동", 20), E("other", "기타", 10)]} seen={seen} />);
    const svg = document.querySelector("svg.dial") as unknown as HTMLElement;
    act(() => svg.focus());
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "코딩", pressed: true })).toBeTruthy();
    expect(document.getElementById("ratio-dial-changes")!.textContent).toBe("코딩 고름, 30%");
    // 다이얼 다음 탭 자리는 손잡이(고른 조각의 앞, 뒤)
    const tabbables = [...document.querySelectorAll('[tabindex="0"]')];
    expect(tabbables[0]).toBe(svg);
    expect(tabbables.slice(1, 3).map((e) => e.id)).toEqual(["ratio-dial-handle-start", "ratio-dial-handle-end"]);
    fireEvent.keyDown(slider("end"), { key: "PageUp" });
    expect(values("어학", "코딩", "운동", "기타")).toEqual([40, 35, 15, 10]);
    fireEvent.keyDown(slider("end"), { key: "End" });
    expect(values("어학", "코딩", "운동", "기타")).toEqual([40, 50, 0, 10]);
    expect(seen.every((n) => sum(n.map((e) => e.percent)) === 100)).toBe(true);
  });
});

describe("포커스를 뺏지 않는다(다이얼 고침1)", () => {
  it("끝에서 값이 안 바뀐 키를 누른 뒤 숫자 칸을 고치고 Tab으로 나가도 포커스가 손잡이로 안 간다", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 40), E("b", "코딩", 30), E("other", "기타", 30)]} seen={seen} />);
    const end = slider("end");
    act(() => end.focus());
    fireEvent.keyDown(end, { key: "End" }); // 어학이 코딩을 다 가져간다
    expect(values("어학", "코딩", "기타")).toEqual([70, 0, 30]);
    expect(document.activeElement).toBe(slider("end"));
    const n = seen.length;
    fireEvent.keyDown(slider("end"), { key: "End" }); // 끝에서 한 번 더: 값이 안 바뀐다
    fireEvent.keyDown(slider("end"), { key: "ArrowRight" });
    expect(seen).toHaveLength(n);
    // 숫자 칸으로 가서 고친 뒤 Tab으로 나간다(다음 칸 = 기타 − 단추) — 칸을 떠나는 순간 값이 바뀌고 다이얼이 다시 그려진다
    const field = screen.getByLabelText("기타 비율(%)") as HTMLInputElement;
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "20" } });
    const next = screen.getByRole("button", { name: "기타 5% 늘리기" });
    act(() => next.focus()); // Tab: 숫자 칸 blur → 반영 → 다시 그림
    expect(values("어학", "코딩", "기타")).toEqual([70, 10, 20]); // 기타는 맨 끝 줄: 줄인 몫은 앞 줄(코딩)로
    expect(document.activeElement).toBe(next);
    // −/+ 단추를 눌러 다시 그려져도 그대로
    fireEvent.click(next);
    expect(values("어학", "코딩", "기타")).toEqual([70, 5, 25]);
    expect(document.activeElement).toBe(next);
  });
});
