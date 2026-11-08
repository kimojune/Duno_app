// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/offers/actions", () => ({ requestOffer: vi.fn(), dismissOffer: vi.fn() }));
vi.mock("../../lib/push/subscribe", () => ({ defaultPushApi: { enable: vi.fn(async () => "ok") } }));

import { EveningRecord } from "../../components/evening-record";
import { STATUS_VIEWS, type GrowthViewText } from "../../components/growth-views";
import { RatioEditor, type RatioEntry } from "../../components/ratio-editor";
import { categoryColorValue } from "../../lib/category-color";
import { buildStatusChart } from "../../lib/growth/status-chart";
import type { EveningApi } from "../../lib/evening-api";
import type { EveningState } from "../../lib/evening/types";
import { COLOR_TOKENS, CATEGORY_COLOR_TOKENS } from "../../lib/design-tokens";

/**
 * 분야 색 잇기(고침4 합치기): 같은 분야는 처음 정한 비율 다이얼·저녁 나누기 다이얼·상태보기(띠·원·분야 줄·색점)에서 같은 색 변수를 쓴다.
 * 분야 순서 기준 = 보관하지 않고 읽을 수 있는 내 분야를 만든 순서(세 화면이 받는 분야 목록의 순서)의 자리(0부터). 기타는 늘 기타 색.
 * 10개 분야로 9번째부터 돌려 쓰는 것(순서 8 → 색 1)까지 본다.
 */

const IDS = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const NAMES = IDS.map((_, i) => `분야${i + 1}`);
const EXPECTED = IDS.map((_, i) => `var(--color-category-${(i % 8) + 1})`);
const OTHER = "var(--color-category-other)";

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});

const fills = (selector: string, prop: "fill" | "background") =>
  Array.from(document.querySelectorAll<HTMLElement | SVGElement>(selector)).map((el) => (el as HTMLElement).style[prop]);

