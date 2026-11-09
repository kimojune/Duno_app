import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fillWheel } from "../e2e/wheel";

/**
 * 고침9 워커 J3: 오늘 기록 전체 Figma 정합(S5-1 시간 49:5 · 숫자 바로 쓰기 66:170 · 오늘 할 일 시트 88:12 · S5-2 87:2 · 87:96 · 49:26 · 49:83 ·
 * S5-3 49:142 · 59:2 · 확인 창 98:278). 360×800 사진을 docs/oneshot-v2/고침9-J3/에 「최종 폰 목록」의 화면·상태 이름으로 두고,
 * 사진만 남는 시험이 되지 않게 치수·글·순서를 Figma 값과 같이 단언한다(하한·상한 둘 다).
 * 개발 갤러리(/dev/v2)의 화면이다(진짜 로그인 앱 화면 아님 — 컴포넌트는 앱과 같은 것, 데이터만 가짜). npm run screens(SCREENS_PORT로 포트를 바꿔 돈다)
 */
const OUT = path.resolve(__dirname, "../../docs/oneshot-v2/고침9-J3");

async function open(page: Page, s: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dev/v2?s=${s}`);
  await page.waitForLoadState("networkidle");
}
async function photo(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
async function noOverflow(page: Page) {
  const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(s.sw, "가로 스크롤 없음").toBeLessThanOrEqual(s.cw);
}
const box = async (l: Locator) => (await l.boundingBox())!;
const near = (actual: number, expected: number, tol: number, what: string) => {
  expect(actual, `${what} ≥ ${expected - tol}`).toBeGreaterThanOrEqual(expected - tol);
  expect(actual, `${what} ≤ ${expected + tol}`).toBeLessThanOrEqual(expected + tol);
};
const style = (l: Locator, props: string[]) =>
  l.evaluate((el, ps) => {
    const s = getComputedStyle(el);
    return Object.fromEntries(ps.map((p) => [p, s.getPropertyValue(p)]));
  }, props);

/** 아래 고정 단추(A2): 폭 가득(328) · 높이 48 · 마지막 단추 아래 여백 36 */
async function bottomButtons(page: Page, names: string[]) {
  const bar = page.locator(".bottom-actions");
  const buttons = bar.getByRole("button");
  await expect(buttons).toHaveText(names);
  for (let i = 0; i < names.length; i++) {
    const b = await box(buttons.nth(i));
    near(b.width, 328, 1, `${names[i]} 폭`);
    near(b.height, 48, 1, `${names[i]} 높이`);
    near(b.x, 16, 1, `${names[i]} 왼쪽`);
  }
  const last = await box(buttons.last());
  near(800 - (last.y + last.height), 36, 2, "아래 여백");
}

test("S5-1 시간 · 처음(타이머로 채움) — 49:5", async ({ page }) => {
  await open(page, "evening-todo");
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await expect(dialog).toBeVisible();
  // 머리 A1: 「오늘 기록」 16 Bold · 「닫기」 14 보조, 큰 제목 24 Bold는 머리 아래
  const head = dialog.locator(".screen-head-title");
  expect(await style(head, ["font-size", "font-weight"])).toEqual({ "font-size": "16px", "font-weight": "700" });
  const ask = dialog.getByRole("heading", { name: "오늘 몇 시간 썼어요?" });
  expect(await style(ask, ["font-size", "font-weight"])).toEqual({ "font-size": "24px", "font-weight": "700" });
  expect((await box(ask)).y).toBeGreaterThan((await box(head)).y);
  // 「어제」 왼쪽 · 「오늘」 오른쪽: 켜진 쪽 Bold + 2px 테두리, 채움 없음(흰 면)
  const days = dialog.getByRole("group", { name: "기록할 날" }).getByRole("button");
  await expect(days).toHaveText(["어제", "오늘"]);
  const [y, t] = [await box(days.nth(0)), await box(days.nth(1))];
  expect(y.x).toBeLessThan(t.x);
  near(y.width, 76, 1, "알약 폭");
  expect(await style(days.nth(1), ["font-weight"])).toEqual({ "font-weight": "700" });
  const ring = await days.nth(1).evaluate((el) => {
    const s = getComputedStyle(el, "::after");
    return { border: s.borderTopWidth, bg: s.backgroundColor, h: s.height };
  });
  expect(ring).toEqual({ border: "2px", bg: "rgb(255, 255, 255)", h: "36px" });
  // 두 줄 휠: 가운데 32 Bold(2 · 30), 바로 위아래 24, 바깥 20(보조 색), 가운데 띠 위아래 1px 선
  const hours = dialog.getByRole("spinbutton", { name: "시간", exact: true });
  const minutes = dialog.getByRole("spinbutton", { name: "분", exact: true });
  await expect(hours).toHaveAttribute("aria-valuetext", "2시간");
  await expect(minutes).toHaveAttribute("aria-valuetext", "30분");
  const center = minutes.locator(".time-wheel-center");
  await expect(center).toHaveText("30");
  expect(await style(center, ["font-size", "font-weight", "border-top-width", "border-bottom-width"])).toEqual({
    "font-size": "32px",
    "font-weight": "700",
    "border-top-width": "1px",
    "border-bottom-width": "1px",
  });
  const dims = minutes.locator(".time-wheel-dim");
  await expect(dims).toHaveText(["20", "25", "35", "40"]);
  expect(await dims.evaluateAll((els) => els.map((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).color]))).toEqual([
    ["20px", "rgb(94, 100, 120)"],
    ["24px", "rgb(94, 100, 120)"],
    ["24px", "rgb(94, 100, 120)"],
    ["20px", "rgb(94, 100, 120)"],
  ]);
  const band = (await box(hours.locator(".time-wheel-center"))).width + (await box(center)).width;
  near(band, 216, 1, "가운데 띠 선 폭");
  // 「− 5분」「+ 5분」 120×48 둘
  for (const n of ["− 5분", "+ 5분"]) {
    const b = await box(dialog.getByRole("button", { name: n }));
    near(b.width, 120, 1, `${n} 폭`);
    near(b.height, 48, 1, `${n} 높이`);
  }
  // 「타이머 2시간 30분」 띠 · 「오늘 할 일 2/4 ›」 흰 카드 줄(radius 16 = 토큰, 테두리 없음) · 체크 원 22
  await expect(dialog.getByText("타이머 2시간 30분", { exact: true })).toBeVisible();
  const line = dialog.getByRole("button", { name: /^오늘 할 일 2\/4/ });
  expect(await style(line, ["background-color", "border-top-width", "border-top-left-radius"])).toEqual({
    "background-color": "rgb(255, 255, 255)",
    "border-top-width": "0px",
    "border-top-left-radius": "16px",
  });
  near((await box(line)).height, 48, 1, "오늘 할 일 줄 높이");
  near((await box(line.locator("svg"))).width, 22, 0.5, "체크 원 아이콘");
  await expect(dialog.getByText(/^합계/)).toHaveCount(0);
  await bottomButtons(page, ["분야마다 나누기", "나누지 않고 저장"]);
  await noOverflow(page);
  await photo(page, "S5-1 시간 · 처음(타이머로 채움)");
});

test("S5-1 시간 · 숫자 바로 쓰기 — 66:170", async ({ page }) => {
  await open(page, "evening-todo");
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await dialog.getByRole("spinbutton", { name: "시간", exact: true }).locator(".time-wheel-center").click();
  const hour = dialog.getByRole("textbox", { name: "시간", exact: true });
  const minute = dialog.getByRole("textbox", { name: "분", exact: true });
  await expect(hour).toBeFocused();
  await expect(hour).toHaveAttribute("inputmode", "numeric");
  await expect(minute).toHaveValue("30");
  const h = await box(hour);
  near(h.width, 68, 1, "숫자 칸 폭");
  near(h.height, 48, 1, "숫자 칸 높이");
  expect(await style(hour, ["border-top-width", "font-size"])).toEqual({ "border-top-width": "2px", "font-size": "32px" });
  expect(await style(minute, ["border-top-width"])).toEqual({ "border-top-width": "1px" });
  await noOverflow(page);
  await photo(page, "S5-1 시간 · 숫자 바로 쓰기");
  // 악용: 25 → 24시간(범위 밖은 끝값), 쓴 뒤 Enter
  await hour.fill("25");
  await hour.press("Enter");
  await expect(dialog.getByRole("spinbutton", { name: "시간", exact: true })).toHaveAttribute("aria-valuenow", "24");
  await expect(dialog.getByRole("spinbutton", { name: "분", exact: true })).toHaveAttribute("aria-valuenow", "0");
});

test("S5-1 오늘 할 일 시트 — 88:12", async ({ page }) => {
  await open(page, "evening-todo");
  await page.getByRole("button", { name: /^오늘 할 일 2\/4/ }).click();
  const sheet = page.getByRole("dialog", { name: "오늘 할 일" });
  await expect(sheet).toBeVisible();
  const list = sheet.locator("ul.evening-todo-list");
  expect(await style(list, ["background-color", "border-top-left-radius"])).toEqual({ "background-color": "rgb(255, 255, 255)", "border-top-left-radius": "16px" });
  await expect(list.locator("li")).toHaveCount(4);
  near((await box(list.locator(".check-circle").first())).width, 24, 0.5, "체크 원");
  const done = await list.locator(".check-circle-ring").first().evaluate((e) => getComputedStyle(e).fill);
  const notDone = await list.locator(".check-circle-ring").nth(2).evaluate((e) => getComputedStyle(e).fill);
  expect([done, notDone]).toEqual(["rgb(28, 35, 64)", "none"]);
  const tag = list.locator(".evening-todo-category-name").first();
  expect(await style(tag, ["font-size", "background-color"])).toEqual({ "font-size": "12px", "background-color": "rgba(0, 0, 0, 0)" });
  near((await box(list.locator(".evening-todo-dot").first())).width, 10, 0.5, "분야 점");
  await noOverflow(page);
  await photo(page, "S5-1 오늘 할 일 시트");
  await sheet.getByRole("button", { name: "+ 할 일" }).click();
  const chips = sheet.getByRole("group", { name: "분야", exact: true }).getByRole("button");
  await expect(chips.first()).toHaveText("기타");
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  const add = await box(sheet.getByRole("button", { name: "더하기" }));
  near(add.width, 328, 1, "「더하기」 폭 가득");
  near(add.height, 48, 1, "「더하기」 높이");
  expect(await style(sheet.getByRole("textbox", { name: "할 일" }), ["border-top-left-radius", "border-top-width"])).toEqual({ "border-top-left-radius": "12px", "border-top-width": "2px" });
  await photo(page, "S5-1 오늘 할 일 시트 · 할 일 더하기 펼침");
});

async function openSplit(page: Page, hours: number) {
  await open(page, "evening-split-blank");
  await page.locator("#dev-open-window").click();
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await fillWheel(dialog, "시간", hours);
  await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
  await expect(dialog.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
  return dialog;
}
async function splitShape(page: Page, dialog: Locator, total: string) {
  // 머리 「‹ 오늘 기록 닫기」 · 제목 + 같은 줄 오른쪽 「합계 n」(12 보조) · 흰 카드 하나(radius 16 · 안 여백 16) · 「저장」 아래 고정
  near((await box(dialog.getByRole("button", { name: "이전" }))).width, 48, 1, "「‹」 누름 폭");
  const title = await box(dialog.getByRole("heading", { name: "분야마다 나눠 주세요" }));
  const sum = dialog.locator(".evening-split-total");
  await expect(sum).toHaveText(total);
  const s = await box(sum);
  expect(s.x, "합계는 제목 오른쪽").toBeGreaterThan(title.x + title.width - 1);
  expect(Math.abs(s.y + s.height - (title.y + title.height)), "같은 줄(아래 끝 가까이)").toBeLessThan(12);
  expect(await style(sum, ["font-size"])).toEqual({ "font-size": "12px" });
  const card = dialog.locator(".evening-split-card");
  expect(await style(card, ["background-color", "border-top-left-radius", "padding-left"])).toEqual({ "background-color": "rgb(255, 255, 255)", "border-top-left-radius": "16px", "padding-left": "16px" });
  near((await box(card)).width, 328, 1, "카드 폭");
  await expect(dialog.getByRole("group", { name: "기록할 날" })).toHaveCount(0);
  await expect(dialog.locator(".dial-noon")).toHaveCount(0);
  const value = dialog.locator(".dial-center-big");
  const name = dialog.locator(".dial-center-small");
  expect(await style(value, ["font-size", "font-weight"])).toEqual({ "font-size": "24px", "font-weight": "700" });
  expect((await box(value)).y).toBeLessThan((await box(name)).y);
  const other = dialog.locator('[data-row-key="other"]');
  await expect(other.locator("button, input")).toHaveCount(0);
  const ov = other.locator(".evening-other-value");
  expect(await style(ov, ["font-size", "font-weight", "font-variant-numeric"])).toEqual({ "font-size": "14px", "font-weight": "500", "font-variant-numeric": "tabular-nums" });
  const ob = await box(ov);
  const cb = await box(card);
  expect(cb.x + cb.width - (ob.x + ob.width), "기타 값이 카드 오른쪽 끝 가까이").toBeLessThanOrEqual(30);
  await bottomButtons(page, ["저장"]);
  await noOverflow(page);
}

test("S5-2 나누기 · 들어간 처음(기타 100%) — 87:2", async ({ page }) => {
  const dialog = await openSplit(page, 3);
  await splitShape(page, dialog, "합계 3시간");
  await expect(dialog.locator(".dial-center-big")).toHaveText("3시간");
  await expect(dialog.locator(".dial-center-small")).toHaveText("기타");
  await photo(page, "S5-2 나누기 · 들어간 처음(기타 100%)");
});

test("S5-2 나누기 · 칩 하나 고른 상태 — 87:96", async ({ page }) => {
  const dialog = await openSplit(page, 3);
  await dialog.getByRole("button", { name: "어학, 다이얼에 넣기" }).click();
  await splitShape(page, dialog, "합계 3시간");
  await expect(dialog.locator(".dial-center-big")).toHaveText("30분");
  await expect(dialog.locator(".dial-center-small")).toHaveText("어학");
  const picked = dialog.locator(".ratio-list li.is-picked");
  expect(await style(picked, ["background-color"])).toEqual({ "background-color": "rgb(243, 238, 230)" });
  near((await box(picked.locator(".step-btn-face").first())).width, 32, 0.5, "−/+ 원 32");
  await expect(picked.locator(".num-field input")).toHaveValue("30"); // 숫자 칸 안에 숫자 + 단위(A3)
  await expect(picked.locator(".num-field .stepper-unit")).toHaveText("분");
  await photo(page, "S5-2 나누기 · 칩 하나 고른 상태");
});

test("S5-2 나누기 · 칩 둘 고른 상태 — 49:26", async ({ page }) => {
  const dialog = await openSplit(page, 3);
  await dialog.getByRole("button", { name: "포트폴리오, 다이얼에 넣기" }).click();
  await dialog.getByRole("button", { name: "어학, 다이얼에 넣기" }).click();
  await splitShape(page, dialog, "합계 3시간");
  await expect(dialog.locator(".ratio-list li")).toHaveCount(3);
  await expect(dialog.locator('[data-row-key="other"] .evening-other-value')).toHaveText("2시간");
  await photo(page, "S5-2 나누기 · 칩 둘 고른 상태");
});

test("S5-2 나누기 · 나눈 합이 합계보다 많을 때(기타 0분) — 49:83", async ({ page }) => {
  // 앱은 나눈 합이 쓴 시간을 넘지 못하게 막는다(PM 확정 11-08) — 기타가 0분이 되는 데까지가 화면에서 닿는 끝. 넘침 안내 상자는 숨은 분야가 있는 옛 기록에서만 뜬다
  const dialog = await openSplit(page, 1);
  await dialog.getByRole("button", { name: "어학, 다이얼에 넣기" }).click();
  await dialog.getByRole("button", { name: "포트폴리오, 다이얼에 넣기" }).click();
  await splitShape(page, dialog, "합계 1시간");
  await expect(dialog.locator('[data-row-key="other"] .evening-other-value')).toHaveText("0분");
  await expect(dialog.locator('[id^="evening-dial-handle-"]')).toHaveCount(1); // 12시 손잡이 없음
  await photo(page, "S5-2 나누기 · 나눈 합이 합계보다 많을 때(기타 0분)");
});

async function afterSave(page: Page, s: string) {
  await open(page, s);
  await page.locator("#dev-open-window").click();
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await fillWheel(dialog, "시간", 3);
  await dialog.getByRole("button", { name: "나누지 않고 저장" }).click();
  await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible();
  await expect(dialog.locator(".after-save-bar").first()).toBeVisible();
  await page.waitForTimeout(500); // 차오름 400ms가 끝난 뒤
  // 「✓ 저장했어요」 14 보조 · 체크 원 22 · 흰 카드 「이번 주」 16 Bold · 가운데 「상태보기에서 보기 ›」 · 아래 「닫기」 알약 없음
  const saved = dialog.getByRole("heading", { name: "저장했어요" });
  expect(await style(saved, ["font-size", "color"])).toEqual({ "font-size": "14px", color: "rgb(94, 100, 120)" });
  near((await box(saved.locator("svg"))).width, 22, 0.5, "체크 원");
  const card = dialog.locator(".after-save-card");
  expect(await style(card, ["background-color", "border-top-left-radius"])).toEqual({ "background-color": "rgb(255, 255, 255)", "border-top-left-radius": "16px" });
  expect(await style(card.getByRole("heading", { name: "이번 주" }), ["font-size", "font-weight"])).toEqual({ "font-size": "16px", "font-weight": "700" });
  const go = await box(dialog.getByRole("button", { name: "상태보기에서 보기" }));
  near(go.x + go.width / 2, 180, 2, "글 단추 가운데");
  expect(go.y).toBeGreaterThan((await box(card)).y + (await box(card)).height - 1);
  await expect(page.locator(".bottom-actions")).toHaveCount(0);
  await expect(dialog.getByRole("button")).toHaveText(["닫기", "상태보기에서 보기›"]); // 「›」는 글자 사이 4px(꾸밈, 화면 읽기에서 숨김)
  // 막대: 높이 16, 빗금 칸은 같은 분야 색 위 사선 빗금
  const hatch = card.locator(".after-save-hatch").first();
  near((await box(hatch)).height, 16, 0.5, "막대 높이");
  expect((await style(hatch, ["background-image"]))["background-image"]).toContain("repeating-linear-gradient");
  await noOverflow(page);
  return card;
}

test("S5-3 저장 직후 · 목표 세운 주 — 49:142", async ({ page }) => {
  const card = await afterSave(page, "after-save");
  const rows = card.locator(".after-save-row");
  await expect(rows.locator(".after-save-name")).toHaveText(["포트폴리오", "어학"]);
  await expect(rows.locator(".after-save-value")).toHaveText(["12시간 +2시간", "2시간 +1시간"]);
  await expect(rows.locator(".after-save-more")).toHaveText(["목표 6시간", "3시간 더"]);
  near((await box(rows.first().locator(".after-save-tick"))).width, 2, 0.5, "목표 눈금 2px");
  // 막대 길이 = 같은 잣대(12시간 = 끝): 포트폴리오 앞 칸 10시간 ≈ 83% · 빗금 2시간 ≈ 17%
  const bar = await box(rows.first().locator(".after-save-bar"));
  const hatch = await box(rows.first().locator(".after-save-hatch"));
  near(hatch.width / bar.width, 120 / 720, 0.02, "빗금 몫 = delta");
  await expect(card.locator('[role="status"]')).toHaveText("저장했어요. 포트폴리오 2시간 더해서 이번 주 12시간. 목표 6시간. 어학 1시간 더해서 이번 주 2시간. 목표까지 3시간.");
  await photo(page, "S5-3 저장 직후 · 목표 세운 주");
});

test("S5-3 저장 직후 · 목표 없는 주 — 59:2", async ({ page }) => {
  const card = await afterSave(page, "after-save-ratio");
  const rows = card.locator(".after-save-row");
  await expect(rows.locator(".after-save-value")).toHaveText(["6시간 +2시간", "2시간 +1시간"]);
  await expect(rows.locator(".after-save-more")).toHaveText(["이번 주 60% / 목표 40%", "이번 주 20% / 목표 30%"]);
  await expect(card.locator(".after-save-tick")).toHaveCount(0);
  await photo(page, "S5-3 저장 직후 · 목표 없는 주");
});

test("S5-3 저장 직후 · 분야가 많을 때(큰 순 넷 + 그 밖 n개)", async ({ page }) => {
  const card = await afterSave(page, "after-save-many");
  await expect(card.locator(".after-save-row")).toHaveCount(4);
  await expect(card.locator(".after-save-others")).toHaveText("그 밖 2개");
  await photo(page, "S5-3 저장 직후 · 분야가 많을 때");
});

test("확인 창 「저장하지 않고 나갈까요?」 계속 적기 / 나가기 — 98:278(꼴은 J1 공통 부품)", async ({ page }) => {
  await open(page, "evening-todo");
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await dialog.getByRole("button", { name: "+ 5분" }).click();
  await dialog.locator(".screen-head").getByRole("button", { name: "닫기" }).click();
  const confirm = page.getByRole("alertdialog", { name: "저장하지 않고 나갈까요?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button")).toHaveText(["계속 적기", "나가기"]);
  await expect(confirm.getByRole("button", { name: "계속 적기" })).toBeFocused();
  expect((await box(confirm)).width).toBeLessThanOrEqual(312.5);
  await noOverflow(page);
  await photo(page, "확인 창 · 저장하지 않고 나갈까요");
});
