import { expect, test, type Browser, type Page } from "@playwright/test";
import type { MirrorSnapshot } from "../../lib/local/types";
import { ids, logStep, openA, openHome, pickSplitChip, pressedSplitChips, removeGoal, removeTodos, tab, type Session } from "./release";

/**
 * 발표판 검수(K2, PM d-153): 23 「사용자 시나리오 검수 목록」(원샷-v2-시나리오검수목록-2026-11-09)의 자동 몫을 진짜 로그인 앱(운영 빌드, 시험 계정 A)에서 돌린다.
 * 단계마다 결과를 test-results/release/scenarios.jsonl에 남긴다(시나리오 · 단계 · AC · 통과/실패 · 까닭).
 * **실패는 고치지 않고 표에 남긴다**(창구가 디자인/동작으로 나눔): 한 단계가 실패해도 다음 단계를 돌리고, 시나리오 끝에 실패한 단계 목록으로 실패한다.
 * 빈 기록·처음 설정 전 상태는 GET /mirror 가짜 응답(tests/release/release.ts). A의 할 일·이번 주 목표는 끝에 지운다(실행 전에 없던 것만).
 * A의 설정(목표 한 문장·목표 비율·알림)과 오늘 기록·타이머 기록은 바뀐다(지시: A로만).
 */

let s: Session;
let page: Page;
let beforeTodos = new Set<string>();
let goalBefore: string[] = [];
let fails: string[] = [];

async function step(scenario: string, label: string, ac: string, body: () => Promise<void>) {
  try {
    await body();
    logStep({ scenario, step: label, ac, pass: true });
  } catch (e) {
    const note = String((e as Error).message).split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 220);
    logStep({ scenario, step: label, ac, pass: false, note });
    fails.push(`${scenario} ${label}`);
    // 다음 단계가 앞 단계의 남은 창에 막히지 않게 같은 창을 다시 연다(기기 저장소·보낼 줄은 그대로)
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await s.context.setOffline(false).catch(() => undefined);
    await openHome(s).catch(() => undefined);
  }
}

function finish() {
  const failed = fails;
  fails = [];
  expect(failed, "실패한 단계(표에 남김)").toEqual([]);
}

async function reopen(browser: Browser, fake?: (snap: MirrorSnapshot) => MirrorSnapshot, once = false) {
  if (s) {
    await s.page.waitForLoadState("networkidle").catch(() => undefined);
    await s.context.close();
  }
  let used = false;
  s = await openA(browser, fake ? (snap) => (once && used ? snap : ((used = true), fake(snap))) : undefined);
  page = s.page;
}

async function home() {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await openHome(s);
}

function weekStartOf(snap: MirrorSnapshot): string {
  const seoul = new Date(new Date(snap.serverNow).getTime() + 9 * 3600_000);
  const dow = (seoul.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate() - dow)).toISOString().slice(0, 10);
}

const box = async (sel: import("@playwright/test").Locator) => (await sel.boundingBox())!;

test.beforeAll(async ({ browser }) => {
  await reopen(browser);
  beforeTodos = await ids(s.client, "todos");
  const goals = await s.client.from("weekly_goals").select("week_start");
  goalBefore = (goals.data ?? []).map((r: { week_start: string }) => r.week_start);
});

test.afterAll(async () => {
  await s.page.waitForLoadState("networkidle").catch(() => undefined);
  const now = await ids(s.client, "todos");
  await removeTodos(s.client, [...now].filter((id) => !beforeTodos.has(id)));
  const goals = await s.client.from("weekly_goals").select("week_start");
  for (const r of (goals.data ?? []) as { week_start: string }[]) if (!goalBefore.includes(r.week_start)) await removeGoal(s.client, r.week_start);
  await s.context.close();
});

