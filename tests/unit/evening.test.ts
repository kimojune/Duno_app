import { describe, expect, it } from "vitest";
import { listEveningLogs, latestPerDay, readEveningState, saveEveningLogForUser, toLog } from "../../lib/evening/core";
import {
  buildItems,
  classifySaveMode,
  compactItems,
  diffItems,
  initialSelection,
  NEW_CHIP_MINUTES,
  notSplitItems,
  otherOf,
  pickChip,
  sameItems,
  sumMinutes,
  unpickChip,
} from "../../lib/evening/logic";
import { encryptCategoryName, encryptTodoText, parseTodoKey } from "../../lib/todos/crypto";
import { FakeStore, fakeTablesClient, v2Rules } from "./fake-tables";

const KEY = parseTodoKey(Buffer.alloc(32, 3).toString("base64"));
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const L1 = "10101010-1010-4010-8010-101010101010";
const L2 = "20202020-2020-4020-8020-202020202020";
const L3 = "30303030-3030-4030-8030-303030303030";
const NOW = new Date("2026-11-07T14:00:00.000Z"); // 서울 23:00 → 두노 하루 2026-11-07

describe("initialSelection (나누기 처음 값 — 고침 5바퀴, d-115 나 · d-116 가)", () => {
  const CAT = [C1, C2, C3];
  it("타이머도 끝낸 할 일도 없으면 기타 100%, 골라진 칩 없음", () => {
    const r = initialSelection({ totalMinutes: 120, timer: {}, doneCategoryIds: [], catalogOrder: CAT });
    expect(r.total).toBe(120);
    expect(r.perCategory).toEqual({});
    expect(r.items).toEqual([{ categoryId: null, minutes: 120 }]);
  });
  it("타이머로 잰 분야만 그 시간만큼 채우고 칩이 골라진다. 나머지는 기타(남은 시간을 나눠 채우지 않는다)", () => {
    const r = initialSelection({ totalMinutes: 205, timer: { [C1]: 45 }, doneCategoryIds: [], catalogOrder: CAT });
    expect(r.perCategory).toEqual({ [C1]: 45 });
    expect(r.items).toEqual([{ categoryId: C1, minutes: 45 }, { categoryId: null, minutes: 160 }]);
  });
  it("끝낸 할 일의 분야는 만든 순서대로 기타에서 30분씩. 타이머와 겹친 분야는 타이머 시간만, 기타(null)·목록 밖 분야는 칩을 만들지 않는다", () => {
    const OUT = "c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9";
    const r = initialSelection({ totalMinutes: 200, timer: { [C2]: 20 }, doneCategoryIds: [C3, null, C2, OUT, C1, C3], catalogOrder: CAT });
    expect(r.perCategory).toEqual({ [C1]: 30, [C2]: 20, [C3]: 30 });
    expect(Object.keys(r.perCategory)).not.toContain(OUT);
    expect(sumMinutes(r.items)).toBe(200);
    expect(r.items.find((i) => i.categoryId === null)?.minutes).toBe(120);
  });
  it("가장자리: 기타가 30분보다 적으면 남은 만큼, 0분이면 칩만 골라진 0분(만든 순서대로 뗀다)", () => {
    const r = initialSelection({ totalMinutes: 80, timer: { [C3]: 40 }, doneCategoryIds: [C2, C1], catalogOrder: CAT });
    // 타이머 C3 40 → 기타 40 → C1 30(만든 순서가 먼저) → C2 10
    expect(r.perCategory).toEqual({ [C1]: 30, [C2]: 10, [C3]: 40 });
    const z = initialSelection({ totalMinutes: 30, timer: { [C1]: 30 }, doneCategoryIds: [C2], catalogOrder: CAT });
    expect(z.perCategory).toEqual({ [C1]: 30, [C2]: 0 });
    expect(z.items).toEqual([{ categoryId: C1, minutes: 30 }]); // 0분은 미리 채운 값(저장 방식 기준)에서 빠진다
  });
  it("총시간이 타이머 합보다 작으면 타이머 합이 총시간이 된다(분야 없는 타이머는 기타)", () => {
    const r = initialSelection({ totalMinutes: 10, timer: { [C1]: 25, [C2]: 20 }, timerOther: 5, doneCategoryIds: [C3], catalogOrder: CAT });
    expect(r.total).toBe(50);
    expect(r.perCategory).toEqual({ [C1]: 25, [C2]: 20, [C3]: 5 });
    expect(sumMinutes(r.items)).toBe(50);
  });
  it("총시간 0, 타이머도 없으면 빈 목록(끝낸 할 일 칩은 0분으로 골라짐)", () => {
    const r = initialSelection({ totalMinutes: 0, timer: {}, doneCategoryIds: [C1], catalogOrder: CAT });
    expect(r.items).toEqual([]);
    expect(r.perCategory).toEqual({ [C1]: 0 });
  });
});

