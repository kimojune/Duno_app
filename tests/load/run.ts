import fs from "node:fs";
import path from "node:path";

/**
 * 체험 코드 부하 시험(22 팀장 지시 · PM d-229 가 · d-230 가). 실행: npm run load -- --target <주소> [--stages 5,15,30,50] [--build <판 해시>] --yes
 * - 이 파일은 시험 묶음에 끼지 않는다(*.spec.ts · *.test.ts 꼴이 아니고, vitest는 tests/unit, playwright는 tests/e2e·tests/screens·tests/release만 본다).
 * - --yes 가 없으면 계획(대상 · 단계 · 합 · 시작 시각)만 찍고 끝낸다. 그때는 브라우저도 네트워크도 쓰지 않는다.
 * - 대상은 운영 주소와 http://localhost:<포트> 만 받는다. 단계 문맥 수 합이 100(--max-total)을 넘으면 시작 전에 거절한다.
 * - 체험 코드는 .env.local의 DEMO_ACCESS_CODE를 실행 때 읽는다. 값은 결과·요약·콘솔 어디에도 쓰지 않는다(쓰기 전에 모두 redact).
 * - 재시도 없음. 문맥마다 총 시간 상한(CONTEXT_TIMEOUT_MS). 단계에서 실패가 10%보다 많거나 한도 초과 신호가 하나라도 보이면 멈춘다.
 * - Playwright trace · video · screenshot 을 쓰지 않는다. 결과는 test-results/load/(git 무시)에만 쓴다.
 * 순수 부분(주소 · 단계 · 통계 · 멈춤 · 가리기)은 tests/load/pure.ts, 단위 시험은 tests/unit/load-pure.test.ts.
 */

const P: typeof import("./pure") = await import(new URL("./pure.ts", import.meta.url).href);

const OUT_DIR = "test-results/load";

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

function readCode(): string {
  try {
    return P.readEnvValue(fs.readFileSync(".env.local", "utf8"), P.CODE_ENV_NAME);
  } catch {
    return "";
  }
}

type ContextOutcome = ContextResultWithStatuses;
type ContextResultWithStatuses = import("./pure").ContextResult & { statuses: { status: number; url: string }[] };

async function runContext(
  browser: import("@playwright/test").Browser,
  target: string,
  code: string,
): Promise<ContextOutcome> {
  const statuses: { status: number; url: string }[] = [];
  let limitHit = false;
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } }); // trace · video · screenshot 없음
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), P.CONTEXT_TIMEOUT_MS);
  });
  const work = (async (): Promise<ContextOutcome> => {
    const page = await context.newPage();
    page.on("response", (res) => {
      const status = res.status();
      if (P.isErrorStatus(status)) statuses.push({ status, url: res.url() }); // 쿼리 문자열·본문은 남기지 않는다(세는 쪽이 호스트+경로만 쓴다)
      if (P.isLimitStatus(status)) limitHit = true;
    });
    await page.goto(target + "/", { timeout: 30_000 });
    await page.locator("input.demo-input").fill(code, { timeout: 30_000 });
    const clickedAt = Date.now();
    await page.locator("button.demo-start").click({ timeout: 30_000 });
    const todoTab = page.getByRole("button", { name: "할 일 적기" });
    const alert = page.getByRole("alert");
    const which = await Promise.race([
      todoTab.waitFor({ timeout: 60_000 }).then(() => "ok" as const),
      alert.first().waitFor({ timeout: 60_000 }).then(() => "alert" as const),
    ]);
    if (which === "ok") return { ok: true, enterMs: Date.now() - clickedAt, failKind: null, limitHit, statuses };
    const text = (await alert.first().innerText().catch(() => "")) ?? "";
    if (P.isLimitText(text)) limitHit = true;
    return { ok: false, enterMs: null, failKind: "screen_error", limitHit, statuses };
  })();
  work.catch(() => undefined); // 시간 초과로 문맥을 닫은 뒤 늦게 나는 오류가 처리 안 된 거절이 되지 않게
  try {
    const r = await Promise.race([work, deadline]);
    if (r === "timeout") return { ok: false, enterMs: null, failKind: "timeout", limitHit, statuses };
    return r;
  } catch (e) {
    const name = (e as Error)?.name ?? "";
    const msg = String((e as Error)?.message ?? "");
    const timedOut = name === "TimeoutError" || /timeout/i.test(msg.split("\n")[0] ?? "");
    const failKind: import("./pure").FailKind = statuses.length > 0 ? "http_status" : timedOut ? "timeout" : "other";
    return { ok: false, enterMs: null, failKind, limitHit, statuses };
  } finally {
    await context.close().catch(() => undefined);
    clearTimeout(timer);
  }
}

