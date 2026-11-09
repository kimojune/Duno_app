import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import type { MirrorSnapshot } from "../../lib/local/types";
import { addDays } from "../../lib/week";
import { todoDayFor } from "../../lib/todos/day";
import { forgetSession, ids, missing, openA, openHome, PHOTO_DIR, PHOTO_SCALE, removeTodos, shot, tab } from "./release";

/**
 * 고침10 사진 묶음(23 디자인 QA용) — 360×800 · 배율 2 · 운영 빌드 · 불러오기가 끝난 뒤(shot()이 「불러오는 중」이 사라질 때까지 기다림).
 * SAVE_PHOTOS=1 PHOTO_OUT=고침10-사진 PHOTO_SCALE=2 일 때만 docs/oneshot-v2/고침10-사진/에 쓴다(아니면 test-results/photos/ — git이 무시).
 * 출처 셋: 체험(체험 코드 계정, 이 파일 전체에서 체험 들어가기는 한 번) · 시험 계정 A(진짜 로그인 + 필요하면 GET /mirror 가짜 응답) · 개발 갤러리(tests/release/fix10-gallery-photos.ts, 따로).
 * 체험 코드는 .env.local(또는 환경)에서 이 시험 안에서만 읽어 칸에 넣는다 — 찍지도 쓰지도 않는다.
 * 찍지 못한 상태는 실패로 시험을 멈추지 않고 「찍지 못함」 줄(test-results/release/photos.jsonl)로 남긴다.
 * 실행: SAVE_PHOTOS=1 PHOTO_OUT=고침10-사진 PHOTO_SCALE=2 DUNO_DIST_DIR=… E2E_PORT=… npx playwright test --config playwright.release.config.ts tests/release/fix10-photos.spec.ts
 */

const DEMO = " (체험)";

function demoCode(): string {
  const file = path.resolve(__dirname, "../../.env.local");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const value = (fromFile.DEMO_ACCESS_CODE ?? process.env.DEMO_ACCESS_CODE)?.trim();
  if (!value) throw new Error("DEMO_ACCESS_CODE 없음");
  return value;
}

/** 사진 하나: 실패하면 「찍지 못함」으로 남기고 다음으로 간다 */
async function take(name: string, node: string, opts: { suffix?: string; note?: string; fake?: boolean }, body: () => Promise<Page>) {
  try {
    const page = await body();
    await shot(page, name, node, opts);
  } catch (e) {
    missing(name + (opts.suffix ?? ""), node, `시험 실패: ${String((e as Error).message).split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 200)}`);
  }
}

/** 섹션 하나가 막혀도 다음 섹션으로 간다(체험 들어가기는 한 번뿐이라 다시 돌릴 수 없다). 섹션 앞에서 앱을 처음 화면으로 돌린다 */
async function section(page: Page, name: string, body: () => Promise<void>) {
  try {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "할 일 적기" })).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await body();
  } catch (e) {
    missing(`섹션 ${name}`, "-", `시험 실패: ${String((e as Error).message).split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 200)}`);
  }
}

const growthTab = async (page: Page) => {
  await tab(page, "상태보기");
  await expect(page.getByRole("tab", { name: "목표 비율" })).toBeVisible({ timeout: 20_000 });
};

async function closeConfirm(page: Page, name: string) {
  const confirm = page.getByRole("alertdialog");
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name }).click();
}