describe("칩 고르기·풀기 (PM 10 — 합 고정)", () => {
  it("고르면 기타에서 30분, 기타가 적으면 기타 전부, 0분이면 0분. 이미 고른 칩은 그대로", () => {
    expect(NEW_CHIP_MINUTES).toBe(30);
    expect(pickChip(120, {}, C1)).toEqual({ perCategory: { [C1]: 30 }, taken: 30 });
    expect(pickChip(120, { [C1]: 100 }, C2)).toEqual({ perCategory: { [C1]: 100, [C2]: 20 }, taken: 20 });
    expect(pickChip(120, { [C1]: 120 }, C2)).toEqual({ perCategory: { [C1]: 120, [C2]: 0 }, taken: 0 });
    const same = { [C1]: 40 };
    expect(pickChip(120, same, C1).perCategory).toBe(same);
  });
  it("풀면 그 분야 값이 지워지고 시간은 기타로(기타 = 쓴 시간 − 나눈 합)", () => {
    const next = unpickChip({ [C1]: 40, [C2]: 30 }, C1);
    expect(next).toEqual({ [C2]: 30 });
    expect(otherOf(120, next)).toBe(90);
    const none = { [C2]: 30 };
    expect(unpickChip(none, C1)).toBe(none);
  });
  it("악용: 어떤 고르기·풀기 순서에도 합(분야 + 기타) = 쓴 시간이고 값은 0 이상 정수", () => {
    const ids = [C1, C2, C3];
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let checked = 0;
    for (const total of [0, 5, 29, 62, 120, 1440]) {
      let per: Record<string, number> = {};
      for (let step = 0; step < 200; step++) {
        const id = ids[Math.floor(rand() * ids.length)];
        per = id in per ? unpickChip(per, id) : pickChip(total, per, id).perCategory;
        const built = buildItems(total, per);
        expect(built.total).toBe(total);
        expect(sumMinutes(built.items)).toBe(total);
        expect(Object.values(per).every((m) => Number.isInteger(m) && m >= 0)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBe(1200);
  });
});

describe("저장할 항목 만들기", () => {
  it("기타는 총시간에서 분야 합을 뺀 나머지", () => {
    expect(buildItems(180, { [C1]: 60, [C2]: 30 })).toEqual({
      total: 180,
      items: [
        { categoryId: C1, minutes: 60 },
        { categoryId: C2, minutes: 30 },
        { categoryId: null, minutes: 90 },
      ],
    });
  });
  it("분야 합이 총시간보다 크면 총시간을 그 합으로 늘린다", () => {
    const built = buildItems(30, { [C1]: 60 });
    expect(built.total).toBe(60);
    expect(built.items).toEqual([{ categoryId: C1, minutes: 60 }]);
  });
  it("나누지 않음은 전부 기타, 0분이면 항목 없음", () => {
    expect(notSplitItems(120)).toEqual([{ categoryId: null, minutes: 120 }]);
    expect(notSplitItems(0)).toEqual([]);
  });
  it("compactItems는 같은 분야를 합치고 0분을 버리고 기타를 맨 끝에 둔다", () => {
    expect(compactItems([{ categoryId: null, minutes: 5 }, { categoryId: C1, minutes: 10 }, { categoryId: C1, minutes: 5 }, { categoryId: C2, minutes: 0 }])).toEqual([
      { categoryId: C1, minutes: 15 },
      { categoryId: null, minutes: 5 },
    ]);
  });
});

describe("저장 방식 분류 (G9)", () => {
  const prefilled = [{ categoryId: C1, minutes: 60 }, { categoryId: null, minutes: 30 }];
  it("나누기를 건너뛰면 not_split, 미리 채운 그대로면 prefilled(순서·0분 무시), 고쳤으면 edited", () => {
    expect(classifySaveMode({ skippedSplit: true, prefilled, final: [] })).toBe("not_split");
    expect(classifySaveMode({ skippedSplit: false, prefilled, final: [{ categoryId: null, minutes: 30 }, { categoryId: C1, minutes: 60 }, { categoryId: C2, minutes: 0 }] })).toBe("prefilled");
    expect(classifySaveMode({ skippedSplit: false, prefilled, final: [{ categoryId: C1, minutes: 65 }, { categoryId: null, minutes: 25 }] })).toBe("edited");
    expect(sameItems(prefilled, [{ categoryId: C1, minutes: 60 }])).toBe(false);
  });
});

describe("diffItems (저장 직후 한 줄: 오늘 바뀐 분야별 시간)", () => {
  it("앞선 기록이 없으면 0에서 시작하고, 큰 변화부터 보인다", () => {
    expect(diffItems([], [{ categoryId: C1, minutes: 30 }, { categoryId: null, minutes: 90 }])).toEqual([
      { categoryId: null, minutes: 90 },
      { categoryId: C1, minutes: 30 },
    ]);
  });
  it("줄어든 분야는 음수, 같은 분야는 빠진다. 모두 기타로 저장해도 값이 있다", () => {
    expect(diffItems([{ categoryId: C1, minutes: 60 }, { categoryId: C2, minutes: 30 }], [{ categoryId: C1, minutes: 30 }, { categoryId: C2, minutes: 30 }])).toEqual([
      { categoryId: C1, minutes: -30 },
    ]);
    expect(diffItems([], [{ categoryId: null, minutes: 120 }])).toEqual([{ categoryId: null, minutes: 120 }]);
    expect(diffItems([{ categoryId: C1, minutes: 5 }], [{ categoryId: C1, minutes: 5 }])).toEqual([]);
  });
});

function setup() {
  const store = new FakeStore();
  store.rules = v2Rules();
  for (const [id, name] of [[C1, "어학"], [C2, "포트폴리오"]] as const) {
    store.seed("categories", { id, user_id: ME, name_encrypted: encryptCategoryName(name, ME, KEY!), archived_at: null });
  }
  store.seed("categories", { id: C3, user_id: OTHER, name_encrypted: "x", archived_at: null });
  return store;
}
const deps = (store: FakeStore, sub: string | null = ME) => ({ supabase: fakeTablesClient(store, { sub }), key: KEY, now: () => NOW });
const valid = (over: Record<string, unknown> = {}) => ({
  id: L1,
  targetDay: "2026-11-07",
  totalMinutes: 180,
  items: [{ categoryId: C1, minutes: 120 }, { categoryId: null, minutes: 60 }],
  saveMode: "edited",
  clientSavedAt: "2026-11-07T14:00:05.000Z",
  ...over,
});

describe("saveEveningLogForUser", () => {
  it("저장하면 저장 방식·대상 날·서버 저장 시각·기기 시각이 한 행에 남고, 바뀐 시간을 돌려준다", async () => {
    const store = setup();
    const res = await saveEveningLogForUser(deps(store), valid());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.log).toMatchObject({ id: L1, targetDay: "2026-11-07", totalMinutes: 180, saveMode: "edited" });
    expect(res.data.delta).toEqual([{ categoryId: C1, minutes: 120 }, { categoryId: null, minutes: 60 }]);
    const row = store.table("evening_logs")[0];
    expect(row).toMatchObject({ user_id: ME, target_day: "2026-11-07", save_mode: "edited", client_saved_at: "2026-11-07T14:00:05.000Z" });
    expect(typeof row.saved_at).toBe("string");
    // 서버 시각은 보내지 않았다(DB 기본값)
    const insert = store.calls.find((c) => c.table === "evening_logs" && c.op === "insert");
    expect(Object.keys(insert!.payload as object)).not.toContain("saved_at");
  });
  it("같은 날 다시 저장하면 행이 쌓이고, 바뀐 시간은 앞선 기록 대비다. 현재 값은 가장 늦은 것", async () => {
    const store = setup();
    await saveEveningLogForUser(deps(store), valid());
    const second = await saveEveningLogForUser(
      deps(store),
      valid({ id: L2, totalMinutes: 150, items: [{ categoryId: C1, minutes: 90 }, { categoryId: null, minutes: 60 }], saveMode: "edited" }),
    );
    expect(second.ok && second.data.delta).toEqual([{ categoryId: C1, minutes: -30 }]);
    expect(store.table("evening_logs")).toHaveLength(2);
    const state = await readEveningState(deps(store));
    expect(state.ok && state.data.existing).toMatchObject({ id: L2, totalMinutes: 150 });
  });
  it("같은 id를 다시 보내도 새 행이 없고 같은 결과(재시도)", async () => {
    const store = setup();
    const first = await saveEveningLogForUser(deps(store), valid());
    const again = await saveEveningLogForUser(deps(store), valid());
    expect(again).toEqual(first);
    expect(store.table("evening_logs")).toHaveLength(1);
  });
  it("어제 것도 저장한다(대상 날이 저장한 날과 다르다). 8일 전·미래·날짜 아님은 거절", async () => {
    const store = setup();
    expect((await saveEveningLogForUser(deps(store), valid({ targetDay: "2026-11-06" }))).ok).toBe(true);
    expect(store.table("evening_logs")[0].target_day).toBe("2026-11-06");
    expect(await saveEveningLogForUser(deps(store), valid({ id: L2, targetDay: "2026-10-30" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveEveningLogForUser(deps(store), valid({ id: L2, targetDay: "2026-11-08" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveEveningLogForUser(deps(store), valid({ id: L2, targetDay: "내일" }))).toEqual({ ok: false, error: "invalid_input" });
    expect((await saveEveningLogForUser(deps(store), valid({ id: L3, targetDay: "2026-10-31" }))).ok).toBe(true); // 7일 앞은 된다
  });
  it("나누지 않음은 항목이 기타 하나여야 한다", async () => {
    const store = setup();
    expect((await saveEveningLogForUser(deps(store), valid({ saveMode: "not_split", items: [{ categoryId: null, minutes: 180 }] }))).ok).toBe(true);
    expect(await saveEveningLogForUser(deps(store), valid({ id: L2, saveMode: "not_split" }))).toEqual({ ok: false, error: "invalid_input" });
    const zero = await saveEveningLogForUser(deps(store), valid({ id: L3, saveMode: "not_split", totalMinutes: 0, items: [] }));
    expect(zero.ok && zero.data.log.items).toEqual([]);
  });
  it("항목 합이 총시간과 다르거나, 같은 분야가 두 번이거나, 모르는 키·저장 방식이면 거절하고 DB를 부르지 않는다", async () => {
    const store = setup();
    const before = store.calls.length;
    expect(await saveEveningLogForUser(deps(store), valid({ totalMinutes: 200 }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveEveningLogForUser(deps(store), valid({ items: [{ categoryId: C1, minutes: 100 }, { categoryId: C1, minutes: 80 }] }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveEveningLogForUser(deps(store), valid({ saveMode: "auto" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveEveningLogForUser(deps(store), valid({ savedAt: "2020-01-01T00:00:00.000Z" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveEveningLogForUser(deps(store), valid({ userId: OTHER }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveEveningLogForUser(deps(store), valid({ totalMinutes: 1441, items: [{ categoryId: null, minutes: 1441 }] }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await saveEveningLogForUser(deps(store), valid({ id: "x" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(store.calls.length).toBe(before);
  });
  it("남의 분야·없는 분야면 not_found이고 저장하지 않는다", async () => {
    const store = setup();
    expect(await saveEveningLogForUser(deps(store), valid({ items: [{ categoryId: C3, minutes: 180 }], totalMinutes: 180 }))).toEqual({ ok: false, error: "not_found" });
    expect(store.table("evening_logs")).toHaveLength(0);
  });
  it("기기 시각이 이상하면 null로 둔다(서버 시각은 따로 남는다)", async () => {
    const store = setup();
    await saveEveningLogForUser(deps(store), valid({ clientSavedAt: "어제쯤" }));
    expect(store.table("evening_logs")[0].client_saved_at).toBeNull();
  });
  it("로그인이 없으면 unauthenticated, DB 오류는 unavailable", async () => {
    const store = setup();
    expect(await saveEveningLogForUser(deps(store, null), valid())).toEqual({ ok: false, error: "unauthenticated" });
    store.alwaysError = { code: "XX000", message: "secret" };
    expect(await saveEveningLogForUser(deps(store), valid())).toEqual({ ok: false, error: "unavailable" });
  });
  it("남의 기록은 읽히지 않는다", async () => {
    const store = setup();
    store.seed("evening_logs", { id: L3, user_id: OTHER, target_day: "2026-11-07", total_minutes: 60, items: [], save_mode: "not_split", saved_at: "2026-11-07T10:00:00.000Z" });
    const state = await readEveningState(deps(store));
    expect(state.ok && state.data.existing).toBeNull();
  });
});

describe("readEveningState", () => {
  it("그 날 끝낸 할 일의 분야(중복 없음)와 고를 수 있는 분야를 준다", async () => {
    const store = setup();
    const todo = (id: string, categoryId: string | null, done: boolean, day = "2026-11-07") =>
      store.seed("todos", { id, user_id: ME, day, text_encrypted: encryptTodoText("글", ME, KEY!), done, category_id: categoryId });
    todo("11111111-1111-4111-8111-111111111111", C1, true);
    todo("22222222-2222-4222-8222-222222222222", C1, true);
    todo("33333333-3333-4333-8333-333333333333", null, true);
    todo("44444444-4444-4444-8444-444444444444", C2, false);
    todo("55555555-5555-4555-8555-555555555555", C2, true, "2026-11-06");
    const state = await readEveningState(deps(store));
    expect(state.ok && state.data.today).toBe("2026-11-07");
    expect(state.ok && [...state.data.doneCategoryIds].sort((a, b) => String(a).localeCompare(String(b)))).toEqual([C1, null]);
    expect(state.ok && state.data.categories.map((c) => c.name)).toEqual(["어학", "포트폴리오"]);
    expect(state.ok && state.data.timerByCategory).toEqual([]);
  });
  it("범위 밖 날은 invalid_input", async () => {
    const store = setup();
    expect(await readEveningState(deps(store), "2026-10-01")).toEqual({ ok: false, error: "invalid_input" });
    expect(await readEveningState(deps(store), "2026-11-08")).toEqual({ ok: false, error: "invalid_input" });
    expect(await readEveningState(deps(store), 5)).toEqual({ ok: false, error: "invalid_input" });
    const yesterday = await readEveningState(deps(store), "2026-11-06");
    expect(yesterday.ok && yesterday.data.day).toBe("2026-11-06");
  });
});

describe("listEveningLogs · latestPerDay", () => {
  it("날마다 가장 늦게 저장한 것만, 날짜 오름차순", async () => {
    const store = setup();
    await saveEveningLogForUser(deps(store), valid({ id: L1, targetDay: "2026-11-05" }));
    await saveEveningLogForUser(deps(store), valid({ id: L2, targetDay: "2026-11-06", totalMinutes: 60, items: [{ categoryId: null, minutes: 60 }], saveMode: "not_split" }));
    await saveEveningLogForUser(deps(store), valid({ id: L3, targetDay: "2026-11-06", totalMinutes: 90, items: [{ categoryId: C2, minutes: 90 }] }));
    const res = await listEveningLogs(deps(store));
    expect(res.ok && res.data.map((l) => [l.targetDay, l.id])).toEqual([["2026-11-05", L1], ["2026-11-06", L3]]);
    const from = await listEveningLogs(deps(store), "2026-11-06");
    expect(from.ok && from.data).toHaveLength(1);
    expect(await listEveningLogs(deps(store), "x")).toEqual({ ok: false, error: "invalid_input" });
  });
  it("2000행을 넘게 쌓여도 가장 최근 기록이 빠지지 않는다(오래된 쪽이 빠진다) (A12)", async () => {
    const store = setup();
    const start = new Date("2020-01-01T00:00:00.000Z").getTime();
    const dayOf = (i: number) => new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const total = 2010;
    for (let i = 0; i < total; i++) {
      store.seed("evening_logs", {
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        user_id: ME,
        target_day: dayOf(i),
        total_minutes: 10,
        items: [{ categoryId: null, minutes: 10 }],
        save_mode: "edited",
        saved_at: `${dayOf(i)}T12:00:00.000Z`,
      });
    }
    const res = await listEveningLogs(deps(store));
    expect(res.ok && res.data).toHaveLength(2000);
    // 가장 최근 날이 들어 있고, 빠진 것은 가장 오래된 열 날이다. 결과는 날짜 오름차순
    expect(res.ok && res.data[res.data.length - 1].targetDay).toBe(dayOf(total - 1));
    expect(res.ok && res.data[0].targetDay).toBe(dayOf(total - 2000));
  });
  it("toLog: 이상한 items는 빈 목록으로, 모르는 저장 방식은 edited로 읽는다", () => {
    const log = toLog({ id: L1, target_day: "2026-11-07", total_minutes: 5, items: "깨짐", save_mode: "zzz", saved_at: "x" });
    expect(log).toMatchObject({ items: [], saveMode: "edited" });
    expect(latestPerDay([log, { ...log, id: L2, savedAt: "y" }]).map((l) => l.id)).toEqual([L2]);
  });
});
