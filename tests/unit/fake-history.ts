import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * 시험용 가짜 history. 칸마다 state를 따로 갖고, 브라우저처럼:
 *  - pushState는 지금 칸 뒤(앞으로 갈 칸)를 버리고 새 칸을 더한다. replaceState는 지금 칸의 state만 바꾼다.
 *  - back()·forward()는 바로 움직이지 않고 나중에(작업 큐) 돈다. flush()로 돌린다.
 *    target: "run"이면 돌 때의 지금 칸 기준으로 한 칸, "call"이면 부를 때 정한 칸으로 간다(브라우저마다 다를 수 있어 둘 다 시험한다).
 *  - 움직이면 popstate를 보낸다. 앱 첫 칸보다 더 뒤로 가면 leftApp이 된다(앱을 떠남).
 *  - reload(): 새로고침해도 칸과 state는 그대로 남는다(문서만 새로 그린다 — 시험이 다시 render한다).
 * state는 값 복사(structuredClone)로 둔다. 부르는 쪽이 넘긴 객체를 나중에 바꿔도 칸의 state는 바뀌지 않는다.
 */
export class FakeHistory {
  entries: { state: unknown }[];
  index = 0;
  leftApp = false;
  private queue: (() => void)[] = [];

  constructor(
    initialState: unknown = null,
    private target: "run" | "call" = "run",
  ) {
    this.entries = [{ state: structuredClone(initialState) }];
  }

  get state(): unknown {
    return this.entries[this.index].state;
  }

  pushState = vi.fn((state: unknown) => {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ state: structuredClone(state) });
    this.index += 1;
  });

  replaceState = vi.fn((state: unknown) => {
    this.entries[this.index] = { state: structuredClone(state) };
  });

  back = vi.fn(() => this.schedule(-1));
  forward = vi.fn(() => this.schedule(1));

  private schedule(delta: number) {
    if (this.target === "call") {
      const to = this.index + delta;
      this.queue.push(() => this.moveTo(to));
    } else {
      this.queue.push(() => this.moveTo(this.index + delta));
    }
  }

  private moveTo(to: number) {
    if (to < 0) {
      this.leftApp = true;
      return;
    }
    if (to >= this.entries.length) return;
    this.index = to;
    window.dispatchEvent(new PopStateEvent("popstate", { state: this.state }));
  }

  /** 미뤄 둔 back()·forward()를 돌린다(브라우저의 다음 작업) */
  flush() {
    act(() => {
      while (this.queue.length > 0) this.queue.shift()!();
    });
  }

  /** 사용자가 브라우저(안드로이드) 뒤로 가기를 누름 */
  userBack() {
    act(() => this.moveTo(this.index - 1));
  }

  /** 사용자가 앞으로 가기를 누름 */
  userForward() {
    act(() => this.moveTo(this.index + 1));
  }

  /** window.history를 이 가짜로 바꾼다(state 읽기와 네 메서드) */
  install() {
    vi.spyOn(window.history, "state", "get").mockImplementation(() => this.state);
    vi.spyOn(window.history, "pushState").mockImplementation(this.pushState);
    vi.spyOn(window.history, "replaceState").mockImplementation(this.replaceState);
    vi.spyOn(window.history, "back").mockImplementation(this.back);
    vi.spyOn(window.history, "forward").mockImplementation(this.forward);
    return this;
  }
}