// ============================================================ 체험 계정 (체험 들어가기 1번)
test("체험 계정: S0 셋 · 모든 화면", async ({ browser }) => {
  test.setTimeout(600_000);
  const code = demoCode();
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: PHOTO_SCALE });
  const page = await context.newPage();
  try {
    // ---- S0 로그인: 기본 · 틀린 코드(실제 서버에 한 번) · 시작 중(실제 시작, 응답을 2.5초 붙잡아 그 순간을 찍는다) ----
    await page.goto("/");
    await expect(page.locator("input.demo-input")).toBeVisible({ timeout: 30_000 });
    await take("S0-체험코드 기본", "141:9~141:13 · 49:169", {}, async () => page);
    await take("S0-체험코드 틀린 코드", "141:9~141:13 · 141:31", { note: "틀린 코드를 실제 서버에 한 번 넣음(한도 기기 5)" }, async () => {
      await page.locator("input.demo-input").fill(`틀림-${Date.now().toString(36)}`);
      await page.locator("button.demo-start").click();
      await expect(page.locator(".demo-error")).toBeVisible({ timeout: 20_000 });
      return page;
    });
    await page.locator("input.demo-input").fill(code);
    // 체험 코드는 사진에 찍히면 안 된다: 칸의 글자를 점으로 보이게 한 뒤에 찍는다(값은 칸에 있되 화면에는 안 보임)
    await page.addStyleTag({ content: "input.demo-input { -webkit-text-security: disc; }" });
    await page.route("**/*", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.locator("button.demo-start").click();
    await take("S0-체험코드 시작 중", "141:9~141:13", { note: "실제 시작 요청을 2.5초 붙잡아 「시작 중」 순간을 찍음" }, async () => {
      await expect(page.locator("button.demo-start")).toContainText("시작 중", { timeout: 5_000 });
      return page;
    });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await expect(page.getByRole("button", { name: "할 일 적기" })).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);

    await section(page, "A 할 일 · 적는 창 · 어제 못 끝낸", async () => {
      await take("S2 할 일 · 기본", "50:52", { suffix: DEMO }, async () => page);

      // 적는 창(시트 · 막) · 나가기 확인 · 머리 단추 초점 링 · 확인 창 단추 초점 링
      await take("S2-a 적는 창 · 시트와 막", "50:103 · 50:109~111", { suffix: DEMO }, async () => {
        await page.getByRole("button", { name: "할 일 적기" }).click();
        await expect(page.getByRole("textbox", { name: "할 일 적기" })).toBeVisible();
        return page;
      });
      await take("S2-a 적는 창 · 나가기 확인", "133:2 · 147:2", { suffix: DEMO }, async () => {
        await page.getByRole("textbox", { name: "할 일 적기" }).fill("적던 글");
        await page.getByRole("form", { name: "할 일 적기" }).getByRole("button", { name: "닫기" }).click();
        await expect(page.getByRole("alertdialog")).toBeVisible();
        return page;
      });
      await take("확인 창 · 단추 초점 링(키보드 Tab)", "146:11 · 150:58", { suffix: DEMO }, async () => {
        await page.keyboard.press("Tab");
        return page;
      });
      await closeConfirm(page, "계속 적기");
      await take("머리 단추 · 초점 링(키보드 Tab)", "146:10 · 150:58", { suffix: DEMO }, async () => {
        // 적는 창 머리의 「✕」에 키보드로 초점을 둔다
        const closeBtn = page.getByRole("form", { name: "할 일 적기" }).getByRole("button", { name: "닫기" });
        await closeBtn.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        return page;
      });
      await page.getByRole("textbox", { name: "할 일 적기" }).fill("");
      await page.getByRole("form", { name: "할 일 적기" }).getByRole("button", { name: "닫기" }).click();
      await closeConfirm(page, "나가기");

      // 어제 못 끝낸 할 일 펼침(체험에 있으면) — 없으면 시험 계정 A 가짜 응답 쪽에서 찍는다
      const carry = page.getByRole("button", { name: /^어제 못 끝낸 할 일 \d+개 보기$/ });
      if (await carry.isVisible().catch(() => false)) {
        await take("S2 어제 못 끝낸 할 일 · 펼침 모두 고름", "148:108", { suffix: DEMO }, async () => {
          await carry.click();
          return page;
        });
        await take("S2 어제 못 끝낸 할 일 · 펼침 모두 풂(고른 할 일 없음)", "148:108", { suffix: DEMO }, async () => {
          const boxes = page.getByRole("checkbox");
          const n = await boxes.count();
          for (let i = 0; i < n; i++) if (await boxes.nth(i).isChecked().catch(() => false) && (await boxes.nth(i).isVisible())) await boxes.nth(i).uncheck({ force: true }).catch(() => undefined);
          return page;
        });
        await page.getByRole("button", { name: "접기" }).click().catch(() => undefined);
      } else {
        missing("S2 어제 못 끝낸 할 일 · 펼침" + DEMO, "148:108", "체험 계정에 어제 못 끝낸 할 일 줄이 없음 — 시험 계정 A(가짜 응답)로 찍음");
      }

    });

    await section(page, "B 할 일 페이지", async () => {
      const firstTodo = page.getByRole("button", { name: /^자세히 보기: / }).first();
      await expect(firstTodo).toBeVisible({ timeout: 20_000 });
      await firstTodo.click();
      const detail = page.getByRole("dialog", { name: "할 일 자세히" });
      await expect(detail).toBeVisible();
      const noteBox = page.getByRole("textbox", { name: /작업 기록/ });
      const noteCount = await page.locator("li.note-item").count();
      await take(noteCount === 0 ? "S2-b 할 일 페이지 · 작업 기록 0개" : "S2-b 할 일 페이지 · 작업 기록 있음", "51:55 · 147:58", { suffix: DEMO }, async () => page);
      await take("S2-b 할 일 페이지 · 빈 칸 「남기기」 안내", "147:58", { suffix: DEMO }, async () => {
        await page.getByRole("button", { name: "남기기", exact: true }).click();
        await expect(page.getByText("작업 기록을 적어 주세요")).toBeVisible();
        return page;
      });
      await noteBox.fill("Day 12까지 끝내기");
      await page.getByRole("button", { name: "남기기", exact: true }).click();
      await expect(page.locator("li.note-item", { hasText: "Day 12까지 끝내기" })).toBeVisible({ timeout: 10_000 });
      await take("S2-b 할 일 페이지 · 작업 기록 있음(방금 남김)", "58:92 · 147:58", { suffix: DEMO }, async () => page);
      missing("S2-b 할 일 페이지 · 남기는 중" + DEMO, "147:58", "기기 먼저 저장이라 「남기는 중」이 화면에 남지 않는다 — 개발 갤러리로 찍음");
      await take("S2-b 작업 기록 · 「지우기」 확인 창", "147:95 · 147:2", { suffix: DEMO }, async () => {
        await page.locator("li.note-item", { hasText: "Day 12까지 끝내기" }).getByRole("button", { name: /지우기/ }).click();
        await expect(page.getByRole("alertdialog")).toBeVisible();
        return page;
      });
      await closeConfirm(page, "그대로 두기");
      await take("S2-b 「⋯」 메뉴 · 막", "58:92", { suffix: DEMO }, async () => {
        await page.getByRole("button", { name: /더 보기|메뉴|⋯/ }).first().click();
        await expect(page.getByRole("menu")).toBeVisible();
        return page;
      });
      await take("S2-b 할 일 지우기 · 확인 창", "147:95 · 147:2", { suffix: DEMO }, async () => {
        await page.getByRole("menuitem", { name: /지우기/ }).first().click();
        await expect(page.getByRole("alertdialog")).toBeVisible();
        return page;
      });
      await closeConfirm(page, "그대로 두기");
      await page.keyboard.press("Escape");
      await take("S2-b′ 분야 고르기 시트", "77:18", { suffix: DEMO }, async () => {
        await page.getByRole("button", { name: /^분야/ }).first().click();
        await expect(page.getByRole("dialog", { name: /분야/ }).last()).toBeVisible();
        return page;
      });
      await page.keyboard.press("Escape");
      // 할 일 페이지에서 나온다
      await detail.getByRole("button", { name: "이전" }).click().catch(() => undefined);
      await expect(detail).toBeHidden({ timeout: 10_000 });

    });

    await section(page, "C 이번 주 목표 시트", async () => {
      await take("S2-d 이번 주 목표 시트", "50:332", { suffix: DEMO }, async () => {
        await page.getByRole("button", { name: /^이번 주 목표/ }).first().click();
        await expect(page.getByRole("dialog", { name: "이번 주 목표" })).toBeVisible();
        return page;
      });
      await take("S2-d 이번 주 목표 · 없애기 확인", "147:2", { suffix: DEMO }, async () => {
        await page.getByRole("button", { name: "목표 없애기" }).click();
        await expect(page.getByRole("alertdialog")).toBeVisible();
        return page;
      });
      await closeConfirm(page, "그대로 두기");
      await page.getByRole("dialog", { name: "이번 주 목표" }).getByRole("button", { name: "닫기" }).click();

    });

    await section(page, "D 지난 날", async () => {
      await take("S2-e 지난 날 · 할 일 있는 날", "148:56 · 148:95", { suffix: DEMO }, async () => {
        await page.getByRole("button", { name: "지난 날 보기" }).click();
        await expect(page.getByRole("dialog", { name: "지난 날" })).toBeVisible();
        return page;
      });
      await take("S2-e 지난 날 · 빈 날", "148:95", { suffix: DEMO }, async () => {
        const past = page.getByRole("dialog", { name: "지난 날" });
        for (let i = 0; i < 25; i++) {
          if (await past.getByText("할 일 0개").isVisible().catch(() => false)) return page;
          await past.getByRole("button", { name: "이전 날" }).click();
        }
        throw new Error("25일 거슬러 가도 할 일 0개인 날이 없음");
      });
      await page.getByRole("dialog", { name: "지난 날" }).getByRole("button", { name: "이전" }).click();

    });

    await section(page, "E 타이머", async () => {
      await tab(page, "타이머");
      await expect(page.getByRole("heading", { name: "무엇을 할까요?" })).toBeVisible({ timeout: 20_000 });
      await take("S4 타이머 · 고르기(안 고름)", "50:390", { suffix: DEMO }, async () => {
        await page.getByRole("radio", { name: /기타|고르지/ }).first().check().catch(() => undefined);
        return page;
      });
      await take("S4 타이머 · 고르기(둥근 단추 고름)", "50:390", { suffix: DEMO }, async () => {
        const radios = page.getByRole("radio");
        await radios.nth(Math.min(1, (await radios.count()) - 1)).check({ force: true });
        return page;
      });
      await page.getByRole("button", { name: /^\d+분 시작$/ }).click();
      await expect(page.getByRole("button", { name: "끝내기" })).toBeVisible({ timeout: 20_000 });
      await take("S4 타이머 · 도는 중", "50:440", { suffix: DEMO }, async () => page);
      await page.waitForTimeout(65_000);
      await page.getByRole("button", { name: "끝내기" }).click();
      await expect(page.getByRole("button", { name: "끝내기" })).toBeHidden({ timeout: 20_000 });
      await tab(page, "할 일");

    });

    await section(page, "F 오늘 기록", async () => {
      const dialog = page.getByRole("dialog", { name: "오늘 기록" });
      await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
      await expect(dialog.getByRole("button", { name: "분야마다 나누기" })).toBeVisible({ timeout: 20_000 });
      await take("S5-1 시간 단계", "49:5", { suffix: DEMO }, async () => page);
      await take("S5-1 오늘 할 일 시트", "88:12", { suffix: DEMO }, async () => {
        await dialog.getByRole("button", { name: /^오늘 할 일 \d+\/\d+/ }).click();
        await expect(page.getByRole("dialog", { name: "오늘 할 일" })).toBeVisible();
        return page;
      });
      await page.getByRole("dialog", { name: "오늘 할 일" }).getByRole("button", { name: "닫기" }).click();
      await dialog.getByRole("button", { name: "분야마다 나누기" }).click();
      await expect(dialog.getByRole("heading", { name: "분야마다 나눠 주세요" })).toBeVisible();
      const group = dialog.getByRole("group", { name: "분야 · 여러 개" });
      const expand = async () => {
        const more = group.getByRole("button", { name: /^분야 \d+개 더 보기$/ });
        if (await more.isVisible().catch(() => false)) await more.click();
      };
      const pressed = () => group.getByRole("button", { name: /, 다이얼에 넣기$/, pressed: true });
      const unpressed = () => group.getByRole("button", { name: /, 다이얼에 넣기$/, pressed: false });
      await expand();
      const startPressed = await pressed().count();
      await take(`S5-2 나누기 · 타이머 분야 + 칩 하나(처음 켜진 칩 ${startPressed}개)`, "87:96 · 49:26", { suffix: DEMO, note: "d-180: 타이머 분야는 잰 시간 그대로, 나머지를 고른 칩끼리 똑같이" }, async () => page);
      // 칩 둘 · 셋 고름: 켜진 칩 수를 맞춘다
      for (const want of [2, 3]) {
        await expand();
        while ((await pressed().count()) < want && (await unpressed().count()) > 0) await unpressed().first().click();
        await take(`S5-2 나누기 · 칩 ${want === 2 ? "둘" : "셋"} 고름`, want === 2 ? "49:26" : "87:96", { suffix: DEMO, note: (await pressed().count()) === want ? undefined : `켜진 칩 ${await pressed().count()}개` }, async () => page);
      }
      await take("S5 오늘 기록 · 나가기 확인", "147:2 · 98:210", { suffix: DEMO }, async () => {
        await dialog.press("Escape");
        await expect(page.getByRole("alertdialog")).toBeVisible();
        return page;
      });
      await closeConfirm(page, "나가기");
      // 저장 뒤: 체험 데이터에 오늘 기록이 한 줄 더 쌓인다(체험은 일회용)
      await page.getByRole("button", { name: "오늘 기록 남기기" }).click();
      await take("S5-3 저장 뒤", "49:142", { suffix: DEMO }, async () => {
        await dialog.getByRole("button", { name: "나누지 않고 저장" }).click();
        await expect(dialog.getByRole("heading", { name: "저장했어요" })).toBeVisible({ timeout: 20_000 });
        return page;
      });
      await dialog.getByRole("button", { name: "이전" }).click().catch(() => undefined);

    });

    await section(page, "G 상태보기", async () => {
      await growthTab(page);
      await page.getByRole("tab", { name: "이번 주 목표" }).click();
      await take("S6 상태보기 · 이번 주 목표 뷰", "50:137", { suffix: DEMO }, async () => page);
      await page.getByRole("tab", { name: "목표 비율" }).click();
      await take("S6 상태보기 · 목표 비율 뷰", "50:193", { suffix: DEMO }, async () => page);
      await take("S6 상태보기 · 기간 칩 둘(「비교」 없음)", "50:193 · 111:79", { suffix: DEMO }, async () => {
        await page.getByRole("button", { name: /^기간, / }).click();
        await expect(page.getByRole("menuitemradio")).toHaveCount(2);
        return page;
      });
      await page.keyboard.press("Escape");

    });

    await section(page, "H 분야 페이지", async () => {
      await take("S7 분야 페이지", "50:616", { suffix: DEMO }, async () => {
        await page.locator(".growth-item > button").first().click();
        await expect(page.getByRole("dialog").getByText(/^총 /).first()).toBeVisible({ timeout: 20_000 });
        return page;
      });
      await page.getByRole("dialog").getByRole("button", { name: "이전" }).click();
      await take("S7 분야 페이지 · 기타", "121:468", { suffix: DEMO }, async () => {
        await page.locator(".growth-item > button", { hasText: "기타" }).first().click();
        await expect(page.getByRole("dialog").getByText(/^총 /).first()).toBeVisible({ timeout: 20_000 });
        return page;
      });
      await page.getByRole("dialog").getByRole("button", { name: "이전" }).click();

    });

    await section(page, "I 내 정보", async () => {
      await tab(page, "내 정보");
      await expect(page.getByRole("heading", { name: "내 정보" })).toBeVisible({ timeout: 20_000 });
      await take("S8 내 정보 · 기본(로그아웃 카드가 탭에 안 가림)", "50:641 · 147:142", { suffix: DEMO }, async () => {
        await page.locator("#me-logout-button").scrollIntoViewIfNeeded();
        return page;
      });
      missing("S8 내 정보 · 로그아웃 확인" + DEMO, "147:2", "체험 계정은 연결된 채라 보낼 줄이 없어 확인 창이 안 뜸(누르면 바로 로그아웃) — 시험 계정 A로 찍음");
      await take("S8-a 목표 비율", "81:380", { suffix: DEMO }, async () => {
        await page.getByRole("button", { name: /목표 비율/ }).first().click();
        await expect(page.getByRole("dialog", { name: "목표 비율" })).toBeVisible();
        return page;
      });
      await take("S8-a 목표 비율 · 나가기 확인", "121:389 · 147:2", { suffix: DEMO }, async () => {
        const r = page.getByRole("dialog", { name: "목표 비율" });
        await r.getByRole("button", { name: "균등 배분" }).click();
        await r.getByRole("button", { name: "이전" }).click();
        await expect(page.getByRole("alertdialog")).toBeVisible();
        return page;
      });
      await closeConfirm(page, "나가기");
      await page.getByRole("dialog", { name: "목표 비율" }).isVisible().then(async (v) => v && (await page.getByRole("dialog", { name: "목표 비율" }).getByRole("button", { name: "이전" }).click().catch(() => undefined)));
      await take("S8-b 목표", "102:314", { suffix: DEMO }, async () => {
        await page.getByRole("button", { name: /^목표,/ }).first().click();
        await expect(page.getByRole("dialog", { name: "목표" })).toBeVisible();
        return page;
      });
      await take("S8-b 목표 · 나가기 확인", "121:449 · 147:2", { suffix: DEMO }, async () => {
        const g = page.getByRole("dialog", { name: "목표" });
        await g.getByRole("textbox").fill("글 한 편 끝내고 토익 800점 넘기기 (바꿈)");
        await g.getByRole("button", { name: "이전" }).click();
        await expect(page.getByRole("alertdialog")).toBeVisible();
        return page;
      });
      await closeConfirm(page, "나가기");
    });

  } finally {
    await context.close();
  }
});

