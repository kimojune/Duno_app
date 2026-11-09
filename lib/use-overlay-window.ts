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
 * 4) 닫기 전 확인(PM d-126): options.holdBack이 true를 돌려주면 뒤로 가기로 창을 닫지 않는다. 창은 자기 확인을 띄우고, 훅은
 *    history.forward()로 방금 빠진 자기 칸에 돌아간다(새 칸을 쌓지 않는다 — popstate 안에서 사용자 누름 없이 pushState하면
 *    Chrome이 그 아래 칸을 「뒤로 가기에서 건너뛸 칸」으로 표시해, 다음 뒤로 가기가 앱 밖으로 나갈 수 있다). 그래서 「계속 적기」 뒤
 *    뒤로 가기를 다시 누르면 다시 이 창의 칸이 빠지고 같은 확인이 뜬다. forward로 생긴 popstate는 모든 창이 사용자 뒤로 가기로 읽지 않는다.
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
 * 우리가 부른 이동(거둔 칸의 history.back(), 확인을 띄우며 돌아가는 history.forward())의 popstate가 아직 오지 않은 것, 부른 차례대로.
 * 창이 연달아 닫히고 열릴 때, 늦게 온 popstate를 사용자의 뒤로 가기로 읽지 않게 센다. popstate는 창이 없을 때도 오므로 센 것을 거두는
 * 듣기는 모듈에 하나만 두고, 떠 있는 창에는 그 결과를 알려 준다(「user」 = 사용자의 뒤로·앞으로 가기).
 */
type PopKind = "user" | "back" | "forward";
const pendingMoves: ("back" | "forward")[] = [];
type PopListener = (kind: PopKind) => void;
const listeners = new Set<PopListener>();
let listening = false;

