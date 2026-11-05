import path from "node:path";
import { defineConfig } from "vitest/config";

// duno_dev에 대고 도는 통합 시험. npm test(단위 시험)와 따로 돈다: npm run test:rls
export default defineConfig({
  resolve: {
    // 서버 전용 모듈(import "server-only")을 시험에서 불러오려고, React 서버 조건과 같은 빈 모듈로 바꾼다.
    alias: { "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js") },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
