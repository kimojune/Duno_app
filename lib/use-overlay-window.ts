"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * 전체 화면으로 덮는 창(저녁 기록·이번 주 목표·분야 페이지·할 일 자세히)이 함께 쓰는 장치. 창이 그려지는 동안만 켜진다(마운트 = 열림).
 *
 * 1) 뒤로 가기(B6): 열릴 때 history에 한 칸을 쌓는다. 안드로이드 뒤로 가기(popstate)는 창만 닫고 앱을 나가지 않는다.
 *    「닫기」·Esc·저장 뒤 닫기처럼 화면이 직접 닫으면 쌓은 칸을 history.back()으로 거둔다. 칸을 쌓을 때는 지금 칸의 state를
 *    복사해 이어 붙인다(Next App Router의 내부 state를 보존, 할 일 적는 창이 쓰는 방식과 같다).
 * 2) 바깥 가리기(B7, WCAG 2.4.3·2.4.11): 창이 열린 동안 창이 아닌 나머지(탭 줄·본문)에 inert를 단다. 키보드·낭독 도구가
 *    창 뒤로 새지 않는다. 닫으면 우리가 단 것만 거둔다.
 * 3) 포커스(B7): 창이 열릴 때 포커스가 있던 단추를 기억했다가, 닫으면 그 단추로 돌려보낸다(그 단추가 이미 없으면 건드리지 않는다).
 *
 * 창 컴포넌트는 이 훅을 맨 위(포커스를 제목으로 옮기는 효과보다 앞)에서 부르고, 돌려받은 ref를 창의 맨 바깥 요소에 단다.
 * onClose는 popstate로 닫아야 할 때만 불린다(화면이 정한 닫기 동작 그대로).
 */

export const OVERLAY_HISTORY_MARK = "dunoOverlay";

type HistoryState = Record<string, unknown>;

function currentHistoryState(): HistoryState {
  const state: unknown = window.history.state;
  return state && typeof state === "object" ? { ...(state as HistoryState) } : {};
}

/**
 * 거둔 칸이 부른 history.back()의 popstate가 아직 오지 않은 수. 창이 연달아 닫히고 열릴 때, 늦게 온 popstate를 사용자의 뒤로 가기로
 * 읽지 않게 센다. popstate는 창이 없을 때도 오므로 센 것을 거두는 듣기는 모듈에 하나만 두고, 떠 있는 창에는 그 결과를 알려 준다.
 */
let pendingBacks = 0;
type PopListener = (ours: boolean) => void;
const listeners = new Set<PopListener>();
let listening = false;

function onWindowPopState() {
  const ours = pendingBacks > 0;
  if (ours) pendingBacks -= 1;
  for (const listener of [...listeners]) listener(ours);
}

function subscribePop(listener: PopListener): () => void {
  if (!listening) {
    window.addEventListener("popstate", onWindowPopState);
    listening = true;
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NOSCRIPT"]);

/** root에서 body까지 올라가며, 길 위에 있지 않은 형제 요소에 inert를 단다. 우리가 단 요소 목록을 돌려준다 */
function inertOutside(root: HTMLElement): HTMLElement[] {
  const changed: HTMLElement[] = [];
  let node: HTMLElement | null = root;
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement) || SKIP_TAGS.has(sibling.tagName)) continue;
      if (sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      changed.push(sibling);
    }
    node = parent;
  }
  return changed;
}

export function useOverlayWindow<T extends HTMLElement = HTMLDivElement>(onClose: () => void): RefObject<T | null> {
  const rootRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const mark = crypto.randomUUID();
    let pushed = false;
    let closedByPop = false;
    let mounted = true;

    function pushEntry() {
      try {
        window.history.pushState({ ...currentHistoryState(), [OVERLAY_HISTORY_MARK]: mark }, "");
        pushed = true;
      } catch {
        pushed = false;
      }
    }
    pushEntry();

    function onPopState(ours: boolean) {
      if (!mounted) return;
      if (ours) {
        // 거둔 칸의 popstate가 이제 도착했다(사용자의 뒤로 가기가 아니다). 그사이 같은 창이 다시 열렸다면 자기 칸을 다시 쌓는다
        if (pushed && currentHistoryState()[OVERLAY_HISTORY_MARK] !== mark) pushEntry();
        return;
      }
      if (!pushed) return;
      // 아직 이 창의 칸이면(앞으로 가기로 돌아옴 등) 그대로 둔다
      if (currentHistoryState()[OVERLAY_HISTORY_MARK] === mark) return;
      closedByPop = true;
      closeRef.current();
    }
    const unsubscribe = subscribePop(onPopState);

    const root = rootRef.current;
    const inerted = root ? inertOutside(root) : [];

    return () => {
      mounted = false;
      unsubscribe();
      for (const el of inerted) el.removeAttribute("inert");
      if (pushed && !closedByPop) {
        pendingBacks += 1;
        window.history.back();
      }
      // 창이 사라지며 포커스가 body로 떨어졌으면 연 단추로 돌려보낸다. 다른 곳으로 이미 옮겨졌으면 건드리지 않는다
      const active = document.activeElement;
      if (opener && opener.isConnected && (!active || active === document.body)) opener.focus();
    };
  }, []);

  return rootRef;
}
