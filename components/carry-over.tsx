"use client";

import { useEffect, useRef, useState } from "react";
import type { ManageApi } from "../lib/manage-api";
import type { TodoItem } from "../lib/todos/types";
import { Notice, PrimaryButton, SecondaryButton, TextButton } from "./ui";

/**
 * 어제 못 끝낸 할 일 가져오기(PRD 0번, 기획서 7-2: 넘길지는 사용자가 고른다. 앱이 알아서 다 넘기지 않는다).
 * 어제 못 끝낸 것이 있을 때만 한 줄로 나타나고, 누르면 고를 목록이 펼쳐진다. 가져와도 어제 것은 그대로 둔다.
 * 같은 요청을 다시 눌러도 새로 만들지 않게 가져올 줄마다 화면이 uuid를 만들어 둔다(서버가 같은 id는 한 번만 만든다).
 */

export const CARRY_TEXT = {
  open: (n: number) => `어제 못 끝낸 할 일 ${n}개 보기`,
  title: "어제 못 끝낸 할 일",
  hint: "오늘로 가져올 것을 골라요. 어제 것은 그대로 남아요.",
  take: (n: number) => `고른 ${n}개 가져오기`,
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
}: {
  api: ManageApi;
  online: boolean;
  onCarried: (todos: TodoItem[]) => void;
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
      if (res.ok) setItems(res.data.todos);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [api]);

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
      setItems((prev) => prev.filter((i) => !picked.has(i.id)));
      setPicked(new Set());
      setOpen(false);
    } else {
      setFailed(true);
    }
  }

  if (!open) {
    return (
      <div className="carry">
        <SecondaryButton onClick={() => setOpen(true)}>{CARRY_TEXT.open(items.length)}</SecondaryButton>
      </div>
    );
  }
  return (
    <section className="carry" aria-labelledby="carry-title">
      <h2 id="carry-title" className="carry-title">
        {CARRY_TEXT.title}
      </h2>
      <p className="todo-sub">{CARRY_TEXT.hint}</p>
      <ul className="carry-list">
        {items.map((item) => (
          <li key={item.id} className="carry-item">
            <label className="carry-label">
              <input type="checkbox" checked={picked.has(item.id)} onChange={() => toggle(item.id)} />
              <span>{item.readable ? item.text : CARRY_TEXT.unreadable}</span>
            </label>
          </li>
        ))}
      </ul>
      {!online && <Notice role="status">{CARRY_TEXT.offline}</Notice>}
      {failed && <Notice role="alert">{CARRY_TEXT.failed}</Notice>}
      <div className="detail-actions">
        <PrimaryButton busy={busy} disabled={busy || picked.size === 0 || !online} onClick={() => void take()}>
          {busy ? CARRY_TEXT.taking : CARRY_TEXT.take(picked.size)}
        </PrimaryButton>
        <TextButton onClick={() => setOpen(false)}>{CARRY_TEXT.close}</TextButton>
      </div>
    </section>
  );
}
