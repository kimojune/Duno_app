"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * 분야 칩 줄(고침9 — PM 16:3x P-1 바로잡음, 23 「칩 두 줄」, Figma 최종안 49:194 · 50:103 · 50:390 · 88:12 · 87:2 · 131:2 · 131:51).
 * 옛 고침5 「한 줄 + 옆으로 넘김 + 「‹ ›」 + 옅어지는 띠」를 바꿨다(이름 ChipScroller와 props는 그대로 — 쓰는 곳은 고치지 않아도 된다).
 * - 칩은 만든 순서로 왼쪽부터 놓고, 폭을 넘으면 다음 줄로 감싼다(칩 사이 8 · 줄 사이 8). 칩은 줄이지도 자르지도 않는다.
 * - 두 줄까지. 셋째 줄로 넘치면 둘째 줄 끝에 「+n」 칩(n = 숨은 칩 수, 「+ 분야」도 숨은 쪽에 든다). 「+n」이 들어가게 둘째 줄의 뒤 칩을 숨긴다.
 *   숨은 칩 가운데 고른 것(pressed · aria-pressed)이 있으면 「+n」 앞에 체크.
 * - 「+n」을 누르면 펼침: 모든 칩 + 맨 끝 글 단추 「접기」. 펼친 뒤 초점은 처음 드러난 칩. 「접기」를 누르면 두 줄로, 초점은 「+n」.
 *   칩을 고르거나 풀어도 펼친 채로 둔다. 화면을 닫았다 열면(이 부품이 새로 그려지면) 접힘.
 * - 화면 읽기: 「+n」 = 「분야 n개 더 보기」(aria-expanded=false), 「접기」 = 「분야 접기」(aria-expanded=true), 둘 다 칩 줄을 aria-controls로 가리킨다.
 * - 가로 끌기·넘김 단추·옅어지는 띠는 없다. 칩 모양·고르기 논리는 부르는 쪽이 정한다(칩은 자식으로 받는다).
 */
export const CHIP_SCROLLER_TEXT = {
  more: (n: number) => `분야 ${n}개 더 보기`,
  moreFace: (n: number) => `+${n}`,
  collapse: "분야 접기",
  collapseFace: "접기",
} as const;

/**
 * 칩 줄 이름(aria-labelledby·aria-label)마다 마지막으로 그린 칩 키. 「+ 분야」는 칩 줄 자리에 새 분야 칸을 띄워 칩 줄이 다시 그려지므로
 * (새로 마운트), 컴포넌트 안 ref만으로는 「방금 생긴 칩」을 알 수 없다 — 같은 이름의 칩 줄이 다시 그려질 때 이 기록과 견준다.
 */
const lastKeysByRow = new Map<string, Set<string>>();
/** 시험 사이에 기록을 비운다(시험 전용) */
export function resetChipRowMemory() {
  lastKeysByRow.clear();
}

/** 접혔을 때 보이는 줄 수 */
export const CHIP_MAX_ROWS = 2;

/** 같은 줄로 보는 위치 차(px). 고른 칩 테두리 2px 등으로 위가 1~2px 어긋나도 같은 줄 */
const ROW_SLACK = 4;

type GroupName = { "aria-label": string; "aria-labelledby"?: undefined } | { "aria-labelledby": string; "aria-label"?: undefined };

export type ChipScrollerProps = GroupName & {
  /** 칩 단추들. 칩 줄(role=group) 바로 아래 자식이 된다 */
  children: ReactNode;
  /** 칩 줄(.chip-row)에 더할 class */
  className?: string;
  /** 옛 「‹ ›」 단추 이름(고침5). 두 줄 감싸기로 바뀌어 쓰지 않는다 — 부르는 쪽을 깨지 않게 받기만 한다 */
  prevLabel?: string;
  nextLabel?: string;
};

/**
 * 칩마다의 위(top) → 줄 번호(0부터). 위가 ROW_SLACK 안이면 같은 줄. 순서대로 놓인 칩이라 줄 번호는 줄지 않는다.
 */
export function rowIndexes(tops: number[]): number[] {
  const rows: number[] = [];
  let row = 0;
  let rowTop = tops.length > 0 ? tops[0] : 0;
  for (const top of tops) {
    if (top - rowTop > ROW_SLACK) {
      row += 1;
      rowTop = top;
    }
    rows.push(row);
  }
  return rows;
}

