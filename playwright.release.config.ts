import { defineConfig } from "@playwright/test";

// 발표판 검수(K2, PM d-153): 진짜 로그인 앱(운영 빌드)의 화면 사진(tests/release/photos.spec.ts)과 사용자 시나리오(tests/release/scenarios.spec.ts).
// 시험 계정 A의 데이터를 쓰고 바꾸므로(할 일·목표·오늘 기록) 기본 e2e(npm run e2e)와 따로 돈다:
//   DUNO_DIST_DIR=<다른 빌드 폴더> E2E_PORT=<포트> npx playwright test --config playwright.release.config.ts
// 사진은 SAVE_PHOTOS=1일 때만 docs/oneshot-v2/발표판-화면/에 쓰고, 기본은 test-results/photos/발표판-화면/(git이 무시).
// 서버는 루프백(localhost)에서만 듣는다(MO-17 ②).
const PORT = process.env.E2E_PORT || "3100";

export default defineConfig({
  testDir: "tests/release",
  outputDir: "test-results/artifacts-release",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    actionTimeout: 10_000, // 없는 요소를 누르려다 시험 한도(120초)까지 멈추지 않게 짧게
  },
  webServer: {
    command: `npx next build && npx next start -H localhost -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
