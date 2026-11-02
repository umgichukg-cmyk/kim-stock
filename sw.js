// 김가네 주식 서비스 워커 - 홈 화면 앱 설치와 오프라인 안내용
// 시세는 늘 최신이어야 해서 화면·API는 저장해 두지 않고 항상 인터넷에서 받아요.
// 인터넷이 끊겼을 때만 미리 저장해 둔 "연결 없음" 화면을 보여줍니다.
const CACHE = "kimga-offline-v1";
const OFFLINE = ["/offline.html", "/assets/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // 예전 버전 저장소는 지움
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return; // 페이지 이동만 처리, 나머지는 브라우저 기본 동작
  e.respondWith(fetch(e.request).catch(() => caches.match("/offline.html")));
});
