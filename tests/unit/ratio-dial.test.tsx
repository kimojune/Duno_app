// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { HIT_R, RatioDial, shortName, splitUnit, type DialSlice } from "../../components/ratio-dial";

afterEach(cleanup);

const COLORS = ["#111", "#222", "#333", "#444"];
function slicesOf(values: number[], names = ["어학", "코딩", "운동", "기타"]): DialSlice[] {
  return values.map((value, i) => ({ key: `k${i}`, name: names[i], color: COLORS[i], value }));
}

/** 선택과 값을 바깥에서 가지는 얇은 틀. onChange로 나온 값을 모아 둔다 */
function Harness({ initial, names, seen, selected0 = "k0" }: { initial: number[]; names?: string[]; seen: number[][]; selected0?: string | null }) {
  const [values, setValues] = useState(initial);
  const [sel, setSel] = useState<string | null>(selected0);
  return (
    <>
      <RatioDial
        id="d"
        slices={slicesOf(values, names)}
        selectedKey={sel}
        onSelect={setSel}
        onChange={(v) => {
          seen.push(v);
          setValues(v);
        }}
      />
      <ul>
        {slicesOf(values, names).map((s) => (
          <li key={s.key}>
            <button type="button" aria-pressed={sel === s.key} onClick={() => setSel(s.key)}>
              {`이름 ${s.name}`}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

const slider = (side: "start" | "end" | "both") => document.getElementById(`d-handle-${side}`);
const handles = () => screen.queryAllByRole("slider");
const press = (el: Element, key: string) => fireEvent.keyDown(el, { key });

describe("원형 다이얼: 그리기와 고르기", () => {
  it("조각 수만큼 그려지고(폭 0인 조각은 그리지 않는다), 처음에는 첫 조각이 골라져 있다", () => {
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} />);
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(4);
    expect(document.querySelector(".dial-rim")?.getAttribute("d")).toBeTruthy(); // 고른 조각의 띠
    expect(screen.getByRole("button", { name: "이름 어학" }).getAttribute("aria-pressed")).toBe("true");
    cleanup();
    render(<Harness initial={[60, 40, 0, 0]} seen={[]} />);
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(2);
  });

  it("손잡이 수: 첫 조각은 끝 하나, 가운데 조각은 둘, 마지막 조각은 앞 하나. 아무것도 안 골랐으면 없다", () => {
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} />);
    expect(handles()).toHaveLength(1);
    expect(slider("end")).toBeTruthy();
    expect(slider("start")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "이름 코딩" }));
    expect(handles()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "이름 기타" }));
    expect(handles()).toHaveLength(1);
    expect(slider("start")).toBeTruthy();
    expect(slider("end")).toBeNull();
    cleanup();
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} selected0={null} />);
    expect(handles()).toHaveLength(0);
  });

  it("조각이 하나뿐이면 12시 말고는 경계가 없어 손잡이도 눈금도 없다", () => {
    render(<Harness initial={[100]} names={["어학"]} seen={[]} />);
    expect(handles()).toHaveLength(0);
    expect(document.querySelector(".dial-noon")).toBeNull();
  });

  it("조각을 누르면 고르고, 고른 조각을 다시 누르면 고름이 풀린다", () => {
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} />);
    const slices = document.querySelectorAll(".dial-slice");
    fireEvent.click(slices[2]);
    expect(screen.getByRole("button", { name: "이름 운동" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(document.querySelectorAll(".dial-slice")[2]);
    expect(handles()).toHaveLength(0);
  });

  it("목록에서 0% 분야의 이름을 누르면 그 조각이 골라진다. 폭 0이라 두 경계가 겹치면 손잡이는 하나이고, 키우면 둘로 갈리며 포커스를 잃지 않는다", () => {
    const seen: number[][] = [];
    render(<Harness initial={[60, 40, 0, 0]} seen={seen} />);
    fireEvent.click(screen.getByRole("button", { name: "이름 운동" })); // 폭 0이라 원에서는 누를 수 없다
    expect(screen.getByRole("button", { name: "이름 운동" }).getAttribute("aria-pressed")).toBe("true");
    expect(handles()).toHaveLength(1); // 겹친 두 손잡이 → 하나
    const both = slider("both")!;
    expect(both.getAttribute("aria-valuenow")).toBe("0");
    expect(both.getAttribute("aria-label")).toContain("코딩");
    expect(both.getAttribute("aria-label")).toContain("기타");
    both.focus();
    press(both, "ArrowLeft"); // 폭 0: 더 줄일 것이 없다
    expect(seen).toHaveLength(0);
    press(both, "ArrowRight"); // 뒤 이웃(기타)이 0이라 앞 이웃(코딩)에서 가져온다
    expect(seen.at(-1)).toEqual([60, 39, 1, 0]);
    expect(handles()).toHaveLength(2);
    expect(document.activeElement).toBe(slider("start")); // 움직인 경계의 손잡이로 포커스
    press(slider("start")!, "PageUp"); // 운동이 5% 더 커진다(코딩에서)
    expect(seen.at(-1)).toEqual([60, 34, 6, 0]);
    press(slider("end")!, "ArrowRight"); // 뒤 이웃(기타)이 0이라 더 키울 수 없다 — 값이 안 바뀌면 onChange도 없다
    expect(seen).toHaveLength(2);
    // 다시 0까지 줄이면 손잡이가 하나로 합쳐지고 포커스는 그 손잡이로 간다
    slider("start")!.focus();
    press(slider("start")!, "Home");
    expect(seen.at(-1)).toEqual([60, 40, 0, 0]);
    expect(handles()).toHaveLength(1);
    expect(document.activeElement).toBe(slider("both"));
    for (const v of seen) expect(v.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("선택이 목록에 없는 key면 다이얼도 목록도 아무것도 안 고른 것으로 보인다(손잡이·띠 없음)", () => {
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} selected0="없는 분야" />);
    expect(handles()).toHaveLength(0);
    expect(document.querySelector(".dial-rim")?.getAttribute("d")).toBe("");
    expect(document.querySelector(".dial-center-name")).toBeNull();
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(4);
  });

  it("첫 조각은 늘 12시에서 시작한다: 손잡이로 이리저리 바꿔도 처음 그린 조각의 시작점이 맨 위(0, −100)", () => {
    render(<Harness initial={[20, 30, 50]} names={["어학", "코딩", "기타"]} seen={[]} />);
    const firstStart = () => document.querySelectorAll(".dial-slice")[0].getAttribute("d")!.split("A")[0].trim();
    expect(firstStart()).toBe("M0 0 L0.000 -100.000");
    for (const key of ["PageUp", "PageUp", "End", "Home", "ArrowRight"]) {
      press(slider("end")!, key);
      expect(firstStart(), key).toBe("M0 0 L0.000 -100.000");
    }
    fireEvent.click(screen.getByRole("button", { name: "이름 기타" }));
    press(slider("start")!, "End"); // 기타가 코딩을 다 가져간다
    expect(firstStart()).toBe("M0 0 L0.000 -100.000");
  });
});