function onWindowPopState() {
  const kind: PopKind = pendingMoves.shift() ?? "user";
  for (const listener of [...listeners]) listener(kind);
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

/** root에서 body까지 올라가며, 길 위에 있지 않은 형제 요소에 inert를 단다. 우리가 단 요소 목록을 돌려준다(닫기 확인 창도 쓴다) */
export function inertOutside(root: HTMLElement): HTMLElement[] {
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

/**
 * 확인 창(components/close-confirm.tsx ConfirmDialog)의 뒤로 가기(고침10 B: 안드로이드 뒤로 가기 = 아래 주 단추).
 * 떠 있는 확인 창의 「취소」를 쌓아 둔다(맨 위가 지금 확인). 겹친 창·적는 창의 뒤로 가기 길은 자기 칸이 빠졌을 때 이것을 먼저 본다:
 * 확인이 떠 있으면 확인만 닫고(창은 그대로) history.forward()로 자기 칸에 돌아간다(holdBack과 같은 길).
 */
const confirmCancels: (() => void)[] = [];

/** 떠 있는 확인 창이 있으면 맨 위 확인의 「취소」를 부르고 true. 없으면 false(창의 뒤로 가기 길이 원래대로 간다) */
export function cancelConfirmOnBack(): boolean {
  const top = confirmCancels[confirmCancels.length - 1];
  if (!top) return false;
  top();
  return true;
}

/**
 * 확인 창이 뒤로 가기를 받는 훅. wasConfirmed는 위 단추를 눌렀는지 돌려준다(닫힐 때 읽는다).
 * - own = false(기본): 아래 겹친 창의 뒤로 가기 길이 이 확인을 먼저 닫는다(cancelConfirmOnBack). history는 건드리지 않는다.
 * - own = true: 겹친 창 없이 뜨는 확인(로그아웃). 열릴 때 history에 한 칸을 쌓고, 사용자의 뒤로 가기에 onCancel을 부른다.
 *   아래 단추·Esc로 닫히면 쌓은 칸을 history.back()으로 거둔다. 위 단추를 눌렀으면(페이지를 떠나는 동작) 거두지 않는다 —
 *   떠나는 이동과 back()이 겹쳐 앞 화면으로 되돌아가지 않게.
 */
export function useConfirmBack(onCancel: () => void, own: boolean, wasConfirmed: () => boolean): void {
  const cancelRef = useRef(onCancel);
  const confirmedRef = useRef(wasConfirmed);
  useEffect(() => {
    cancelRef.current = onCancel;
    confirmedRef.current = wasConfirmed;
  });
  useEffect(() => {
    const handler = () => cancelRef.current();
    if (!own) {
      confirmCancels.push(handler);
      return () => {
        const at = confirmCancels.lastIndexOf(handler);
        if (at >= 0) confirmCancels.splice(at, 1);
      };
    }
    const mark = crypto.randomUUID();
    let pushed = false;
    let closedByPop = false;
    try {
      window.history.pushState({ ...currentHistoryState(), [OVERLAY_HISTORY_MARK]: mark }, "");
      pushed = true;
    } catch {
      pushed = false;
    }
    const unsubscribe = subscribePop((kind) => {
      if (kind !== "user" || !pushed || closedByPop) return;
      if (currentHistoryState()[OVERLAY_HISTORY_MARK] === mark) return;
      closedByPop = true;
      cancelRef.current();
    });
    return () => {
      unsubscribe();
      if (pushed && !closedByPop && !confirmedRef.current()) {
        pendingMoves.push("back");
        window.history.back();
      }
    };
  }, [own]);
}

export type OverlayWindowOptions = {
  /** 사용자의 뒤로 가기가 이 창의 칸을 뺐을 때 불린다. true면 창을 닫지 않고(창이 확인을 띄운다) 자기 칸으로 돌아간다 */
  holdBack?: () => boolean;
};

export function useOverlayWindow<T extends HTMLElement = HTMLDivElement>(onClose: () => void, options?: OverlayWindowOptions): RefObject<T | null> {
  const rootRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  const holdBackRef = useRef(options?.holdBack);
  // 연 단추. 개발 모드(StrictMode)는 효과를 지웠다 다시 켜는데, 다시 켤 때는 첫 켜짐에서 창 제목으로 옮겨진 포커스가 이미 창 안에 있다.
  // 그때 포커스를 연 단추로 잡으면 곧 사라질 제목을 기억하게 되므로, 창 안에 있는 포커스는 연 단추로 잡지 않고 앞서 기억한 것을 둔다.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    closeRef.current = onClose;
    holdBackRef.current = options?.holdBack;
  });

  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !rootRef.current?.contains(active)) {
      openerRef.current = active;
    }
    const opener = openerRef.current;
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

    function onPopState(kind: PopKind) {
      if (!mounted) return;
      // 확인을 띄우며 자기 칸으로 돌아간 이동(사용자의 뒤로 가기가 아니다). 어느 창도 닫지 않는다
      if (kind === "forward") return;
      if (kind === "back") {
        // 거둔 칸의 popstate가 이제 도착했다(사용자의 뒤로 가기가 아니다). 그사이 같은 창이 다시 열렸다면 자기 칸을 다시 쌓는다
        if (pushed && currentHistoryState()[OVERLAY_HISTORY_MARK] !== mark) pushEntry();
        return;
      }
      if (!pushed) return;
      // 아직 이 창의 칸이면(앞으로 가기로 돌아옴 등) 그대로 둔다
      if (currentHistoryState()[OVERLAY_HISTORY_MARK] === mark) return;
      // 고침10 B: 이 창 위에 확인 창이 떠 있으면 뒤로 가기 = 확인의 아래 단추(확인만 닫는다). 창은 그대로, 자기 칸으로 돌아간다
      if (cancelConfirmOnBack() || holdBackRef.current?.()) {
        // 창이 확인을 띄웠다: 방금 빠진 자기 칸으로 돌아간다(칸은 그대로 이 창의 것, 다음 뒤로 가기도 같은 길을 탄다)
        pendingMoves.push("forward");
        window.history.forward();
        return;
      }
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
        pendingMoves.push("back");
        window.history.back();
      }
      // 창이 사라지며 포커스가 body로 떨어졌으면 연 단추로 돌려보낸다. 다른 곳으로 이미 옮겨졌으면 건드리지 않는다
      const active = document.activeElement;
      if (opener && opener.isConnected && (!active || active === document.body)) opener.focus();
    };
  }, []);

  return rootRef;
}