// ---------------------------------------------------------------- S-01
test("S-01 첫날 ②~⑤(가짜 응답: 처음 설정 전)", async ({ browser }) => {
  const S = "S-01";
  await reopen(browser, (snap) => ({ ...snap, todos: [], settings: snap.settings ? { ...snap.settings, onboardingDone: false, goal: null } : snap.settings }), true);
  await page.goto("/");
  await step(S, "② 목표 칸 → 다음", "8-1 AC1", async () => {
    await expect(page.getByRole("heading", { name: "목표" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("textbox").first().fill("포트폴리오 끝내고 토익 800점 넘기기");
    await page.getByRole("button", { name: "다음" }).click();
    await expect(page.getByRole("heading", { name: "분야" })).toBeVisible();
    await expect(page.getByRole("button", { name: "이전" })).toBeVisible(); // 2~4단계 「‹」 = 「이전」
  });
  await step(S, "③ 분야 고름 → 다음", "8-1 AC2", async () => {
    const pressed = page.getByRole("group", { name: "분야" }).getByRole("button", { pressed: true });
    if ((await pressed.count()) === 0) await page.getByRole("group", { name: "분야" }).getByRole("button").first().click();
    await page.getByRole("button", { name: "다음" }).click();
    await expect(page.getByRole("heading", { name: "목표 비율" })).toBeVisible();
    await expect(page.getByRole("button", { name: "이전" })).toBeVisible();
  });
  await step(S, "④ −/+만으로 합 100% · 「다음」", "8-1 AC4", async () => {
    const fields = page.getByRole("spinbutton", { name: /비율\(%\)/ }).or(page.getByRole("textbox", { name: /비율\(%\)/ }));
    const sum = async () => (await fields.evaluateAll((els) => els.map((e) => Number((e as HTMLInputElement).value)))).reduce((a, b) => a + b, 0);
    expect(await fields.count()).toBeGreaterThan(1);
    await page.getByRole("button", { name: /% 늘리기$/ }).first().click();
    await page.getByRole("button", { name: /% 줄이기$/ }).first().click();
    expect(await sum()).toBe(100); // 이 앱은 합을 늘 100으로 지킨다(합이 100이 아닌 상태를 만들 수 없음 — 시나리오의 「오류 글」은 나타날 자리가 없다)
    await page.getByRole("button", { name: "다음" }).click();
    await expect(page.getByRole("heading", { name: "알림" })).toBeVisible();
  });
  await step(S, "⑤ 알림 둘 켠 채 「시작하기」 → 할 일 탭 빈 목록(50:28)", "8-1 AC6 · 8-7 AC1", async () => {
    // 시작 상태(새 계정)는 둘 다 켜짐이 기본이다. A의 알림 설정을 읽어 오므로 꺼져 있으면 켠다(시나리오 「켠 채」)
    for (const n of ["오늘 기록 알림", "아침 알림"]) {
      const c = page.getByRole("checkbox", { name: n });
      if (!(await c.isChecked())) await c.check();
      await expect(c).toBeChecked();
    }
    await page.getByRole("button", { name: "시작하기" }).click();
    await expect(page.getByRole("button", { name: "할 일 적기" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("예시", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "화면 이동" }).getByRole("button", { name: "할 일" })).toHaveAttribute("aria-current", "page");
  });
  await step(S, "⑤ 상태보기 맨 위에 목표 한 줄", "8-1 AC6", async () => {
    await tab(page, "상태보기");
    await expect(page.getByText("포트폴리오 끝내고 토익 800점 넘기기")).toBeVisible({ timeout: 20_000 });
  });
  finish();
});

// ---------------------------------------------------------------- S-02
const T1 = "토익 단어 50개";
const T2 = "토익 LC 한 회 풀기";
const T3 = "빨래";
let cat1 = "";

test("S-02 낮 — 할 일 적기 · 끝냄 · 작업 기록 · 타이머", async ({ browser }) => {
  const S = "S-02";
  await reopen(browser);
  await home();
  const input = page.getByRole("textbox", { name: "할 일 적기" });
  const group = page.getByRole("group", { name: "분야" });
  await step(S, "① 「토익 단어 50개」 + 분야 칩 → 적기", "8-2 AC1", async () => {
    await page.getByRole("button", { name: "할 일 적기" }).click();
    await input.fill(T1);
    const chip = group.getByRole("button", { pressed: false }).first();
    cat1 = (await chip.textContent())!.trim();
    await chip.click();
    await page.getByRole("button", { name: "적기", exact: true }).click();
    await expect(page.locator("li.todo-row", { hasText: T1 }).locator(".category-tag")).toContainText(cat1);
  });
  await step(S, "② 이어서 적기 — 분야가 골라진 채", "8-2 AC1", async () => {
    await expect(group.getByRole("button", { name: cat1 })).toHaveAttribute("aria-pressed", "true"); // 시나리오 기대(앱 C7은 적은 뒤 고름을 푼다)
  });
  await step(S, "③ 칩 없이 「빨래」 → 기타", "8-2 AC1", async () => {
    if (!(await input.isVisible())) await page.getByRole("button", { name: "할 일 적기" }).click(); // 앞 단계 실패로 창이 닫혔으면 다시 연다
    await input.fill(T2);
    await page.getByRole("button", { name: "적기", exact: true }).click();
    await input.fill(T3);
    for (const b of await group.getByRole("button", { pressed: true }).all()) if ((await b.textContent())?.trim() !== "기타") await b.click();
    await page.getByRole("button", { name: "적기", exact: true }).click();
    await page.getByRole("form", { name: "할 일 적기" }).getByRole("button", { name: "닫기" }).click(); // 고침10 A: 왼쪽 위 「✕」
    await expect(page.locator("li.todo-row", { hasText: T3 })).toBeVisible();
    await expect(page.locator("li.todo-row", { hasText: T3 }).locator(".category-tag")).toHaveCount(0);
  });
  await step(S, "④ 할 일 페이지(51:55) 작업 기록 「Day 12까지」 → 줄에 종이 아이콘", "8-2 AC7 · AC8", async () => {
    await page.getByRole("button", { name: `자세히 보기: ${T1}` }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: /타이머/ })).toHaveCount(0); // 할 일 페이지에 타이머 단추 없음
    const note = page.getByRole("textbox", { name: /작업 기록/ });
    await note.fill("Day 12까지");
    await note.press("Enter");
    await expect(page.getByText("Day 12까지")).toBeVisible();
    await page.getByRole("dialog", { name: "할 일 자세히" }).getByRole("button", { name: "이전" }).click(); // 고침10 A: 왼쪽 위 「‹」
    await expect(page.locator("li.todo-row", { hasText: T1 }).getByRole("img", { name: "작업 기록 있음" })).toBeVisible();
  });
  await step(S, "④ 작업 기록이 분야 페이지(50:616) 그날 아래에", "8-6 AC5", async () => {
    await page.waitForLoadState("networkidle");
    await tab(page, "상태보기");
    await page.getByRole("tab", { name: "목표 비율" }).click();
    await page.locator(".growth-item > button", { hasText: cat1 }).first().click();
    await expect(page.getByRole("dialog").getByText("Day 12까지")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("dialog").getByRole("button", { name: "이전" }).click(); // 고침10 A: 분야 페이지 「‹」
    await tab(page, "할 일");
  });
  await step(S, "⑤ 체크 → 다시 누름 → 풀림 · 줄 누름 44", "8-2 AC3", async () => {
    const cb = page.getByRole("checkbox", { name: T2 });
    await cb.check();
    await expect(cb).toBeChecked();
    await cb.uncheck();
    await expect(cb).not.toBeChecked();
    const b = await box(page.getByRole("button", { name: `자세히 보기: ${T2}` }));
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator("li.todo-row").getByRole("button", { name: /타이머/ }).count()).toBe(0);
  });
  await step(S, "⑥ 타이머 → 할 일 고름 → 「30분 시작」 → 줄어듦 · 「오늘 시작한 타이머」에 한 줄", "8-6 AC1 · AC3 · AC6", async () => {
    await tab(page, "타이머");
    await expect(page.getByRole("heading", { name: "무엇을 할까요?" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("radio", { name: new RegExp(T1) }).check();
    await page.getByRole("button", { name: "30분 시작" }).click();
    const clock = page.getByRole("timer");
    await expect(clock).toBeVisible({ timeout: 20_000 });
    const a = await clock.textContent();
    await expect.poll(async () => clock.textContent(), { timeout: 5_000 }).not.toBe(a);
    await page.getByRole("button", { name: "끝내기" }).click();
    await expect(page.getByRole("heading", { name: "오늘 시작한 타이머" })).toBeVisible();
    await expect(page.getByText(T1).last()).toBeVisible();
    await tab(page, "할 일");
  });
  finish();
});

// ---------------------------------------------------------------- S-03 · S-04
test("S-03 저녁 — 오늘 기록부터 상태보기까지(이번 주 목표 있음)", async ({ browser }) => {
  const S = "S-03";
  await reopen(browser);
  await home();
  // 준비: 이번 주 목표(첫 분야 5시간), 할 일 하나 끝냄
  const goalOpen = page.getByRole("button", { name: /^이번 주 목표/ }).first();
  await goalOpen.click();
  const g = page.getByRole("dialog", { name: "이번 주 목표" });
  const gPlus = g.getByRole("button", { name: /늘리기/ });
  for (let i = 0; i < 5; i++) await gPlus.first().click();
  await g.getByRole("button", { name: "저장" }).click();
  await expect(g).toBeHidden({ timeout: 20_000 });
  await page.getByRole("checkbox", { name: T2 }).check().catch(() => undefined);
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await step(S, "① 「오늘 기록」 → 시간 단계(49:5) · 휠 2시간 30분 · 「타이머 n」 띠", "8-3 AC1", async () => {
    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    await expect(dialog.getByRole("button", { name: "분야마다 나누기" })).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText(/^타이머 /)).toBeVisible();
    for (const [col, v] of [["시간", "2"], ["분", "30"]] as const) {
      await dialog.getByRole("spinbutton", { name: col, exact: true }).locator(".time-wheel-center").click();
      await dialog.getByRole("textbox", { name: col, exact: true }).fill(v);
      await dialog.getByRole("textbox", { name: col, exact: true }).press("Enter");
    }
    await expect(dialog.getByRole("spinbutton", { name: "시간", exact: true })).toHaveAttribute("aria-valuetext", "2시간");
    await expect(dialog.getByRole("spinbutton", { name: "분", exact: true })).toHaveAttribute("aria-valuetext", "30분");
  });
  await step(S, "② 「오늘 할 일 n/m ›」 → 시트(88:12)에서 하나 더 체크 → 닫기", "8-3 AC2", async () => {
    const line = dialog.getByRole("button", { name: /^오늘 할 일 \d+\/\d+/ });
    const before = (await line.textContent())!.match(/(\d+)\/(\d+)/)!;
    await line.click();
    const sheet = page.getByRole("dialog", { name: "오늘 할 일" });
    await sheet.getByRole("checkbox", { checked: false }).first().check();
    await sheet.getByRole("button", { name: "닫기" }).click();
    await expect(line).toContainText(`${Number(before[1]) + 1}/${before[2]}`);
  });
  await step(S, "③④ 「분야마다 나누기」(87:2) · 처음 값 = 타이머·끝낸 할 일 분야 칩 켜짐 + 기타", "8-3 AC3 · AC9", async () => {
    await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
    await expect(dialog.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
    expect(await pressedSplitChips(dialog).count()).toBeGreaterThanOrEqual(1);
    await expect(dialog.getByText("기타", { exact: true }).first()).toBeVisible();
  });
  await step(S, "⑤ 칩 하나 더 → 고른 칩끼리 남은 시간을 똑같이(타이머 분야는 잰 시간 그대로, PM d-180) · 합계 2시간 30분 유지", "8-3 AC4", async () => {
    const before = await pressedSplitChips(dialog).count();
    await pickSplitChip(dialog);
    await expect(pressedSplitChips(dialog)).toHaveCount(before + 1);
    await expect(dialog.getByText(/2시간 30분/).first()).toBeVisible();
  });
  await step(S, "⑥ 「저장」 → 저장 중 막힘(133:48) → ⑦ 저장 직후(49:142) 「✓ 저장했어요」 · 막대 · 「저녁 기록」 글 없음", "8-3 AC6 · AC8", async () => {
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible({ timeout: 20_000 });
    await expect(dialog.locator(".after-save-card")).toBeVisible();
    expect(await page.getByText("저녁 기록").count()).toBe(0);
  });
  await step(S, "⑦ 「상태보기에서 보기 ›」 → 이번 주 목표 뷰(50:137) · 줄 순서 기타 끝", "8-4 AC2 · AC3", async () => {
    await dialog.getByRole("button", { name: /상태보기에서 보기/ }).click();
    await expect(page.getByRole("tab", { name: "이번 주 목표" })).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
    await page.getByRole("tab", { name: "목표 비율" }).click();
    const names = await page.locator(".growth-item .growth-name, .growth-item > button").allTextContents();
    expect(names.length).toBeGreaterThan(0);
    expect(names.findIndex((n) => n.includes("기타"))).toBe(names.length - 1);
  });
  finish();
});

test("S-04 실수 — 나누다 닫기 · 합 넘침 · 나누지 않고 저장", async ({ browser }) => {
  const S = "S-04";
  await reopen(browser);
  await home();
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
  await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
  const confirm = page.getByRole("alertdialog");
  await step(S, "① 칩 고른 뒤 닫기(Esc — 나누기 단계의 머리 「‹」는 시간 단계로) → 확인 창(147:2) · 초점이 제목 · 위 「나가기」 아래 「계속 적기」", "8-3 AC2", async () => {
    await pickSplitChip(dialog);
    await dialog.press("Escape");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("heading", { name: "저장하지 않고 나갈까요?" })).toBeFocused(); // 고침10 B: 첫 초점 = 제목
    await expect(confirm.getByRole("button")).toHaveText(["나가기", "계속 적기"]);
  });
  await step(S, "② 「계속 적기」 → 값 그대로", "8-3 AC2", async () => {
    const before = await pressedSplitChips(dialog).count();
    await confirm.getByRole("button", { name: "계속 적기" }).click();
    await expect(confirm).toBeHidden();
    await expect(pressedSplitChips(dialog)).toHaveCount(before);
  });
  await step(S, "③ 다시 닫기(Esc) → 「나가기」 → 닫힘", "8-3 AC2", async () => {
    await dialog.press("Escape");
    await confirm.getByRole("button", { name: "나가기" }).click();
    await expect(dialog).toBeHidden();
  });
  await step(S, "④ 다시 들어가 바꾸지 않고 머리 「‹」 → 확인 없이 닫힘", "명세 ④-2", async () => {
    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "이전" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(dialog).toBeHidden();
  });
  await step(S, "⑤ 「+」로 합계보다 많게 → 안내(49:83) · 기타 0분 · 기타 줄 −/+ 없음", "8-3 AC5", async () => {
    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
    if ((await pressedSplitChips(dialog).count()) === 0) await pickSplitChip(dialog);
    const plus = dialog.getByRole("button", { name: /늘리기/ });
    for (let i = 0; i < 60 && !(await dialog.getByText(/합계보다 많아서/).isVisible()); i++) await plus.first().click();
    await expect(dialog.getByText(/나눈 시간이 합계보다 많아서 합계를 .+ 맞춰 저장해요/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^기타 .*(늘리기|줄이기)$/ })).toHaveCount(0);
  });
  await step(S, "⑥ 시간 단계에서 「나누지 않고 저장」 → 저장", "8-3 AC5", async () => {
    await dialog.press("Escape");
    if (await confirm.isVisible()) await confirm.getByRole("button", { name: "나가기" }).click();
    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    await dialog.getByRole("button", { name: "나누지 않고 저장" }).click();
    await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "이전" }).click(); // 저장 뒤 머리 「‹」 = 닫기
  });
  finish();
});

// ---------------------------------------------------------------- S-05
test("S-05 목표 없는 주 — 이번 주 목표 세우기", async ({ browser }) => {
  const S = "S-05";
  await reopen(browser);
  await home();
  // 준비: 이번 주 목표 없앰(S-03이 세운 것)
  const lineBtn = page.getByRole("button", { name: /^이번 주 목표/ }).first();
  if (!(await page.getByRole("button", { name: "이번 주 목표 정하기" }).isVisible())) {
    await lineBtn.click();
    const g = page.getByRole("dialog", { name: "이번 주 목표" });
    await g.getByRole("button", { name: "목표 없애기" }).click();
    await g.getByRole("button", { name: "없애기", exact: true }).click();
    await expect(g).toBeHidden({ timeout: 20_000 });
  }
  await step(S, "① 할 일 탭 맨 위 「이번 주 목표 정하기」 한 줄", "8-7 AC1", async () => {
    await expect(page.getByRole("button", { name: "이번 주 목표 정하기" })).toBeVisible();
  });
  await step(S, "② 상태보기 → 「목표 비율」 탭이 처음", "8-7 AC2", async () => {
    await tab(page, "상태보기");
    await expect(page.getByRole("tab", { name: "목표 비율" })).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
  });
  await step(S, "③ 「이번 주 목표」 탭(50:741) — 예시 → 「분야마다 시간 · 1시간 단위」 → 단추", "8-7 AC3", async () => {
    await page.getByRole("tab", { name: "이번 주 목표" }).click();
    const ex = page.locator(".growth-example-label").first();
    const hint = page.getByText("분야마다 시간 · 1시간 단위");
    const btn = page.getByRole("button", { name: "이번 주 목표 정하기" });
    await expect(btn).toBeVisible();
    expect((await box(ex)).y).toBeLessThan((await box(hint)).y);
    expect((await box(hint)).y).toBeLessThan((await box(btn)).y);
  });
  await step(S, "④ 시트(50:332) 분야마다 시간 → 저장 → 할 일 탭 「이번 주 목표 n시간 중 n시간」", "8-5 AC1", async () => {
    await page.getByRole("button", { name: "이번 주 목표 정하기" }).click();
    const g = page.getByRole("dialog", { name: "이번 주 목표" });
    for (let i = 0; i < 3; i++) await g.getByRole("button", { name: /늘리기/ }).first().click();
    await g.getByRole("button", { name: "저장" }).click();
    await expect(g).toBeHidden({ timeout: 20_000 });
    await tab(page, "할 일");
    await expect(page.getByRole("button", { name: /^이번 주 목표 \d+시간 중 / })).toBeVisible();
  });
  await step(S, "⑤ 시트를 다시 열어 값을 바꾼 뒤 「닫기」 → 확인 창(O-3)", "명세 O-3", async () => {
    await page.getByRole("button", { name: /^이번 주 목표 \d+시간 중 / }).click();
    const g = page.getByRole("dialog", { name: "이번 주 목표" });
    await g.getByRole("button", { name: /늘리기/ }).first().click();
    await g.getByRole("button", { name: "닫기" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "나가기" }).click();
  });
  finish();
});

// ---------------------------------------------------------------- S-06
test("S-06 상태보기 — 두 뷰 · 기간 · 빈 상태 · 분야 페이지", async ({ browser }) => {
  const S = "S-06";
  const growth = async () => {
    await tab(page, "상태보기");
    await page.getByRole("tab", { name: "목표 비율" }).click();
  };
  await reopen(browser, (snap) => ({ ...snap, logs: [], sessions: [], goal: null }));
  await home();
  await step(S, "(가) 기록 없음(가짜 응답): 기간 칩 · 「원그래프로 보기」가 같은 자리(50:598)", "8-4 AC6", async () => {
    await growth();
    await expect(page.getByRole("button", { name: /^기간, / })).toBeVisible();
    await expect(page.getByRole("button", { name: "원그래프로 보기" })).toBeVisible();
    await page.getByRole("button", { name: "원그래프로 보기" }).click();
    await expect(page.getByText("0시간").first()).toBeVisible(); // 121:240 빈 고리 가운데
  });
  await reopen(browser, (snap) => ({ ...snap, logs: (snap.logs ?? []).filter((l) => l.targetDay < weekStartOf(snap)), sessions: [], goal: null }));
  await home();
  await step(S, "(나) 이번 주 0시간 + 지난 기록(가짜 응답): 「총 시간」으로 시작 · 「이번 주 0시간」 · 「오늘 기록」(111:79)", "8-4 AC6", async () => {
    await growth();
    await expect(page.getByRole("button", { name: /^기간, 총 시간/ })).toBeVisible();
    await expect(page.getByText("이번 주 0시간").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "오늘 기록" })).toBeVisible();
  });
  await reopen(browser);
  await home();
  await step(S, "(다) ② 기간 칩 「이번 주 ▾」 → 「총 시간」 → 「비교」", "8-4 AC4", async () => {
    await growth();
    for (const p of ["총 시간", "비교", "이번 주"]) {
      await page.getByRole("button", { name: /^기간, / }).click();
      await page.getByRole("menuitemradio", { name: p }).click();
      await expect(page.getByRole("button", { name: new RegExp(`^기간, ${p}`) })).toBeVisible();
    }
  });
  await step(S, "(다) ③ 원그래프 ↔ 띠그래프 · 그래프는 화면 읽기에서 숨음", "8-4 AC5", async () => {
    await page.getByRole("button", { name: "원그래프로 보기" }).click();
    await expect(page.getByRole("button", { name: "띠그래프로 보기" })).toBeVisible();
    const hidden = await page.locator(".growth-graph, .growth-pie, svg.growth-pie").evaluateAll((els) => els.every((e) => e.closest("[aria-hidden=true]") !== null));
    expect(hidden).toBe(true);
    await page.getByRole("button", { name: "띠그래프로 보기" }).click();
  });
  await step(S, "(다) ④ 분야 줄 「›」 → 분야 페이지(50:616): 요약 카드 · 날짜별 막대 → 「닫기」", "8-4 AC1 · ⑰", async () => {
    await page.locator(".growth-item > button").first().click();
    const d = page.getByRole("dialog");
    await expect(d.getByText(/^총 /).first()).toBeVisible({ timeout: 20_000 });
    await expect(d.getByText(/^이번 주 /).first()).toBeVisible();
    await d.getByRole("button", { name: "이전" }).click(); // 고침10 A: 분야 페이지 「‹」
    await expect(d).toBeHidden();
  });
  await step(S, "(다) ⑤ 기타 줄 「›」 → 기타 페이지(121:468) 목표 비율 줄 없음", "⑰", async () => {
    await page.locator(".growth-item > button", { hasText: "기타" }).first().click();
    const d = page.getByRole("dialog");
    await expect(d.getByText(/^총 /).first()).toBeVisible({ timeout: 20_000 });
    await expect(d.getByText(/^목표 비율 /)).toHaveCount(0);
    await d.getByRole("button", { name: "이전" }).click();
  });
  await step(S, "재촉·평가 말 없음", "8-4 AC2", async () => {
    const text = await page.locator("main, body").first().innerText();
    for (const w of ["달성", "부족", "분발", "잘했어요", "아쉬워요"]) expect(text, w).not.toContain(w);
  });
  finish();
});