// ============================================================ 시험 계정 A (진짜 로그인 + 가짜 응답)
test("시험 계정 A: 빈 목록 · 어제 못 끝낸 펼침 · 빈 상태 · 긴 분야 이름 · 로그아웃 확인 · 처음 설정", async ({ browser }) => {
  test.setTimeout(300_000);
  let s = await openA(browser);
  const before = await ids(s.client, "todos");
  const fresh = async (fake?: (snap: MirrorSnapshot) => MirrorSnapshot) => {
    await s.page.waitForLoadState("networkidle").catch(() => undefined);
    await s.context.close();
    s = await openA(browser, fake);
    await openHome(s);
    return s.page;
  };
  try {
    // 빈 목록: 오늘 할 일 0개(가짜 응답)
    let page = await fresh((snap) => ({ ...snap, todos: [] }));
    await take("S2 할 일 · 빈 목록", "50:28", { suffix: " (시험 계정 A·가짜 응답)", fake: false }, async () => page);

    // 어제 못 끝낸 할 일: 어제 줄 셋(못 끝냄) — 펼침 모두 고름 · 모두 풂
    page = await fresh((snap) => {
      const now = new Date(snap.serverNow);
      const yesterday = addDays(todoDayFor(now), -1);
      const cat = snap.categories?.find((c) => c.readable)?.id ?? null;
      const mk = (i: number, text: string, categoryId: string | null) => ({ id: `00000000-0000-4000-8000-00000000f1${i}0`, day: yesterday, text, done: false, createdAt: new Date(now.getTime() - 86_400_000).toISOString(), categoryId, position: i, hasNotes: false });
      return { ...snap, todos: [mk(1, "토익 단어 50개", cat), mk(2, "글 한 편 초고 쓰기", cat), mk(3, "빨래", null)] };
    });
    const carry = page.getByRole("button", { name: /^어제 못 끝낸 할 일 \d+개 보기$/ });
    await take("S2 어제 못 끝낸 할 일 · 펼침 모두 고름", "148:108", { suffix: " (시험 계정 A·가짜 응답)" }, async () => {
      await carry.click();
      return page;
    });
    await take("S2 어제 못 끝낸 할 일 · 펼침 모두 풂(고른 할 일 없음)", "148:108", { suffix: " (시험 계정 A·가짜 응답)" }, async () => {
      const boxes = page.getByRole("checkbox");
      for (let i = 0; i < (await boxes.count()); i++) if (await boxes.nth(i).isChecked()) await boxes.nth(i).uncheck({ force: true });
      await expect(page.getByText("고른 할 일 없음")).toBeVisible();
      return page;
    });

    // 상태보기 빈 상태 · 「오늘 기록」 단추
    page = await fresh((snap) => ({ ...snap, logs: [], sessions: [], goal: null }));
    await take("S6 상태보기 · 빈 상태(「오늘 기록」 단추)", "50:598", { suffix: " (시험 계정 A·가짜 응답)" }, async () => {
      await growthTab(page);
      await expect(page.getByRole("button", { name: "오늘 기록" })).toBeVisible();
      return page;
    });

    // S8-a 분야 이름 긴 줄 말줄임
    page = await fresh((snap) => ({ ...snap, categories: (snap.categories ?? []).map((c, i) => (c.readable && i < 3 ? { ...c, name: `아주 긴 분야 이름을 열두 글자 넘게 적은 분야 ${i + 1}` } : c)) }));
    await take("S8-a 목표 비율 · 분야 이름 긴 줄 말줄임", "49:248~49:287 · 81:380", { suffix: " (시험 계정 A·가짜 응답)" }, async () => {
      await tab(page, "내 정보");
      await page.getByRole("button", { name: /목표 비율/ }).first().click();
      await expect(page.getByRole("dialog", { name: "목표 비율" })).toBeVisible();
      return page;
    });

    // 로그아웃 확인 창: 이 글을 담은 서버 요청만 막아 줄을 기기에 남긴다(연결은 그대로)
    page = await fresh();
    const marker = `사진-${Date.now().toString(36)}`;
    await page.route("**/*", (route) => {
      const req = route.request();
      if (req.method() === "POST" && (req.postData() ?? "").includes(marker)) return route.abort();
      return route.continue();
    });
    await page.getByRole("button", { name: "할 일 적기" }).click();
    await page.getByRole("textbox", { name: "할 일 적기" }).fill(`${marker} 못 보낸 글`);
    await page.getByRole("button", { name: "적기", exact: true }).click();
    await page.getByRole("form", { name: "할 일 적기" }).getByRole("button", { name: "닫기" }).click();
    await take("S8 내 정보 · 로그아웃 확인", "147:2 · 147:142", { suffix: " (시험 계정 A)", note: "보낼 줄이 있는 채(그 글의 서버 요청만 막음)" }, async () => {
      await tab(page, "내 정보");
      await page.locator("#me-logout-button").click();
      await expect(page.getByRole("alertdialog", { name: "로그아웃할까요?" })).toBeVisible({ timeout: 15_000 });
      return page;
    });
    await page.getByRole("alertdialog").getByRole("button", { name: "계속 쓰기" }).click();
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // 처음 설정 1~4(가짜 응답)
    page = await (async () => {
      await s.page.waitForLoadState("networkidle").catch(() => undefined);
      await s.context.close();
      s = await openA(browser, (snap) => ({ ...snap, settings: snap.settings ? { ...snap.settings, onboardingDone: false, goal: null } : snap.settings }));
      await s.page.goto("/");
      return s.page;
    })();
    await expect(page.getByRole("heading", { name: "목표" })).toBeVisible({ timeout: 30_000 });
    const onboarding: [string, string][] = [
      ["처음 설정 1 목표", "49:178"],
      ["처음 설정 2 분야", "49:194"],
      ["처음 설정 3 목표 비율", "49:232"],
      ["처음 설정 4 알림", "50:4"],
    ];
    for (const [i, [name, node]] of onboarding.entries()) {
      await take(name, node, { suffix: " (시험 계정 A·가짜 응답)" }, async () => {
        if (i === 0) await page.getByRole("textbox").first().fill("글 한 편 끝내고 토익 800점 넘기기");
        return page;
      });
      if (i < 3) await page.getByRole("button", { name: "다음" }).click().catch(() => undefined);
    }
  } finally {
    await s.context.close();
    forgetSession(); // 로그아웃을 누르지는 않았지만 다음 시험이 깨끗한 로그인으로 시작하게
    const c = await openA(browser);
    const now = await ids(c.client, "todos");
    await removeTodos(c.client, [...now].filter((id) => !before.has(id)));
    await c.context.close();
  }
});

