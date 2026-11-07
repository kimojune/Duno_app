// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllOutboxes, createOutbox, OUTBOX_MAX_ITEMS, safeLocalStorage, type OutboxItem } from "../../lib/outbox";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const ID1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const item = (id: string, text = "글"): OutboxItem => ({ id, text, categoryId: null, writtenAt: "2026-11-07T01:00:00.000Z" });

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("오프라인 보관함 (PRD 10절)", () => {
  it("저장한 것을 읽고, 비우면 키가 지워진다", () => {
    const box = createOutbox(window.localStorage, U1);
    expect(box.load()).toEqual([]);
    box.save([item(ID1, "첫 글"), item(ID2, "둘째 글")]);
    expect(box.load()).toEqual([item(ID1, "첫 글"), item(ID2, "둘째 글")]);
    box.save([]);
    expect(box.load()).toEqual([]);
    expect(window.localStorage.length).toBe(0);
  });
  it("사용자마다 따로 둔다(다른 사용자의 글을 읽지 않는다)", () => {
    createOutbox(window.localStorage, U1).save([item(ID1)]);
    expect(createOutbox(window.localStorage, U2).load()).toEqual([]);
    createOutbox(window.localStorage, U2).save([item(ID2)]);
    expect(createOutbox(window.localStorage, U1).load().map((i) => i.id)).toEqual([ID1]);
  });
  it("깨진 값·이상한 항목은 버리고 멀쩡한 항목만 읽는다. 같은 id는 한 번", () => {
    window.localStorage.setItem("duno.outbox.v1." + U1, "{깨짐");
    expect(createOutbox(window.localStorage, U1).load()).toEqual([]);
    window.localStorage.setItem("duno.outbox.v1." + U1, JSON.stringify({ not: "array" }));
    expect(createOutbox(window.localStorage, U1).load()).toEqual([]);
    window.localStorage.setItem(
      "duno.outbox.v1." + U1,
      JSON.stringify([item(ID1), { id: "x", text: "나쁜 id", categoryId: null, writtenAt: "x" }, { id: ID2, text: "", categoryId: null, writtenAt: "x" }, item(ID1, "중복")]),
    );
    expect(createOutbox(window.localStorage, U1).load()).toEqual([item(ID1)]);
  });
  it("개수 상한을 넘기지 않는다", () => {
    const many = Array.from({ length: OUTBOX_MAX_ITEMS + 20 }, (_, i) => item(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
    const box = createOutbox(window.localStorage, U1);
    box.save(many);
    expect(box.load()).toHaveLength(OUTBOX_MAX_ITEMS);
  });
  it("저장소가 없으면(null) 아무것도 안 하고 던지지 않는다", () => {
    const box = createOutbox(null, U1);
    expect(() => box.save([item(ID1)])).not.toThrow();
    expect(box.load()).toEqual([]);
    expect(() => box.clear()).not.toThrow();
  });
  it("저장소가 막히거나 가득 차도 던지지 않는다", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const box = createOutbox(broken, U1);
    expect(box.load()).toEqual([]);
    expect(() => box.save([item(ID1)])).not.toThrow();
    expect(() => box.clear()).not.toThrow();
    expect(() => clearAllOutboxes(broken)).not.toThrow();
  });
  it("clear는 그 사용자만, clearAllOutboxes는 보관함 키만 모두 지운다(다른 저장값은 그대로)", () => {
    window.localStorage.setItem("other.key", "keep");
    createOutbox(window.localStorage, U1).save([item(ID1)]);
    createOutbox(window.localStorage, U2).save([item(ID2)]);
    createOutbox(window.localStorage, U1).clear();
    expect(createOutbox(window.localStorage, U1).load()).toEqual([]);
    expect(createOutbox(window.localStorage, U2).load()).toHaveLength(1);
    clearAllOutboxes(window.localStorage);
    expect(createOutbox(window.localStorage, U2).load()).toEqual([]);
    expect(window.localStorage.getItem("other.key")).toBe("keep");
  });
  it("safeLocalStorage는 쓸 수 있으면 저장소를, 막혔으면 null", () => {
    expect(safeLocalStorage()).toBe(window.localStorage);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(safeLocalStorage()).toBeNull();
  });
});
