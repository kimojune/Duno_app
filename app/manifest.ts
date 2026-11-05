import type { MetadataRoute } from "next";

// 이름·색·아이콘은 임시 값. 디자인이 정한다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "duno",
    short_name: "duno",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf7",
    theme_color: "#2f5d50",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
