const CACHE = "teachersheet-shell-v1";
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"]))));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((r) => r || caches.match("/"))));
});
