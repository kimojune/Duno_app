import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { cleanupTodos } from "../integration/cleanup";
import { loadIntegrationEnv } from "../integration/load-env";
import { accountA, contextFor, markOnboardingDone, nodeClient, pollUntil, sessionCookies } from "./helpers";

/**
 * 반응 속도 재기(고침 3바퀴). 운영 빌드(next build && next start, e2e 설정과 같은 꼴)에서 Playwright로 잰다.
 * 개발 서버는 화면마다 처음에 컴파일해 느려서 쓰지 않는다.
 *
 * 잰 것(ms): 「누른 뒤 화면이 바뀌기까지」는 브라우저 안에서 performance.now()로, 단추를 누른 순간부터 화면에 그 결과가 보일 때까지(MutationObserver)다.
 * 「서버에 들어가기까지」는 Node에서 시험 계정으로 DB를 60ms마다 보다가 행이 보일 때까지다(누른 순간부터, 폴링 오차 약 ±60ms 더하기 DB 왕복).
 * 결과는 콘솔과 test-results/latency/<이름표>.json에 남는다. 이름표는 환경 변수 LATENCY_LABEL(없으면 run).
 * 저녁 기록은 쌓기만 하는 표라(지울 권한 없음) 실행마다 시험 계정 A에 행이 하나씩 남는다. 할 일은 이번 실행에서 만든 것을 지운다.
 */

const REPEATS = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? -1;
}

/** 브라우저 안에서: 단추를 누르고, 결과가 화면에 보일 때까지 걸린 ms(없으면 -1). 두 함수는 문자열로 받는다 */
async function clickUntil(page: Page, clickSrc: string, doneSrc: string, timeoutMs = 20_000): Promise<number> {
  return page.evaluate(
    ([click, done, limit]) => {
      const clickFn = new Function(`return (${click})`)() as () => void;
      const doneFn = new Function(`return (${done})`)() as () => boolean;
      return new Promise<number>((resolve) => {
        let finished = false;
        const t0 = performance.now();
        const observer = new MutationObserver(() => check());
        function finish(value: number) {
          if (finished) return;
          finished = true;
          observer.disconnect();
          resolve(value);
        }
        function check() {
          if (doneFn()) finish(performance.now() - t0);
          else if (performance.now() - t0 > (limit as number)) finish(-1);
        }
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        clickFn();
        check();
        setTimeout(() => check(), limit as number);
      });
    },
    [clickSrc, doneSrc, timeoutMs] as const,
  );
}

/** 느린 망 흉내: 이 컴퓨터는 서버가 가까워 왕복이 100ms 안쪽이라, 휴대폰의 느린 망을 CDP로 흉내 내 한 번 더 잰다 */
const SCENARIOS = [
  { name: "fast", latencyMs: 0 },
  { name: "slow", latencyMs: 300 },
] as const;

