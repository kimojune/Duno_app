import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 서버 전용 모듈(import "server-only")을 시험에서 불러오려고, React 서버 조건과 같은 빈 모듈로 바꾼다.
    alias: { "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js") },
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node", // jsdom은 필요한 파일 맨 위 주석으로만 켠다
  },
});
