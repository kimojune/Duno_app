import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * 고침6 G2(PM d-129 ②·③·④): 오늘 기록 나누기 기타 0분 손잡이 · 안내 글 한 줄 · 시간 단계 「타이머 n」 띠. 360×800 사진은 docs/oneshot-v2/고침6-G2/에 둔다.
 * 개발 서버의 /dev/v2(가짜 데이터, env 없이 그려짐)에서만 돈다: npm run screens -- fix6-g2
 */

const OUT = "docs/oneshot-v2/고침6-G2";

async function open(page: Page, state: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${state}`);
  await page.waitForLoadState("networkidle");
}
async function noHorizontalScroll(page: Page) {
  const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(s.sw, "가로 스크롤 없음").toBeLessThanOrEqual(s.cw);
}

test("나누기 기타 0분(마지막 분야 고름): 12시에 손잡이가 없고, 안내 글은 분야 줄 아래 한 줄 · 기타 줄은 「기타」 한 줄", async ({ page }) => {
  await open(page, "evening-split-blank"); // 어학 · 포트폴리오 · CS 공부, 타이머·끝낸 할 일 없음
  await page.locator("#dev-open-window").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByLabel("시간", { exact: true }).fill("1");
  await page.getByLabel("분", { exact: true }).fill("30");
  await page.getByRole("button", { name: "분야마다 나누기" }).click();
  await expect(page.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
  for (const name of ["어학", "포트폴리오", "CS 공부"]) await page.getByRole("button", { name: `${name}, 다이얼에 넣기` }).click();
  // 30분씩 셋 = 1시간 30분 → 기타 0분, 마지막에 고른 CS 공부(마지막 분야)가 골라져 있다
  await expect(dialog.locator('.ratio-list [data-row-key="other"] .ratio-value')).toHaveText("0분");
  await expect(dialog.locator(".ratio-list li.is-picked")).toHaveCount(1);
  await expect(dialog.locator(".ratio-list li.is-picked .stepper-label")).toHaveText("CS 공부");
  // 손잡이: 앞(포트폴리오·CS 공부) 하나뿐, 끝(12시) 없음. 보이는 자리도 12시(다이얼 맨 위 가운데)가 아니다
  const handles = dialog.locator('[id^="evening-dial-handle-"]');
  await expect(handles).toHaveCount(1);
  await expect(handles.first()).toHaveAttribute("id", "evening-dial-handle-start");
  const svg = (await dialog.locator("svg.dial").boundingBox())!;
  const knob = (await dialog.locator("#evening-dial-handle-start .dial-ring").boundingBox())!;
  const cx = knob.x + knob.width / 2 - (svg.x + svg.width / 2);
  const cy = knob.y + knob.height / 2 - (svg.y + svg.height / 2);
  const turn = (((Math.atan2(cy, cx) / (2 * Math.PI) + 0.25) % 1) + 1) % 1;
  expect(turn, "손잡이가 8시 자리(60/90 바퀴)").toBeCloseTo(2 / 3, 1);
  expect(Math.min(turn, 1 - turn), "12시에서 떨어져 있다").toBeGreaterThan(0.2);
  // 안내 글 한 줄(12, 보조 색): 분야 줄 아래
  const hint = dialog.locator(".evening-split-hint");
  await expect(hint).toHaveText("나누지 않은 시간은 기타로 들어가요.");
  const font = await hint.evaluate((e) => {
    const s = getComputedStyle(e);
    return { size: s.fontSize, color: s.color };
  });
  expect(font.size).toBe("12px");
  const sub = await page.evaluate(() => {
    const p = document.createElement("p");
    p.style.color = "var(--color-text-sub)";
    document.body.append(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  });
  expect(font.color, "보조 글 색").toBe(sub);
  const listBox = (await dialog.locator("ul.ratio-list").boundingBox())!;
  const hintBox = (await hint.boundingBox())!;
  expect(hintBox.y, "안내 글이 분야 줄 아래").toBeGreaterThanOrEqual(listBox.y + listBox.height - 0.5);
  await expect(dialog.getByText(/나누지 않은 시간/)).toHaveCount(1);
  await expect(dialog.getByText(/미리 채운 값을/)).toHaveCount(0);
  // 기타 줄: 이름 「기타」 한 줄이 줄 세로 가운데
  const otherRow = dialog.locator('.ratio-list [data-row-key="other"]');
  await expect(otherRow.locator(".ratio-name")).toHaveText("기타");
  const rowBox = (await otherRow.boundingBox())!;
  const nameBox = (await otherRow.locator(".ratio-name").boundingBox())!;
  expect(Math.abs(nameBox.y + nameBox.height / 2 - (rowBox.y + rowBox.height / 2)), "기타 이름이 줄 세로 가운데").toBeLessThanOrEqual(1.5);
  await noHorizontalScroll(page);
  await dialog.locator("svg.dial").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/split-other0-last-picked-360x800.png` });
  // 줄의 −로 CS 공부를 줄이면 기타로 돌아가고 끝 손잡이(CS 공부·기타)가 선다
  await page.getByRole("button", { name: "CS 공부 5분 줄이기" }).click();
  await expect(dialog.locator('.ratio-list [data-row-key="other"] .ratio-value')).toHaveText("5분");
  await expect(handles).toHaveCount(2);
  // 안내 글 사진: 분야 줄과 안내 글·합계가 함께 보이게
  await hint.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/split-hint-360x800.png` });
});

test("시간 단계: 타이머로 채웠으면 「타이머 2시간 30분」 띠만(알림 글 없음), 그 아래 「오늘 할 일」 줄", async ({ page }) => {
  await open(page, "evening-todo");
  const chip = page.getByText("타이머 2시간 30분", { exact: true });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveClass("evening-timer-chip");
  await expect(page.getByText(/미리 채웠어요/)).toHaveCount(0);
  const line = page.getByRole("button", { name: /^오늘 할 일 2\/4/ });
  await expect(line).toBeVisible();
  const chipBox = (await chip.boundingBox())!;
  const lineBox = (await line.boundingBox())!;
  const totalBox = (await page.getByText("합계 2시간 30분", { exact: true }).boundingBox())!;
  expect(chipBox.y, "띠는 합계 아래").toBeGreaterThan(totalBox.y);
  expect(lineBox.y, "오늘 할 일 줄은 띠 아래").toBeGreaterThan(chipBox.y + chipBox.height);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `${OUT}/time-step-timer-chip-360x800.png` });
});
