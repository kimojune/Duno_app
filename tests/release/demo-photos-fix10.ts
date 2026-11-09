import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

/**
 * 발표 06~08장 사진을 고침 10 판에서 「체험 코드」 계정으로 다시 찍는다(22 팀장 지시, webServer 없음).
 * 이미 떠 있는 운영 서버(기본 http://localhost:3200)에 브라우저로 접속만 한다. *.spec.ts 꼴이 아니라 시험 묶음에 끼지 않는다.
 * 실행: node tests/release/demo-photos-fix10.ts  (Node의 타입 지우기로 돈다, 새 패키지 없음)
 * 체험 코드는 .env.local의 DEMO_ACCESS_CODE를 이 안에서만 읽는다 — 출력·저장·사진에 쓰지 않는다.
 * 로그인 상태(쿠키)는 test-results/demo-fix10-state.json(git 무시)에만 두어, 다시 돌릴 때 체험으로 또 들어가지 않는다.
 * trace·video·실패 때 사진을 쓰지 않는다. 가짜 응답(page.route)을 쓰지 않는다.
 */

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3200";
const OUT = "docs/oneshot-v2/발표판-화면-체험-고침10";
const STATE = "test-results/demo-fix10-state.json";

function readCode(): string {
  const text = fs.readFileSync(".env.local", "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith("DEMO_ACCESS_CODE="));
  const value = (line ?? "").slice("DEMO_ACCESS_CODE=".length).trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error("DEMO_ACCESS_CODE 없음");
  return value;
}

const log = (msg: string) => console.log(msg);
let entered = 0;

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name} (체험).png`), animations: "disabled" });
  log(`찍음: ${name}`);
}

async function step(name: string, body: () => Promise<void>) {
  try {
    await body();
  } catch (e) {
    log(`실패: ${name} — ${String((e as Error).message).split("\n")[0].slice(0, 300)}`);
  }
}

const flat = (s: string) => s.replace(/\s+/g, " ");

async function tab(page: Page, name: "상태보기" | "할 일" | "타이머") {
  await page.getByRole("navigation", { name: "화면 이동" }).getByRole("button", { name }).click();
}

async function main() {
  fs.mkdirSync("test-results", { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const haveState = fs.existsSync(STATE);
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
    ...(haveState ? { storageState: STATE } : {}),
  });
  const page = await context.newPage();
  await page.goto(BASE + "/");
  const addBtn = page.getByRole("button", { name: "할 일 적기" });
  if (!(await addBtn.isVisible({ timeout: 15_000 }).catch(() => false))) {
    const code = readCode();
    await page.locator("input.demo-input").fill(code);
    await page.locator("button.demo-start").click();
    entered += 1;
    await addBtn.waitFor({ timeout: 60_000 });
  }
  await context.storageState({ path: STATE });
  log(`체험으로 들어간 횟수(이 실행): ${entered}`);
  await page.waitForTimeout(2500);

  // ---- 08장 ① : 먼저 할 일 카드 ----
  const card = page.getByRole("region", { name: "오늘 먼저 할 일" });
  await step("08 카드", async () => {
    await card.waitFor({ timeout: 15_000 });
    log("카드 글: " + flat(await card.innerText()));
    await shot(page, "S2 할 일 · 먼저 할 일 카드");
  });

  // ---- 08장 ② : 30분 시작 → 도는 중 ----
  await step("08 시작", async () => {
    if (await card.isVisible().catch(() => false)) {
      await card.getByRole("button", { name: /^\d+분 시작$/ }).click();
    } else {
      await tab(page, "타이머");
      await page.getByRole("heading", { name: "무엇을 할까요?" }).waitFor({ timeout: 20_000 });
      await page.getByRole("button", { name: /^\d+분 시작$/ }).click();
    }
    await page.waitForTimeout(2000);
    await tab(page, "타이머");
    await page.getByRole("button", { name: "끝내기" }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    log("타이머 도는 중 글: " + flat(await page.locator("section.timer").innerText()).slice(0, 300));
    await shot(page, "S4 타이머 · 도는 중");
    await page.waitForTimeout(65_000);
    await page.getByRole("button", { name: "끝내기" }).click();
    await page.getByRole("button", { name: "끝내기" }).waitFor({ state: "hidden", timeout: 20_000 });
    await page.waitForTimeout(1500);
    log("타이머 끝난 뒤 글: " + flat(await page.locator("section.timer").innerText()).slice(0, 300));
    await shot(page, "S4 타이머 · 고르기");
    await tab(page, "할 일");
  });

  // ---- 06장 ① : 적는 창 · 분야 칩 ----
  await step("S2-a", async () => {
    await page.getByRole("button", { name: "할 일 적기" }).click();
    const input = page.getByRole("textbox", { name: "할 일 적기" });
    await input.fill("토익 단어 50개");
    const group = page.getByRole("group", { name: "분야" });
    await group.getByRole("button", { pressed: false }).nth(0).click();
    await shot(page, "S2-a 적는 창 · 분야 고르기");
    await input.fill("");
    await page.getByRole("button", { name: "닫기" }).first().click();
    const confirm = page.getByRole("alertdialog");
    if (await confirm.isVisible({ timeout: 1_500 }).catch(() => false)) {
      log("적는 창 확인 단추: " + (await confirm.getByRole("button").allInnerTexts()).join(" | "));
      await confirm.getByRole("button", { name: /나가기|저장하지 않고/ }).first().click();
    }
  });

  // ---- 오늘 할 일 하나를 끝냄 표시(30분 조각이 나오게, 앱 안의 정상 조작) ----
  await step("끝냄 표시", async () => {
    const boxes = page.locator("li.todo-row input[type=checkbox]:not(:checked)");
    log("안 끝낸 할 일 수: " + (await boxes.count()));
    await boxes.first().check({ force: true });
    await page.waitForTimeout(1500);
  });

  // ---- 06장 ② · ③ + 08장 ③ : 오늘 기록(저장하지 않고 닫는다) ----
  await step("오늘 기록", async () => {
    const dialog = page.getByRole("dialog", { name: "오늘 기록" });
    await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
    await dialog.getByRole("button", { name: "분야마다 나누기" }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    log("오늘 기록 시간 칸: " + flat(await dialog.innerText()).slice(0, 300));
    await shot(page, "S5-1 시간 · 처음(타이머로 채움)");
    await step("S5-1 시트", async () => {
      await dialog.getByRole("button", { name: /^오늘 할 일 \d+\/\d+/ }).click();
      const sheet = page.getByRole("dialog", { name: "오늘 할 일" });
      await sheet.waitFor();
      await shot(page, "S5-1 오늘 할 일 시트");
      await sheet.getByRole("button", { name: "닫기" }).click();
    });
    await step("S5-2 나누기", async () => {
      await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
      await dialog.getByRole("heading", { name: "분야마다 나눠 주세요" }).waitFor();
      const group = dialog.getByRole("group", { name: "분야 · 여러 개" });
      const more = group.getByRole("button", { name: /^분야 \d+개 더 보기$/ });
      if (await more.isVisible().catch(() => false)) await more.click();
      const pressed = await group.getByRole("button", { name: /, 다이얼에 넣기$/, pressed: true }).count();
      log(`나누기에서 처음 켜진 칩: ${pressed}`);
      for (let i = pressed; i < 2; i++) await group.getByRole("button", { name: /, 다이얼에 넣기$/, pressed: false }).first().click();
      log("나누기 글: " + flat(await dialog.innerText()).slice(0, 400));
      await shot(page, "S5-2 나누기 · 칩 둘 고른 상태");
    });
    await dialog.press("Escape");
    const confirm = page.getByRole("alertdialog");
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) {
      log("닫기 확인 창 단추: " + (await confirm.getByRole("button").allInnerTexts()).join(" | "));
      await confirm.getByRole("button", { name: /나가기|저장하지 않고/ }).first().click();
    }
  });

  // ---- 07장 ① · ② ----
  await step("07", async () => {
    await tab(page, "상태보기");
    await page.getByRole("tab", { name: "목표 비율" }).waitFor({ timeout: 20_000 });
    await page.getByRole("tab", { name: "이번 주 목표" }).click();
    await page.waitForTimeout(1500);
    log("이번 주 목표 글: " + flat(await page.locator("main").innerText()).slice(0, 400));
    await shot(page, "S6-1 이번 주 목표 뷰 · 목표 세운 주");
    await page.getByRole("tab", { name: "목표 비율" }).click();
    await page.getByRole("button", { name: "원그래프로 보기" }).click();
    await page.waitForTimeout(1500);
    await shot(page, "S6-2 목표 비율 뷰 · 원그래프");
  });

  await context.storageState({ path: STATE });
  await browser.close();
  log("끝");
}

main().catch((e) => {
  console.log("중단: " + String((e as Error).message).split("\n")[0].slice(0, 300));
  process.exit(1);
});
