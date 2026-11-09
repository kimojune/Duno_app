// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeWheel, WHEEL_ROW_PX, WHEEL_SNAP_MS } from "../../components/time-wheel";
import {
  canMove,
  columnEdge,
  moveColumn,
  neighbors,
  nudgeTotal,
  parseColumnInput,
  stepMinute,
  withColumn,
} from "../../lib/time-wheel";
import { typeWheel, wheelTotal, wheelValue } from "./time-wheel-helpers";

/** 두 줄 휠(고침9, 명세 ⑦-4 · D-170 · Figma 49:5 / 66:170) */

function Host({ initial = 0, onChange }: { initial?: number; onChange?: (n: number) => void }) {
  const [total, setTotal] = useState(initial);
  return (
    <div role="dialog" aria-label="바깥 창" onKeyDown={(e) => e.key === "Escape" && onChange?.(-1)}>
      <TimeWheel
        id="w"
        total={total}
        onChange={(n) => {
          setTotal(n);
          onChange?.(n);
        }}
      />
      <button type="button">바깥 단추</button>
    </div>
  );
}
const spin = (label: "시간" | "분") => screen.getByRole("spinbutton", { name: label });
const key = (label: "시간" | "분", k: string) => fireEvent.keyDown(spin(label), { key: k });
const centerText = (label: "시간" | "분") => spin(label).querySelector(".time-wheel-center")!.textContent;
const dimTexts = (label: "시간" | "분") => Array.from(spin(label).querySelectorAll(".time-wheel-dim")).map((e) => e.textContent);

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  window.matchMedia = globalThis.matchMedia;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("값 계산(lib/time-wheel)", () => {
  it("분 열은 5분 눈금으로 걸리고 0~55 밖으로 나가지 않는다. 5의 배수가 아닌 값은 가까운 눈금으로", () => {
    expect([stepMinute(30, 1), stepMinute(30, -1)]).toEqual([35, 25]);
    expect([stepMinute(47, 1), stepMinute(47, -1)]).toEqual([50, 45]);
    expect([stepMinute(55, 1), stepMinute(0, -1)]).toEqual([55, 0]);
  });
  it("시간 열 0~24, 합은 24시간(1440분)을 넘지 않는다 — 24시간이면 분은 0", () => {
    expect(moveColumn(23 * 60 + 30, "hours", 1)).toBe(1440);
    expect(moveColumn(1440, "hours", 1)).toBe(1440);
    expect(moveColumn(1440, "minutes", 1)).toBe(1440);
    expect(canMove(1440, "hours", 1)).toBe(false);
    expect(canMove(1440, "minutes", 1)).toBe(false);
    expect(canMove(0, "hours", -1)).toBe(false);
    expect(columnEdge(90, "hours", "max")).toBe(1440);
    expect(columnEdge(90, "minutes", "max")).toBe(115);
    expect(columnEdge(90, "minutes", "min")).toBe(60);
  });
  it("「− 5분」「+ 5분」은 합을 5분 눈금으로 옮기고 분이 넘치면 시간으로 넘어간다", () => {
    expect(nudgeTotal(55, 1)).toBe(60);
    expect(nudgeTotal(60, -1)).toBe(55);
    expect(nudgeTotal(47, 1)).toBe(50);
    expect(nudgeTotal(47, -1)).toBe(45);
    expect(nudgeTotal(0, -1)).toBe(0);
    expect(nudgeTotal(1440, 1)).toBe(1440);
  });
  it("악용: 숫자 바로 쓰기는 범위 밖을 끝값으로, 숫자가 아니면 그대로(null), 분은 5분 단위로 맞춘다 — 정상 값은 그대로", () => {
    expect(parseColumnInput("25", "hours")).toBe(24);
    expect(parseColumnInput("-3", "hours")).toBe(0);
    expect(parseColumnInput("1e9", "hours")).toBe(24);
    expect(parseColumnInput("abc", "hours")).toBeNull();
    expect(parseColumnInput("", "minutes")).toBeNull();
    expect(parseColumnInput("7", "minutes")).toBe(5);
    expect(parseColumnInput("58", "minutes")).toBe(55);
    expect(parseColumnInput("-10", "minutes")).toBe(0);
    expect(parseColumnInput("2", "hours")).toBe(2);
    expect(parseColumnInput("30", "minutes")).toBe(30);
    expect(withColumn(60, "hours", 24)).toBe(1440);
    expect(withColumn(1440, "minutes", 30)).toBe(1440);
  });
  it("가운데 위아래 흐린 값 둘씩(범위 밖 자리는 비움)", () => {
    expect(neighbors(2, "hours")).toEqual({ above: [0, 1], below: [3, 4] });
    expect(neighbors(0, "hours")).toEqual({ above: [null, null], below: [1, 2] });
    expect(neighbors(24, "hours")).toEqual({ above: [22, 23], below: [null, null] });
    expect(neighbors(30, "minutes")).toEqual({ above: [20, 25], below: [35, 40] });
    expect(neighbors(5, "minutes")).toEqual({ above: [null, 0], below: [10, 15] });
  });
});