describe("원형 다이얼: 손잡이 키보드와 알림", () => {
  it("화살표는 1%, PageUp/PageDown은 5% — 고른 조각과 이웃 조각이 그만큼 바뀌고 합이 100이다", () => {
    const seen: number[][] = [];
    render(<Harness initial={[40, 30, 20, 10]} seen={seen} />);
    const end = slider("end")!;
    press(end, "ArrowRight");
    expect(seen.at(-1)).toEqual([41, 29, 20, 10]);
    press(slider("end")!, "ArrowUp");
    expect(seen.at(-1)).toEqual([42, 28, 20, 10]);
    press(slider("end")!, "PageUp");
    expect(seen.at(-1)).toEqual([47, 23, 20, 10]);
    press(slider("end")!, "PageDown");
    expect(seen.at(-1)).toEqual([42, 28, 20, 10]);
    press(slider("end")!, "ArrowLeft");
    press(slider("end")!, "ArrowDown");
    expect(seen.at(-1)).toEqual([40, 30, 20, 10]);
    for (const v of seen) expect(v.reduce((a, b) => a + b, 0)).toBe(100);
    // 가운데 조각: 앞 손잡이는 앞 조각과, 끝 손잡이는 뒤 조각과 나눈다
    fireEvent.click(screen.getByRole("button", { name: "이름 코딩" }));
    press(slider("start")!, "ArrowRight"); // 코딩이 커진다 → 어학이 줄어든다
    expect(seen.at(-1)).toEqual([39, 31, 20, 10]);
    press(slider("end")!, "ArrowRight"); // 코딩이 커진다 → 운동이 줄어든다
    expect(seen.at(-1)).toEqual([39, 32, 19, 10]);
  });

  it("손잡이는 role=slider이고 값·이름이 맞다(분야 이름 전체가 접근성 이름에 있다)", () => {
    render(<Harness initial={[40, 30, 20, 10]} names={["아주아주아주긴분야이름입니다", "코딩", "운동", "기타"]} seen={[]} />);
    const end = slider("end")!;
    expect(end.getAttribute("role")).toBe("slider");
    expect(end.getAttribute("aria-valuenow")).toBe("40");
    expect(end.getAttribute("aria-valuemin")).toBe("0");
    expect(end.getAttribute("aria-valuemax")).toBe("100");
    expect(end.getAttribute("aria-valuetext")).toBe("40%");
    expect(end.getAttribute("aria-label")).toContain("아주아주아주긴분야이름입니다");
    expect(end.getAttribute("aria-label")).toContain("코딩");
  });

  it("바뀐 값이 aria-live 줄에 글로 나온다", () => {
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} />);
    const live = document.getElementById("d-changes")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent?.trim()).toBe("");
    press(slider("end")!, "PageUp");
    expect(live.textContent).toBe("어학 40% → 45%, 코딩 30% → 25%");
    press(slider("end")!, "ArrowRight");
    expect(live.textContent).toBe("어학 45% → 46%, 코딩 25% → 24%");
  });

  it("끝까지 밀면 멈춘다: 0 밑으로 내려가지 않고 값이 안 바뀌면 onChange도 없다", () => {
    const seen: number[][] = [];
    render(<Harness initial={[50, 50, 0, 0]} seen={seen} />);
    for (let i = 0; i < 12; i++) press(slider("end")!, "PageUp"); // 어학이 50→100까지 (코딩 50→0)
    expect(seen.at(-1)).toEqual([100, 0, 0, 0]);
    const n = seen.length;
    press(slider("end")!, "PageUp");
    expect(seen).toHaveLength(n);
    for (let i = 0; i < 25; i++) press(slider("end")!, "PageDown");
    expect(seen.at(-1)).toEqual([0, 100, 0, 0]);
    for (const v of seen) {
      expect(v.every((x) => Number.isInteger(x) && x >= 0 && x <= 100)).toBe(true);
      expect(v.reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it("마지막 조각의 앞 손잡이는 12시를 넘지 못한다: 뒤로 더 키울 수 없고 0%까지만 내려간다", () => {
    const seen: number[][] = [];
    render(<Harness initial={[50, 40, 10]} names={["어학", "코딩", "기타"]} seen={seen} />);
    fireEvent.click(screen.getByRole("button", { name: "이름 기타" }));
    for (let i = 0; i < 3; i++) press(slider("start")!, "PageDown"); // 기타 10 → 0
    expect(seen.at(-1)).toEqual([50, 50, 0]);
    expect(handles()).toHaveLength(1); // 마지막 조각: 끝 손잡이 없음
  });

  it("합이 100이 아닌 값은 처음 만지는 순간 합 100의 정수로 맞춘 뒤 그 위에서 바뀐다", () => {
    const seen: number[][] = [];
    render(<Harness initial={[30, 30, 0, 0]} seen={seen} />);
    expect(slider("end")!.getAttribute("aria-valuenow")).toBe("50"); // 그리는 값은 합으로 나눈 것
    press(slider("end")!, "ArrowRight");
    expect(seen.at(-1)).toEqual([51, 49, 0, 0]);
    expect(document.getElementById("d-changes")!.textContent).toBe("어학 50% → 51%, 코딩 50% → 49%");
  });

  it("모두 0이면 깨지지 않는다: 조각도 손잡이도 없이 빈 원만 그리고, 가운데 글을 보인다", () => {
    const seen: number[][] = [];
    render(
      <RatioDial id="d" slices={slicesOf([0, 0, 0, 0])} selectedKey={null} onSelect={() => {}} onChange={(v) => seen.push(v)} center="비율 없음" />,
    );
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(0);
    expect(handles()).toHaveLength(0);
    expect(screen.getByText("비율 없음")).toBeTruthy();
    expect(seen).toHaveLength(0);
  });

  it("조각 구성이 바뀌면 바뀐 내용 안내를 지운다", () => {
    const seen: number[][] = [];
    function Grow() {
      const [extra, setExtra] = useState(false);
      const base = extra ? [30, 30, 20, 10, 10] : [40, 30, 20, 10];
      return (
        <>
          <button type="button" onClick={() => setExtra(true)}>
            더하기
          </button>
          <RatioDial
            id="d"
            slices={slicesOf(base, ["어학", "코딩", "운동", "기타", "독서"])}
            selectedKey="k0"
            onSelect={() => {}}
            onChange={(v) => seen.push(v)}
          />
        </>
      );
    }
    render(<Grow />);
    press(slider("end")!, "ArrowRight");
    expect(document.getElementById("d-changes")!.textContent).not.toBe(" ");
    fireEvent.click(screen.getByRole("button", { name: "더하기" }));
    expect(document.getElementById("d-changes")!.textContent?.trim()).toBe("");
  });
});

describe("원형 다이얼: 글과 스크롤", () => {
  it("분야 이름은 React 텍스트로만 그린다: 꺾쇠가 글로 나오고 요소가 되지 않는다", () => {
    const evil = "<img src=x onerror=alert(1)>";
    render(<Harness initial={[40, 30, 20, 10]} names={[evil, "코딩", "운동", "기타"]} seen={[]} />);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("svg script")).toBeNull();
    // 가운데 표시는 줄인 글, 전체 이름은 손잡이 이름에 글로
    expect(slider("end")!.getAttribute("aria-label")).toContain(evil);
    expect(screen.getByRole("button", { name: `이름 ${evil}` })).toBeTruthy();
    press(slider("end")!, "ArrowRight");
    expect(document.getElementById("d-changes")!.textContent).toContain(evil);
    expect(document.querySelector("#d-changes img")).toBeNull();
  });

  it("긴 이름은 가운데 표시에서 줄여 그린다(글자 단위, 이모지를 반으로 자르지 않는다)", () => {
    expect(shortName("어학")).toBe("어학");
    expect(shortName("일곱글자이름입니다")).toBe("일곱글자이름…");
    expect(shortName("😀".repeat(10))).toBe("😀".repeat(6) + "…");
    const long = "아주아주아주긴분야이름입니다";
    render(<Harness initial={[40, 30, 20, 10]} names={[long, "코딩", "운동", "기타"]} seen={[]} />);
    const name = document.querySelector(".dial-center-name")!;
    expect(name.textContent).toBe(shortName(long));
    expect(name.textContent!.length).toBeLessThan(long.length);
    expect(name.getAttribute("aria-hidden")).toBe("true");
  });

  it("가운데 표시는 숫자와 단위를 따로 그린다(45%)", () => {
    expect(splitUnit("45%")).toEqual(["45", "%"]);
    expect(splitUnit("1시간 30분")).toEqual(["1", "시간 30분"]);
    expect(splitUnit("없음")).toEqual(["없음", ""]);
    render(<Harness initial={[45, 55, 0, 0]} seen={[]} />);
    expect(document.querySelector(".dial-center-value")?.textContent).toBe("45%");
  });

  it("조각마다 아래 줄 글(sub)과 값 글(format)을 바깥에서 받는다(분 단위로도 쓸 수 있다)", () => {
    const seen: number[][] = [];
    render(
      <RatioDial
        id="d"
        total={120}
        slices={slicesOf([60, 40, 20, 0])}
        selectedKey="k1"
        onSelect={() => {}}
        onChange={(v) => seen.push(v)}
        format={(v) => `${v}분`}
        sub={(s, v) => `${s.name} ${Math.floor(v / 60)}시간 ${v % 60}분`}
      />,
    );
    expect(document.querySelector(".dial-center-value")?.textContent).toBe("코딩 0시간 40분");
    expect(slider("end")!.getAttribute("aria-valuemax")).toBe("120");
    expect(slider("end")!.getAttribute("aria-valuetext")).toBe("40분");
    press(slider("end")!, "PageUp");
    expect(seen.at(-1)).toEqual([60, 45, 15, 0]);
    expect(seen.at(-1)!.reduce((a, b) => a + b, 0)).toBe(120);
    expect(document.getElementById("d-changes")!.textContent).toBe("코딩 40분 → 45분, 운동 20분 → 15분");
  });

  it("touch-action: none은 손잡이에만 있고, 다이얼 바탕(svg)·조각에는 없다", () => {
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} />);
    const handle = slider("end")!;
    const svg = document.querySelector("svg.dial")!;
    // ① 계산된 스타일(손잡이는 인라인으로도 막아 두었다)
    expect(getComputedStyle(handle).touchAction || handle.style.touchAction || handle.getAttribute("style")).toMatch(/none/);
    expect((svg as SVGElement).style.touchAction ?? "").not.toBe("none");
    expect(svg.getAttribute("style") ?? "").not.toMatch(/touch-action/);
    for (const p of document.querySelectorAll(".dial-slice")) expect(p.getAttribute("style") ?? "").not.toMatch(/touch-action/);
    // ② 클래스와 CSS 규칙: .dial-handle에만 touch-action이 있다
    expect(handle.getAttribute("class")).toContain("dial-handle");
    expect(svg.getAttribute("class")).toBe("dial");
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /touch-action/.test(m[2]));
    const withDial = rules.filter((m) => /\.dial|\.ratio-dial/.test(m[1]));
    expect(withDial).toHaveLength(1);
    expect(withDial[0][1].trim()).toBe(".dial-handle");
    expect(withDial[0][2]).toMatch(/touch-action:\s*none/);
  });

  it("Home/End: 고른 조각을 그 손잡이 쪽 끝까지(End = 이웃을 0까지, Home = 고른 조각을 0까지)", () => {
    const seen: number[][] = [];
    render(<Harness initial={[40, 30, 20, 10]} seen={seen} />);
    fireEvent.click(screen.getByRole("button", { name: "이름 코딩" }));
    press(slider("end")!, "End"); // 코딩이 운동을 다 가져간다
    expect(seen.at(-1)).toEqual([40, 50, 0, 10]);
    press(slider("start")!, "End"); // 코딩이 어학을 다 가져간다
    expect(seen.at(-1)).toEqual([0, 90, 0, 10]);
    press(slider("end")!, "Home"); // 코딩을 뒤 쪽(운동)으로 다 넘긴다
    expect(seen.at(-1)).toEqual([0, 0, 90, 10]);
  });

  it("손잡이 누르는 자리(보이지 않는 원)는 지름 48 이상이다(다이얼 최대 폭 240px = viewBox 240, 1:1). 보이는 고리는 그대로 16", () => {
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} />);
    const svg = document.querySelector("svg.dial")!;
    expect(svg.getAttribute("viewBox")).toBe("-120 -120 240 240");
    const hit = slider("end")!.querySelector(".dial-hit")!;
    expect(Number(hit.getAttribute("r")) * 2).toBeGreaterThanOrEqual(48);
    expect(HIT_R * 2).toBeGreaterThanOrEqual(48);
    expect(slider("end")!.querySelector(".dial-ring")!.getAttribute("r")).toBe("16");
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toMatch(/\.dial \{[^}]*max-width: 240px/);
  });

  it("손잡이를 끌 때 포인터 잡기를 못 해도(jsdom) 깨지지 않는다", () => {
    const seen: number[][] = [];
    render(<Harness initial={[40, 30, 20, 10]} seen={seen} />);
    const svg = document.querySelector("svg.dial")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    const end = slider("end")!;
    // 12시 방향(100,0)에서 시계 방향으로 3.6도(= 1%) 끈다
    fireEvent.pointerDown(end, { clientX: 100, clientY: 0, pointerId: 1 });
    const a = (0.01 * 2 * Math.PI) - Math.PI / 2;
    fireEvent.pointerMove(end, { clientX: 100 + 100 * Math.cos(a), clientY: 100 + 100 * Math.sin(a), pointerId: 1 });
    fireEvent.pointerUp(end, { pointerId: 1 });
    expect(seen.at(-1)).toEqual([41, 29, 20, 10]);
  });
});