// ============================================================ 시험 계정 A: 체험에서 빠진 셋(분야 페이지 · 기타 · 지난 날 빈 날)
test("시험 계정 A: S7 분야 페이지 · 기타 · S2-e 빈 날", async ({ browser }) => {
  test.setTimeout(180_000);
  let s = await openA(browser);
  try {
    await openHome(s);
    let page = s.page;
    await growthTab(page);
    await page.getByRole("tab", { name: "목표 비율" }).click();
    await take("S7 분야 페이지", "50:616", { suffix: " (시험 계정 A)" }, async () => {
      await page.locator(".growth-item > button").first().click();
      await expect(page.getByRole("dialog").getByText(/^총 /).first()).toBeVisible({ timeout: 20_000 });
      return page;
    });
    await page.getByRole("dialog").getByRole("button", { name: "이전" }).click();
    await take("S7 분야 페이지 · 기타", "121:468", { suffix: " (시험 계정 A)" }, async () => {
      await page.locator(".growth-item > button", { hasText: "기타" }).first().click();
      await expect(page.getByRole("dialog").getByText(/^총 /).first()).toBeVisible({ timeout: 20_000 });
      return page;
    });
    await s.context.close();
    // 빈 날: 오늘 앞의 할 일을 가짜 응답에서 뺀다(어제가 「할 일 0개」)
    s = await openA(browser, (snap) => {
      const today = todoDayFor(new Date(snap.serverNow));
      return { ...snap, todos: (snap.todos ?? []).filter((t) => t.day >= today) };
    });
    await openHome(s);
    page = s.page;
    await take("S2-e 지난 날 · 빈 날", "148:95", { suffix: " (시험 계정 A·가짜 응답)" }, async () => {
      await page.getByRole("button", { name: "지난 날 보기" }).click();
      await expect(page.getByRole("dialog", { name: "지난 날" }).getByText("할 일 0개")).toBeVisible();
      return page;
    });
  } finally {
    await s.context.close();
  }
});

