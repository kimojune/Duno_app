"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import type { DemoStartResult } from "../lib/demo/start";
import { DEMO_TEXT, LOGIN_TEXT, toDemoCodeInput, type DemoNotice, type LoginNotice } from "../lib/login-text";
import { createClient } from "../lib/supabase/client";
import { useAnnouncer } from "../lib/use-announcer";
import { useOnline } from "../lib/use-online";
import { LiveRegion, Notice, SecondaryButton } from "./ui";
import { Wordmark } from "./wordmark";

/**
 * 큰 L1 고리(Figma 54:14 · 54:15, 고침10 D): 지름 120 · 두께 24 · 먹남색(--color-text), 한 조각(살구)이 오른쪽 위 45°로 8px 바깥 + 빛 번짐.
 * 작은 워드마크 고리(components/wordmark.tsx)와 같은 모양: 빠진 자리 60°(15°~75°), 조각은 그 자리의 호. 장식이라 화면 읽기에서 숨긴다(제목 「두노」는 h1).
 */
export const LOGIN_RING = { size: 120, thickness: 24, pieceOffset: 8 } as const;
const RING_ARC = "M72.423 13.636 A48 48 0 1 0 106.364 47.577";
const PIECE_ARC = "M106.364 47.577 A48 48 0 0 0 72.423 13.636";
const PIECE_SHIFT = LOGIN_RING.pieceOffset / Math.SQRT2;
export function LoginRing() {
  return (
    <svg className="login-ring" width={LOGIN_RING.size} height={LOGIN_RING.size} viewBox="0 0 120 120" fill="none" aria-hidden="true" focusable="false" overflow="visible">
      <defs>
        <filter id="login-ring-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>
      <path className="login-ring-body" d={RING_ARC} strokeWidth={LOGIN_RING.thickness} />
      <g transform={`translate(${PIECE_SHIFT.toFixed(3)} ${(-PIECE_SHIFT).toFixed(3)})`}>
        <path className="login-ring-glow" d={PIECE_ARC} strokeWidth={LOGIN_RING.thickness} filter="url(#login-ring-glow)" />
        <path className="login-ring-piece" d={PIECE_ARC} strokeWidth={LOGIN_RING.thickness} />
      </g>
    </svg>
  );
}

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
        <LoginRing />
        <h1 className="login-name">
          <Wordmark />
        </h1>
        <p className="login-sentence">{LOGIN_TEXT.sentence}</p>
      </div>
      {children}
    </main>
  );
}

/** 체험 코드 칸의 모양(상태는 바깥에서 받는다). 진짜 화면과 상태 모음 화면이 같이 쓴다. */
export type DemoCodeViewProps = {
  value: string;
  notice: DemoNotice | null;
  busy: boolean;
  /** Google로 이동하는 중이면 막는다(두 번 누름 막기) */
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
};

/**
 * 체험 코드(23 S0 49:169): 이름표 「체험 코드」 → 한 줄에 칸 + 「시작」 보조 단추. 틀리면 칸 테두리 2px + 칸 아래 「!」와 글(role=alert, 칸의 aria-describedby).
 * 칸 안에 흐린 글을 두지 않는다(이름표가 보인다). 쓴 값은 틀려도 지우지 않는다.
 */
export function DemoCodeView({ value, notice, busy, disabled = false, onChange, onSubmit, inputRef }: DemoCodeViewProps) {
  const inputId = useId();
  const errorId = useId();
  const invalid = notice !== null;
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <form className="demo-form" onSubmit={submit} noValidate>
      <label className="input-label" htmlFor={inputId}>
        {DEMO_TEXT.label}
      </label>
      <div className="input-row">
        <input
          ref={inputRef}
          id={inputId}
          className="input demo-input"
          type="text"
          name="code"
          value={value}
          onChange={(e) => onChange(toDemoCodeInput(e.target.value))}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          readOnly={busy}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? errorId : undefined}
        />
        <SecondaryButton type="submit" className="demo-start" busy={busy} disabled={disabled} aria-label={DEMO_TEXT.buttonName}>
          {busy ? DEMO_TEXT.busy : DEMO_TEXT.button}
        </SecondaryButton>
      </div>
      {/* 고침10 QA1 ①(Fig 141:13 · UI-03): 오류 줄 자리를 처음부터 비워 둔다 — 오류가 나와도 칸·Google 단추가 안 움직인다 */}
      <div className="demo-error-slot">
        {invalid && (
          <p id={errorId} role="alert" className="demo-error">
            <span className="demo-error-icon" aria-hidden="true">
              !
            </span>
            <span>{DEMO_TEXT[notice]}</span>
          </p>
        )}
      </div>
    </form>
  );
}

