import { screen, within } from "@testing-library/react";
import { expect } from "vitest";

/**
 * 고침10 B 공통 확인 창(components/close-confirm.tsx ConfirmDialog)을 보는 시험 도우미.
 * 확인 창의 약속(146:11 · 147:2): role alertdialog, 이름 = 제목, 뜨면 초점은 제목, 단추 둘 = 위(떠나기·지우기) · 아래(안전한 쪽 주 단추).
 */

export const LEAVE = { title: "저장하지 않고 나갈까요?", top: "나가기", bottom: "계속 적기" } as const;
export const LOGOUT = {
  title: "로그아웃할까요?",
  description: "아직 저장되지 않은 기록은 이 기기에서 지워져요.",
  top: "로그아웃",
  bottom: "계속 쓰기",
} as const;

export function confirmDialog(title: string): HTMLElement {
  return screen.getByRole("alertdialog", { name: title });
}

export function queryConfirmDialog(title: string): HTMLElement | null {
  return screen.queryByRole("alertdialog", { name: title });
}

export function confirmTitle(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("heading");
}

/** 위·아래 단추(보이는 순서 = DOM 순서) */
export function confirmButtons(dialog: HTMLElement): HTMLButtonElement[] {
  return within(dialog).getAllByRole("button") as HTMLButtonElement[];
}

/** 꼴 약속: 제목에 초점, 단추 둘이 위 = top(보조, 테두리) · 아래 = bottom(주 단추) */
export function expectConfirmShape(dialog: HTMLElement, top: string, bottom: string) {
  expect(document.activeElement, "뜨면 초점은 제목").toBe(confirmTitle(dialog));
  const buttons = confirmButtons(dialog);
  expect(buttons.map((b) => b.textContent)).toEqual([top, bottom]);
  expect(buttons[0].className).toContain("btn-secondary");
  expect(buttons[1].className).toContain("btn-primary");
}

/**
 * 고침10 A 머리 단추 쓰는 곳 약속: root 안에 이름 「이전」(back) 또는 「닫기」(close) 머리 단추가 정확히 하나(아이콘만, 글 없음),
 * 다른 이름의 머리 단추는 없고, 글 「닫기」 TextButton(.btn-text)·「‹ 할 일」 글 단추도 없다.
 */
export function expectHeadButton(root: HTMLElement, kind: "back" | "close"): HTMLButtonElement {
  const name = kind === "back" ? "이전" : "닫기";
  const other = kind === "back" ? "닫기" : "이전";
  const buttons = within(root).getAllByRole("button", { name }) as HTMLButtonElement[];
  expect(buttons, `이름 「${name}」 단추는 하나`).toHaveLength(1);
  const head = buttons[0];
  expect(head.getAttribute("data-head-button")).toBe(kind);
  expect(head.className).toContain("head-btn");
  expect(head.textContent, "아이콘만(이름은 aria-label)").toBe("");
  expect(within(root).queryAllByRole("button", { name: other }), `이름 「${other}」 단추는 없다`).toHaveLength(0);
  const textClose = [...root.querySelectorAll(".btn-text")].filter((b) => /닫기|‹/.test(b.textContent ?? ""));
  expect(textClose, "글 「닫기」·「‹ …」 글 단추 없음").toHaveLength(0);
  return head;
}
