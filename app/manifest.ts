import type { MetadataRoute } from "next";
import { BACKGROUND_COLOR, THEME_COLOR } from "../lib/design-tokens";

// 이름·아이콘은 임시 값. 디자인이 정한다. 색은 lib/design-tokens.ts 한 출처에서 가져온다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "duno",
    short_name: "duno",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