// ---------------------------------------------------------------- S-07
test("S-07 내 정보 — 목표·목표 비율 고치기 · 알림", async ({ browser }) => {
  const S = "S-07";
  await reopen(browser);
  await home();
  await tab(page, "내 정보");
  await expect(page.getByRole("heading", { name: "내 정보" })).toBeVisible({ timeout: 20_000 });
  const confirm = page.getByRole("alertdialog");
  const newGoal = `포트폴리오 끝내고 토익 ${800 + (Date.now() % 100)}점 넘기기`;
  await step(S, "① 목표 카드 › → 고침 → 「‹」 → 확인(121:449) 「계속 적기」 → 「저장」 → 상태보기 맨 위 줄", "8-1 AC7", async () => {
    await page.getByRole("button", { name: /^목표,/ }).first().click();
    const g = page.getByRole("dialog", { name: "목표" });
    await g.getByRole("textbox").fill(newGoal);
    await g.getByRole("button", { name: "이전" }).click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "계속 적기" }).click();
    await g.getByRole("button", { name: "저장" }).click();
    await expect(g).toBeHidden({ timeout: 20_000 });
    await tab(page, "상태보기");
    await expect(page.getByText(newGoal)).toBeVisible({ timeout: 20_000 });
    await tab(page, "내 정보");
  });
  await step(S, "② 목표 비율 › → 「균등 배분」 → 「‹」 → 「나가기」(121:389) → 값 그대로", "8-1 AC7", async () => {
    await page.getByRole("button", { name: /목표 비율/ }).first().click();
    const r = page.getByRole("dialog", { name: "목표 비율" });
    const values = () => r.getByRole("spinbutton", { name: /비율\(%\)/ }).or(r.getByRole("textbox", { name: /비율\(%\)/ })).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const before = await values();
    await r.getByRole("button", { name: "균등 배분" }).click();
    await r.getByRole("button", { name: "이전" }).click();
    await confirm.getByRole("button", { name: "나가기" }).click();
    await page.getByRole("button", { name: /목표 비율/ }).first().click();
    expect(await values()).toEqual(before);
  });
  await step(S, "③ 값 바꿔 「저장」 → 합 100(기타 포함)", "8-1 AC7", async () => {
    const r = page.getByRole("dialog", { name: "목표 비율" });
    await r.getByRole("button", { name: /% 늘리기$/ }).first().click();
    const sum = (await r.getByRole("spinbutton", { name: /비율\(%\)/ }).or(r.getByRole("textbox", { name: /비율\(%\)/ })).evaluateAll((els) => els.map((e) => Number((e as HTMLInputElement).value)))).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
    await r.getByRole("button", { name: "저장" }).click();
    await expect(r).toBeHidden({ timeout: 20_000 });
  });
  await step(S, "④⑤ 알림 시각 바꿈 · 아침 알림 끔 → 단추 없이 바로 저장 + 「저장했어요」 · 「알림 설정 저장」 단추 없음", "8-8 AC2", async () => {
    await expect(page.getByRole("button", { name: "알림 설정 저장" })).toHaveCount(0);
    const evening = page.getByRole("checkbox", { name: "오늘 기록 알림" });
    if (!(await evening.isChecked())) {
      await evening.click(); // 시작 상태 「알림 둘 켬」 — 꺼져 있으면 켠다(시각 칸은 켰을 때만 고를 수 있다)
      await expect(page.getByText(/저장했어요/).first()).toBeVisible({ timeout: 20_000 });
    }
    const sel = page.getByLabel("오늘 기록 알림 시각");
    const opts = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const cur = await sel.inputValue();
    await sel.selectOption(opts.find((v) => v !== cur)!);
    await expect(page.getByText(/저장했어요/).first()).toBeVisible({ timeout: 20_000 });
    await sel.selectOption(cur);
    const morning = page.getByRole("checkbox", { name: "아침 알림" });
    const was = await morning.isChecked();
    await morning.click();
    await expect(page.getByText(/저장했어요/).first()).toBeVisible({ timeout: 20_000 });
    if (was !== (await morning.isChecked())) await morning.click(); // 되돌림
  });
  finish();
});