// ============================================================ PWA
test("PWA: manifest 응답 · 아이콘 셋 · offline.html", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: PHOTO_SCALE });
  const page = await context.newPage();
  try {
    const res = await page.request.get("/manifest.webmanifest");
    const manifest = (await res.json()) as { name?: string; short_name?: string; icons?: { src: string; sizes: string; purpose?: string }[]; background_color?: string; theme_color?: string; display?: string; start_url?: string };
    const summary = {
      status: res.status(),
      contentType: res.headers()["content-type"],
      name: manifest.name,
      short_name: manifest.short_name,
      background_color: manifest.background_color,
      theme_color: manifest.theme_color,
      display: manifest.display,
      start_url: manifest.start_url,
      icons: (manifest.icons ?? []).map((i) => `${i.src} ${i.sizes}${i.purpose ? ` ${i.purpose}` : ""}`),
    };
    mkdirSync("test-results/release", { recursive: true });
    writeFileSync("test-results/release/pwa-manifest.json", JSON.stringify(summary, null, 2), "utf8");
    // 찍기 쉽도록 아이콘 셋과 offline.html을 한 장씩
    for (const [name, src, node] of [
      ["PWA 아이콘 192", "/icon-v2-192.png", "149:96"],
      ["PWA 아이콘 512", "/icon-v2-512.png", "149:87"],
      ["PWA 아이콘 maskable 512", "/icon-v2-maskable-512.png", "149:91"],
      ["PWA offline.html", "/offline.html", "149:105"],
    ] as const) {
      await take(name, node, {}, async () => {
        await page.goto(`${baseURL}${src}`);
        return page;
      });
    }
    expect(summary.name).toBe("두노");
    expect(summary.short_name).toBe("두노");
  } finally {
    await context.close();
  }
});

// 사진 폴더 알림(로그)
test.afterAll(() => {
  console.log(`사진 폴더: ${PHOTO_DIR} · 배율 ${PHOTO_SCALE}`);
});

