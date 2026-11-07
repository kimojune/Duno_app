// duno 서비스 워커 (직접 작성, 도구 없음)
// 저장하는 것: /_next/static/ 아래 해시 파일, 아이콘, manifest, 오프라인 안내 화면 하나
// 저장하지 않는 것: 화면 HTML(탐색 응답), RSC 응답, /auth/ 경로, 외부(Supabase 등) 요청, GET 아닌 요청
// 사용자 데이터가 로그아웃 뒤 캐시에 남지 않게 하려는 것이다.
// skipWaiting·clients.claim을 쓰지 않는다: 앱을 모두 닫았다 다시 열 때 새 버전이 적용된다.

const VERSION = "v2"; // 오프라인 화면(offline.html)이 바뀌어 올렸다
const CACHE_PREFIX = "duno-";
const CACHE_NAME = CACHE_PREFIX + VERSION;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];

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
// 보내는 쪽은 본문 없이 신호만 보낸다(본문 암호화에는 새 패키지가 필요할 수 있어 이번 틀에서는 쓰지 않는다. docs/oneshot-v2/임시값.md ⑦).
// 그래서 어느 알림인지는 이 서비스 워커가 지금 서울 시각으로 가른다: 오후 3시 전이면 아침 알림, 아니면 저녁 알림(임시).
// 저녁 알림을 누르면 저녁 기록이 열린다(/?open=evening). 글은 어미 없는 이름표와 해요체 한 문장이고 재촉하지 않는다.
const EVENING_FROM_HOUR = 15;

function seoulHourNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const part = parts.find((p) => p.type === "hour");
  return Number(part ? part.value : "0");
}

self.addEventListener("push", (event) => {
  const evening = seoulHourNow() >= EVENING_FROM_HOUR;
  const title = evening ? "저녁 기록" : "오늘 먼저 할 일";
  const options = {
    body: evening ? "오늘 몇 시간 썼어요?" : "앱을 열어 오늘 할 일을 시작해 보세요",
    tag: evening ? "duno-evening" : "duno-morning",
    icon: "/icon-192.png",
    data: { url: evening ? "/?open=evening" : "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const url = data && typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("navigate" in client && "focus" in client) return client.navigate(url).then((c) => (c || client).focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});