// ---------------------------------------------------------------- S-08
test("S-08 오프라인 — 저장 대기 원", async ({ browser }) => {
  const S = "S-08";
  await reopen(browser);
  await home();
  const text = "오프라인 할 일";
  await step(S, "①② 끊긴 채 적기 → 줄 끝 도는 원 · 「저장 대기」 글은 안 보이고 화면 읽기만", "8-2 AC6", async () => {
    await s.context.setOffline(true);
    await page.getByRole("button", { name: "할 일 적기" }).click();
    await page.getByRole("textbox", { name: "할 일 적기" }).fill(text);
    await page.getByRole("button", { name: "적기", exact: true }).click();
    await page.getByRole("form", { name: "할 일 적기" }).getByRole("button", { name: "닫기" }).click(); // 고침10 A: 왼쪽 위 「✕」
    const row = page.locator("li.todo-row", { hasText: text });
    await expect(row).toBeVisible();
    await expect(row.locator(".save-pending")).toHaveCount(1);
    await expect(row.locator(".save-pending .sr-only")).toHaveText("저장 대기");
    const visibleText = await row.evaluate((el) => (el as HTMLElement).innerText);
    expect(visibleText).not.toContain("저장 대기");
  });
  await step(S, "③ 연결 되살림 → 원 사라짐 · 서버에 남음", "8-2 AC6", async () => {
    await s.context.setOffline(false);
    const row = page.locator("li.todo-row", { hasText: text });
    await expect(row.locator(".save-pending")).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => [...(await ids(s.client, "todos"))].filter((id) => !beforeTodos.has(id)).length, { timeout: 20_000 }).toBeGreaterThan(0);
  });
  await step(S, "④ 할 일 페이지 작업 기록을 쓰다가 서버 실패 → 「저장 안 됨 · 다시 시도」(66:76)", "8-2 AC6", async () => {
    // 기기 먼저 저장이라 작업 기록·고치기는 기기에 먼저 저장되어 이 머리 상태로 가지 않는다(photos.spec 66:76과 같음). 끊고 써 본다
    await page.route("**/*", (route) => (route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("failed") : route.continue()));
    await page.getByRole("button", { name: `자세히 보기: ${text}` }).click();
    const note = page.getByRole("textbox", { name: /작업 기록/ });
    await note.fill("끊긴 채 쓴 기록");
    await note.press("Enter");
    await expect(page.getByRole("button", { name: /저장 안 됨/ })).toBeVisible({ timeout: 10_000 });
  });
  finish();
});

