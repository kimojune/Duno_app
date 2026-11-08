import { describe, expect, it, vi } from "vitest";
import { createLocalApis } from "../../lib/local/apis";
import { createMemoryKv, kvKeys, wipeOtherUsers, wipeUser, type KvStore } from "../../lib/local/kv";
import { createRuntime } from "../../lib/local/runtime";
import { DEFAULT_STATUS_PREF, parseStatusPref, STATUS_PREF_NAME } from "../../lib/growth/status-view-pref";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VIEWS = ["band", "pie", "rows"];

describe("parseStatusPref: 기기 저장소의 값은 믿지 않는다", () => {
  it("처음 값은 최근 1주 · 띠그래프", () => {
    expect(DEFAULT_STATUS_PREF).toEqual({ period: "recent", view: "band" });
    expect(parseStatusPref(undefined, VIEWS)).toEqual(DEFAULT_STATUS_PREF);
  });
  it("알아볼 수 있는 값은 그대로 읽는다", () => {
    expect(parseStatusPref({ period: "total", view: "pie" }, VIEWS)).toEqual({ period: "total", view: "pie" });
    expect(parseStatusPref({ period: "compare", view: "rows" }, VIEWS)).toEqual({ period: "compare", view: "rows" });
  });
  it("모양이 다르면(null·글·숫자·배열) 처음 값", () => {
    for (const raw of [null, "recent", 7, [], [{ period: "total" }], true]) expect(parseStatusPref(raw, VIEWS)).toEqual(DEFAULT_STATUS_PREF);
  });
  it("모르는 기간·보기 번호는 그 칸만 처음 값으로 돌리고 알아본 칸은 살린다", () => {
    expect(parseStatusPref({ period: "year", view: "pie" }, VIEWS)).toEqual({ period: "recent", view: "pie" });
    expect(parseStatusPref({ period: "total", view: "sunburst" }, VIEWS)).toEqual({ period: "total", view: "band" });
    expect(parseStatusPref({ period: 1, view: { id: "pie" } }, VIEWS)).toEqual(DEFAULT_STATUS_PREF);
  });
  it("보기 목록에 새 보기를 더하면 그 번호도 읽히고, 목록에서 빠진 보기는 처음 값으로 돌아온다", () => {
    expect(parseStatusPref({ period: "recent", view: "stack" }, [...VIEWS, "stack"]).view).toBe("stack");
    expect(parseStatusPref({ period: "recent", view: "rows" }, ["band", "pie"]).view).toBe("band");
    expect(parseStatusPref({ period: "recent", view: "x" }, ["pie", "rows"]).view).toBe("pie"); // 목록에 band가 없으면 첫 보기
  });
  it("별난 객체(__proto__·여분 칸)가 와도 두 칸만 읽는다", () => {
    const raw = JSON.parse('{"__proto__":{"polluted":1},"period":"total","view":"rows","extra":"x"}');
    expect(parseStatusPref(raw, VIEWS)).toEqual({ period: "total", view: "rows" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
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
