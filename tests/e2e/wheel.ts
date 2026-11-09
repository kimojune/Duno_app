import type { Locator, Page } from "@playwright/test";

/**
 * 오늘 기록 두 줄 휠(고침9, components/time-wheel.tsx)에 값을 바로 쓴다 — 사람이 하는 길 그대로:
 * 「시간」/「분」 열(spinbutton) 가운데 숫자를 누르면 숫자 칸이 열리고, 쓰고 Enter로 닫는다(분은 앱이 5분 단위로 맞춘다).
 * e2e(tests/e2e)와 화면 시험(tests/screens)이 같이 쓴다.
 */
export async function fillWheel(scope: Page | Locator, label: "시간" | "분", value: number) {
  await scope.getByRole("spinbutton", { name: label, exact: true }).locator(".time-wheel-center").click();
  const box = scope.getByRole("textbox", { name: label, exact: true });
  await box.fill(String(value));
  await box.press("Enter");
}