async function throttle(page: Page, latencyMs: number): Promise<void> {
  if (latencyMs <= 0) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: latencyMs,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

for (const scenario of SCENARIOS) {
test(`반응 속도(${scenario.name}): 할 일 적기·끝냄·저녁 기록 저장, 첫 화면`, async ({ browser }) => {
  test.setTimeout(300_000);
  const env = loadIntegrationEnv();
  const A = accountA(env);
  const nodeA = await nodeClient(env, A);
  await markOnboardingDone(nodeA, "A");
  const before = await nodeA.from("todos").select("id");
  const beforeIds = new Set((before.data ?? []).map((r: { id: string }) => r.id));
  // 저녁 기록 표는 지울 수 없다(쌓기만 함): 이 시험이 저장한 기록이 서버에 닿은 뒤에 끝내려고 시작 때의 행을 적어 둔다(뒤의 local-first 시험이 남의 행을 세지 않게)
  const beforeLogs = await nodeA.from("evening_logs").select("id");
  const beforeLogIds = new Set((beforeLogs.data ?? []).map((r: { id: string }) => r.id));

  const label = `${process.env.LATENCY_LABEL ?? "run"}-${scenario.name}`;
  const marker = `lat-${Date.now().toString(36)}`;
  const result: Record<string, unknown> = { label, repeats: REPEATS };
  // 느린 망 흉내는 서비스 워커를 막는다: 서비스 워커가 보내는 요청(화면 HTML)은 페이지의 CDP 느림이 닿지 않아서
  const ctx = await contextFor(browser, await sessionCookies(env, A), scenario.latencyMs > 0 ? { serviceWorkers: "block" } : {});
  try {
    // ---- 첫 화면(운영 빌드): 새 화면을 REPEATS번 연다. 첫 번째는 서버·브라우저가 데워지기 전이라 따로 적는다 ----
    const paints: { fcp: number; heading: number; list: number }[] = [];
    for (let i = 0; i < REPEATS + 1; i++) {
      const p = await ctx.newPage();
      await throttle(p, scenario.latencyMs);
      await p.addInitScript(() => {
        const marks: Record<string, number> = {};
        (window as unknown as { __marks: Record<string, number> }).__marks = marks;
        function tick() {
          const text = document.body ? document.body.innerText : "";
          if (marks.heading === undefined && /(^|\n)오늘(\n|$)/.test(text)) marks.heading = performance.now();
          if (marks.list === undefined && /\d+개 중 \d+개 끝냄/.test(text)) marks.list = performance.now();
          if (marks.list === undefined) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      await p.goto("/");
      await expect(p.getByText(/\d+개 중 \d+개 끝냄/)).toBeVisible({ timeout: 30_000 });
      const m = await p.evaluate(() => {
        const marks = (window as unknown as { __marks: Record<string, number> }).__marks;
        const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1;
        return { fcp, heading: marks.heading ?? -1, list: marks.list ?? -1 };
      });
      paints.push(m);
      await p.close();
    }
    const warm = paints.slice(1);
    result.firstPaint = {
      coldFirstVisit: paints[0],
      fcpMedian: median(warm.map((x) => x.fcp)),
      headingMedian: median(warm.map((x) => x.heading)),
      listMedian: median(warm.map((x) => x.list)),
      all: warm,
    };

    // ---- 할 일 적기·끝냄 ----
    const page = await ctx.newPage();
    await throttle(page, scenario.latencyMs);
    await page.goto("/");
    await expect(page.getByText(/\d+개 중 \d+개 끝냄/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "할 일 적기" }).click();
    const input = page.getByRole("textbox", { name: "할 일 적기" });
    await expect(input).toBeFocused();

    const addScreen: number[] = [];
    const addServer: number[] = [];
    const doneScreen: number[] = [];
    const doneServer: number[] = [];
    for (let i = 0; i < REPEATS; i++) {
      const text = `${marker} 적기 ${i}`;
      await input.fill(text);
      const tServer = Date.now();
      const screenMs = await clickUntil(
        page,
        `() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent && x.textContent.trim() === '적기'); b.click(); }`,
        `() => [...document.querySelectorAll('li.todo-row')].some((li) => li.textContent && li.textContent.includes(${JSON.stringify(text)}))`,
      );
      addScreen.push(screenMs);
      const serverMs = await pollUntil(() => countNew(i + 1));
      addServer.push(serverMs < 0 ? -1 : Date.now() - tServer);
      // 끝냄: 방금 적은 줄의 체크 칸. 줄이 「저장하는 중」을 벗어난 뒤에 누른다(옛 화면은 서버에 올라가기 전의 줄은 체크할 수 없다)
      await page.waitForFunction(() => !document.body.innerText.includes("저장하는 중"), undefined, { timeout: 30_000 });
      // 줄의 체크 칸이 화면에 있을 때까지 기다린 뒤 잰다(없는 칸을 누르다 던지는 경쟁을 막는다. 줄이 끝내 없으면 이 기다림이 시간 초과로 실패한다)
      await page.waitForFunction(
        (needle) => [...document.querySelectorAll("li.todo-row input[type=checkbox]")].some((x) => x.closest("li")?.textContent?.includes(needle)),
        text,
        { timeout: 30_000 },
      );
      const tDone = Date.now();
      const doneMs = await clickUntil(
        page,
        `() => { const cb = [...document.querySelectorAll('li.todo-row input[type=checkbox]')].find((x) => (x.getAttribute('aria-label') || '').includes(${JSON.stringify(text)}) || (x.closest('li') && x.closest('li').textContent.includes(${JSON.stringify(text)}))); cb.click(); }`,
        `() => { const cb = [...document.querySelectorAll('li.todo-row input[type=checkbox]')].find((x) => x.closest('li') && x.closest('li').textContent.includes(${JSON.stringify(text)})); return !!cb && cb.checked; }`,
      );
      doneScreen.push(doneMs);
      const doneServerMs = await pollUntil(() => countDone(i + 1));
      doneServer.push(doneServerMs < 0 ? -1 : Date.now() - tDone);
    }
    async function countNew(expected: number): Promise<boolean> {
      const all = await nodeA.from("todos").select("id");
      return (all.data ?? []).filter((r: { id: string }) => !beforeIds.has(r.id)).length >= expected;
    }
    async function countDone(expected: number): Promise<boolean> {
      const all = await nodeA.from("todos").select("id, done");
      return (all.data ?? []).filter((r: { id: string; done: boolean }) => !beforeIds.has(r.id) && r.done).length >= expected;
    }
    // 적은 직후 바로 체크: 줄이 화면에 보이자마자(서버 응답을 기다리지 않고) 끝냄 표시를 누른다. 옛 화면은 서버에 올라가기 전의 줄은 체크할 수 없다.
    // 누른 뒤 1초 안에 체크가 켜졌고, 1초 뒤에도 남는지 본다
    {
      const text = `${marker} 바로 체크`;
      await input.fill(text);
      await clickUntil(
        page,
        `() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent && x.textContent.trim() === '적기'); b.click(); }`,
        `() => [...document.querySelectorAll('li.todo-row')].some((li) => li.textContent && li.textContent.includes(${JSON.stringify(text)}))`,
      );
      const find = `[...document.querySelectorAll('li.todo-row input[type=checkbox]')].find((x) => x.closest('li') && x.closest('li').textContent.includes(${JSON.stringify(text)}))`;
      const tickMs = await clickUntil(page, `() => { const cb = ${find}; if (cb) cb.click(); }`, `() => { const cb = ${find}; return !!cb && cb.checked; }`, 1000);
      await page.waitForTimeout(1000);
      const kept = await page.evaluate(`(() => { const cb = ${find}; return !!cb && cb.checked; })()`);
      result.tickRightAfterAdd = { checkedWithin1s: tickMs >= 0, stillCheckedAfter1s: kept === true };
      await page.waitForFunction(() => !document.body.innerText.includes("저장하는 중"), undefined, { timeout: 30_000 });
    }
    result.addTodo = { screenMedian: median(addScreen), screenAll: addScreen, serverMedian: median(addServer), serverAll: addServer };
    result.doneTodo = { screenMedian: median(doneScreen), screenAll: doneScreen, serverMedian: median(doneServer), serverAll: doneServer };

    // ---- 저녁 기록 저장 ----
    await input.press("Escape");
    const eveningOpen: number[] = [];
    const eveningSave: number[] = [];
    for (let i = 0; i < 3; i++) {
      const openMs = await clickUntil(
        page,
        `() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '오늘 기록 남기기'); b.click(); }`,
        `() => { const d = document.querySelector('[role=dialog]'); return !!d && /나누지 않고 저장/.test(d.textContent || ''); }`,
      );
      eveningOpen.push(openMs);
      const saveMs = await clickUntil(
        page,
        `() => { const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent && x.textContent.trim() === '나누지 않고 저장'); b.click(); }`,
        `() => { const d = document.querySelector('[role=dialog]'); return !!d && /저장했어요/.test(d.textContent || ''); }`,
      );
      eveningSave.push(saveMs);
      await page.getByRole("dialog").getByRole("button", { name: "이전" }).click(); // 고침10 A: 오늘 기록 머리 「‹」(저장 뒤 = 닫기)
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    result.eveningOpen = { median: median(eveningOpen), all: eveningOpen };
    result.eveningSave = { median: median(eveningSave), all: eveningSave };

    // 저장한 저녁 기록 3개가 서버에 닿을 때까지 기다린다(기기 먼저 저장은 뒤에서 보낸다. 닿기 전에 창을 닫으면 다음 시험 중에 도착할 수 있다)
    const landed = await pollUntil(async () => {
      const all = await nodeA.from("evening_logs").select("id");
      return (all.data ?? []).filter((r: { id: string }) => !beforeLogIds.has(r.id)).length >= eveningSave.length;
    }, 60_000, 250);
    expect(landed, "저장한 저녁 기록이 60초 안에 서버에 닿는다").toBeGreaterThanOrEqual(0);

    fs.mkdirSync("test-results/latency", { recursive: true });
    fs.writeFileSync(`test-results/latency/${label}.json`, JSON.stringify(result, null, 2));
    console.log(`LATENCY ${label} ${JSON.stringify(result)}`);
    expect(Object.keys(result).length).toBeGreaterThan(3);
  } finally {
    await ctx.close();
    const after = await nodeA.from("todos").select("id");
    const created = (after.data ?? []).map((r: { id: string }) => r.id).filter((id) => !beforeIds.has(id));
    await cleanupTodos([{ label: "A", client: nodeA, ids: created }]);
  }
});
}
