import { fireEvent, screen } from "@testing-library/react";

/**
 * 오늘 기록 두 줄 휠(components/time-wheel.tsx)에 값을 바로 쓴다 — 사람이 하는 길 그대로:
 * 「시간」/「분」 열(spinbutton)의 가운데 숫자를 누르면 숫자 칸이 열리고, 그 칸에 쓰고 Enter로 닫는다.
 * 숫자 칸 검사(범위 밖 끝값, 분 5분 단위)는 앱이 한다. 바뀐 합은 onChange로 바로 들어간다.
 */
export function typeWheel(label: "시간" | "분", value: number | string) {
  const spin = screen.getByRole("spinbutton", { name: label });
  const center = spin.querySelector(".time-wheel-center");
  if (!center) throw new Error("휠 가운데 숫자가 없다");
  fireEvent.click(center);
  const input = screen.getByRole("textbox", { name: label });
  fireEvent.change(input, { target: { value: String(value) } });
  fireEvent.keyDown(input, { key: "Enter" });
}

/** 휠 열의 지금 값(aria-valuenow) */
export function wheelValue(label: "시간" | "분"): number {
  return Number(screen.getByRole("spinbutton", { name: label }).getAttribute("aria-valuenow"));
}

/** 휠이 보이는 지금 합(분) */
export function wheelTotal(): number {
  return wheelValue("시간") * 60 + wheelValue("분");
}

/** 「시간」「분」이면 휠, 아니면(나누기 줄의 분야 이름 등) 그 이름표의 숫자 칸에 쓴다 */
export function setNumberField(label: string, value: number) {
  if (label === "시간" || label === "분") typeWheel(label, value);
  else fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
}
