// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RatioEditor, type RatioEntry } from "../../components/ratio-editor";

afterEach(cleanup);

const E = (id: string, name: string, percent: number): RatioEntry => ({ id, name, percent });

function Host({ initial, seen }: { initial: RatioEntry[]; seen?: RatioEntry[][] }) {
  const [entries, setEntries] = useState(initial);
  return (
    <RatioEditor
      entries={entries}
      onChange={(next) => {
        seen?.push(next);
        setEntries(next);
      }}
    />
  );
}
const slider = (side: "start" | "end") => document.getElementById(`ratio-dial-handle-${side}`)!;

describe("RatioEditor 위의 원형 다이얼 (고침4 1단계)", () => {
  it("−/+ 목록 위쪽에 다이얼이 있고, 합계와 목록은 지금 그대로다", () => {
    render(<Host initial={[E("a", "어학", 50), E("b", "코딩", 50), E("other", "기타", 0)]} />);
    const dial = document.querySelector("svg.dial")!;
    const list = document.querySelector("ul.ratio-list")!;
    expect(dial.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("합계 100%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "고르게 나누기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "어학 5% 줄이기" })).toBeTruthy();
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(2); // 기타 0%는 폭이 없다
  });

  it("다이얼로 바꾼 값이 −/+ 목록 숫자와 합계에 그대로 나온다(같은 상태). 합이 늘 100이다", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 50), E("b", "코딩", 50), E("other", "기타", 0)]} seen={seen} />);
    fireEvent.keyDown(slider("end"), { key: "PageUp" }); // 어학 +5, 코딩 −5
    expect(screen.getByText("55%")).toBeTruthy();
    expect(screen.getByText("45%")).toBeTruthy();
    expect(screen.getByText("합계 100%")).toBeTruthy();
    // 그 값에서 −/+ 단추가 이어진다
    fireEvent.click(screen.getByRole("button", { name: "코딩 5% 줄이기" }));
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText("합계 95%")).toBeTruthy(); // −/+ 목록은 지금 동작 그대로: 합이 100이 아니어도 된다
    // 다이얼을 다시 만지면 합 100으로 맞춘 뒤 바뀐다(55·40·0 → 58·42·0 → +1)
    fireEvent.keyDown(slider("end"), { key: "ArrowRight" });
    expect(seen.at(-1)!.map((e) => e.percent)).toEqual([59, 41, 0]);
    expect(screen.getByText("합계 100%")).toBeTruthy();
  });

  it("합이 100이 아닌 값도 비율로 그리고, 만지면 합 100의 정수가 된다(30·30·0)", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 30), E("b", "코딩", 30), E("other", "기타", 0)]} seen={seen} />);
    expect(screen.getByText("합계 60%")).toBeTruthy();
    expect(slider("end").getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(slider("end"), { key: "ArrowRight" });
    expect(seen.at(-1)!.map((e) => e.percent)).toEqual([51, 49, 0]);
    expect(screen.getByText("합계 100%")).toBeTruthy();
  });

  it("고른 조각은 다이얼과 목록이 같이 쓴다: 목록의 이름을 누르면 그 조각에 손잡이가 선다. 0% 분야·기타도 고르고 키울 수 있다", () => {
    const seen: RatioEntry[][] = [];
    render(<Host initial={[E("a", "어학", 60), E("b", "코딩", 40), E("c", "운동", 0), E("other", "기타", 0)]} seen={seen} />);
    expect(screen.getByRole("button", { name: "어학", pressed: true })).toBeTruthy(); // 처음에는 첫 조각
    fireEvent.click(screen.getByRole("button", { name: "운동" }));
    expect(screen.getByRole("button", { name: "운동", pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "어학", pressed: false })).toBeTruthy();
    expect(document.querySelectorAll('[role="slider"]')).toHaveLength(2);
    fireEvent.keyDown(slider("start"), { key: "PageUp" }); // 운동 0 → 5 (코딩에서)
    expect(seen.at(-1)!.map((e) => e.percent)).toEqual([60, 35, 5, 0]);
    expect(screen.getByText("5%")).toBeTruthy();
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
      expect(next.reduce((a, e) => a + e.percent, 0)).toBe(100);
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

  it("「고르게 나누기」는 지금 그대로 기타를 0%로 돌리고 다이얼도 따라 바뀐다", () => {
    render(<Host initial={[E("a", "어학", 50), E("b", "코딩", 30), E("other", "기타", 20)]} />);
    fireEvent.click(screen.getByRole("button", { name: "고르게 나누기" }));
    expect(screen.getAllByText("50%")).toHaveLength(2);
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(2);
  });

  it("모두 0%여도 깨지지 않는다: 다이얼은 빈 원, −/+ 단추는 그대로 쓴다", () => {
    render(<Host initial={[E("a", "어학", 0), E("b", "코딩", 0), E("other", "기타", 0)]} />);
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(0);
    expect(document.querySelectorAll('[role="slider"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "어학 5% 늘리기" }));
    expect(screen.getByText("합계 5%")).toBeTruthy();
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(1);
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
});
