import type { MetadataRoute } from "next";
import { BACKGROUND_COLOR, THEME_COLOR } from "../lib/design-tokens";

// 이름 「두노」(PM d-179)·아이콘(23이 내보낸 v2, Figma 149:87 · 149:91 · 149:96). 색은 lib/design-tokens.ts 한 출처에서 가져온다.
// 아이콘 이름에 v2를 둔 까닭: 서비스 워커가 옛 이름(icon-192.png 등)을 캐시해 두었다. 옛 파일은 이미 설치된 앱을 위해 public/에 남긴다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "두노",
    short_name: "두노",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icon-v2-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-v2-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-v2-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