/** 다이얼 중심(100,100), 반지름 100인 상자에서 t(0=12시, 시계 방향 0..1) 자리의 포인터 좌표 */
function at(t: number) {
  const a = t * 2 * Math.PI - Math.PI / 2;
  return { clientX: 100 + 90 * Math.cos(a), clientY: 100 + 90 * Math.sin(a), pointerId: 1 };
}
function box() {
  const svg = document.querySelector("svg.dial")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  return svg;
}
/** from → to를 여러 걸음으로 끈다(실제 손가락처럼 조금씩) */
function dragAlong(el: Element, from: number, to: number, steps = 20) {
  fireEvent.pointerDown(el, at(from));
  for (let i = 1; i <= steps; i++) fireEvent.pointerMove(document.querySelector("svg.dial")!, at(from + ((to - from) * i) / steps));
}

describe("원형 다이얼: 포인터 끌기 경계(0%·12시)", () => {
  it("첫 조각의 끝 손잡이를 반시계로 12시를 넘겨 끌어도 0%에서 멈추고 100%로 뛰지 않는다. 돌아오면 손가락 자리를 따른다", () => {
    const seen: number[][] = [];
    render(<Harness initial={[40, 30, 20, 10]} seen={seen} />);
    box();
    dragAlong(slider("end")!, 0.4, -0.1); // 40% 자리에서 12시를 넘어 90% 자리까지(반시계)
    expect(seen.at(-1)).toEqual([0, 70, 20, 10]);
    for (const v of seen) {
      expect(v[0]).toBeLessThanOrEqual(40); // 한 번도 뛰지 않았다
      expect(v.reduce((a, b) => a + b, 0)).toBe(100);
    }
    for (let i = 1; i <= 10; i++) fireEvent.pointerMove(document.querySelector("svg.dial")!, at(-0.1 + (0.3 * i) / 10)); // 20% 자리로 돌아온다
    fireEvent.pointerUp(document.querySelector("svg.dial")!, { pointerId: 1 });
    expect(seen.at(-1)).toEqual([20, 50, 20, 10]);
  });

  it("마지막 조각의 앞 손잡이를 시계로 12시를 넘겨 끌어도 마지막 조각이 0%에서 멈춘다(첫 조각에 붙지 않는다)", () => {
    const seen: number[][] = [];
    render(<Harness initial={[40, 30, 20, 10]} seen={seen} />);
    box();
    fireEvent.click(screen.getByRole("button", { name: "이름 기타" }));
    dragAlong(slider("start")!, 0.9, 1.15);
    fireEvent.pointerUp(document.querySelector("svg.dial")!, { pointerId: 1 });
    expect(seen.at(-1)).toEqual([40, 30, 30, 0]);
    for (const v of seen) expect(v[0]).toBe(40);
  });

  it("이웃이 0%가 되면 더 끌어도 멈춘다(가운데 조각)", () => {
    const seen: number[][] = [];
    render(<Harness initial={[40, 30, 20, 10]} seen={seen} />);
    box();
    fireEvent.click(screen.getByRole("button", { name: "이름 코딩" }));
    dragAlong(slider("end")!, 0.7, 0.98); // 운동(20)을 넘어 기타 쪽까지
    fireEvent.pointerUp(document.querySelector("svg.dial")!, { pointerId: 1 });
    expect(seen.at(-1)).toEqual([40, 50, 0, 10]);
  });

  it("겹친 손잡이(폭 0 조각)는 끌기 시작한 방향으로 경계를 정한다: 시계 = 뒤 이웃에서, 반시계 = 앞 이웃에서", () => {
    const seen: number[][] = [];
    render(<Harness initial={[50, 0, 50]} names={["어학", "코딩", "기타"]} seen={seen} />);
    box();
    fireEvent.click(screen.getByRole("button", { name: "이름 코딩" }));
    expect(handles()).toHaveLength(1);
    dragAlong(slider("both")!, 0.5, 0.6, 5); // 시계 방향
    fireEvent.pointerUp(document.querySelector("svg.dial")!, { pointerId: 1 });
    expect(seen.at(-1)).toEqual([50, 10, 40]);
    cleanup();
    const seen2: number[][] = [];
    render(<Harness initial={[50, 0, 50]} names={["어학", "코딩", "기타"]} seen={seen2} />);
    box();
    fireEvent.click(screen.getByRole("button", { name: "이름 코딩" }));
    dragAlong(slider("both")!, 0.5, 0.4, 5); // 반시계 방향
    fireEvent.pointerUp(document.querySelector("svg.dial")!, { pointerId: 1 });
    expect(seen2.at(-1)).toEqual([40, 10, 50]);
  });

  it("분 단위(step 5): 끌기도 5분 단위로 반올림한다", () => {
    const seen: number[][] = [];
    render(
      <RatioDial id="d" total={120} step={5} slices={slicesOf([60, 30, 30])} selectedKey="k0" onSelect={() => {}} onChange={(v) => seen.push(v)} format={(v) => `${v}분`} />,
    );
    box();
    dragAlong(slider("end")!, 0.5, 0.52, 3); // 60분 자리에서 2.4분만큼 → 60(그대로)
    expect(seen).toHaveLength(0);
    dragAlong(slider("end")!, 0.5, 0.535, 3); // 4.2분 → 65
    fireEvent.pointerUp(document.querySelector("svg.dial")!, { pointerId: 1 });
    expect(seen.at(-1)).toEqual([65, 25, 30]);
    expect(seen.every((v) => v.every((x) => x % 5 === 0))).toBe(true);
  });
});

