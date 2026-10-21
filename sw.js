// sw.js — 한 번 열어 본 파일은 저장해 두었다가, 인터넷이 없을 때 꺼내 쓰는 서비스 워커
// 인터넷이 되면 항상 최신 파일을 먼저 가져오므로, GitHub에 올린 수정이 바로 반영돼요.
const CACHE = "jjal-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  // AI 서버 등 다른 주소 요청은 건드리지 않아요
  if (req.method !== "GET" || url.origin !== location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("index.html")))
  );
});