// ---------------------------------------------------------------- S-09
test("S-09 접근성 ②③ · 대비 · 누름 · aria", async ({ browser }) => {
  const S = "S-09";
  await reopen(browser);
  await home();
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await step(S, "아래 탭 아이콘은 읽지 않고 글만", "D-131", async () => {
    const icons = page.getByRole("navigation", { name: "화면 이동" }).locator("svg");
    expect(await icons.count()).toBe(4);
    expect(await icons.evaluateAll((els) => els.every((e) => e.getAttribute("aria-hidden") === "true"))).toBe(true);
  });
  await step(S, "② 키보드: 휠 위/아래 = 1시간 · 5분", "8-3 AC8", async () => {
    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    const h = dialog.getByRole("spinbutton", { name: "시간", exact: true });
    const m = dialog.getByRole("spinbutton", { name: "분", exact: true });
    const hv = Number(await h.getAttribute("aria-valuenow"));
    await h.focus();
    await page.keyboard.press("ArrowUp");
    await expect(h).toHaveAttribute("aria-valuenow", String(hv + 1));
    const mv = Number(await m.getAttribute("aria-valuenow"));
    await m.focus();
    await page.keyboard.press(mv >= 55 ? "ArrowDown" : "ArrowUp");
    await expect(m).toHaveAttribute("aria-valuenow", String(mv >= 55 ? mv - 5 : mv + 5));
  });
  await step(S, "② 칩 이름 「{분야}, 다이얼에 넣기」 + 켬/끔(aria-pressed) · 「‹」 = 「이전」", "D-131", async () => {
    await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
    const chips = dialog.getByRole("group", { name: "분야 · 여러 개" }).getByRole("button");
    const names = await chips.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent ?? ""));
    expect(names.some((n) => /, 다이얼에 넣기$/.test(n))).toBe(true);
    await expect(dialog.getByRole("button", { name: "이전" })).toBeVisible();
  });
  await step(S, "② 확인 창이 떠 있는 동안 Tab이 뒤 화면으로 가지 않는다(inert · 고침10 B Tab 가두기)", "명세 ④-2", async () => {
    await pickSplitChip(dialog);
    await dialog.press("Escape");
    const c = page.getByRole("alertdialog");
    await expect(c).toBeVisible();
    // 확인 밖에는 inert, Tab·Shift+Tab은 창 안 두 단추에서만 돈다(components/close-confirm.tsx)
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await c.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await c.getByRole("button", { name: "나가기" }).click();
  });
  await step(S, "③ 동작 줄이기: 도는 원·나타남 애니메이션 없음", "D-131", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const anim = await page.evaluate(() => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      el.setAttribute("class", "save-pending-ring");
      document.body.appendChild(el);
      const a = getComputedStyle(el).animationName;
      el.remove();
      return a;
    });
    expect(["none", ""]).toContain(anim);
    await page.emulateMedia({ reducedMotion: null });
  });
  await step(S, "대비: 예시 글(#5e6478) 4.5:1 이상", "D-131", async () => {
    const ratio = await page.evaluate(() => {
      const lum = (c: string) => {
        const [r, g, b] = (c.match(/\d+/g) ?? []).slice(0, 3).map((v) => Number(v) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const probe = document.createElement("span");
      probe.style.color = "var(--color-text-sub)";
      document.body.appendChild(probe);
      const fg = getComputedStyle(probe).color;
      probe.remove();
      const bg = getComputedStyle(document.body).backgroundColor;
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
  await step(S, "누름: −/+ 누름 44 · 보이는 원 32", "명세 O-1", async () => {
    await tab(page, "내 정보");
    await page.getByRole("button", { name: /목표 비율/ }).first().click();
    const b = page.getByRole("dialog", { name: "목표 비율" }).getByRole("button", { name: /% 늘리기$/ }).first();
    const r = await box(b);
    expect(Math.round(r.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(r.height)).toBeGreaterThanOrEqual(44);
    const face = await box(b.locator(".step-btn-face"));
    expect(Math.round(face.width)).toBe(32);
  });
  finish();
});

// ---------------------------------------------------------------- S-10
test("S-10 분야가 많을 때 — 칩 「+n」", async ({ browser }) => {
  const S = "S-10";
  await reopen(browser);
  await home();
  const group = page.getByRole("group", { name: "분야" });
  await page.getByRole("button", { name: "할 일 적기" }).click();
  const more = group.getByRole("button", { name: /^분야 \d+개 더 보기$/ });
  await step(S, "① 두 줄까지 · 둘째 줄 끝 「+n」(131:2) · aria-expanded=false", "명세 ⑱ P-1", async () => {
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    const tops = await group.getByRole("button").evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops.map((t) => Math.round(t / 8))).size).toBeLessThanOrEqual(2);
  });
  await step(S, "② 「+n」 → 모두 + 「+ 분야」 + 「접기」(131:51) · aria-expanded=true", "명세 ⑱ P-1", async () => {
    await more.click();
    const collapse = page.getByRole("button", { name: "분야 접기" });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "+ 분야" })).toBeVisible();
  });
  await step(S, "③④ 숨어 있던 분야 고름 → 「접기」 → 「✓ +n」", "명세 ⑱ P-1", async () => {
    const unpressed = group.getByRole("button", { pressed: false });
    await unpressed.nth(Math.min(5, (await unpressed.count()) - 1)).click();
    await page.getByRole("button", { name: "분야 접기" }).click();
    await expect(more).toBeVisible();
    expect(await more.evaluate((el) => el.querySelector("svg, .chip-check") !== null || /✓/.test(el.textContent ?? ""))).toBe(true);
  });
  await step(S, "⑤ 나누기·타이머에서도 같은 꼴(「+n」)", "명세 ⑱ P-1", async () => {
    await page.getByRole("form", { name: "할 일 적기" }).getByRole("button", { name: "닫기" }).click(); // 고침10 A: 왼쪽 위 「✕」
    if (await page.getByRole("alertdialog").isVisible()) await page.getByRole("alertdialog").getByRole("button", { name: "나가기" }).click();
    await tab(page, "타이머");
    await expect(page.getByRole("button", { name: /^분야 \d+개 더 보기$/ })).toBeVisible({ timeout: 20_000 });
    await tab(page, "할 일");
    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    const dialog = page.getByRole("dialog", { name: "오늘 기록" });
    await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
    await expect(dialog.getByRole("button", { name: /^분야 \d+개 더 보기$/ })).toBeVisible();
    const save = await box(dialog.getByRole("button", { name: "저장", exact: true }));
    const dial = await box(dialog.locator("svg.dial"));
    expect(dial.y + dial.height).toBeLessThanOrEqual(save.y + 0.5);
  });
  finish();
});
