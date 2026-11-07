"use client";

/**
 * 아래 탭(PRD 부록 B, D-112): 상태보기 · 할 일 · 타이머 · 내 정보. 화면 이동은 같은 문서 안의 탭 바꿈이다
 * (할 일 탭의 적던 글·도는 타이머가 탭을 옮겨도 살아 있게 하려고). 지금 탭은 aria-current="page"로 알린다.
 * 누름 영역은 높이 48px 이상(--tap-min), 글자는 이름표라 어미 없이 쓴다. 새 색은 쓰지 않는다.
 */
export type TabId = "growth" | "todo" | "timer" | "me";

export const TAB_LABELS: Record<TabId, string> = {
  growth: "상태보기",
  todo: "할 일",
  timer: "타이머",
  me: "내 정보",
};

export function TabBar({ tabs, current, onSelect }: { tabs: TabId[]; current: TabId; onSelect: (tab: TabId) => void }) {
  return (
    <nav className="tabbar" aria-label="화면 이동">
      <ul className="tabbar-list">
        {tabs.map((tab) => (
          <li key={tab} className="tabbar-item">
            <button
              type="button"
              className="tabbar-btn"
              aria-current={tab === current ? "page" : undefined}
              onClick={() => onSelect(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
