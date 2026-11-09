import { expect, test, type Page } from "@playwright/test";
import type { MirrorSnapshot } from "../../lib/local/types";
import { ids, missing, openA, openHome, pickSplitChip, removeGoal, removeTodos, shot, tab, type Session } from "./release";

/**
 * 발표판 검수(K2, PM d-153): 진짜 로그인 앱(운영 빌드, 시험 계정 A)의 화면 사진 360×800.
 * 이름 = 23 「최종 폰 목록」(+ 「더함」·새 폰)의 「화면 · 상태」. 실제 데이터로 못 만드는 상태만 GET /mirror 가짜 응답(파일 이름 끝 「(가짜 응답)」).
 * A에 할 일·이번 주 목표·오늘 기록·타이머 기록을 쓴다. 끝에 이번 실행이 만든 할 일과 이번 주 목표(실행 전에 없었으면)를 지운다.
 * 사진은 tests/release/release.ts PHOTO_DIR(SAVE_PHOTOS=1일 때만 docs/oneshot-v2/발표판-화면/). 사진 목록 줄은 test-results/release/photos.jsonl.
 */

const T1 = "토익 단어 50개";
const T2 = "토익 LC 한 회 풀기";
const T3 = "빨래";
const NOTE = "Day 12까지";

let s: Session;
let page: Page;
let beforeTodos = new Set<string>();
let goalBefore: string[] = [];

/** 사진 하나 = 시험 하나. 실패하면 「찍지 못함」 줄을 남기고 실패로 둔다 */
function photo(name: string, node: string, body: () => Promise<void>) {
  test(`${name} — ${node}`, async () => {
    try {
      await body();
    } catch (e) {
      missing(name, node, `시험 실패: ${String((e as Error).message).split("\n")[0].slice(0, 160)}`);
      throw e;
    }
  });
}

test.describe.configure({ mode: "default" });

test.beforeAll(async ({ browser }) => {
  s = await openA(browser);
  page = s.page;
  beforeTodos = await ids(s.client, "todos");
  const goals = await s.client.from("weekly_goals").select("week_start");
  goalBefore = (goals.data ?? []).map((r: { week_start: string }) => r.week_start);
});

test.afterAll(async () => {
  const now = await ids(s.client, "todos");
  await removeTodos(s.client, [...now].filter((id) => !beforeTodos.has(id)));
  const goals = await s.client.from("weekly_goals").select("week_start");
  for (const r of (goals.data ?? []) as { week_start: string }[]) if (!goalBefore.includes(r.week_start)) await removeGoal(s.client, r.week_start);
  await s.context.close();
});

/** 새 창을 열어 A로(가짜 응답이 있으면 그 창에만) */
async function reopen(browser: import("@playwright/test").Browser, fake?: (snap: MirrorSnapshot) => MirrorSnapshot) {
  // 창을 닫기 전에 보낼 줄이 서버로 가게(기기 먼저 저장) 네트워크가 잠잠해질 때까지
  await s.page.waitForLoadState("networkidle").catch(() => undefined);
  await s.context.close();
  s = await openA(browser, fake);
  page = s.page;
}

/** 같은 창을 다시 연다(기기 저장소·보낼 줄은 그대로 — 앞 시험이 실패해 남긴 창·route를 걷는다) */
const home = async () => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await openHome(s);
};
const growthReady = async () => {
  await tab(page, "상태보기");
  await expect(page.getByRole("tab", { name: "목표 비율" })).toBeVisible({ timeout: 20_000 });
};

// ---------- S0 · S1 ----------
photo("S0 로그인 · 처음 열기", "49:169", async () => {
  const ctx = await page.context().browser()!.newContext({ viewport: { width: 360, height: 800 } });
  const p = await ctx.newPage();
  await p.goto("/");
  await expect(p.getByRole("button", { name: /Google로 로그인/ })).toBeVisible({ timeout: 30_000 });
  await shot(p, "S0 로그인 · 처음 열기", "49:169");
  await ctx.close();
});