describe("TimeWheel 화면", () => {
  it("열마다 spinbutton(이름 「시간」「분」, 값 글 「2시간」「30분」, 범위). 가운데 32 Bold 글 = 값, 위아래 흐린 값(Figma 49:5: 0 1 [2] 3 4 · 20 25 [30] 35 40)", () => {
    render(<Host initial={150} />);
    const h = spin("시간");
    const m = spin("분");
    expect([h.getAttribute("aria-valuenow"), h.getAttribute("aria-valuetext"), h.getAttribute("aria-valuemin"), h.getAttribute("aria-valuemax")]).toEqual(["2", "2시간", "0", "24"]);
    expect([m.getAttribute("aria-valuenow"), m.getAttribute("aria-valuetext"), m.getAttribute("aria-valuemax")]).toEqual(["30", "30분", "55"]);
    expect([h.tabIndex, m.tabIndex]).toEqual([0, 0]);
    expect([centerText("시간"), centerText("분")]).toEqual(["2", "30"]);
    expect(dimTexts("시간")).toEqual(["0", "1", "3", "4"]);
    expect(dimTexts("분")).toEqual(["20", "25", "35", "40"]);
    // 바깥 두 줄(20)과 가운데 바로 위아래(24)를 가른다
    expect(Array.from(h.querySelectorAll(".time-wheel-dim")).map((e) => e.classList.contains("is-far"))).toEqual([true, false, false, true]);
    // 열 이름(12 보조)은 보이는 글이고 화면 읽기는 spinbutton 이름으로 읽는다
    expect(Array.from(document.querySelectorAll(".time-wheel-label")).map((e) => [e.textContent, e.getAttribute("aria-hidden")])).toEqual([
      ["시간", "true"],
      ["분", "true"],
    ]);
    expect(centerText("분")).toBe("30");
    cleanup();
    render(<Host initial={5} />);
    expect(centerText("분")).toBe("05"); // 분은 두 자리
  });

  it("PM 14: 5의 배수가 아닌 합(타이머가 채운 1·2분 등)도 분 휠은 5분 격자 값만 보인다(합은 만지기 전까지 그대로, 만지면 그 눈금에서 한 걸음)", () => {
    for (const [initial, shown, saved, dims] of [
      [1, "00", 0, ["", "", "05", "10"]],
      [2, "00", 0, ["", "", "05", "10"]],
      [3, "05", 5, ["", "00", "10", "15"]],
      [47, "45", 45, ["35", "40", "50", "55"]],
    ] as const) {
      const seen: number[] = [];
      render(<Host initial={initial} onChange={(n) => seen.push(n)} />);
      expect(centerText("분")).toBe(shown);
      expect(dimTexts("분")).toEqual([...dims]);
      expect(spin("분").getAttribute("aria-valuenow")).toBe(String(Number(shown)));
      expect(seen).toEqual([]); // 보이기만 맞춘다: 만지기 전에는 합을 바꾸지 않는다
      key("분", "ArrowUp");
      expect(seen).toEqual([saved + 5]); // 만지면 보이는 눈금에서 한 걸음
      cleanup();
    }
  });

  it("키보드: 위/아래 화살표 1시간·5분, PageUp/PageDown 3시간·15분(임시), Home/End 끝값", () => {
    const onChange = vi.fn();
    render(<Host initial={150} onChange={onChange} />);
    key("시간", "ArrowUp");
    expect(wheelTotal()).toBe(210);
    key("시간", "ArrowDown");
    key("시간", "ArrowDown");
    expect(wheelTotal()).toBe(90);
    key("분", "ArrowUp");
    expect(wheelValue("분")).toBe(35);
    key("분", "PageUp");
    expect(wheelValue("분")).toBe(50);
    key("분", "PageDown");
    expect(wheelValue("분")).toBe(35);
    key("분", "End");
    expect(wheelValue("분")).toBe(55);
    key("분", "Home");
    expect(wheelValue("분")).toBe(0);
    key("시간", "PageUp");
    expect(wheelValue("시간")).toBe(4);
    key("시간", "End");
    expect(wheelTotal()).toBe(1440);
    key("분", "ArrowUp"); // 24시간이면 분을 늘리지 못한다
    expect(wheelTotal()).toBe(1440);
    key("시간", "Home");
    expect(wheelTotal()).toBe(0);
    key("시간", "ArrowDown"); // 0 밑으로 가지 않는다
    expect(wheelTotal()).toBe(0);
    expect(onChange.mock.calls.every(([n]) => n >= 0 && n <= 1440 && n % 5 === 0)).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it("끌기(포인터): 손가락을 위로 한 칸 반 넘게 올리면 두 칸, 반 칸이 안 되면 그대로. 끄는 동안 칸 사이를 따라오고 손을 떼면 가운데로 걸린다(160ms)", () => {
    mockReducedMotion(false);
    render(<Host initial={120} />);
    const h = spin("시간");
    fireEvent.pointerDown(h, { pointerId: 1, clientY: 300 });
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 300 - 18 }); // 18px < 반 칸(22)
    expect(wheelValue("시간")).toBe(2); // 반 칸이 안 됨
    const track = h.querySelector<HTMLElement>(".time-wheel-track")!;
    expect(track.style.transform).toBe("translateY(-18px)"); // 손가락을 따라온다
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 300 - WHEEL_ROW_PX * 1.6 });
    expect(wheelValue("시간")).toBe(4); // 두 칸 걸림
    fireEvent.pointerUp(h, { pointerId: 1, clientY: 300 - WHEEL_ROW_PX * 1.6 });
    expect(track.style.transform).toBe("translateY(0px)");
    expect(track.style.transition).toBe(`transform ${WHEEL_SNAP_MS}ms ease-out`);
    // 아래로 끌면 작은 값
    fireEvent.pointerDown(spin("분"), { pointerId: 2, clientY: 100 });
    fireEvent.pointerMove(spin("분"), { pointerId: 2, clientY: 100 + WHEEL_ROW_PX });
    fireEvent.pointerUp(spin("분"), { pointerId: 2 });
    expect(wheelTotal()).toBe(4 * 60); // 분 0에서 더 내려가지 않는다
    // 끈 뒤의 누름(click)은 숫자 바로 쓰기를 열지 않는다
    fireEvent.click(spin("분").querySelector(".time-wheel-center")!);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("「동작 줄이기」면 끄는 동안 따라오지 않고 손을 떼도 걸림 움직임이 없다(값은 같은 칸씩 걸린다)", () => {
    mockReducedMotion(true);
    render(<Host initial={120} />);
    const h = spin("시간");
    const track = h.querySelector<HTMLElement>(".time-wheel-track")!;
    fireEvent.pointerDown(h, { pointerId: 1, clientY: 300 });
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 300 - WHEEL_ROW_PX * 1.2 });
    expect(wheelValue("시간")).toBe(3);
    expect(track.style.transform).toBe("translateY(0px)");
    expect(track.style.transition).toBe("none");
    fireEvent.pointerUp(h, { pointerId: 1 });
    expect([track.style.transform, track.style.transition]).toEqual(["", ""]); // 걸림 움직임 없음
  });

  it("휠·트랙패드: 아래로 굴리면 큰 값, 작은 굴림은 모아서 한 칸. 줄 단위(deltaMode 1)도 한 칸", () => {
    render(<Host initial={120} />);
    const h = spin("시간");
    fireEvent.wheel(h, { deltaY: 20 });
    expect(wheelValue("시간")).toBe(2);
    fireEvent.wheel(h, { deltaY: 20 });
    expect(wheelValue("시간")).toBe(3);
    fireEvent.wheel(h, { deltaY: -40 });
    expect(wheelValue("시간")).toBe(2);
    fireEvent.wheel(spin("분"), { deltaY: 1, deltaMode: 1 });
    expect(wheelValue("분")).toBe(5);
  });

  it("가운데 숫자를 누르면 두 열이 숫자 칸(숫자 자판 inputmode numeric, 이름 「시간」「분」)으로 바뀌고 누른 열 칸에 포커스. Enter면 끝나고 그 열로 포커스", () => {
    render(<Host initial={150} />);
    fireEvent.click(spin("분").querySelector(".time-wheel-center")!);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    const hour = screen.getByRole("textbox", { name: "시간" }) as HTMLInputElement;
    const minute = screen.getByRole("textbox", { name: "분" }) as HTMLInputElement;
    expect([hour.inputMode, minute.inputMode, hour.value, minute.value]).toEqual(["numeric", "numeric", "2", "30"]);
    expect(document.activeElement).toBe(minute);
    fireEvent.change(minute, { target: { value: "45" } });
    expect(wheelTotalFromInputs()).toEqual([2, 45]);
    fireEvent.keyDown(minute, { key: "Enter" });
    expect(document.activeElement).toBe(spin("분"));
    expect(wheelTotal()).toBe(165);
    // 키보드로도 연다(Enter)
    fireEvent.keyDown(spin("시간"), { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "시간" }));
  });

  it("숫자 칸 밖으로 나가면 끝, Esc면 쓰기 전 값으로 돌아가고 바깥 창의 Esc(닫기)로 가지 않는다", () => {
    const onChange = vi.fn();
    render(<Host initial={150} onChange={onChange} />);
    typeWheel("시간", 5); // 다음 열 칸으로 옮겨도 끝나지 않고, 바깥으로 나가면 끝
    fireEvent.click(spin("시간").querySelector(".time-wheel-center")!);
    const hour = screen.getByRole("textbox", { name: "시간" });
    const minute = screen.getByRole("textbox", { name: "분" });
    fireEvent.change(hour, { target: { value: "7" } });
    fireEvent.blur(hour, { relatedTarget: minute });
    expect(screen.getByRole("textbox", { name: "분" })).toBe(minute);
    fireEvent.keyDown(minute, { key: "Escape" });
    expect(wheelTotal()).toBe(5 * 60 + 30); // 7을 쓰기 전 값
    expect(onChange).not.toHaveBeenCalledWith(-1); // 바깥 창 Esc 아님
    fireEvent.click(spin("분").querySelector(".time-wheel-center")!);
    fireEvent.change(screen.getByRole("textbox", { name: "분" }), { target: { value: "10" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "분" }), { relatedTarget: screen.getByRole("button", { name: "바깥 단추" }) });
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(wheelTotal()).toBe(5 * 60 + 10);
  });

  it("악용: 바로 쓰기로 25시간·음수·1e9·분 7·글자를 넣어도 합은 0~24시간 5분 단위(범위 밖은 끝값, 글자는 무시). 정상 값은 그대로", () => {
    const onChange = vi.fn();
    render(<Host initial={60} onChange={onChange} />);
    typeWheel("시간", 25);
    expect(wheelTotal()).toBe(1440);
    typeWheel("시간", -1);
    expect(wheelTotal()).toBe(0);
    typeWheel("시간", "1e9");
    expect(wheelTotal()).toBe(1440);
    typeWheel("시간", "abc");
    expect(wheelTotal()).toBe(1440);
    typeWheel("시간", 1);
    typeWheel("분", 7);
    expect([wheelValue("시간"), wheelValue("분")]).toEqual([1, 5]);
    typeWheel("분", 30);
    expect(wheelTotal()).toBe(90);
    expect(onChange.mock.calls.length).toBeGreaterThan(0);
    expect(onChange.mock.calls.every(([n]) => Number.isInteger(n) && n >= 0 && n <= 1440 && n % 5 === 0)).toBe(true);
  });

  it("「− 5분」「+ 5분」(끌지 않는 길, 보이는 글이 이름): 5분씩, 55분 다음은 다음 시간. 0이면 「− 5분」, 24시간이면 「+ 5분」이 막힌다", () => {
    render(<Host initial={55} />);
    const minus = screen.getByRole("button", { name: "− 5분" });
    const plus = screen.getByRole("button", { name: "+ 5분" });
    expect([minus.className, plus.className]).toEqual(["btn btn-secondary time-wheel-nudge-btn", "btn btn-secondary time-wheel-nudge-btn"]);
    fireEvent.click(plus);
    expect([wheelValue("시간"), wheelValue("분")]).toEqual([1, 0]);
    fireEvent.click(minus);
    fireEvent.click(minus);
    expect(wheelTotal()).toBe(50);
    act(() => {
      for (let i = 0; i < 12; i++) fireEvent.click(minus);
    });
    expect(wheelTotal()).toBe(0);
    expect((minus as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<Host initial={1435} />);
    fireEvent.click(screen.getByRole("button", { name: "+ 5분" }));
    expect(wheelTotal()).toBe(1440);
    expect((screen.getByRole("button", { name: "+ 5분" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

function wheelTotalFromInputs() {
  return [Number((screen.getByRole("textbox", { name: "시간" }) as HTMLInputElement).value), Number((screen.getByRole("textbox", { name: "분" }) as HTMLInputElement).value)];
}
