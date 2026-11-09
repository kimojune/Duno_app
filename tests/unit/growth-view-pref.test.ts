import { describe, expect, it, vi } from "vitest";
import { createLocalApis } from "../../lib/local/apis";
import { createMemoryKv, kvKeys, wipeOtherUsers, wipeUser, type KvStore } from "../../lib/local/kv";
import { createRuntime } from "../../lib/local/runtime";
import { DEFAULT_STATUS_PREF, initialStatusPeriod, initialStatusTab, parseStatusPref, STATUS_PREF_NAME, STATUS_TABS } from "../../lib/growth/status-view-pref";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** 목표 비율 뷰의 보기 목록(고침5: 띠그래프·원그래프. 분야별 막대는 이번 주 목표 뷰로 옮겼다) */
const VIEWS = ["band", "pie"];
/** 고른 탭 없음 + 칩에서 고른 주 없음(고침7: 기간은 칩에서 고른 주에만 기억한다 — 옛 판 값에는 그 주가 없다) */
const NO_TAB = { tab: null, tabWeek: null, periodWeek: null };
const WEEK = "2026-11-02";

describe("parseStatusPref: 기기 저장소의 값은 믿지 않는다", () => {
  it("처음 값은 이번 주 · 띠그래프(목표 비율 뷰의 처음 보기, PM d-102) · 고른 탭 없음", () => {
    expect(DEFAULT_STATUS_PREF).toEqual({ period: "week", periodWeek: null, view: "band", tab: null, tabWeek: null });
    expect(parseStatusPref(undefined, VIEWS)).toEqual(DEFAULT_STATUS_PREF);
  });
  it("이미 기억된 보기는 그대로 존중한다: 이전 판에서 고른 원그래프는 처음 값(띠)으로 바뀌지 않는다", () => {
    expect(parseStatusPref({ period: "week", view: "band" }, VIEWS)).toEqual({ period: "week", view: "band", ...NO_TAB });
    expect(parseStatusPref({ period: "total", view: "pie" }, VIEWS)).toEqual({ period: "total", view: "pie", ...NO_TAB });
  });
  it("이전 판의 「분야별 줄 막대」(rows)는 목표 비율 뷰에서 띠그래프로 읽는다(목록에 rows가 다시 생기면 rows 그대로)", () => {
    expect(parseStatusPref({ period: "total", view: "rows" }, VIEWS)).toEqual({ period: "total", view: "band", ...NO_TAB });
    expect(parseStatusPref({ period: "total", view: "rows" }, ["pie"])).toEqual({ period: "total", view: "pie", ...NO_TAB }); // 띠가 목록에 없으면 첫 보기
    expect(parseStatusPref({ period: "total", view: "rows" }, ["band", "pie", "rows"]).view).toBe("rows");
  });
  it("옛 기간 값 「recent」(최근 1주에 해당하던 값)는 「이번 주」로 읽는다. 보기 방식은 그대로 살린다", () => {
    expect(parseStatusPref({ period: "recent", view: "pie" }, VIEWS)).toEqual({ period: "week", view: "pie", ...NO_TAB });
    expect(parseStatusPref({ period: "recent", view: "rows" }, VIEWS)).toEqual({ period: "week", view: "band", ...NO_TAB });
    expect(parseStatusPref({ period: "recent", view: "nope" }, VIEWS)).toEqual({ period: "week", view: "band", ...NO_TAB });
  });
  it("옛 이름의 모양만 받는다: 객체 기본 속성 이름(toString·__proto__ 등)은 옛 기간·보기 값으로 읽지 않는다", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect(parseStatusPref({ period: name, view: "pie" }, VIEWS)).toEqual({ period: "week", view: "pie", ...NO_TAB });
      expect(parseStatusPref({ period: "total", view: name }, VIEWS)).toEqual({ period: "total", view: "band", ...NO_TAB });
      expect(parseStatusPref({ period: "total", view: "pie", tab: name, tabWeek: WEEK }, VIEWS)).toEqual({ period: "total", view: "pie", ...NO_TAB });
    }
  });
  it("알아볼 수 있는 값은 그대로 읽는다(고른 탭과 그 주 포함)", () => {
    expect(parseStatusPref({ period: "total", view: "pie" }, VIEWS)).toEqual({ period: "total", view: "pie", ...NO_TAB });
    expect(parseStatusPref({ period: "compare", view: "band", tab: "goal", tabWeek: WEEK }, VIEWS)).toEqual({ period: "compare", periodWeek: null, view: "band", tab: "goal", tabWeek: WEEK });
    expect(parseStatusPref({ period: "week", view: "pie", tab: "ratio", tabWeek: WEEK }, VIEWS)).toEqual({ period: "week", periodWeek: null, view: "pie", tab: "ratio", tabWeek: WEEK });
    expect(parseStatusPref({ period: "total", periodWeek: WEEK, view: "pie" }, VIEWS)).toEqual({ period: "total", periodWeek: WEEK, view: "pie", tab: null, tabWeek: null });
  });
  it("탭은 탭 이름과 날짜 모양의 주가 함께 있을 때만 읽는다(하나라도 이상하면 둘 다 버린다)", () => {
    for (const bad of [
      { tab: "goal" },
      { tab: "goal", tabWeek: "11월 2일" },
      { tab: "goal", tabWeek: 20261102 },
      { tab: "rows", tabWeek: WEEK },
      { tab: ["goal"], tabWeek: WEEK },
      { tabWeek: WEEK },
    ]) {
      expect(parseStatusPref({ period: "total", view: "pie", ...bad }, VIEWS)).toEqual({ period: "total", view: "pie", ...NO_TAB });
    }
  });
  it("모양이 다르면(null·글·숫자·배열) 처음 값", () => {
    for (const raw of [null, "recent", 7, [], [{ period: "total" }], true]) expect(parseStatusPref(raw, VIEWS)).toEqual(DEFAULT_STATUS_PREF);
  });
  it("모르는 기간·보기 번호는 그 칸만 처음 값으로 돌리고 알아본 칸은 살린다", () => {
    expect(parseStatusPref({ period: "year", view: "pie" }, VIEWS)).toEqual({ period: "week", view: "pie", ...NO_TAB });
    expect(parseStatusPref({ period: "total", view: "sunburst" }, VIEWS)).toEqual({ period: "total", view: "band", ...NO_TAB });
    expect(parseStatusPref({ period: 1, view: { id: "pie" } }, VIEWS)).toEqual(DEFAULT_STATUS_PREF);
  });
  it("보기 목록에 새 보기를 더하면 그 번호도 읽히고, 목록에서 빠진 보기는 처음 값으로 돌아온다", () => {
    expect(parseStatusPref({ period: "week", view: "stack" }, [...VIEWS, "stack"]).view).toBe("stack");
    expect(parseStatusPref({ period: "week", view: "pie" }, ["band"]).view).toBe("band");
    expect(parseStatusPref({ period: "week", view: "x" }, ["pie", "stack"]).view).toBe("pie"); // 목록에 처음 보기(띠)가 없으면 첫 보기
  });
  it("별난 객체(__proto__·여분 칸)가 와도 다섯 칸만 읽는다", () => {
    const raw = JSON.parse('{"__proto__":{"polluted":1},"period":"total","periodWeek":"2026-11-02","view":"pie","tab":"ratio","tabWeek":"2026-11-02","extra":"x"}');
    expect(parseStatusPref(raw, VIEWS)).toEqual({ period: "total", periodWeek: WEEK, view: "pie", tab: "ratio", tabWeek: WEEK });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("기간을 고른 주(periodWeek, 고침7)", () => {
  it("날짜 모양의 주이고 기간이 지금 값일 때만 읽는다(하나라도 이상하면 고른 적 없는 것으로)", () => {
    expect(parseStatusPref({ period: "week", periodWeek: WEEK, view: "band" }, VIEWS).periodWeek).toBe(WEEK);
    for (const bad of [{ periodWeek: "11월 2일" }, { periodWeek: 20261102 }, { periodWeek: [WEEK] }, { periodWeek: null }, {}]) {
      expect(parseStatusPref({ period: "total", view: "pie", ...bad }, VIEWS)).toEqual({ period: "total", view: "pie", ...NO_TAB });
    }
    // 모르는 기간·옛 이름(recent)이면 고른 주도 버린다(사용자가 지금 판에서 고른 값이 아니다)
    expect(parseStatusPref({ period: "year", periodWeek: WEEK, view: "pie" }, VIEWS)).toEqual({ period: "week", view: "pie", ...NO_TAB });
    expect(parseStatusPref({ period: "recent", periodWeek: WEEK, view: "pie" }, VIEWS)).toEqual({ period: "week", view: "pie", ...NO_TAB });
  });
});

describe("initialStatusPeriod: 목표 비율 뷰의 처음 기간(고침7, PM 15:1x)", () => {
  const AUTO = { period: "week" as const, periodWeek: null };
  it("이번 주 0시간 + 쌓인 시간 있음 → 총 시간", () => {
    expect(initialStatusPeriod(AUTO, WEEK, { week: 0, total: 2880 })).toBe("total");
  });
  it("이번 주에 기록이 있으면 → 이번 주(쌓인 시간과 상관없이)", () => {
    expect(initialStatusPeriod(AUTO, WEEK, { week: 30, total: 2880 })).toBe("week");
    expect(initialStatusPeriod(AUTO, WEEK, { week: 1, total: 1 })).toBe("week");
  });
  it("모두 0(처음 쓰는 사람) → 이번 주", () => {
    expect(initialStatusPeriod(AUTO, WEEK, { week: 0, total: 0 })).toBe("week");
  });
  it("이 주에 칩에서 고른 기간은 규칙보다 이긴다(이번 주 0이어도 「이번 주」, 기록이 있어도 「총 시간」·「비교」)", () => {
    expect(initialStatusPeriod({ period: "week", periodWeek: WEEK }, WEEK, { week: 0, total: 2880 })).toBe("week");
    expect(initialStatusPeriod({ period: "total", periodWeek: WEEK }, WEEK, { week: 30, total: 2880 })).toBe("total");
    expect(initialStatusPeriod({ period: "compare", periodWeek: WEEK }, WEEK, { week: 0, total: 0 })).toBe("compare");
  });
  it("다른 주에 고른 기간·고른 주가 없는 기간(옛 판·자동)은 쓰지 않는다 — 규칙대로", () => {
    expect(initialStatusPeriod({ period: "total", periodWeek: "2026-10-26" }, WEEK, { week: 30, total: 2880 })).toBe("week");
    expect(initialStatusPeriod({ period: "week", periodWeek: "2026-10-26" }, WEEK, { week: 0, total: 2880 })).toBe("total");
    expect(initialStatusPeriod({ period: "total", periodWeek: null }, WEEK, { week: 30, total: 2880 })).toBe("week");
    expect(initialStatusPeriod({ period: "week", periodWeek: null }, WEEK, { week: 0, total: 2880 })).toBe("total");
  });
});

describe("initialStatusTab: 처음 탭 규칙(명세 ③-S)", () => {
  it("탭 순서는 이번 주 목표 → 목표 비율", () => {
    expect(STATUS_TABS).toEqual(["goal", "ratio"]);
  });
  it("고른 탭이 없으면: 이번 주 목표를 세운 주 → goal, 세우지 않은 주 → ratio", () => {
    expect(initialStatusTab(NO_TAB, WEEK, true)).toBe("goal");
    expect(initialStatusTab(NO_TAB, WEEK, false)).toBe("ratio");
  });
  it("이 주에 고른 탭은 규칙보다 이긴다(목표가 있어도 ratio, 없어도 goal)", () => {
    expect(initialStatusTab({ tab: "ratio", tabWeek: WEEK }, WEEK, true)).toBe("ratio");
    expect(initialStatusTab({ tab: "goal", tabWeek: WEEK }, WEEK, false)).toBe("goal");
  });
  it("다른 주에 고른 탭은 쓰지 않는다(주가 바뀌면 규칙대로)", () => {
    expect(initialStatusTab({ tab: "ratio", tabWeek: "2026-10-26" }, WEEK, true)).toBe("goal");
    expect(initialStatusTab({ tab: "goal", tabWeek: "2026-10-26" }, WEEK, false)).toBe("ratio");
  });
});

function makeRuntime(userKey: string, kv: KvStore) {
  return createRuntime({
    userKey,
    kv,
    send: async () => ({ ok: true }),
    fetchSnapshot: async () => ({ ok: false, error: "unavailable" }),
    now: () => Date.parse("2026-11-07T06:00:00.000Z"),
    online: () => false,
  });
}

describe("기억한 보기 방식은 이 기기·이 사용자에 한정된다", () => {
  it("쓰고 읽는다. 다른 사용자의 같은 기기 저장소에서는 읽히지 않는다", async () => {
    const kv = createMemoryKv();
    const mine = makeRuntime(USER, kv);
    const theirs = makeRuntime(OTHER, kv);
    await mine.setPref(STATUS_PREF_NAME, { period: "total", view: "pie" });
    expect(await mine.getPref(STATUS_PREF_NAME)).toEqual({ period: "total", view: "pie" });
    expect(await theirs.getPref(STATUS_PREF_NAME)).toBeUndefined(); // 새지 않는다
    expect(await kv.keys("pref/")).toEqual([kvKeys.pref(USER, STATUS_PREF_NAME)]);
  });

  it("로그아웃(wipe): 기억한 값도 지워지고, 지운 뒤에는 다시 적지 않는다", async () => {
    const kv = createMemoryKv();
    const rt = makeRuntime(USER, kv);
    await rt.setPref(STATUS_PREF_NAME, { period: "total", view: "rows" });
    await rt.wipe();
    expect(await rt.getPref(STATUS_PREF_NAME)).toBeUndefined();
    expect(await kv.keys("pref/")).toEqual([]);
    await rt.setPref(STATUS_PREF_NAME, { period: "total", view: "rows" }); // 지운 뒤: 조용히 건너뜀
    expect(await kv.keys("pref/")).toEqual([]);
  });

  it("다른 사용자가 로그인하면(wipeOtherUsers) 이전 사용자의 기억한 값이 지워지고 내 것은 남는다", async () => {
    const kv = createMemoryKv();
    await kv.set(kvKeys.pref(OTHER, STATUS_PREF_NAME), { period: "total", view: "pie" });
    await kv.set(kvKeys.pref(USER, STATUS_PREF_NAME), { period: "recent", view: "rows" });
    await wipeOtherUsers(kv, USER);
    expect(await kv.keys("pref/")).toEqual([kvKeys.pref(USER, STATUS_PREF_NAME)]);
    // 사용자 번호가 다른 사용자 번호의 앞부분이어도 섞이지 않는다
    await kv.set(kvKeys.pref(`${USER}x`, STATUS_PREF_NAME), "남의 것");
    await wipeUser(kv, USER);
    expect(await kv.keys("pref/")).toEqual([kvKeys.pref(`${USER}x`, STATUS_PREF_NAME)]);
  });

  it("기억한 값은 보낼 줄(op)로 읽히지 않는다: 켜도 보낼 줄이 늘지 않는다", async () => {
    const kv = createMemoryKv();
    const rt = makeRuntime(USER, kv);
    await rt.setPref(STATUS_PREF_NAME, { period: "total", view: "pie" });
    await rt.boot();
    expect(rt.pendingCount()).toBe(0);
  });

  it("setPref 직후 wipe(로그아웃)해도 pref/가 남지 않는다: 아직 끝나지 않은 쓰기를 기다린 뒤 지운다(진행 중 쓰기와 지움의 경쟁)", async () => {
    // 실제 IndexedDB처럼 쓰기가 늦게 끝나는 저장소: set은 한 박자 늦게 반영되고, keys는 그 시점의 열쇠만 본다
    const inner = createMemoryKv();
    const slow: KvStore = {
      ...inner,
      set: (key, value) => new Promise<void>((resolve) => setTimeout(() => void inner.set(key, value).then(resolve), 20)),
    };
    const rt = makeRuntime(USER, slow);
    const writing = rt.setPref(STATUS_PREF_NAME, { period: "total", view: "pie" }); // 기다리지 않는다
    await rt.wipe(); // 쓰기가 끝나기 전에 로그아웃
    await writing;
    expect(await inner.keys("pref/")).toEqual([]);
    expect(await rt.getPref(STATUS_PREF_NAME)).toBeUndefined();
  });

  it("쓰기를 여러 번 부른 직후 wipe해도 모두 지워진다", async () => {
    const inner = createMemoryKv();
    const slow: KvStore = {
      ...inner,
      set: (key, value) => new Promise<void>((resolve) => setTimeout(() => void inner.set(key, value).then(resolve), 10)),
    };
    const rt = makeRuntime(USER, slow);
    void rt.setPref(STATUS_PREF_NAME, { period: "week", view: "band" });
    void rt.setPref("other-pref", { x: 1 });
    void rt.setPref(STATUS_PREF_NAME, { period: "total", view: "rows" });
    await rt.wipe();
    await new Promise((r) => setTimeout(r, 40));
    expect(await inner.keys("pref/")).toEqual([]);
  });

  it("저장소가 읽기·쓰기에 실패해도(사생활 창 등) 던지지 않고 읽기는 undefined", async () => {
    const broken: KvStore = {
      persistent: false,
      get: vi.fn(async () => {
        throw new Error("blocked");
      }),
      set: vi.fn(async () => {
        throw new Error("blocked");
      }),
      delete: vi.fn(async () => {}),
      keys: vi.fn(async () => []),
    };
    const rt = makeRuntime(USER, broken);
    await expect(rt.setPref(STATUS_PREF_NAME, { period: "total", view: "pie" })).resolves.toBeUndefined();
    await expect(rt.getPref(STATUS_PREF_NAME)).resolves.toBeUndefined();
    expect(parseStatusPref(await rt.getPref(STATUS_PREF_NAME), VIEWS)).toEqual(DEFAULT_STATUS_PREF);
  });

  it("화면용 growth API의 viewPref가 같은 길을 쓴다", async () => {
    const kv = createMemoryKv();
    const apis = createLocalApis(makeRuntime(USER, kv));
    expect(await apis.growth.viewPref!.load()).toBeUndefined();
    await apis.growth.viewPref!.save({ period: "total", view: "rows" });
    expect(await apis.growth.viewPref!.load()).toEqual({ period: "total", view: "rows" });
    expect(await kv.get(kvKeys.pref(USER, STATUS_PREF_NAME))).toEqual({ period: "total", view: "rows" });
  });
});