test.describe("S1 처음 설정(가짜 응답: 설정 onboardingDone=false)", () => {
  test("S1-1~S1-4", async ({ browser }) => {
    await reopen(browser, (snap) => ({ ...snap, settings: snap.settings ? { ...snap.settings, onboardingDone: false, goal: null } : snap.settings }));
    await page.goto("/");
    const steps: [string, string][] = [
      ["S1-1 목표(1/4)", "49:178"],
      ["S1-2 분야(2/4)", "49:194"],
      ["S1-3 목표 비율(3/4)", "49:232"],
      ["S1-4 알림(4/4)", "50:4"],
    ];
    await expect(page.getByRole("heading", { name: "목표" })).toBeVisible({ timeout: 30_000 });
    for (const [i, [name, node]] of steps.entries()) {
      try {
        if (i === 0) await page.getByRole("textbox").first().fill("포트폴리오 끝내고 토익 800점 넘기기");
        await shot(page, name, node, { fake: true });
        if (i < 3) await page.getByRole("button", { name: "다음" }).click();
      } catch (e) {
        missing(name, node, `시험 실패: ${String((e as Error).message).split("\n")[0]}`);
        throw e;
      }
    }
    // 「시작하기」는 누르지 않는다(A의 설정을 바꾸지 않게)
  });
});

// ---------- S2 할 일 ----------
test("S2 할 일 · 빈 목록(첫날)", async ({ browser }) => {
  const name = "S2 할 일 · 빈 목록(첫날)";
  // 오늘 할 일이 이미 있으면(지난 실행 등) 할 일만 비운 가짜 응답으로
  await reopen(browser);
  await openHome(s);
  const rows = await page.locator("li.todo-row").count();
  if (rows > 0) {
    await reopen(browser, (snap) => ({ ...snap, todos: [] }));
    await openHome(s);
  }
  await expect(page.getByText("예시", { exact: true })).toBeVisible();
  await shot(page, name, "50:28", { fake: rows > 0 });
});