async function main() {
  const parsed = P.parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`거절: ${parsed.reason}`);
    process.exit(2);
  }
  const a = parsed.args;
  const startPlan = new Date();
  const code = readCode();
  const lines = [
    "=== 체험 코드 부하 시험 계획 ===",
    `대상: ${a.target}`,
    `단계: ${a.stages.join(" + ")}`,
    `합: ${a.total} (상한 ${a.maxTotal})`,
    `시작 시각(UTC): ${startPlan.toISOString()}`,
    `판 해시: ${a.build === "" ? "(없음)" : a.build}`,
    `문맥 시간 상한: ${P.CONTEXT_TIMEOUT_MS / 1000}초 · 재시도 없음 · trace/video/사진 없음`,
    `체험 코드 변수 ${P.CODE_ENV_NAME}: ${code === "" ? "비었음(값을 못 읽음)" : "있음(값은 출력하지 않음)"}`,
  ];
  if (!a.yes) {
    console.log(lines.join("\n"));
    console.log("\n--yes 가 없어 여기서 끝냅니다(아무것도 보내지 않음).");
    return;
  }
  if (code.length < 4) {
    console.error(`거절: .env.local의 ${P.CODE_ENV_NAME} 값이 비었거나 너무 짧아요(이름만 말함, 값은 출력하지 않음).`);
    process.exit(2);
  }
  const safe = (s: string) => P.redact(s, code);
  console.log(safe(lines.join("\n")));

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ channel: "chrome" }); // 이 컴퓨터의 Chrome. 내려받지 않음
  const runStart = new Date();
  const stageReports: Record<string, unknown>[] = [];
  let stoppedReason: string | null = null;
  try {
    for (let i = 0; i < a.stages.length; i++) {
      const size = a.stages[i];
      const startedAt = new Date();
      console.log(`단계 ${i + 1}/${a.stages.length}: 문맥 ${size}개 시작 ${startedAt.toISOString()}`);
      const outcomes = await Promise.all(Array.from({ length: size }, () => runContext(browser, a.target, code)));
      const endedAt = new Date();
      const summary = P.summarizeStage(outcomes);
      const statusCounts = P.countStatuses(outcomes.flatMap((o) => o.statuses));
      const limitHits = outcomes.filter((o) => o.limitHit).length;
      const stop = P.decideStop(outcomes);
      stageReports.push({
        stage: i + 1,
        startedAtUtc: startedAt.toISOString(),
        endedAtUtc: endedAt.toISOString(),
        ...summary,
        limitHits,
        statusCounts,
        stop: stop.stop,
        stopReason: stop.reason,
      });
      console.log(safe(`  성공 ${summary.ok} · 실패 ${summary.failed} · 들어가기 가운데값 ${summary.enterMedianMs ?? "-"}ms · 95% ${summary.enterP95Ms ?? "-"}ms`));
      if (stop.stop) {
        stoppedReason = stop.reason;
        console.log(safe(`멈춤: ${stop.reason}`));
        break;
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  const runEnd = new Date();

  const report = {
    target: a.target,
    build: a.build === "" ? null : a.build,
    stagesPlanned: a.stages,
    totalPlanned: a.total,
    startedAtUtc: runStart.toISOString(),
    endedAtUtc: runEnd.toISOString(),
    contextTimeoutMs: P.CONTEXT_TIMEOUT_MS,
    stoppedReason,
    stagesRun: stageReports.length,
    stages: stageReports,
  };
  const json = safe(JSON.stringify(report, null, 2));
  const md = safe(renderMd(report as unknown as Report));
  if (json.includes(code) || md.includes(code)) throw new Error("결과에 코드 값이 남아 쓰지 않았어요."); // 마지막 안전장치
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, `load-${stamp(runStart)}`);
  fs.writeFileSync(`${base}.json`, json);
  fs.writeFileSync(`${base}.md`, md);
  console.log(`결과: ${base}.json · ${base}.md`);
}

type Report = {
  target: string;
  build: string | null;
  stagesPlanned: number[];
  startedAtUtc: string;
  endedAtUtc: string;
  contextTimeoutMs: number;
  stoppedReason: string | null;
  stages: (import("./pure").StageSummary & {
    stage: number;
    startedAtUtc: string;
    endedAtUtc: string;
    limitHits: number;
    statusCounts: Record<string, number>;
  })[];
};

function renderMd(r: Report): string {
  const out: string[] = [];
  out.push("# 체험 코드 부하 시험 결과", "");
  out.push(`- 대상: ${r.target}`);
  out.push(`- 판 해시: ${r.build ?? "(안 넘김)"}`);
  out.push(`- 단계 계획: ${r.stagesPlanned.join(" + ")}`);
  out.push(`- 시작·끝(UTC): ${r.startedAtUtc} ~ ${r.endedAtUtc}`);
  out.push(`- 문맥 시간 상한: ${r.contextTimeoutMs / 1000}초 · 재시도 없음`);
  out.push(`- 멈춤: ${r.stoppedReason ?? "없음(모든 단계 끝)"}`, "");
  for (const s of r.stages) {
    out.push(`## 단계 ${s.stage} (문맥 ${s.size}개)`);
    out.push(`- 시각(UTC): ${s.startedAtUtc} ~ ${s.endedAtUtc}`);
    out.push(`- 성공 ${s.ok} · 실패 ${s.failed}`);
    out.push(`- 실패 종류: 화면 오류 글 ${s.failKinds.screen_error} · 응답 코드 ${s.failKinds.http_status} · 시간 초과 ${s.failKinds.timeout} · 그 밖 ${s.failKinds.other}`);
    out.push(`- 들어가기까지(성공만): 가운데값 ${s.enterMedianMs ?? "-"}ms · 95% ${s.enterP95Ms ?? "-"}ms`);
    out.push(`- 한도 초과 신호 문맥 수: ${s.limitHits}`);
    const keys = Object.keys(s.statusCounts);
    out.push(keys.length === 0 ? "- 4xx·5xx 응답: 없음" : "- 4xx·5xx 응답(호스트+경로 · 횟수):");
    for (const k of keys) out.push(`  - ${k} × ${s.statusCounts[k]}`);
    out.push("");
  }
  out.push("정리 SQL 범위: 첫 단계 시작 ~ 마지막 단계 끝(UTC)에 앞뒤 1분을 더한다(docs/oneshot-v2/부하시험-정리.sql).");
  return out.join("\n") + "\n";
}

main().catch((e) => {
  // 오류 글에도 값이 섞일 수 있어(Playwright 호출 기록) 코드를 읽어 가린 뒤 첫 줄만 낸다
  const code = readCode();
  console.error(P.oneLine(P.redact(String((e as Error)?.message ?? e), code)));
  process.exit(1);
});
