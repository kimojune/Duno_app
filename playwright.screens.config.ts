import { defineConfig } from "@playwright/test";

// 스크린샷 전용 설정. 개발용 경로(상태 모음·B 화면)는 개발 서버에만 있어서 next dev를 3200 포트에 띄운다.
// 환경 변수 SCREENS_PORT가 있으면 그 포트를 쓴다(작업 폴더 여러 곳이 동시에 돌 때 포트가 부딪히지 않게).
// 기본 e2e(playwright.config.ts, production 빌드 3100 포트)와 따로 돈다: npm run screens
// 개발 서버가 같은 폴더를 쓰는 다른 개발 서버와 부딪히지 않게 산출물 폴더를 따로 둔다(DUNO_DIST_DIR).
// 서버는 루프백(localhost)에서만 듣는다(MO-17 ②). url·baseURL도 같은 이름 localhost라 실제로 붙은 주소([::1] 또는 127.0.0.1)에 닿는다.
const PORT = process.env.SCREENS_PORT || "3200";

export default defineConfig({
  testDir: "tests/screens",
  outputDir: "test-results/artifacts-screens",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome", // 이 컴퓨터에 설치된 Chrome. 브라우저는 내려받지 않는다.
  },
  webServer: {
    command: `npx next dev -H localhost -p ${PORT}`,
    env: { DUNO_DIST_DIR: process.env.SCREENS_DIST_DIR || ".next/screens" }, // SCREENS_DIST_DIR가 있으면 그 폴더(운영 서버가 .next를 쓰는 동안 다른 곳에 짓게)
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
