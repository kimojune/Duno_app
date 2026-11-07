"use client";

import { useEffect, useState } from "react";
import type { HomeRead } from "../lib/home-types";
import { readTodayFromMirror, createLocalApis } from "../lib/local/apis";
import { createBrowserRuntime, migrateLegacyOutbox, startBrowserSync } from "../lib/local/browser";
import { AppShell, type LocalBundle } from "./app-shell";

/**
 * 기기 먼저 저장(고침 3바퀴)으로 앱을 여는 입구. 서버는 로그인한 사용자 번호만 넘기고 개인 데이터는 HTML에 싣지 않는다(첫 화면이 데이터를 기다려 늦어지지 않는다).
 * 열면: ① 기기 저장소(IndexedDB)에서 거울과 보낼 줄을 읽어 바로 그린다(네트워크 없이). ② 뒤에서 보낼 줄을 보내고 서버 것을 받아 맞춘다.
 * 이 기기에서 처음 쓰는 사용자(기기에 거울이 없음)만 서버 사본이 올 때까지 「불러오는 중」을 보인다(연결이 없거나 8초가 지나면 그냥 연다: 읽기 실패 안내가 뜬다).
 * 이 기기에 남은 다른 사용자의 기기 저장소는 지운다(로그아웃 없이 계정이 바뀐 경우).
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

export function LocalAppShell({ userKey, initialOpen = null }: { userKey: string; initialOpen?: "evening" | null }) {
  const [bundle, setBundle] = useState<LocalBundle | null>(null);
  const [, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    let stopSync = () => {};
    const runtime = createBrowserRuntime(userKey);
    const apis = createLocalApis(runtime);
    void (async () => {
      await runtime.boot();
      await runtime.wipeOthers();
      migrateLegacyOutbox(runtime, userKey);
      if (!alive) return;
      stopSync = startBrowserSync(runtime);
      if (!runtime.getMirror().synced && runtime.isOnline()) {
        // 이 기기에서 처음: 서버 사본이 오기 전에는 비어 있는 것인지 아직 모르는 것인지 알 수 없다
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([runtime.pull(), new Promise((resolve) => (timer = setTimeout(resolve, FIRST_PULL_WAIT_MS)))]);
        clearTimeout(timer);
      }
      if (alive) setBundle({ runtime, apis });
    })();
    return () => {
      alive = false;
      stopSync();
      void runtime.persistNow();
      runtime.stop();
    };
  }, [userKey]);

  // 서버에서 받아 맞춘 것(다른 기기에서 처음 설정을 마친 경우 등)이 입구 판단에도 닿게 거울이 바뀔 때 다시 그린다
  useEffect(() => {
    if (!bundle) return;
    return bundle.runtime.subscribe(() => setVersion((n) => n + 1));
  }, [bundle]);

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