describe("원형 다이얼: 키보드만으로 조각 고르기(부품 안의 길)", () => {
  it("다이얼이 탭 한 자리이고, 화살표로 앞뒤 조각·Home/End로 첫·마지막 조각을 고른다. 폭 0인 조각도 고른다. 고른 것을 안내한다", () => {
    const picks: (string | null)[] = [];
    function Solo() {
      const [sel, setSel] = useState<string | null>(null);
      return (
        <RatioDial
          id="d"
          slices={slicesOf([60, 40, 0, 0])}
          selectedKey={sel}
          onSelect={(k) => {
            picks.push(k);
            setSel(k);
          }}
          onChange={() => {}}
        />
      );
    }
    render(<Solo />);
    const svg = document.querySelector("svg.dial") as unknown as HTMLElement;
    expect(svg.getAttribute("tabindex")).toBe("0");
    expect(svg.getAttribute("aria-label")).toContain("원형 다이얼");
    act(() => svg.focus());
    expect(document.activeElement).toBe(svg);
    press(svg, "ArrowRight"); // 아무것도 안 골랐으면 첫 조각
    expect(picks.at(-1)).toBe("k0");
    expect(document.getElementById("d-changes")!.textContent).toBe("어학 고름, 60%");
    press(svg, "ArrowRight");
    press(svg, "ArrowRight"); // 폭 0인 운동
    expect(picks.at(-1)).toBe("k2");
    expect(document.getElementById("d-handle-both")).toBeTruthy();
    press(svg, "End");
    expect(picks.at(-1)).toBe("k3");
    press(svg, "ArrowRight"); // 끝에서 멈춘다
    expect(picks.at(-1)).toBe("k3");
    press(svg, "Home");
    expect(picks.at(-1)).toBe("k0");
    press(svg, "ArrowLeft"); // 처음에서 멈춘다
    expect(picks).toEqual(["k0", "k1", "k2", "k3", "k0"]);
  });

  it("손잡이 위의 화살표는 조각 고르기로 올라가지 않고, Esc·Tab은 막지 않는다(창 닫기 규칙을 깨지 않는다)", () => {
    const outer = vi.fn();
    const picks: (string | null)[] = [];
    render(
      <div onKeyDown={(e) => outer(e.key, e.defaultPrevented)}>
        <RatioDial id="d" slices={slicesOf([60, 40])} selectedKey="k0" onSelect={(k) => picks.push(k)} onChange={() => {}} />
      </div>,
    );
    press(slider("end")!, "ArrowRight");
    expect(picks).toHaveLength(0);
    const svg = document.querySelector("svg.dial")!;
    press(svg, "Escape");
    press(slider("end")!, "Escape");
    press(svg, "Tab");
    expect(outer).toHaveBeenCalledWith("Escape", false);
    expect(outer.mock.calls.filter((c) => c[0] === "Escape")).toHaveLength(2);
    expect(outer).toHaveBeenCalledWith("Tab", false);
  });

  it("조각이 하나뿐이면 키보드로 골라도 손잡이가 없다", () => {
    render(<Harness initial={[100]} names={["어학"]} seen={[]} selected0={null} />);
    const svg = document.querySelector("svg.dial")!;
    press(svg, "ArrowRight");
    expect(screen.getByRole("button", { name: "이름 어학" }).getAttribute("aria-pressed")).toBe("true");
    expect(handles()).toHaveLength(0);
  });
});
