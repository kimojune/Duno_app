"use client";

/*
 * 할 일 · 타이머 · 내 정보 탭 아이콘의 SVG 경로는 Phosphor Icons(Regular)에서 옮겼다 — 패키지 없이 경로만(PM d-151 나).
 * 출처: https://github.com/phosphor-icons/core/blob/main/assets/regular/list-checks.svg · timer.svg · user.svg
 *
 * MIT License
 * Copyright (c) 2023 Phosphor Icons
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
 * (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import type { ReactNode } from "react";

/**
 * 아래 탭(PRD 부록 B, D-112): 상태보기 · 할 일 · 타이머 · 내 정보. 화면 이동은 같은 문서 안의 탭 바꿈이다
 * (할 일 탭의 적던 글·도는 타이머가 탭을 옮겨도 살아 있게 하려고). 지금 탭은 aria-current="page"로 알린다.
 * 누름 영역은 높이 48px 이상(--tap-min), 글자는 이름표라 어미 없이 쓴다. 새 색은 쓰지 않는다.
 *
 * 원샷 v2 고침9(A6 · 스킬 검토 O-6, PM d-150 — Figma 50:185~50:190 · 132:1215~132:1224):
 * - 켜진 탭 위 굵은 선은 없다. 켜진 탭 = 글 Bold + --color-text(아이콘도 같은 색), 꺼진 탭 = 보조색.
 * - 아이콘 24 위 + 글 12 아래. 아이콘은 장식이라 aria-hidden(탭 이름은 글 그대로).
 * - 상태보기 아이콘 = 브랜드 고리(한 조각이 나온 고리, 선 1.5 — Figma 132:1215 경로 그대로, 색은 currentColor).
 * - 할 일 ListChecks · 타이머 Timer · 내 정보 User = Phosphor Regular SVG 경로 그대로(viewBox 256, 채움 currentColor — Regular의 선 굵기는 경로에 들어 있다).
 *   패키지는 들이지 않는다(PM d-151 나, 파일 머리 MIT 고지).
 */
export type TabId = "growth" | "todo" | "timer" | "me";

export const TAB_LABELS: Record<TabId, string> = {
  growth: "상태보기",
  todo: "할 일",
  timer: "타이머",
  me: "내 정보",
};

/** 상태보기 탭 아이콘: 브랜드 고리(Figma 132:1215 — 고리 한 줄 + 바깥으로 나온 조각 한 줄, 선 1.5, 끝 둥글게) */
function RingIcon() {
  return (
    <svg className="tabbar-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false" data-icon="ring">
      <path d="M12 3C10.22 3 8.47991 3.52784 6.99987 4.51677C5.51983 5.50571 4.36627 6.91131 3.68508 8.55585C3.0039 10.2004 2.82567 12.01 3.17293 13.7558C3.5202 15.5016 4.37737 17.1053 5.63604 18.364C6.89471 19.6226 8.49836 20.4798 10.2442 20.8271C11.99 21.1743 13.7996 20.9961 15.4442 20.3149C17.0887 19.6337 18.4943 18.4802 19.4832 17.0001C20.4722 15.5201 21 13.78 21 12" />
      <path d="M17.1 1.7C18.284 2.1518 19.3592 2.84855 20.2553 3.74465C21.1514 4.64075 21.8482 5.716 22.3 6.9" />
    </svg>
  );
}

/** Phosphor Regular 경로(위 출처 그대로) */
export const PHOSPHOR_PATHS = {
  "list-checks":
    "M224,128a8,8,0,0,1-8,8H128a8,8,0,0,1,0-16h88A8,8,0,0,1,224,128ZM128,72h88a8,8,0,0,0,0-16H128a8,8,0,0,0,0,16Zm88,112H128a8,8,0,0,0,0,16h88a8,8,0,0,0,0-16ZM82.34,42.34,56,68.69,45.66,58.34A8,8,0,0,0,34.34,69.66l16,16a8,8,0,0,0,11.32,0l32-32A8,8,0,0,0,82.34,42.34Zm0,64L56,132.69,45.66,122.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32,0l32-32a8,8,0,0,0-11.32-11.32Zm0,64L56,196.69,45.66,186.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32,0l32-32a8,8,0,0,0-11.32-11.32Z",
  timer:
    "M128,40a96,96,0,1,0,96,96A96.11,96.11,0,0,0,128,40Zm0,176a80,80,0,1,1,80-80A80.09,80.09,0,0,1,128,216ZM173.66,90.34a8,8,0,0,1,0,11.32l-40,40a8,8,0,0,1-11.32-11.32l40-40A8,8,0,0,1,173.66,90.34ZM96,16a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H104A8,8,0,0,1,96,16Z",
  user: "M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z",
} as const;

function phosphor(name: keyof typeof PHOSPHOR_PATHS) {
  return function PhosphorIcon() {
    return (
      <svg className="tabbar-icon" width="24" height="24" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false" data-icon={name}>
        <path d={PHOSPHOR_PATHS[name]} />
      </svg>
    );
  };
}

const TAB_ICONS: Record<TabId, () => ReactNode> = {
  growth: RingIcon,
  todo: phosphor("list-checks"),
  timer: phosphor("timer"),
  me: phosphor("user"),
};

export function TabBar({ tabs, current, onSelect }: { tabs: TabId[]; current: TabId; onSelect: (tab: TabId) => void }) {
  return (
    <nav className="tabbar" aria-label="화면 이동">
      <ul className="tabbar-list">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <li key={tab} className="tabbar-item">
              <button type="button" className="tabbar-btn" aria-current={tab === current ? "page" : undefined} onClick={() => onSelect(tab)}>
                <Icon />
                <span className="tabbar-label">{TAB_LABELS[tab]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