/** 단추와 안내(L1~L5). 상태는 바깥에서 받는다. 진짜 화면과 상태 모음 화면이 같이 쓴다. demo가 있으면 Google 단추 아래에 체험 코드 칸. */
export function LoginActionsView({
  notice,
  busy,
  live,
  onClick,
  googleDisabled = false,
  demo = null,
}: {
  notice: LoginNotice | null;
  busy: boolean;
  live: string;
  onClick: () => void;
  /** 체험을 시작하는 중이면 Google 단추도 막는다 */
  googleDisabled?: boolean;
  demo?: DemoCodeViewProps | null;
}) {
  return (
    <div className={demo ? "login-actions has-demo" : "login-actions"}>
      {notice && (
        <Notice role={notice === "failed" || notice === "config" ? "alert" : "status"}>{LOGIN_TEXT[notice]}</Notice>
      )}
      <button
        type="button"
        className="google-btn"
        aria-busy={busy ? true : undefined}
        disabled={googleDisabled || undefined}
        onClick={onClick}
      >
        {/* 표준 색 G 로고(Google 지침의 SVG). 크기·색을 바꾸지 않는다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/google-g.svg" width={20} height={20} alt="" />
        <span>{busy ? LOGIN_TEXT.busy : LOGIN_TEXT.button}</span>
      </button>
      {demo && <DemoCodeView {...demo} disabled={demo.disabled || busy} />}
      <LiveRegion message={live} />
    </div>
  );
}

const SERVER_DEMO_ERRORS: readonly string[] = ["wrong_code", "rate_limited", "failed", "off"];

/** 체험 코드로 시작하는 서버 행동(app/demo/actions.ts startDemo). 서버 컴포넌트(app/page.tsx)가 켜졌을 때만 넘긴다 — 코드 값은 넘어오지 않는다. */
export type StartDemo = (code: string) => Promise<DemoStartResult>;

export function LoginButton({
  initialNotice = null,
  startDemo = null,
  onDemoStarted,
}: {
  initialNotice?: LoginNotice | null;
  /** null이면 체험 칸을 그리지 않는다(DEMO_ACCESS_CODE 없음) */
  startDemo?: StartDemo | null;
  /** 성공 뒤 이동(기본: 첫 화면을 새로 연다 — 새 세션 쿠키로 서버가 할 일 탭을 그린다). 시험이 바꾼다 */
  onDemoStarted?: () => void;
}) {
  const [notice, setNotice] = useState<LoginNotice | null>(initialNotice);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [live, announce] = useAnnouncer();
  const online = useOnline();

  const [demoCode, setDemoCode] = useState("");
  const [demoNotice, setDemoNotice] = useState<DemoNotice | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const demoInputRef = useRef<HTMLInputElement | null>(null);

  function showDemoNotice(next: DemoNotice) {
    setDemoNotice(next);
    announce(DEMO_TEXT[next], { again: true });
    // 칸으로 초점(23 141:13). 막힘이 풀린 뒤에 옮긴다
    window.setTimeout(() => demoInputRef.current?.focus(), 0);
  }

  async function onDemoSubmit() {
    if (busyRef.current || !startDemo) return; // 두 번째 누름·Google 이동 중은 무시
    if (!navigator.onLine) return showDemoNotice("offline");
    if (demoCode.trim() === "") return showDemoNotice("empty");
    busyRef.current = true;
    setDemoBusy(true);
    setDemoNotice(null);
    announce(DEMO_TEXT.busy);
    let result: DemoStartResult;
    try {
      result = await startDemo(demoCode);
    } catch {
      result = { ok: false, error: "failed" };
    }
    if (result.ok) {
      // 막힌 채로 이동한다(다시 누름 막기)
      (onDemoStarted ?? (() => window.location.replace("/")))();
      return;
    }
    busyRef.current = false;
    setDemoBusy(false);
    // 화면 글은 정해진 글만: 서버가 준 값이 약속한 오류 이름이 아니면 「시작하지 못했어요」로(원문·코드 값을 띄우지 않는다)
    showDemoNotice(SERVER_DEMO_ERRORS.includes(result.error) ? result.error : "failed");
  }

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
      googleDisabled={demoBusy}
      demo={
        startDemo
          ? {
              value: demoCode,
              notice: demoNotice,
              busy: demoBusy,
              onChange: (value) => setDemoCode(value),
              onSubmit: () => void onDemoSubmit(),
              inputRef: demoInputRef,
            }
          : null
      }
    />
  );
}
