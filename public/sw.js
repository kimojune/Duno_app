// duno 서비스 워커 (직접 작성, 도구 없음)
// 저장하는 것: /_next/static/ 아래 해시 파일, 아이콘, manifest, 오프라인 안내 화면 하나
// 저장하지 않는 것: 화면 HTML(탐색 응답), RSC 응답, /auth/ 경로, 외부(Supabase 등) 요청, GET 아닌 요청
// 사용자 데이터가 로그아웃 뒤 캐시에 남지 않게 하려는 것이다.
// skipWaiting·clients.claim을 쓰지 않는다: 앱을 모두 닫았다 다시 열 때 새 버전이 적용된다.

const VERSION = "v4"; // 아이콘 이름이 icon-v2-*로 바뀌고 오프라인 화면 머리가 워드마크로 바뀌어 올렸다(고침 10바퀴). activate가 옛 판(duno-v3 등)을 지운다
const CACHE_PREFIX = "duno-";
const CACHE_NAME = CACHE_PREFIX + VERSION;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icon-v2-192.png", "/icon-v2-512.png", "/icon-v2-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
});

// 배포가 바뀌면 /_next/static 해시 파일 이름이 바뀐다. sw.js 자체는 안 바뀔 수 있어 activate에서는 못 치우므로,
// 저장할 때 /_next/static 항목 수를 MAX_STATIC개로 묶어 가장 오래된 것부터 지운다(keys()는 저장한 순서).
const MAX_STATIC = 60;

function trimStatic(cache) {
  return cache.keys().then((requests) => {
    const statics = requests.filter((r) => new URL(r.url).pathname.startsWith("/_next/static/"));
    return Promise.all(statics.slice(0, Math.max(0, statics.length - MAX_STATIC)).map((r) => cache.delete(r)));
  });
}

function isStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/") || /^\/icon-[^/]+\.png$/.test(pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase 등 외부 도메인은 건드리지 않는다
  if (url.pathname.startsWith("/auth/")) return;

  // 화면 탐색: 네트워크로만 보내고, 실패하면 오프라인 안내 화면. 응답은 저장하지 않는다.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((res) => res || Response.error())),
    );
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((res) => {
              if (!res.ok) return res;
              return cache.put(request, res.clone()).then(() => trimStatic(cache)).then(() => res);
            }),
        ),
      ),
    );
    return;
  }

  if (url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request).then((res) => res || Response.error())),
    );
  }
  // 그 밖(RSC 응답 등)은 가로채지 않는다.
});

// ---- 알림(PRD 7-8, ⑦) ----
// 보내는 쪽은 본문 없이 신호만 보낸다(본문 암호화에는 새 패키지가 필요할 수 있어 쓰지 않는다. docs/oneshot-v2/임시값.md ⑦).
// 신호를 받으면 이 서비스 워커가 서버(GET /api/notify/next)에 「지금 보낼 알림이 무엇인가」를 물어 종류·글·여는 주소를 받는다(로그인 쿠키로 자기 것만).
// 그래서 아침·저녁 알림 시각은 어디에 두어도 된다. 서버가 아침·저녁 알림을 서로 다른 알림으로 가른다(고침 3바퀴, PM 답 d-69).
// 서버에 닿지 못하거나(끊김·로그인 풀림) 보낼 알림이 없다고 하면 시각을 짐작하지 않고 중립 알림 하나를 보인다(알림을 안 보이면 브라우저가 대신 보인다).
// 알림을 누르면 알림 글이 정한 주소가 열린다(저녁 기록은 /?open=evening). 글은 재촉하지 않는다.
const NEXT_URL = "/api/notify/next";
const NEXT_TIMEOUT_MS = 8000;
const NEUTRAL = { title: "두노", body: "앱을 열어 오늘을 확인해 보세요", tag: "duno-neutral", url: "/" };

function cleanItem(item) {
  if (!item || typeof item !== "object") return null;
  const text = (value) => (typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null);
  const title = text(item.title);
  const body = text(item.body);
  const tag = text(item.tag);
  const url = typeof item.url === "string" && item.url.startsWith("/") && !item.url.startsWith("//") ? item.url : "/";
  return title && body && tag ? { title, body, tag, url } : null;
}

function loadNotifications() {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), NEXT_TIMEOUT_MS) : null;
  return fetch(NEXT_URL, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, signal: controller ? controller.signal : undefined })
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      const items = body && body.ok === true && body.data && Array.isArray(body.data.items) ? body.data.items.map(cleanItem).filter(Boolean).slice(0, 2) : [];
      return items.length > 0 ? items : [NEUTRAL];
    })
    .catch(() => [NEUTRAL])
    .then((items) => {
      if (timer) clearTimeout(timer);
      return items;
    });
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    loadNotifications().then((items) =>
      Promise.all(
        items.map((item) =>
          self.registration.showNotification(item.title, { body: item.body, tag: item.tag, icon: "/icon-v2-192.png", data: { url: item.url } }),
        ),
      ),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const url = data && typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("navigate" in client && "focus" in client) return client.navigate(url).then((c) => (c || client).focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});
