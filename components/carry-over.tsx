"use client";

import { useEffect, useRef, useState } from "react";
import type { ManageApi } from "../lib/manage-api";
import type { TodoItem } from "../lib/todos/types";
import { Notice, PrimaryButton, TextButton } from "./ui";

/**
 * 어제 못 끝낸 할 일 가져오기(PRD 0번, 기획서 7-2: 넘길지는 사용자가 고른다. 앱이 알아서 다 넘기지 않는다).
 * 어제 못 끝낸 것이 있을 때만 한 줄로 나타나고, 누르면 고를 목록이 펼쳐진다. 가져와도 어제 것은 그대로 둔다.
 * 고침10 E(Figma 148:108 · 50:69): 접힌 줄 = 카드 줄 40 + 「›」. 펼치면 고르기는 할 일과 같은 체크 원 24, 처음엔 모두 고른 채,
 * 「n개 가져오기」 주 단추(막지 않는다 — 고른 것이 있을 때만 보이고, 모두 풀면 그 자리에 글 「고른 할 일 없음」이 온다) · 「접기」 글 단추.
 * 설명 글(「오늘로 가져올 것을 골라요…」)은 없다.
 * 같은 요청을 다시 눌러도 새로 만들지 않게 가져올 줄마다 화면이 uuid를 만들어 둔다(서버가 같은 id는 한 번만 만든다).
 */

export const CARRY_TEXT = {
  open: (n: number) => `어제 못 끝낸 할 일 ${n}개 보기`,
  title: "어제 못 끝낸 할 일",
  take: (n: number) => `${n}개 가져오기`,
  /** 모두 풀면 주 단추 자리에 놓는 글(단추가 아니다, 14 보조색) */
  none: "고른 할 일 없음",
  taking: "가져오는 중",
  failed: "가져오지 못했어요. 다시 눌러 주세요.",
  offline: "인터넷에 연결되면 가져올 수 있어요.",
  close: "접기",
  unreadable: "읽을 수 없는 할 일",
} as const;

export function CarryOver({
  api,
  online,
  onCarried,
  refreshKey = 0,
}: {
  api: ManageApi;
  online: boolean;
  onCarried: (todos: TodoItem[]) => void;
  /** 바뀔 때마다 어제 못 끝낸 목록을 다시 읽는다(카드의 「오늘 할 일에 추가」가 어제 것을 오늘로 넣은 뒤 n이 줄게, 고침 11-2) */
  refreshKey?: number;
}) {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [open, setOpen] = useState(false);
  // 첫 응답 전에는 자리를 비워 둔다(B16)
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const newIds = useRef(new Map<string, string>());

  useEffect(() => {
    let alive = true;
    void api.fetchYesterday().then((res) => {
      if (!alive) return;
      if (res.ok) {
        setItems(res.data.todos);
        setPicked(new Set(res.data.todos.map((t) => t.id))); // 처음엔 모두 고른 채
      }
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [api, refreshKey]);

  if (items.length === 0) return loaded ? null : <div className="slot-carry" aria-hidden="true" />;

  function toggle(id: string) {
    setFailed(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function take() {
    if (busy || picked.size === 0 || !online) return;
    const chosen = items.filter((i) => picked.has(i.id));
    for (const item of chosen) if (!newIds.current.has(item.id)) newIds.current.set(item.id, crypto.randomUUID());
    setBusy(true);
    setFailed(false);
    const res = await api.carryOver(chosen.map((i) => ({ from: i.id, id: newIds.current.get(i.id)! })));
    setBusy(false);
    if (res.ok) {
      onCarried(res.data.todos);
      const rest = items.filter((i) => !picked.has(i.id));
      setItems(rest);
      setPicked(new Set(rest.map((i) => i.id))); // 남은 것도 다시 펼치면 모두 고른 채
      setOpen(false);
    } else {
      setFailed(true);
    }
  }

  if (!open) {
    return (
      <div className="carry">
        <button type="button" className="carry-row" onClick={() => setOpen(true)}>
          <span className="carry-row-text">{CARRY_TEXT.open(items.length)}</span>
          <span className="carry-row-go" aria-hidden="true">
            ›
          </span>
        </button>
      </div>
    );
  }
  return (
    <section className="carry carry-open" aria-labelledby="carry-title">
      {/* 고침10 QA1 ③(Fig 148:108): 「접기」는 제목 줄 오른쪽(보조색 14 Medium), 「n개 가져오기」는 폭 가득 */}
      <div className="carry-head">
        <h2 id="carry-title" className="carry-title">
          {CARRY_TEXT.title}
        </h2>
        <TextButton className="carry-close" onClick={() => setOpen(false)}>
          {CARRY_TEXT.close}
        </TextButton>
      </div>
      <ul className="carry-list">
        {items.map((item) => (
          <li key={item.id} className="carry-item">
            {/* 할 일 줄과 같은 체크 원 24(.check-hit · .check-box). 글은 체크 칸의 이름 */}
            <label className="check-hit">
              <input type="checkbox" checked={picked.has(item.id)} onChange={() => toggle(item.id)} aria-labelledby={`carry-text-${item.id}`} />
              <span className="check-box" aria-hidden="true" />
            </label>
            <span id={`carry-text-${item.id}`} className="carry-text">
              {item.readable ? item.text : CARRY_TEXT.unreadable}
            </span>
          </li>
        ))}
      </ul>
      {!online && <Notice role="status">{CARRY_TEXT.offline}</Notice>}
      {failed && <Notice role="alert">{CARRY_TEXT.failed}</Notice>}
      <div className="detail-actions carry-actions">
        {/* 막지 않는다: 고른 것이 있으면 주 단추(연결이 없을 때만 막힘), 모두 풀면 단추가 아니라 글 */}
        {picked.size > 0 ? (
          <PrimaryButton busy={busy} disabled={busy || !online} onClick={() => void take()}>
            {busy ? CARRY_TEXT.taking : CARRY_TEXT.take(picked.size)}
          </PrimaryButton>
        ) : (
          <p className="carry-none">{CARRY_TEXT.none}</p>
        )}
      </div>
    </section>
  );
}
