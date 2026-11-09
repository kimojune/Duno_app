// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { skipZeroHandles } from "../../lib/ratio-dial-calc";
import { DIAL_GAP, DIAL_GLOW, DIAL_MOTION_MS, DIAL_OUTLINE, DIAL_POP, HIT_R, KNOB_STROKE, popOffset, RatioDial, sectorPath, shortName, splitUnit, type DialSlice } from "../../components/ratio-dial";

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
    // 고른 조각 표시(고침 5바퀴, PM 9 — 옛 3px 띠 대신): 그 조각에만 is-picked·빛 번짐
    expect(document.querySelectorAll(".dial-slice.is-picked")).toHaveLength(1);
    expect(document.querySelector(".dial-slice.is-picked")).toBe(document.querySelectorAll(".dial-slice")[0]);
    expect(document.querySelectorAll(".dial-glow")).toHaveLength(1);
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
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(4);
    expect(document.querySelector(".dial-slice.is-picked")).toBeNull(); // 고른 조각 표시(나옴·빛) 없음
    expect(document.querySelector(".dial-glow")).toBeNull();
    expect(document.querySelector(".dial-center-name")).toBeNull();
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(4);
  });

  it("첫 조각은 늘 12시에서 시작한다: 손잡이로 이리저리 바꿔도 처음 그린 조각의 시작점이 맨 위(0, −100) — 흰 틈 절반 + 윤곽 절반만큼 오른쪽", () => {
    render(<Harness initial={[20, 30, 50]} names={["어학", "코딩", "기타"]} seen={[]} />);
    // 고침 5바퀴: 조각 사이 흰 틈 2px(PM 9)이라 첫 조각의 바깥 시작점은 12시 반지름 선에서 오른쪽으로 최대 1.5 옮긴 바깥 원 위의 점
    // (보통 (1.5, −99.989), 아주 가는 조각은 틈을 줄여 더 12시 가까이). 12시에서 벗어나면 x가 1.5를 넘는다
    const firstStart = () => document.querySelectorAll(".dial-slice")[0].getAttribute("d")!.split("A")[0].trim();
    const atNoon = (label: string) => {
      const m = /^M(-?[\d.]+) (-?[\d.]+)$/.exec(firstStart());
      expect(m, `${label}: ${firstStart()}`).toBeTruthy();
      const [x, y] = [Number(m![1]), Number(m![2])];
      expect(x, label).toBeGreaterThan(0);
      expect(x, label).toBeLessThanOrEqual(1.5);
      expect(y, label).toBeLessThan(-99.98);
      expect(Math.hypot(x, y), label).toBeCloseTo(100, 2);
    };
    expect(firstStart()).toBe("M1.500 -99.989");
    for (const key of ["PageUp", "PageUp", "End", "Home", "ArrowRight"]) {
      press(slider("end")!, key);
      atNoon(key);
    }
    fireEvent.click(screen.getByRole("button", { name: "이름 기타" }));
    press(slider("start")!, "End"); // 기타가 코딩을 다 가져간다
    atNoon("기타 End");
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

  it("손잡이 누르는 자리(보이지 않는 원)는 지름 48 이상이다(다이얼 최대 폭 240px = viewBox 240, 1:1). 보이는 손잡이는 흰 원 + 2px, 지름 20~22(PM 9)", () => {
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} />);
    const svg = document.querySelector("svg.dial")!;
    expect(svg.getAttribute("viewBox")).toBe("-120 -120 240 240");
    const hit = slider("end")!.querySelector(".dial-hit")!;
    expect(Number(hit.getAttribute("r")) * 2).toBeGreaterThanOrEqual(48);
    expect(HIT_R * 2).toBeGreaterThanOrEqual(48);
    // 고침 5바퀴: 보이는 손잡이 = 흰 원(r 10) + 2px 테두리 → 보이는 지름 22(옛 고리 16·안쪽 원·색 점은 없앴다 — 명세 ③ E)
    const ring = slider("end")!.querySelector(".dial-ring")!;
    expect(ring.getAttribute("r")).toBe("10");
    const visible = 2 * Number(ring.getAttribute("r")) + KNOB_STROKE;
    expect(visible).toBeGreaterThanOrEqual(20);
    expect(visible).toBeLessThanOrEqual(22);
    expect(slider("end")!.querySelectorAll("circle")).toHaveLength(2); // 누르는 자리 + 흰 원뿐
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toMatch(/\.dial \{[^}]*max-width: 240px/);
    expect(css).toMatch(/\.dial-ring \{[^}]*fill: var\(--color-surface\);[^}]*stroke: var\(--color-text\);[^}]*stroke-width: 2;/);
    expect(KNOB_STROKE).toBe(2);
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
    expect(document.getElementById("d-changes")!.textContent).toBe("어학 60%, 고름"); // 화면 읽기 「{분야} {값}, 고름」(PM 10 ⑩)
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

