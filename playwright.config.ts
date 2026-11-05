import { defineConfig } from "@playwright/test";

// 프로덕션 빌드를 3100 포트에 띄워서 본다(next dev 아님).
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    channel: "chrome", // 이 컴퓨터에 설치된 Chrome. 브라우저는 내려받지 않는다.
  },
  webServer: {
    command: "npx next build && npx next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
