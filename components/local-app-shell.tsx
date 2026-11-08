"use client";

import { useEffect, useState } from "react";
import type { HomeRead } from "../lib/home-types";
import { readTodayFromMirror, createLocalApis } from "../lib/local/apis";
import { createBrowserRuntime, migrateLegacyOutbox, startBrowserSync } from "../lib/local/browser";
import { markDeviceHint } from "../lib/local/device-hint";
import type { ResetReason } from "../lib/local/runtime";
import type { MirrorSnapshot } from "../lib/local/types";
import { AppShell, LOCAL_SAVE_TEXT, type LocalBundle } from "./app-shell";
import { TextButton } from "./ui";

/**
 * 기기 먼저 저장(고침 3바퀴)으로 앱을 여는 입구. 서버는 로그인한 사용자 번호만 넘기고 개인 데이터는 HTML에 싣지 않는다(첫 화면이 데이터를 기다려 늦어지지 않는다).
 * 열면: ① 기기 저장소(IndexedDB)에서 거울과 보낼 줄을 읽어 바로 그린다(네트워크 없이). ② 뒤에서 보낼 줄을 보내고 서버 것을 받아 맞춘다.
 * 이 기기에서 처음 쓰는 사용자(기기에 거울이 없음)만 서버 사본이 올 때까지 「불러오는 중」을 보인다(연결이 없거나 8초가 지나면 그냥 연다: 읽기 실패 안내가 뜬다).
 * 이 기기에 남은 다른 사용자의 기기 저장소는 지운다(로그아웃 없이 계정이 바뀐 경우).
 * 고침 4바퀴: 운영 장치가 「계정이 바뀜」(서버의 세션 사용자가 다름·다른 사용자가 다른 탭에서 열림)으로 자기 것을 지우면 안내를 보이고 페이지를 다시 연다.
 * 「다른 탭에서 로그아웃함」이면 안내와 「다시 열기」만 보인다(그 탭이 로그아웃을 마치기 전에 다시 열면 같은 세션으로 다시 받아 적을 수 있어, 사용자가 누를 때 연다).
 */

/** 이 기기에서 처음 쓰는 사용자가 서버 사본을 기다리는 시간 상한(밀리초, 임시) */
export const FIRST_PULL_WAIT_MS = 8000;

function homeFromMirror(bundle: LocalBundle): HomeRead {
  const mirror = bundle.runtime.getMirror();
  return {
    today: readTodayFromMirror(bundle.runtime),
    settings: mirror.settings ? { ok: true, data: mirror.settings } : { ok: false, error: "unavailable" },
  };
}

export function LocalAppShell({
  userKey,
  initialOpen = null,
  initialSnapshot = null,
}: {
  userKey: string;
  initialOpen?: "evening" | null;
  /** 이 기기에서 처음 여는 사용자에게만 서버가 첫 화면과 함께 싣는 서버 사본(그 밖에는 null: HTML에 개인 데이터가 없다) */
  initialSnapshot?: MirrorSnapshot | null;
}) {
  const [bundle, setBundle] = useState<LocalBundle | null>(null);
  const [, setVersion] = useState(0);
  const [reset, setReset] = useState<ResetReason | null>(null);

  useEffect(() => {
    let alive = true;
    let stopSync = () => {};
    const runtime = createBrowserRuntime(userKey, (reason) => {
      stopSync();
      if (!alive) return;
      setReset(reason);
      if (reason === "account_mismatch") {
        try {
          window.location.reload();
        } catch {
          // 다시 열지 못하면 안내의 「다시 열기」를 누른다
        }
      }
    });
    const apis = createLocalApis(runtime);
    void (async () => {
      await runtime.boot();
      migrateLegacyOutbox(runtime, userKey);
      if (!alive) return;
      // 다른 사용자의 기기 저장소 지우기는 첫 화면을 기다리게 하지 않는다(우리는 내 열쇠만 읽는다)
      void runtime.wipeOthers();
      // 이 기기에서 처음이고 서버가 사본을 실어 보냈으면 그것으로 시작한다(JS를 받은 뒤 서버에 다시 사본을 받으러 가는 왕복이 없다)
      if (!runtime.getMirror().synced && initialSnapshot) runtime.applySnapshot(initialSnapshot);
      stopSync = startBrowserSync(runtime);
      if (!runtime.getMirror().synced && runtime.isOnline()) {
        // 이 기기에서 처음: 서버 사본이 오기 전에는 비어 있는 것인지 아직 모르는 것인지 알 수 없다
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([runtime.pull(), new Promise((resolve) => (timer = setTimeout(resolve, FIRST_PULL_WAIT_MS)))]);
        clearTimeout(timer);
      }
      // 이 기기에 거울이 생겼다고 표시한다(다음에 열 때 서버는 개인 데이터를 HTML에 싣지 않는다). 저장소를 못 쓰면(메모리) 표시하지 않는다
      if (runtime.getMirror().synced && runtime.isPersistent()) markDeviceHint(userKey);
      if (alive) setBundle({ runtime, apis });
    })();
    return () => {
      alive = false;
      stopSync();
      void runtime.persistNow();
      runtime.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey]);

  // 서버에서 받아 맞춘 것(다른 기기에서 처음 설정을 마친 경우 등)이 입구 판단에도 닿게 거울이 바뀔 때 다시 그린다
  useEffect(() => {
    if (!bundle) return;
    return bundle.runtime.subscribe(() => setVersion((n) => n + 1));
  }, [bundle]);

  if (reset) {
    return (
      <div className="app-shell">
        <p className="todo-sub" role="status">
          {reset === "account_mismatch" ? LOCAL_SAVE_TEXT.resetAccount : LOCAL_SAVE_TEXT.resetSignedOut}
        </p>
        <TextButton onClick={() => window.location.reload()}>{LOCAL_SAVE_TEXT.reopen}</TextButton>
      </div>
    );
  }
  if (!bundle) {
    return (
      <div className="app-shell">
        <p className="todo-sub" role="status">
          불러오는 중
        </p>
      </div>
    );
  }
  return <AppShell home={homeFromMirror(bundle)} initialOpen={initialOpen} userKey={userKey} local={bundle} />;
}
