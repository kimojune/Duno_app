import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { expect, test } from "@playwright/test";
import { pollUntil } from "./helpers";

/**
 * 시연 체험 코드(PM d-162 가) — 진짜 Supabase(익명 로그인 켜짐)와 DEMO_ACCESS_CODE가 있는 빌드에 대고 본다.
 * **합칠 때 돌림**: 이 시험은 .env.local(또는 환경)에 DEMO_ACCESS_CODE가 있어야 돈다. 없으면 건너뛰지 않고 「DEMO_ACCESS_CODE 없음」으로 실패한다.
 * Supabase가 익명 로그인을 꺼 두었거나 CAPTCHA를 켜 두면 「체험을 시작하지 못했어요」가 떠서 첫 시험이 실패한다(서버 로그 [demo] sign_in_failed code=…).
 * 돌릴 때마다 익명 사용자가 하나 생긴다(정리 SQL은 docs/oneshot-v2/시연-체험코드.md).
 * 코드 값은 칸에 넣기만 하고 찍지 않는다.
 */

const PORT = Number(process.env.E2E_PORT || "3100");
const DEMO_TODO = /토익|영어 단어|섀도잉|오픽|회고|표지|케이스 스터디|자기소개|기출|오답 노트|데이터베이스|요약 노트|헬스장|걷기|스트레칭|러닝|은행 서류|방 정리|장보기/;

function demoCode(): string {
  const file = path.resolve(__dirname, "../../.env.local");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const value = (fromFile.DEMO_ACCESS_CODE ?? process.env.DEMO_ACCESS_CODE)?.trim();
  if (!value) throw new Error("DEMO_ACCESS_CODE 없음 — 합칠 때 .env.local에 넣고 돌린다");
  return value;
}

test.describe("체험 코드로 시작", () => {
  test("맞는 코드 → 처음 설정 없이 할 일 탭에 예시 할 일 · 상태보기에 기록", async ({ browser }) => {
    const code = demoCode();
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("textbox", { name: "체험 코드" }).fill(code.toLowerCase()); // 대문자로 바뀌어도 맞아야 한다
    await page.getByRole("button", { name: "체험 코드로 시작" }).click();

    // 할 일 탭(처음 설정 화면이 아니다)
    await expect(page.getByRole("checkbox", { name: DEMO_TODO }).first()).toBeVisible({ timeout: 30_000 });
    expect(await page.getByRole("checkbox", { name: DEMO_TODO }).count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole("textbox", { name: "체험 코드" })).toHaveCount(0);

    // 상태보기: 예시 분야 이름이 보인다(기록·목표 비율이 있다)
    await page.getByRole("navigation", { name: "화면 이동" }).getByRole("button", { name: "상태보기" }).click();
    await expect(page.getByText("어학").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("글쓰기").first()).toBeVisible();

    // 같은 세션으로 다시 열어도 그대로 들어간다(로그인 화면이 아니다)
    await page.goto("/");
    await expect(page.getByRole("checkbox", { name: DEMO_TODO }).first()).toBeVisible({ timeout: 30_000 });
    await context.close();
  });

  test("틀린 코드 → 들어가지 못한다(칸 아래 오류, 값 남음, 세션 쿠키 없음)", async ({ browser }) => {
    demoCode();
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "체험 코드" });
    await input.fill("WRONG-CODE-0000");
    await page.getByRole("button", { name: "체험 코드로 시작" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "코드가 맞지 않아요" })).toBeVisible({ timeout: 10_000 });
    await expect(input).toHaveValue("WRONG-CODE-0000");
    await expect(input).toBeFocused();
    await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible();
    const cookies = await context.cookies();
    expect(cookies.filter((c) => c.name.startsWith("sb-")).length).toBe(0);
    await context.close();
  });

  test("코드 환경 변수를 비운 서버 → 체험 칸이 없다", async ({ browser }) => {
    // 같은 빌드(.next)를 다른 포트에 DEMO_ACCESS_CODE="" 로 띄운다. 프로세스 환경 값이 .env.local보다 앞선다(Next env 로더).
    const port = PORT + 7;
    let server: ChildProcess | null = null;
    try {
      server = spawn("npx", ["next", "start", "-H", "localhost", "-p", String(port)], {
        env: { ...process.env, DEMO_ACCESS_CODE: "" },
        shell: process.platform === "win32",
        stdio: "ignore",
      });
      const waited = await pollUntil(async () => {
        try {
          return (await fetch(`http://localhost:${port}/`)).ok;
        } catch {
          return false;
        }
      }, 60_000, 500);
      expect(waited, "끈 서버가 떴다").toBeGreaterThanOrEqual(0);
      const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
      const page = await context.newPage();
      await page.goto(`http://localhost:${port}/`);
      await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "체험 코드" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "체험 코드로 시작" })).toHaveCount(0);
      await context.close();
    } finally {
      if (server?.pid) {
        if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
        else server.kill();
      }
    }
  });
});
