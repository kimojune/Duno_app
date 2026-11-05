import { defineConfig } from "@playwright/test";

// 스크린샷 전용 설정. 개발용 경로(상태 모음·B 화면)는 개발 서버에만 있어서 next dev를 3200 포트에 띄운다.
// 기본 e2e(playwright.config.ts, production 빌드 3100 포트)와 따로 돈다: npm run screens
// 개발 서버가 같은 폴더를 쓰는 다른 개발 서버와 부딪히지 않게 산출물 폴더를 따로 둔다(DUNO_DIST_DIR).
export default defineConfig({
  testDir: "tests/screens",
  outputDir: "test-results/artifacts-screens",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3200",
    channel: "chrome", // 이 컴퓨터에 설치된 Chrome. 브라우저는 내려받지 않는다.
  },
  webServer: {
    command: "npx next dev -p 3200",
    env: { DUNO_DIST_DIR: ".next/screens" },
    url: "http://localhost:3200",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