describe("다이얼과 상태보기가 같은 분야에 같은 색을 준다", () => {
  it("처음 정한 비율 다이얼: 분야 순서대로 1~8, 9번째부터 다시 1, 기타는 기타 색", () => {
    const entries: RatioEntry[] = [
      ...IDS.map((id, i) => ({ id, name: NAMES[i], percent: 9 })),
      { id: "other", name: "기타", percent: 10 },
    ];
    render(<RatioEditor entries={entries} onChange={() => {}} />);
    expect(fills(".dial-slice", "fill")).toEqual([...EXPECTED, OTHER]);
  });

  it("처음 정한 비율: 줄 목록의 자리가 아니라 colorOrder(전체 분야 목록의 자리)를 따른다 — 고르지 않은 분야가 있어도 색이 밀리지 않는다", () => {
    // 첫 분야(자리 0)를 고르지 않은 처음 설정: 남은 둘은 자리 1·2 = 색 2·3
    const entries: RatioEntry[] = [
      { id: IDS[1], name: NAMES[1], percent: 50, colorOrder: 1 },
      { id: IDS[2], name: NAMES[2], percent: 40, colorOrder: 2 },
      { id: "other", name: "기타", percent: 10 },
    ];
    render(<RatioEditor entries={entries} onChange={() => {}} />);
    expect(fills(".dial-slice", "fill")).toEqual(["var(--color-category-2)", "var(--color-category-3)", OTHER]);
  });

  it("상태보기 띠·원·분야 줄 막대·색점: 같은 분야 목록이면 다이얼과 같은 색 변수다", () => {
    const chart = buildStatusChart({
      categoryIds: IDS,
      ratios: IDS.map((categoryId) => ({ categoryId, percent: 10 })),
      totals: [...IDS.map((categoryId) => ({ categoryId, minutes: 60 })), { categoryId: null, minutes: 30 }],
    });
    const text: GrowthViewText = {
      ratioLine: "처음",
      spentLine: "쓴 시간",
      lineSummary: (l, p) => `${l} ${p.join(" ")}`,
      lineNone: (l) => `${l} 없음`,
      piece: (n, p) => `${n} ${p}%`,
      diff: (d) => String(d),
    };
    const props = { chart, text, nameOf: (id: string | null) => (id === null ? "기타" : NAMES[IDS.indexOf(id)]), onOpenCategory: () => {} };
    const want = [...EXPECTED, OTHER];
    for (const view of STATUS_VIEWS) {
      const { unmount } = render(<view.Component {...props} />);
      expect(fills(".growth-dot", "background"), `${view.id} 색점`).toEqual(want);
      if (view.id === "rows") expect(fills(".growth-bar-fill", "background"), "줄 막대").toEqual(want);
      if (view.id === "band") {
        // 처음 정한 비율 줄은 분야만(기타 0), 쓴 시간 줄은 기타까지
        expect(fills(".growth-band-seg", "background")).toEqual([...EXPECTED, ...want]);
      }
      if (view.id === "pie") expect(fills("svg.growth-pie path", "fill")).toEqual([...EXPECTED, ...want]);
      unmount();
    }
  });

  it("저녁 나누기 다이얼: 같은 분야 목록이면 처음 정한 비율 다이얼과 같은 색 변수다", async () => {
    const state: EveningState = {
      today: "2026-11-07",
      day: "2026-11-07",
      existing: null,
      doneCategoryIds: [],
      timerByCategory: IDS.map((categoryId) => ({ categoryId, minutes: 10 })),
      categories: IDS.map((id, i) => ({ id, name: NAMES[i] })),
    };
    const api: EveningApi = {
      fetchState: vi.fn(async (day?: string) => ({ ok: true as const, data: { ...state, day: day ?? state.today } })),
      save: vi.fn(),
    };
    const NOW = new Date("2026-11-07T14:00:00.000Z");
    render(<EveningRecord api={api} now={() => NOW} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "분야마다 나누기" });
    fireEvent.change(screen.getByLabelText("시간"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("분"), { target: { value: "0" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "분야마다 나누기" })));
    // 분야마다 10분 = 100분, 쓴 시간 120분이라 기타 20분
    expect(fills(".dial-slice", "fill")).toEqual([...EXPECTED, OTHER]);
  });
});

describe("분야 색 자리값(디자인 확정 전 임시)", () => {
  it("함수는 순서와 기타에 맞는 변수를 준다", () => {
    expect(categoryColorValue(0)).toBe("var(--color-category-1)");
    expect(categoryColorValue(8)).toBe("var(--color-category-1)");
    expect(categoryColorValue(null)).toBe(OTHER);
  });

  it("자리값 아홉 개(1~8·기타)는 서로 다르다", () => {
    const values = Object.values(CATEGORY_COLOR_TOKENS);
    expect(values).toHaveLength(9);
    expect(new Set(values.map((v) => v.toUpperCase())).size).toBe(9);
  });

  it("기타 색은 막대 바탕(--color-skeleton)과 다르고 1~8과도 다르다(기타 막대가 바탕에 묻히지 않는다)", () => {
    const other = CATEGORY_COLOR_TOKENS["--color-category-other"].toUpperCase();
    expect(other).not.toBe(COLOR_TOKENS["--color-skeleton"].toUpperCase());
    for (let n = 1; n <= 8; n += 1) {
      expect(other, `기타 ≠ ${n}`).not.toBe(CATEGORY_COLOR_TOKENS[`--color-category-${n}` as keyof typeof CATEGORY_COLOR_TOKENS].toUpperCase());
    }
  });

  it("자리값은 지금 있는 색 토큰의 값 중에서만 고른다(새 색을 짓지 않는다)", () => {
    const known = new Set(Object.values(COLOR_TOKENS).map((v) => v.toUpperCase()));
    for (const [name, value] of Object.entries(CATEGORY_COLOR_TOKENS)) expect(known, name).toContain(value.toUpperCase());
  });
});