/** 자식이 고른 칩인가(CategoryChip·OtherChip의 pressed, 또는 단추의 aria-pressed) */
function isPressed(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const props = (node as ReactElement<{ pressed?: unknown; "aria-pressed"?: unknown }>).props;
  return props.pressed === true || props["aria-pressed"] === true || props["aria-pressed"] === "true";
}

function CheckIcon() {
  return (
    <svg className="chip-check" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ChipScroller({ children, className, prevLabel, nextLabel, ...name }: ChipScrollerProps) {
  const rowId = useId();
  const row = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children);
  const total = items.length;
  /** 접혔을 때 보이는 칩 수. null = 다 보임(두 줄 안이거나 아직 재기 전) */
  const [shown, setShown] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  /** 재는 중인 단계: "all" = 모든 칩을 그려 줄을 셈, "fit" = 「+n」을 붙여 둘째 줄에 들어가는지 봄 */
  const phase = useRef<"all" | "fit" | "done">("all");
  const focusAfter = useRef<"revealed" | "more" | null>(null);
  const revealedIndex = useRef(0);
  const lastWidth = useRef(-1);
  /** 다시 재기를 강제하는 값. shown이 이미 null이면 setShown(null)은 다시 그리지 않아 effect가 안 돈다(폭이 줄어 넘치게 될 때) */
  const [tick, setTick] = useState(0);
  /** 지난 그리기의 칩 키(새로 생긴 칩을 가리려고) */
  const prevKeys = useRef<Set<string> | null>(null);
  /** 방금 생기며 골라진 칩(「+ 분야」로 더한 분야)의 키 — 접혀 숨으면 펼쳐 보이고 그 칩으로 초점 */
  const revealKey = useRef<string | null>(null);
  /** 펼친 뒤 초점을 줄 새 칩의 자리(그리기가 끝난 뒤 — 부르는 쪽의 초점 옮김보다 뒤에 돈다) */
  const revealFocus = useRef<number | null>(null);


  // 새로 생긴 칩 가운데 골라진 것(방금 더한 분야)을 기억한다. 같은 이름의 칩 줄을 처음 그릴 때는 없다
  const keys = items.map((item, i) => (isValidElement(item) && item.key !== null ? String(item.key) : `#${i}`));
  const rowName = name["aria-labelledby"] ?? name["aria-label"] ?? "";
  useLayoutEffect(() => {
    const before = prevKeys.current ?? lastKeysByRow.get(rowName) ?? null;
    const now = new Set(keys);
    prevKeys.current = now;
    if (rowName) lastKeysByRow.set(rowName, now);
    if (!before) return;
    const added = items.findIndex((item, i) => !before.has(keys[i]) && isPressed(item));
    if (added < 0) return;
    if (expanded) {
      revealFocus.current = added; // 이미 펼쳐 있으면 새 칩은 보인다 — 초점만 옮긴다
      return;
    }
    revealKey.current = keys[added];
  });

  // 칩 수·칩 모양(고름으로 체크가 붙어 폭이 바뀜)이 바뀌면 다시 잰다. 그리기 전에(layout) 끝나 깜박이지 않는다.
  // 그려진 칩의 자리를 재고 그 결과로 보일 칩 수를 정하는 일이라 effect 안에서 상태를 바꾼다(배치 재기 — 그리기 전 layout effect의 쓰임새).
  // 단계(phase)가 all → fit → done으로만 가고 done에서는 상태를 바꾸지 않아 끝없이 돌지 않는다(screens가 「Maximum update depth」 없음을 본다)
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || expanded) return;
    if (phase.current === "done") {
      phase.current = "all";
      if (shown !== null) {
        setShown(null);
        return;
      }
    }
    const chips = [...el.children].filter((c) => !c.hasAttribute("data-chip-more")) as HTMLElement[];
    // 줄은 칩의 세로 가운데로 가른다(.chip-row align-items:center — 글자 200%에서 칩 높이가 달라도 같은 줄의 가운데는 같다)
    const middle = (r: DOMRect) => r.top + r.height / 2;
    const tops = chips.map((c) => middle(c.getBoundingClientRect()));
    const rows = rowIndexes(tops);
    if (phase.current === "all") {
      const fits = rows.filter((r) => r < CHIP_MAX_ROWS).length;
      const reveal = revealKey.current;
      revealKey.current = null;
      if (fits >= total) {
        phase.current = "done";
        return;
      }
      // 분야를 더한 직후: 새 칩이 「+n」 뒤로 숨게 되면 접지 않고 펼친 채로 두고 새 칩으로 초점(펼친 뒤 초점 규칙과 같게)
      const revealAt = reveal === null ? -1 : keys.indexOf(reveal);
      if (revealAt >= 0 && revealAt >= fits - 1) {
        phase.current = "done";
        revealFocus.current = revealAt;
        setExpanded(true);
        return;
      }
      // 두 줄에 든 칩까지 보이고 「+n」을 붙여 본다. 「+n」이 셋째 줄로 밀리면 하나씩 줄인다
      phase.current = "fit";
      setShown(Math.max(1, fits));
      return;
    }
    // fit: 「+n」의 줄을 본다
    const more = el.querySelector<HTMLElement>("[data-chip-more]");
    if (!more || shown === null) {
      phase.current = "done";
      return;
    }
    const allTops = [...tops, middle(more.getBoundingClientRect())];
    const moreRow = rowIndexes(allTops)[allTops.length - 1];
    if (moreRow >= CHIP_MAX_ROWS && shown > 1) {
      setShown(shown - 1);
      return;
    }
    phase.current = "done";
  }, [keys, expanded, shown, total, tick]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 분야를 더한 직후 펼친 새 칩으로 초점. layout effect가 아니라 effect라 부르는 쪽(할 일 칸으로 초점)보다 뒤에 돈다
  useEffect(() => {
    const at = revealFocus.current;
    const el = row.current;
    if (at === null || !el) return;
    revealFocus.current = null;
    const chips = [...el.children].filter((c) => !c.hasAttribute("data-chip-more")) as HTMLElement[];
    chips[at]?.focus();
  });

  // 폭이 바뀌면(화면 돌림·창 크기·글자 크기) 다시 잰다. 높이만 바뀐 것(펼침)으로는 다시 재지 않는다
  useEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (width === lastWidth.current) return;
      lastWidth.current = width;
      if (expanded) return;
      phase.current = "all";
      setShown(null);
      setTick((t) => t + 1); // shown이 이미 null이어도 다시 그려 잰다(좁아져 넘치게 될 때)
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded]);

  // 펼침·접기 뒤 초점
  useLayoutEffect(() => {
    const el = row.current;
    const target = focusAfter.current;
    if (!el || !target) return;
    if (target === "revealed") {
      focusAfter.current = null;
      const chips = [...el.children].filter((c) => !c.hasAttribute("data-chip-more")) as HTMLElement[];
      chips[revealedIndex.current]?.focus();
      return;
    }
    // 접은 뒤: 다시 재고 「+n」이 그려진 뒤에 옮긴다(재는 동안은 「+n」이 아직 없다)
    const more = el.querySelector<HTMLElement>("[data-chip-more]");
    if (more && phase.current === "done") {
      focusAfter.current = null;
      more.focus();
    }
  });

  const collapsed = !expanded && shown !== null && shown < total;
  const visible = collapsed ? items.slice(0, shown) : items;
  const hidden = collapsed ? items.slice(shown) : [];
  const hiddenPressed = hidden.some(isPressed);

  function expand() {
    revealedIndex.current = shown ?? 0;
    focusAfter.current = "revealed";
    setExpanded(true);
  }
  function collapse() {
    focusAfter.current = "more";
    phase.current = "all";
    setShown(null);
    setExpanded(false);
  }

  return (
    <div className="chip-scroller">
      <div id={rowId} ref={row} className={className ? `chip-row ${className}` : "chip-row"} role="group" {...name}>
        {visible}
        {collapsed && (
          <button
            type="button"
            className="chip chip-more"
            data-chip-more=""
            aria-expanded={false}
            aria-controls={rowId}
            aria-label={CHIP_SCROLLER_TEXT.more(hidden.length)}
            onClick={expand}
          >
            <span className="chip-face">
              {hiddenPressed && <CheckIcon />}
              <span className="chip-label">{CHIP_SCROLLER_TEXT.moreFace(hidden.length)}</span>
            </span>
          </button>
        )}
        {expanded && (
          <button
            type="button"
            className="chip-collapse"
            data-chip-more=""
            aria-expanded={true}
            aria-controls={rowId}
            aria-label={CHIP_SCROLLER_TEXT.collapse}
            onClick={collapse}
          >
            {CHIP_SCROLLER_TEXT.collapseFace}
          </button>
        )}
      </div>
    </div>
  );
}
