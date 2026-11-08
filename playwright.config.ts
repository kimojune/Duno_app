import { defineConfig } from "@playwright/test";

// 프로덕션 빌드를 3100 포트에 띄워서 본다(next dev 아님). 환경 변수 E2E_PORT가 있으면 그 포트를 쓴다
// (작업 폴더 여러 곳이 동시에 돌 때 포트가 부딪히지 않게). 시험 코드(tests/e2e/pwa.spec.ts)도 같은 변수를 따른다.
// 서버는 루프백(localhost)에서만 듣는다(MO-17 ②). -H localhost는 localhost가 먼저 풀리는 주소 하나(이 컴퓨터에서는 [::1],
// 다른 곳에서는 127.0.0.1일 수 있다)에만 붙고, 아래 url·baseURL도 같은 이름 localhost라 그 주소에 닿는다
// (Chrome·Node는 localhost의 ::1·127.0.0.1을 차례로 시도한다). 시험 쿠키의 domain도 localhost다(tests/e2e/todo-flow.spec.ts).
const PORT = process.env.E2E_PORT || "3100";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome", // 이 컴퓨터에 설치된 Chrome. 브라우저는 내려받지 않는다.
  },
  webServer: {
    command: `npx next build && npx next start -H localhost -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