test("S2-a 적는 창 · 분야 고르기 · 접힘(+n) · 펼침 · 닫기 확인", async ({ browser }) => {
  await reopen(browser);
  await openHome(s);
  await page.getByRole("button", { name: "할 일 적기" }).click();
  const input = page.getByRole("textbox", { name: "할 일 적기" });
  await input.fill(T1);
  const group = page.getByRole("group", { name: "분야" });
  const chips = group.getByRole("button", { pressed: false });
  await chips.nth(0).click(); // 「기타」 다음 첫 분야
  await shot(page, "S2-a 적는 창 · 분야 고르기", "50:103");
  const more = group.getByRole("button", { name: /^분야 \d+개 더 보기$/ });
  if (await more.isVisible()) {
    await shot(page, "S2-a 적는 창 · 분야 많음 접힘(+n)", "131:2");
    await more.click();
    await expect(page.getByRole("button", { name: "분야 접기" })).toBeVisible();
    await shot(page, "S2-a 적는 창 · 분야 많음 펼침", "131:51");
    await page.getByRole("button", { name: "분야 접기" }).click();
  } else {
    missing("S2-a 적는 창 · 분야 많음 접힘(+n)", "131:2", "A의 분야가 두 줄 안이라 접히지 않음");
    missing("S2-a 적는 창 · 분야 많음 펼침", "131:51", "A의 분야가 두 줄 안이라 접히지 않음");
  }
  // 133:2 적은 글이 있을 때 닫기 → 확인
  await page.getByRole("button", { name: /적는 창 닫기/ }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await shot(page, "S2-a 적는 창 · 닫기 확인", "133:2");
  await confirm.getByRole("button", { name: "계속 적기" }).click();
  // 적기: T1(분야), T2(같은 분야 이어), T3(기타)
  await page.getByRole("button", { name: "적기", exact: true }).click();
  await expect(input).toHaveValue("");
  for (const t of [T2, T3]) {
    await input.fill(t);
    await page.getByRole("button", { name: "적기", exact: true }).click();
    await expect(input).toHaveValue("");
  }
  await page.getByRole("button", { name: /적는 창 닫기/ }).click();
  await expect(page.getByText(T3, { exact: true })).toBeVisible();
});

test("S2-b 할 일 페이지 · 작업 기록 · ⋯ 메뉴 · 지우기 확인 · 분야 시트 · S2 목록", async () => {
  // 앞 시험의 창에 이어서
  const detail = (t: string) => page.getByRole("button", { name: `자세히 보기: ${t}` });
  await detail(T2).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "S2-b 할 일 페이지 · 작업 기록 빈 때", "51:55");
  // 분야 시트
  await page.getByRole("button", { name: /분야/ }).first().click();
  const catSheet = page.getByRole("dialog", { name: "분야 고르기" });
  await expect(catSheet).toBeVisible();
  await shot(page, "S2-b′ 분야 고르기 시트", "77:18");
  await catSheet.getByRole("button", { name: "닫기" }).click();
  await page.getByRole("button", { name: "할 일로 돌아가기" }).click();
  // T1에 작업 기록
  await detail(T1).click();
  const noteBox = page.getByRole("textbox", { name: /작업 기록/ });
  await noteBox.fill(NOTE);
  await noteBox.press("Enter");
  await expect(page.getByText(NOTE)).toBeVisible();
  await page.getByRole("button", { name: "더 보기" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await shot(page, "S2-b 할 일 페이지 · 기록 있음 · ⋯ 메뉴", "58:92");
  await page.getByRole("menuitem", { name: "지우기" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await shot(page, "S2-b 할 일 페이지 · 지우기 확인", "66:12");
  await page.getByRole("alertdialog").getByRole("button", { name: "취소" }).click();
  await page.getByRole("button", { name: "할 일로 돌아가기" }).click();
  // 하나 끝냄
  await page.getByRole("checkbox", { name: T3 }).check();
  await expect(page.getByRole("checkbox", { name: T3 })).toBeChecked();
  await shot(page, "S2 할 일 · 목록 있음(하나 끝냄)", "50:52");
});

test("S2-b 할 일 페이지 · 저장 안 됨 · 다시 시도", async () => {
  // 기기 먼저 저장: 할 일 페이지의 고치기는 기기에 먼저 저장되어 성공으로 돌아온다(components/todo-detail.tsx send → api.editTodo).
  // 서버 쓰기를 끊어도 「연결되면 보냄」으로 기다릴 뿐 이 머리 상태가 되지 않는다(실행해 확인: Server Action POST를 끊고 20초 — 「저장됨」).
  missing("S2-b 할 일 페이지 · 저장 안 됨 · 다시 시도", "66:76", "기기 먼저 저장이라 고치기가 실패하지 않는다(서버를 끊어도 「저장됨」 — 실행해 확인). 기기 저장소 실패를 만들 길이 없다");
});

test("S2-e 지난 날 · 이날 기록 / 앞날", async () => {
  await home();
  missing("S2-e 앞날 · 미리 적기", "57:2", "앱에 앞날 화면이 없다(components/past-days.tsx: 오늘 이후는 못 본다) — 이동 대조 F17");
  await page.getByRole("button", { name: "지난 날 보기" }).click();
  await expect(page.getByRole("dialog", { name: /지난 날/ })).toBeVisible();
  await shot(page, "S2-e 지난 날 · 이날 기록", "57:93");
  await page.getByRole("dialog", { name: /지난 날/ }).getByRole("button", { name: "닫기" }).click();
});

test("S2-d 이번 주 목표 시트(목표 없애기 확인 포함)", async () => {
  await home();
  const open = page.getByRole("button", { name: /이번 주 목표/ }).first();
  await open.click();
  const dlg = page.getByRole("dialog", { name: "이번 주 목표" });
  await expect(dlg).toBeVisible();
  await shot(page, "S2-d 이번 주 목표 시트", "50:332");
  // 목표 세움: 첫 분야 +1시간 두 번 → 저장
  const plus = dlg.getByRole("button", { name: /늘리기/ });
  await plus.nth(0).click();
  await plus.nth(0).click();
  if ((await plus.count()) > 1) await plus.nth(1).click();
  await dlg.getByRole("button", { name: "저장" }).click();
  await expect(dlg).toBeHidden({ timeout: 20_000 });
  // 다시 열어 「목표 없애기」 확인
  await page.getByRole("button", { name: /이번 주 목표/ }).first().click();
  await dlg.getByRole("button", { name: "목표 없애기" }).click();
  await expect(dlg.getByText("이번 주 목표를 없앨까요?")).toBeVisible();
  await shot(page, "S2-d 이번 주 목표 시트 · 목표 없애기 확인", "50:332");
  await dlg.getByRole("button", { name: "그대로" }).click();
  await dlg.getByRole("button", { name: "닫기" }).click();
});

// ---------- S4 타이머 ----------
test("S4 타이머 · 고르기 · 도는 중", async () => {
  await home();
  await tab(page, "타이머");
  // 앞 실행이 남긴 도는 타이머가 있으면 먼저 끝낸다
  if (await page.getByRole("button", { name: "끝내기" }).isVisible({ timeout: 3_000 }).catch(() => false)) await page.getByRole("button", { name: "끝내기" }).click();
  await expect(page.getByRole("heading", { name: "무엇을 할까요?" })).toBeVisible({ timeout: 20_000 });
  await shot(page, "S4 타이머 · 고르기", "50:390");
  await page.getByRole("radio", { name: new RegExp(T1) }).check().catch(async () => page.getByText(T1).first().click());
  await page.getByRole("button", { name: /^\d+분 시작$/ }).click();
  await expect(page.getByRole("button", { name: "끝내기" })).toBeVisible({ timeout: 20_000 });
  await shot(page, "S4 타이머 · 도는 중", "50:440");
  await page.getByRole("button", { name: "끝내기" }).click();
  await expect(page.getByRole("button", { name: "끝내기" })).toBeHidden({ timeout: 20_000 });
  await tab(page, "할 일");
});

// ---------- S5 오늘 기록 ----------
test("S5 오늘 기록 · 시간 · 시트 · 나누기 · 확인 · 저장 중 · 저장 직후(목표 세운 주) · S6-1", async () => {
  await home();
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
  await expect(dialog.getByRole("button", { name: "분야마다 나누기" })).toBeVisible({ timeout: 20_000 });
  await shot(page, "S5-1 시간 · 처음(타이머로 채움)", "49:5");
  await dialog.getByRole("spinbutton", { name: "시간", exact: true }).locator(".time-wheel-center").click();
  await expect(dialog.getByRole("textbox", { name: "시간", exact: true })).toBeVisible();
  await shot(page, "S5-1 시간 · 숫자 바로 쓰기", "66:170");
  await dialog.getByRole("textbox", { name: "시간", exact: true }).fill("2");
  await dialog.getByRole("textbox", { name: "시간", exact: true }).press("Enter");
  await dialog.getByRole("spinbutton", { name: "분", exact: true }).locator(".time-wheel-center").click();
  await dialog.getByRole("textbox", { name: "분", exact: true }).fill("30");
  await dialog.getByRole("textbox", { name: "분", exact: true }).press("Enter");
  await dialog.getByRole("button", { name: /^오늘 할 일 \d+\/\d+/ }).click();
  const todoSheet = page.getByRole("dialog", { name: "오늘 할 일" });
  await expect(todoSheet).toBeVisible();
  await shot(page, "S5-1 오늘 할 일 시트", "88:12");
  await todoSheet.getByRole("button", { name: "닫기" }).click();
  await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
  await expect(dialog.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
  await shot(page, "S5-2 나누기 · 들어간 처음", "87:2");
  await pickSplitChip(dialog);
  await shot(page, "S5-2 나누기 · 칩 하나 고른 상태", "87:96", { note: "처음부터 타이머·끝낸 할 일 분야 칩이 켜져 있어 그 위에 하나 더" });
  await pickSplitChip(dialog);
  await shot(page, "S5-2 나누기 · 칩 둘 고른 상태", "49:26");
  // 넘침: 첫 분야 + 를 여러 번
  const plus = dialog.getByRole("button", { name: /늘리기/ });
  for (let i = 0; i < 40 && !(await dialog.getByText(/합계보다 많아서/).isVisible()) && (await plus.first().isEnabled()); i++) await plus.first().click();
  let overNote: string | undefined;
  if (!(await dialog.getByText(/합계보다 많아서/).isVisible())) {
    // 「+」로는 합계를 넘길 수 없다(막힘). 시간 단계로 돌아가 합계를 10분으로 줄이면 나눈 값이 넘친다
    overNote = "「+」로는 합계를 넘길 수 없어(단추 막힘) 시간 단계에서 합계를 10분으로 줄여 만듦";
    await dialog.getByRole("button", { name: "이전" }).click();
    for (const [col, v] of [["시간", "0"], ["분", "10"]] as const) {
      await dialog.getByRole("spinbutton", { name: col, exact: true }).locator(".time-wheel-center").click();
      await dialog.getByRole("textbox", { name: col, exact: true }).fill(v);
      await dialog.getByRole("textbox", { name: col, exact: true }).press("Enter");
    }
    await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
  }
  await expect(dialog.getByText(/합계보다 많아서/)).toBeVisible();
  await shot(page, "S5-2 나누기 · 나눈 합이 합계보다 많을 때(기타 0분)", "49:83", { note: overNote });
  if (overNote) {
    await dialog.getByRole("button", { name: "이전" }).click();
    for (const [col, v] of [["시간", "2"], ["분", "30"]] as const) {
      await dialog.getByRole("spinbutton", { name: col, exact: true }).locator(".time-wheel-center").click();
      await dialog.getByRole("textbox", { name: col, exact: true }).fill(v);
      await dialog.getByRole("textbox", { name: col, exact: true }).press("Enter");
    }
    await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
  }
  await dialog.getByRole("button", { name: "닫기" }).first().click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await shot(page, "확인 창 「저장하지 않고 나갈까요?」 계속 적기 · 나가기", "98:210");
  await page.getByRole("alertdialog").getByRole("button", { name: "계속 적기" }).click();
  // 저장 중: 서버 쓰기를 2초 늦춘다(응답은 진짜)
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  const busy = dialog.getByRole("button", { name: /저장 중/ });
  if (await busy.isVisible().catch(() => false)) await shot(page, "S5-2 나누기 · 저장 중", "133:48", { note: "서버 응답을 2초 늦춤" });
  else missing("S5-2 나누기 · 저장 중", "133:48", "기기 먼저 저장이라 저장 중 단추가 화면에 남지 않았다(바로 저장 직후로)");
  await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible({ timeout: 20_000 });
  await page.unroute("**/*");
  await shot(page, "S5-3 저장 직후 · 목표 세운 주", "49:142");
  await dialog.getByRole("button", { name: /상태보기에서 보기/ }).click();
  await expect(page.getByRole("tab", { name: "이번 주 목표" })).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
  await shot(page, "S6-1 이번 주 목표 뷰 · 목표 세운 주", "50:137");
});

// ---------- S6 · S7 ----------
test("S6-2 목표 비율 뷰 · 띠 · 원 · S7 분야 · 기타", async () => {
  await home();
  await growthReady();
  await page.getByRole("tab", { name: "목표 비율" }).click();
  await shot(page, "S6-2 목표 비율 뷰 · 띠그래프(처음 보기)", "50:193");
  await page.getByRole("button", { name: "원그래프로 보기" }).click();
  await shot(page, "S6-2 목표 비율 뷰 · 원그래프", "50:260");
  await page.getByRole("button", { name: "띠그래프로 보기" }).click();
  const rows = page.locator(".growth-item > button");
  await rows.first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "S7 분야 페이지", "50:616");
  await page.getByRole("dialog").getByRole("button", { name: "닫기" }).first().click();
  const other = page.locator(".growth-item > button", { hasText: "기타" });
  await other.first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "S7 분야 페이지 · 「기타」", "121:468");
  await page.getByRole("dialog").getByRole("button", { name: "닫기" }).first().click();
});

test("S6-1 목표 없는 주 · S5-3 저장 직후 목표 없는 주(목표를 없앤 뒤)", async () => {
  await home();
  await tab(page, "할 일");
  await page.getByRole("button", { name: /이번 주 목표/ }).first().click();
  const dlg = page.getByRole("dialog", { name: "이번 주 목표" });
  if (await dlg.getByRole("button", { name: "목표 없애기" }).isVisible()) {
    await dlg.getByRole("button", { name: "목표 없애기" }).click();
    await dlg.getByRole("button", { name: "없애기", exact: true }).click();
  } else await dlg.getByRole("button", { name: "닫기" }).click(); // 이미 목표 없는 주
  await expect(dlg).toBeHidden({ timeout: 20_000 });
  await growthReady();
  await page.getByRole("tab", { name: "이번 주 목표" }).click();
  await shot(page, "S6-1 이번 주 목표 뷰 · 목표 없는 주", "50:741");
  await tab(page, "할 일");
  const dialog = page.getByRole("dialog", { name: "오늘 기록" });
  await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
  await dialog.getByRole("button", { name: "나누지 않고 저장" }).click();
  await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible({ timeout: 20_000 });
  await shot(page, "S5-3 저장 직후 · 목표 없는 주", "59:2");
  await dialog.getByRole("button", { name: /닫기/ }).last().click();
});

// ---------- 가짜 응답: 빈 기록 ----------
function weekStartOf(snap: MirrorSnapshot): string {
  const d = new Date(snap.serverNow);
  const seoul = new Date(d.getTime() + 9 * 3600_000);
  const dow = (seoul.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate() - dow)).toISOString().slice(0, 10);
}

test("S6 빈 상태 · 기록이 하나도 없음(띠 · 원) (가짜 응답)", async ({ browser }) => {
  await reopen(browser, (snap) => ({ ...snap, logs: [], sessions: [] }));
  await openHome(s);
  await growthReady();
  await page.getByRole("tab", { name: "목표 비율" }).click();
  await shot(page, "S6 빈 상태 · 기록이 하나도 없음 · 「이번 주」를 고름", "50:598", { fake: true });
  await page.getByRole("button", { name: "원그래프로 보기" }).click();
  await shot(page, "S6-2 목표 비율 뷰 · 원그래프 · 기록이 하나도 없음 · 「이번 주」를 고름", "121:240", { fake: true });
});

test("S7 분야 페이지 · 빈 상태(기록 없는 분야)", async () => {
  await home();
  await growthReady();
  await page.getByRole("tab", { name: "목표 비율" }).click();
  // 기록·할 일이 없는 분야(시험이 만들고 할 일을 지운 e2e 분야)를 뒤에서부터 찾는다 — 실제 데이터
  const rows = page.locator(".growth-item > button").filter({ hasNotText: "기타" });
  const n = await rows.count();
  for (let i = n - 1; i >= Math.max(0, n - 8); i--) {
    await rows.nth(i).click();
    const d = page.getByRole("dialog");
    await expect(d.getByText(/^총 /).first()).toBeVisible({ timeout: 20_000 });
    if (await d.getByText("할 일 0개").isVisible()) {
      await shot(page, "S7 분야 페이지 · 빈 상태", "121:527");
      return;
    }
    await d.getByRole("button", { name: "닫기" }).first().click();
  }
  throw new Error("기록 없는 분야를 찾지 못함");
});

test("S6-2 이번 주 0시간 · 지난 기록 있음(띠 · 원) (가짜 응답)", async ({ browser }) => {
  await reopen(browser, (snap) => {
    const ws = weekStartOf(snap);
    return { ...snap, logs: (snap.logs ?? []).filter((l) => l.targetDay < ws), sessions: [] };
  });
  await openHome(s);
  await growthReady();
  await page.getByRole("tab", { name: "목표 비율" }).click();
  await shot(page, "S6-2 이번 주 0시간 · 지난 기록 있음(「총 시간」으로 시작)", "111:79", { fake: true });
  await page.getByRole("button", { name: "원그래프로 보기" }).click();
  await shot(page, "S6-2 목표 비율 뷰 · 원그래프 · 이번 주 0시간 + 지난 기록 있음(「총 시간」)", "121:315", { fake: true });
});

test("S6-1 이번 주 목표 뷰 · 목표 세운 주, 기록 없음 (가짜 응답)", async ({ browser }) => {
  await reopen(browser, (snap) => {
    const ws = weekStartOf(snap);
    const first = (snap.categories ?? [])[0];
    return {
      ...snap,
      logs: (snap.logs ?? []).filter((l) => l.targetDay < ws),
      sessions: [],
      goal: first ? { weekStart: ws, items: [{ categoryId: first.id, minutes: 300 }] } : snap.goal,
    };
  });
  await openHome(s);
  await growthReady();
  await page.getByRole("tab", { name: "이번 주 목표" }).click();
  await shot(page, "S6-1 이번 주 목표 뷰 · 목표 세운 주, 기록 없음", "51:107", { fake: true });
});

// ---------- S8 · S9 ----------
test("S8 내 정보 · S8-a · S8-b · 확인 창", async ({ browser }) => {
  await reopen(browser);
  await openHome(s);
  await tab(page, "내 정보");
  await expect(page.getByRole("heading", { name: "내 정보" })).toBeVisible({ timeout: 20_000 });
  await shot(page, "S8 내 정보", "50:641");
  await page.getByRole("button", { name: /목표 비율/ }).first().click();
  const ratio = page.getByRole("dialog", { name: "목표 비율" });
  await expect(ratio).toBeVisible();
  await shot(page, "S8-a 목표 비율 설정", "81:380");
  await ratio.getByRole("button", { name: "균등 배분" }).click();
  await ratio.getByRole("button", { name: "이전" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await shot(page, "S8-a 목표 비율 설정 · 바꾼 뒤 「‹」 → 확인 창", "121:389");
  await page.getByRole("alertdialog").getByRole("button", { name: "나가기" }).click();
  await page.getByRole("button", { name: /^목표,/ }).first().click();
  const goal = page.getByRole("dialog", { name: "목표" });
  await expect(goal).toBeVisible();
  await shot(page, "S8-b 목표 고치기", "102:314");
  await goal.getByRole("textbox").fill("포트폴리오 끝내고 토익 800점 넘기기 (고치는 중)");
  await goal.getByRole("button", { name: "이전" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await shot(page, "S8-b 목표 고치기 · 바꾼 뒤 「‹」 → 확인 창", "121:449");
  await page.getByRole("alertdialog").getByRole("button", { name: "나가기" }).click();
  missing("S9 알림 둘 · 잠금 화면", "50:720", "기기 잠금 화면의 시스템 알림이라 브라우저 화면으로 찍을 수 없다(PM 점검표 P-4)");
});
