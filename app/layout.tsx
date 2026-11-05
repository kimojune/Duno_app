import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SwRegister } from "../components/sw-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "duno",
  description: "두노",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f5d50", // 임시
  // D3: 키보드가 열리면 화면(레이아웃 뷰포트) 높이가 줄어, 아래에 붙은 입력 줄이 키보드 위로 올라온다(안드로이드 크롬).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
