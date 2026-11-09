import { defineConfig } from "@playwright/test";

// 스크린샷 전용 설정. 개발용 경로(상태 모음·B 화면)는 개발 서버에만 있어서 next dev를 띄운다.
// 같은 작업 폴더의 운영 서버(next start, 기본 .next · 3200)를 덮지 않게(K2 사고 21:32 뒤 막음, playwright.release.config.ts와 같은 방식):
//   - SCREENS_DIST_DIR(기본 .next가 아닌 다른 빌드 폴더)를 꼭 받는다. 없거나 .next이거나 .next/ 아래면 서버를 띄우기 전에 throw.
//   - SCREENS_PORT를 꼭 받는다. 없거나 3200(기본 서버)·3100(e2e)이면 throw. 작업 폴더마다 3300~3399에서 하나씩 쓴다.
// 실행: SCREENS_PORT=3301 SCREENS_DIST_DIR=node_modules/.cache/<작업폴더이름>-screens npm run screens
// 기본 e2e(playwright.config.ts, production 빌드 3100 포트)와 따로 돈다. 개발 서버가 다른 개발 서버와 부딪히지 않게 산출물 폴더를 따로 둔다(DUNO_DIST_DIR).
// 서버는 루프백(localhost)에서만 듣는다(MO-17 ②). url·baseURL도 같은 이름 localhost라 실제로 붙은 주소([::1] 또는 127.0.0.1)에 닿는다.
const PORT = (process.env.SCREENS_PORT ?? "").trim();
const DIST = (process.env.SCREENS_DIST_DIR ?? "").split("\\").join("/").replace(/^\.\//, "").replace(/\/+$/, "");
if (DIST === "" || DIST === ".next" || DIST.startsWith(".next/")) {
  throw new Error("playwright.screens.config.ts: SCREENS_DIST_DIR(기본 .next가 아닌 다른 빌드 폴더, 예 node_modules/.cache/<작업폴더이름>-screens)를 주고 돌린다");
}
if (PORT === "" || PORT === "3200" || PORT === "3100") {
  throw new Error("playwright.screens.config.ts: SCREENS_PORT(3300~3399 중 하나)를 주고 돌린다. 3200(기본 서버)·3100(e2e)은 쓰지 않는다");
}

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
    env: { DUNO_DIST_DIR: DIST }, // 운영 서버가 .next를 쓰는 동안 다른 곳에 짓는다(위에서 .next를 막았다)
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
