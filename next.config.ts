import type { NextConfig } from "next";

// 개발 서버(next dev)일 때만 개발용 경로를 연다. 값이 비었거나 표준이 아니면 닫힌 쪽으로 간다.
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false, // 스크린샷에 개발용 N 표시가 찍히지 않게
  // 스크린샷용 개발 서버(npm run screens)는 다른 개발 서버와 같은 폴더를 쓰지 않게 따로 둔다.
  distDir: process.env.DUNO_DIST_DIR || ".next",
  // 개발용 화면(상태 모음·방향 B)은 page.dev.tsx 꼴 파일에만 둔다. production 빌드는 이 확장자를 길로 읽지 않아
  // 그 주소가 만들어지지 않는다(빌드 출력의 경로 목록에 없고, next start에서 404).
  pageExtensions: isDev ? ["tsx", "ts", "dev.tsx"] : ["tsx", "ts"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
