"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LOGIN_TEXT, type LoginNotice } from "../lib/login-text";
import { createClient } from "../lib/supabase/client";
import { useAnnouncer } from "../lib/use-announcer";
import { useOnline } from "../lib/use-online";
import { LiveRegion, Notice } from "./ui";

/** 로그인 화면의 바깥 틀: 이름과 한 문장 위, 단추 묶음 아래(방향 A) 또는 이어서(방향 B). */
export function LoginLayout({
  direction = "A",
  children,
}: {
  direction?: "A" | "B";
  children: ReactNode;
}) {
  return (
    <main className={direction === "B" ? "login dir-b" : "login"}>
      <div className="login-head">
        <h1 className="login-name">{LOGIN_TEXT.name}</h1>
        <p className="login-sentence">{LOGIN_TEXT.sentence}</p>
      </div>
      {children}
    </main>
  );
}

/** 단추와 안내(L1~L5). 상태는 바깥에서 받는다. 진짜 화면과 상태 모음 화면이 같이 쓴다. */
export function LoginActionsView({
  notice,
  busy,
  live,
  onClick,
}: {
  notice: LoginNotice | null;
  busy: boolean;
  live: string;
  onClick: () => void;
}) {
  return (
    <div className="login-actions">
      {notice && (
        <Notice role={notice === "failed" || notice === "config" ? "alert" : "status"}>{LOGIN_TEXT[notice]}</Notice>
      )}
      <button type="button" className="google-btn" aria-busy={busy ? true : undefined} onClick={onClick}>
        {/* 표준 색 G 로고(Google 지침의 SVG). 크기·색을 바꾸지 않는다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/google-g.svg" width={20} height={20} alt="" />
        <span>{busy ? LOGIN_TEXT.busy : LOGIN_TEXT.button}</span>
      </button>
      <LiveRegion message={live} />
    </div>
  );
}

export function LoginButton({ initialNotice = null }: { initialNotice?: LoginNotice | null }) {
  const [notice, setNotice] = useState<LoginNotice | null>(initialNotice);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [live, announce] = useAnnouncer();
  const online = useOnline();

  // Google 창에서 뒤로 가기로 돌아오면(bfcache) 페이지가 「이동하는 중」인 채 되살아날 수 있다. L1로 되돌린다.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        busyRef.current = false;
        setBusy(false);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function onClick() {
    if (busyRef.current) return; // 두 번째 누름은 무시
    if (!navigator.onLine) {
      setNotice("offline");
      announce(LOGIN_TEXT.offline, { again: true });
      return;
    }
    const supabase = createClient();
    if (!supabase) {
      setNotice("config");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    announce(LOGIN_TEXT.busy);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch {
      busyRef.current = false;
      setBusy(false);
      setNotice("failed");
    }
  }

  return (
    <LoginActionsView
      notice={!online ? "offline" : notice === "offline" ? null : notice}
      busy={busy}
      live={live}
      onClick={onClick}
    />
  );
}