describe("원형 다이얼: 합(total)이 0 이하(다이얼 고침1)", () => {
  it("total 0에 조각이 골라져 있어도 띠·조각·손잡이를 그리지 않고 NaN이 나오지 않는다", () => {
    render(
      <RatioDial id="d" total={0} slices={slicesOf([0, 0, 0])} selectedKey="k0" onSelect={() => {}} onChange={() => {}} format={(v) => `${v}분`} />,
    );
    expect(document.querySelector(".dial-glow")).toBeNull();
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(0);
    expect(handles()).toHaveLength(0);
    expect(document.querySelector("svg.dial")!.outerHTML).not.toMatch(/NaN|Infinity/);
  });
});

/** 고침 5바퀴(PM 9 · 명세 ② 「다이얼의 고른 조각」): 조각 윤곽·틈, 고른 조각 3px 나옴·빛 번짐, 움직임 */
describe("원형 다이얼: 조각 모양과 고른 조각(PM 9)", () => {
  const translateOf = (el: Element) => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((el as SVGElement).style.transform);
    expect(m, (el as SVGElement).style.transform).toBeTruthy();
    return [Number(m![1]), Number(m![2])] as [number, number];
  };

  it("고른 조각만 조각 가운데 각도 쪽 바깥으로 3px 옮긴다(모양은 그대로). 고르지 않은 조각은 제자리", () => {
    render(<Harness initial={[25, 25, 25, 25]} seen={[]} selected0="k1" />); // 코딩 = 1/4~2/4 바퀴, 가운데 각도 = 오른쪽 아래 45°
    const slices = [...document.querySelectorAll(".dial-slice")];
    expect(slices).toHaveLength(4);
    const [x, y] = translateOf(slices[1]);
    expect(DIAL_POP).toBe(3);
    expect(Math.hypot(x, y)).toBeCloseTo(DIAL_POP, 1);
    expect(x).toBeCloseTo(3 * Math.cos(Math.PI / 4), 1);
    expect(y).toBeCloseTo(3 * Math.sin(Math.PI / 4), 1);
    for (const i of [0, 2, 3]) expect(translateOf(slices[i])).toEqual([0, 0]);
    // 모양은 그대로: 고른 조각의 d는 그 자리의 조각 모양 그대로(옮김은 transform으로만)
    expect(slices[1].getAttribute("d")).toBe(sectorPath(0.25, 0.5));
    expect(popOffset(0.25, 0.5).map((v) => Number(v.toFixed(3)))).toEqual([2.121, 2.121]);
    fireEvent.click(screen.getByRole("button", { name: "이름 운동" }));
    expect(translateOf(document.querySelectorAll(".dial-slice")[1])).toEqual([0, 0]);
    const [x2, y2] = translateOf(document.querySelectorAll(".dial-slice")[2]);
    expect(Math.hypot(x2, y2)).toBeCloseTo(3, 1);
    expect(x2).toBeLessThan(0); // 운동 = 2/4~3/4 바퀴 → 왼쪽 아래
    expect(y2).toBeGreaterThan(0);
  });

  it("고른 조각에만 같은 분야 색 빛 번짐: 흐림 24(표준 편차 12) · 퍼짐 2 · 불투명 80%, 필터 영역이 그림 칸보다 넓어 잘리지 않는다", () => {
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} selected0="k2" />);
    const glows = document.querySelectorAll(".dial-glow");
    expect(glows).toHaveLength(1);
    const glow = glows[0] as SVGElement;
    const picked = document.querySelectorAll(".dial-slice")[2] as SVGElement;
    expect(glow.style.fill).toBe(picked.style.fill); // 고른 조각(운동)과 같은 분야 색
    expect(glow.style.fill).not.toBe((document.querySelectorAll(".dial-slice")[0] as SVGElement).style.fill);
    expect(glow.getAttribute("d")).toBe(picked.getAttribute("d"));
    expect(glow.style.transform).toBe(picked.style.transform); // 조각과 같이 나온다
    // 빛은 조각들 뒤(먼저 그림)
    expect(glow.compareDocumentPosition(document.querySelectorAll(".dial-slice")[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const filterId = /url\(#(.+)\)/.exec(glow.getAttribute("filter")!)![1];
    const filter = document.getElementById(filterId)!;
    expect(filter.tagName.toLowerCase()).toBe("filter");
    expect(DIAL_GLOW).toEqual({ blur: 24, spread: 2, opacity: 0.8 });
    expect(filter.querySelector("feMorphology")!.getAttribute("operator")).toBe("dilate");
    expect(filter.querySelector("feMorphology")!.getAttribute("radius")).toBe("2");
    expect(filter.querySelector("feGaussianBlur")!.getAttribute("stdDeviation")).toBe("12");
    expect(filter.querySelector("feFuncA")!.getAttribute("slope")).toBe("0.8");
    // 필터 영역: 그림 칸(viewBox −120~120)보다 넓다 — 가장자리 조각의 빛이 영역 끝에서 잘리지 않는다
    expect(filter.getAttribute("filterUnits")).toBe("userSpaceOnUse");
    expect(Number(filter.getAttribute("x"))).toBeLessThanOrEqual(-150);
    expect(Number(filter.getAttribute("width"))).toBeGreaterThanOrEqual(300);
    // 그림 칸 밖으로 번진 빛이 svg 끝에서 잘리지 않게 overflow visible
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toMatch(/\.dial \{[^}]*overflow: visible/);
  });

  it("원을 다 채운 조각(경계 없음)·폭 0인 조각은 나오지 않고 빛도 없다", () => {
    render(<Harness initial={[0, 0, 0, 100]} seen={[]} selected0="k3" />);
    expect(document.querySelectorAll(".dial-slice")).toHaveLength(1);
    expect(translateOf(document.querySelector(".dial-slice")!)).toEqual([0, 0]);
    expect(document.querySelector(".dial-glow")).toBeNull();
    cleanup();
    render(<Harness initial={[60, 40, 0, 0]} seen={[]} selected0="k2" />);
    expect(document.querySelector(".dial-glow")).toBeNull();
    const all = [...document.querySelectorAll(".dial-slice")];
    expect(all).toHaveLength(2);
    for (const p of all) expect(translateOf(p)).toEqual([0, 0]);
    expect(popOffset(0.2, 0.2)).toEqual([0, 0]);
    expect(popOffset(0, 1)).toEqual([0, 0]);
  });

  it("조각마다 1px 윤곽(--color-chart-outline, 없으면 같은 값 --color-text)이고, 이웃 조각 윤곽 사이에 흰 틈 2px이 남는다", () => {
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toMatch(/\.dial-slice \{[^}]*stroke: var\(--color-chart-outline, var\(--color-text\)\);[^}]*stroke-width: 1;/);
    expect(DIAL_OUTLINE).toBe(1);
    expect(DIAL_GAP).toBe(2);
    // 3시 경계: 앞 조각(12~3시)의 바깥 끝점과 뒤 조각(3~6시)의 바깥 시작점 사이 거리 3 = 윤곽 반 + 틈 2 + 윤곽 반
    const outerStart = (d: string) => /^M(-?[\d.]+) (-?[\d.]+)/.exec(d)!.slice(1).map(Number);
    const outerEnd = (d: string) => /A100 100 0 \d 1 (-?[\d.]+) (-?[\d.]+)/.exec(d)!.slice(1).map(Number);
    const a = outerEnd(sectorPath(0, 0.25));
    const b = outerStart(sectorPath(0.25, 0.5));
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    const between = Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(between - DIAL_OUTLINE).toBeCloseTo(DIAL_GAP, 2);
    expect(between).toBeGreaterThan(0);
    // 반 바퀴 근처에서 큰 호 여부가 맞다(엉뚱한 쪽 호를 그리지 않는다)
    expect(sectorPath(0, 0.502)).toMatch(/^M[^A]+A100 100 0 0 1/);
    expect(sectorPath(0, 0.6)).toMatch(/^M[^A]+A100 100 0 1 1/);
    // 아주 가는 조각(5분/24시간)도 NaN 없이 그린다
    expect(sectorPath(0.3, 0.3 + 5 / 1440)).not.toMatch(/NaN/);
  });

  it("고른 조각이 나오는 움직임은 120ms, 「동작 줄이기」면 transition 없이 바로 나온다(나옴·빛은 그대로 보인다)", () => {
    expect(DIAL_MOTION_MS).toBe(120);
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} selected0="k1" />);
    const picked = document.querySelector(".dial-slice.is-picked") as SVGElement;
    expect(picked.style.transition).toBe("transform 120ms ease-out");
    cleanup();
    const mm = vi.fn((q: string) => ({
      matches: q === "(prefers-reduced-motion: reduce)",
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal("matchMedia", mm);
    try {
      render(<Harness initial={[40, 30, 20, 10]} seen={[]} selected0="k1" />);
      expect(mm).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
      const slices = [...document.querySelectorAll(".dial-slice")] as SVGElement[];
      expect(slices).toHaveLength(4);
      for (const p of slices) expect(p.style.transition).toBe("none");
      expect((document.querySelector(".dial-glow") as SVGElement).style.transition).toBe("none");
      // 나옴·빛은 그대로
      expect(Math.hypot(...translateOf(document.querySelector(".dial-slice.is-picked")!))).toBeCloseTo(3, 1);
      expect(document.querySelector(".dial-glow")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("조각의 화면 읽기 이름: 「{분야} {값}」, 고른 조각은 「{분야} {값}, 고름」(PM 10 ⑩)", () => {
    render(<Harness initial={[40, 30, 20, 10]} seen={[]} selected0="k1" />);
    const labels = [...document.querySelectorAll(".dial-slice")].map((p) => p.getAttribute("aria-label"));
    expect(labels).toEqual(["어학 40%", "코딩 30%, 고름", "운동 20%", "기타 10%"]);
  });
});

/**
 * 고침6 PM d-129 ②: 오늘 기록 나누기는 skipZero — 손잡이는 0이 아닌 조각 사이에만, 폭 0 조각은 건너뛴다(12시에 손잡이가 붙지 않는다).
 * 분 단위(합 120, 5분 걸음)로 오늘 기록과 같게 그린다. 처음 정한 비율(skipZero 없음)은 지금 규칙 그대로인 것도 같이 본다.
 */
function SkipHarness({ initial, names, seen, selected0, skipZero = true }: { initial: number[]; names: string[]; seen: number[][]; selected0: string | null; skipZero?: boolean }) {
  const [values, setValues] = useState(initial);
  const [sel, setSel] = useState<string | null>(selected0);
  const total = initial.reduce((a, b) => a + b, 0);
  return (
    <>
      <RatioDial
        id="d"
        slices={slicesOf(values, names)}
        total={total}
        step={5}
        bigStep={30}
        format={(v) => `${v}분`}
        selectedKey={sel}
        onSelect={setSel}
        onChange={(v) => {
          seen.push(v);
          setValues(v);
        }}
        skipZero={skipZero}
      />
      <ul>
        {slicesOf(values, names).map((s, i) => (
          <li key={s.key}>
            <button type="button" aria-pressed={sel === s.key} onClick={() => setSel(s.key)}>
              {`이름 ${s.name}`}
            </button>
            {/* 끌지 않는 길(오늘 기록 줄의 −): 줄인 몫은 맨 끝(기타)으로 */}
            <button
              type="button"
              onClick={() => {
                const next = values.slice();
                const take = Math.min(5, next[i]);
                next[i] -= take;
                next[next.length - 1] += take;
                seen.push(next);
                setValues(next);
              }}
            >
              {`${s.name} 줄이기`}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
/** 손잡이의 자리(바퀴 0~1, 0 = 12시): transform translate(x y)에서 읽는다 */
function turnOf(el: Element): number {
  const m = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(el.getAttribute("transform") ?? "");
  if (!m) throw new Error("손잡이 자리 없음");
  const t = Math.atan2(Number(m[2]), Number(m[1])) / (2 * Math.PI) + 0.25;
  return ((t % 1) + 1) % 1;
}
const noonGap = (t: number) => Math.min(t, 1 - t); // 12시에서 떨어진 정도(바퀴)
const NAMES3 = ["어학", "포트폴리오", "기타"];
const NAMES4 = ["어학", "코딩", "운동", "기타"];

describe("고침6 PM d-129 ②: 폭 0 조각을 건너뛰는 손잡이(skipZero, 오늘 기록 나누기)", () => {
  it("기타 0분 + 마지막 분야 고름: 12시에 손잡이가 없다 — 앞 손잡이 하나(6시 자리)뿐. 같은 값에서 skipZero가 없으면(처음 정한 비율) 12시 손잡이가 있다", () => {
    render(<SkipHarness initial={[60, 60, 0]} names={NAMES3} seen={[]} selected0="k1" />);
    const hs = handles();
    expect(hs).toHaveLength(1);
    expect(hs[0].id).toBe("d-handle-start");
    expect(hs[0].getAttribute("transform")).toBe("translate(0.00 81.00)"); // 6시(60/120)
    expect(noonGap(turnOf(hs[0]))).toBeCloseTo(0.5, 5);
    expect(slider("end")).toBeNull();
    expect(hs[0].getAttribute("aria-label")).toContain("포트폴리오·어학 사이");
    cleanup();
    // 같은 값·같은 고름, skipZero 없음(지금 처음 정한 비율 규칙): 끝 손잡이가 12시에 선다 — 위 단언이 그 차이를 잡는다
    render(<SkipHarness initial={[60, 60, 0]} names={NAMES3} seen={[]} selected0="k1" skipZero={false} />);
    expect(handles()).toHaveLength(2);
    expect(noonGap(turnOf(slider("end")!))).toBeCloseTo(0, 5);
  });

  it("0분 분야 조각의 양옆 손잡이는 하나로 합쳐진다(이웃을 골라도·0분 조각을 골라도), 12시 자리의 0분 조각은 손잡이 없음", () => {
    render(<SkipHarness initial={[60, 0, 60, 0]} names={NAMES4} seen={[]} selected0="k0" />);
    expect(handles().map((h) => h.id)).toEqual(["d-handle-end"]);
    expect(slider("end")!.getAttribute("aria-label")).toContain("어학·운동 사이"); // 0분 코딩을 건너뛰었다
    expect(noonGap(turnOf(slider("end")!))).toBeCloseTo(0.5, 5);
    fireEvent.click(screen.getByRole("button", { name: "이름 코딩" })); // 0분 조각
    expect(handles().map((h) => h.id)).toEqual(["d-handle-both"]);
    expect(slider("both")!.getAttribute("aria-label")).toBe("어학·코딩·운동 사이 손잡이. 화살표 키로 코딩을 5분씩 키울 수 있어요");
    expect(noonGap(turnOf(slider("both")!))).toBeCloseTo(0.5, 5);
    fireEvent.click(screen.getByRole("button", { name: "이름 운동" }));
    expect(handles().map((h) => h.id)).toEqual(["d-handle-start"]); // 기타 0분: 끝 손잡이(12시) 없음
    expect(slider("start")!.getAttribute("aria-label")).toContain("운동·어학 사이");
    fireEvent.click(screen.getByRole("button", { name: "이름 기타" })); // 기타 0분: 자리가 12시라 없음
    expect(handles()).toHaveLength(0);
  });

  it("기타 > 0이고 0분 조각이 없으면 지금과 같다: 고름마다 손잡이 id·자리·이름이 skipZero 없을 때와 같다", () => {
    const snap = () => handles().map((h) => [h.id, h.getAttribute("transform"), h.getAttribute("aria-label")]);
    const withSkip: unknown[][] = [];
    const without: unknown[][] = [];
    for (const [skip, out] of [[true, withSkip], [false, without]] as const) {
      render(<SkipHarness initial={[40, 30, 20, 30]} names={NAMES4} seen={[]} selected0={null} skipZero={skip} />);
      for (const name of NAMES4) {
        fireEvent.click(screen.getByRole("button", { name: `이름 ${name}` }));
        out.push(snap());
      }
      cleanup();
    }
    expect(withSkip).toHaveLength(4);
    expect(withSkip.flat()).toHaveLength(6); // 첫·끝 1개씩 + 가운데 2개씩
    expect(withSkip).toEqual(without);
  });

  it("키보드: 다이얼 화살표로 고르는 조각마다 그려진 손잡이가 폭 0을 건너뛴 목록(skipZeroHandles)과 같다. 손잡이 화살표·Home/End로 바꾸면 목록이 따라 바뀌고 포커스를 잃지 않는다", () => {
    const seen: number[][] = [];
    render(<SkipHarness initial={[60, 0, 60, 0]} names={NAMES4} seen={seen} selected0={null} />);
    const svg = document.querySelector("svg.dial") as unknown as HTMLElement;
    act(() => svg.focus());
    const values = [60, 0, 60, 0];
    let total = 0;
    for (let i = 0; i < 4; i++) {
      press(svg, "ArrowRight");
      const want = skipZeroHandles(values, i).map((h) => `d-handle-${h.side}`);
      expect(handles().map((h) => h.id)).toEqual(want);
      total += want.length;
    }
    expect(total).toBe(3); // 어학 end · 코딩 both · 운동 start · 기타 없음
    // 운동(마지막 분야, 기타 0분) 고름: 앞 손잡이(어학·운동, 0분 코딩 건너뜀)
    press(svg, "ArrowLeft");
    const start = slider("start")!;
    act(() => (start as unknown as HTMLElement).focus());
    press(start, "ArrowRight"); // 운동 +5(어학에서, 코딩 0 그대로)
    expect(seen.at(-1)).toEqual([55, 0, 65, 0]);
    press(slider("start")!, "PageDown"); // 운동 −30 → 어학으로
    expect(seen.at(-1)).toEqual([85, 0, 35, 0]);
    press(slider("start")!, "Home"); // 운동 0까지(어학이 다 가져감) → 0분 아닌 조각이 어학 하나 → 손잡이 없음, 포커스는 다이얼로
    expect(seen.at(-1)).toEqual([120, 0, 0, 0]);
    expect(handles()).toHaveLength(0);
    expect(document.activeElement).toBe(svg);
    // 끌지 않는 길: 어학을 줄이면 기타로 돌아가고, 그러면 기타와의 경계에 손잡이가 다시 선다
    fireEvent.click(screen.getByRole("button", { name: "이름 어학" }));
    fireEvent.click(screen.getByRole("button", { name: "어학 줄이기" }));
    expect(seen.at(-1)).toEqual([115, 0, 0, 5]);
    expect(handles().map((h) => h.id)).toEqual(["d-handle-end"]);
    expect(slider("end")!.getAttribute("aria-label")).toContain("어학·기타 사이");
    press(slider("end")!, "End"); // 어학이 기타 5분을 다 가져간다
    expect(seen.at(-1)).toEqual([120, 0, 0, 0]);
    for (const v of seen) expect(v.reduce((a, b) => a + b, 0)).toBe(120);
  });

  it("끌기: 0분을 건너뛴 손잡이는 양쪽 조각끼리 주고받고 0분 조각은 0 그대로. 겹친 손잡이는 방향으로 이웃을 정한다. 기타 0분에서 12시를 넘겨 끌어도 돌지 않는다", () => {
    const seen: number[][] = [];
    render(<SkipHarness initial={[60, 0, 60, 0]} names={NAMES4} seen={seen} selected0="k0" />);
    box();
    dragAlong(slider("end")!, 0.5, 0.6, 6); // 시계 방향 12분 → 5분 단위
    fireEvent.pointerUp(document.querySelector("svg.dial")!, { pointerId: 1 });
    expect(seen.at(-1)).toEqual([70, 0, 50, 0]);
    fireEvent.click(screen.getByRole("button", { name: "이름 코딩" }));
    const at0 = turnOf(slider("both")!);
    dragAlong(slider("both")!, at0, at0 - 0.1, 6); // 반시계 = 앞 이웃(어학)에서
    fireEvent.pointerUp(document.querySelector("svg.dial")!, { pointerId: 1 });
    expect(seen.at(-1)).toEqual([60, 10, 50, 0]);
    // 운동(마지막 분야) 고름 — 기타 0분: 앞 손잡이를 시계로 12시를 넘겨 끌면 운동이 0에서 멈추고 첫 조각에 붙지 않는다
    fireEvent.click(screen.getByRole("button", { name: "이름 운동" }));
    const from = turnOf(slider("start")!);
    dragAlong(slider("start")!, from, 1.2, 20);
    fireEvent.pointerUp(document.querySelector("svg.dial")!, { pointerId: 1 });
    expect(seen.at(-1)).toEqual([60, 60, 0, 0]);
    for (const v of seen) {
      expect(v.reduce((a, b) => a + b, 0)).toBe(120);
      expect(v.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
      expect(v[0]).toBeGreaterThanOrEqual(60); // 어학은 한 번도 60 밑으로 줄지 않았다(12시를 넘어 돌지 않음)
    }
  });
});

describe("가운데 순서·12시 눈금 옵션(고침9 — 오늘 기록 나누기만 켬)", () => {
  const slices: DialSlice[] = [
    { key: "a", name: "어학", color: "var(--color-category-1)", value: 60 },
    { key: "b", name: "기타", color: "var(--color-category-other)", value: 40 },
  ];
  it("기본(처음 정한 비율·내 정보): 이름 위 · 값 아래, 12시 눈금 있음 — 바뀌지 않는다", () => {
    render(<RatioDial id="d" slices={slices} selectedKey="a" onSelect={() => {}} onChange={() => {}} />);
    const name = document.querySelector(".dial-center-name")!;
    const value = document.querySelector(".dial-center-value")!;
    expect(Number(name.getAttribute("y"))).toBeLessThan(Number(value.getAttribute("y")));
    expect(value.querySelector("tspan.dial-center-unit")).not.toBeNull();
    expect(document.getElementById("d-noon")).not.toBeNull();
  });
  it("valueFirst · noonMark={false}: 값(24 Bold) 위 · 이름(12) 아래, 12시 눈금 없음. 아무것도 안 골랐을 때 가운데 글도 큰 글", () => {
    const { rerender } = render(<RatioDial id="d" slices={slices} selectedKey="a" onSelect={() => {}} onChange={() => {}} valueFirst noonMark={false} />);
    const value = document.querySelector(".dial-center-big")!;
    const name = document.querySelector(".dial-center-small")!;
    expect([value.textContent, name.textContent]).toEqual(["60%", "어학"]);
    expect(Number(value.getAttribute("y"))).toBeLessThan(Number(name.getAttribute("y")));
    expect(document.getElementById("d-noon")).toBeNull();
    rerender(<RatioDial id="d" slices={slices} selectedKey={null} onSelect={() => {}} onChange={() => {}} valueFirst noonMark={false} center="3시간" />);
    expect(document.querySelector(".dial-center-big")!.textContent).toBe("3시간");
  });
});
