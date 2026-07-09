// Bump this when the caching behaviour changes so `activate` purges older
// caches. Assets are content-hashed by Vite and served network-first, so a new
// deployment is picked up without a name change; the version guards behaviour.
const CACHE_NAME = "assalto-reale-web-v2";

// Relative to the service-worker scope, so this is correct under any base path
// (e.g. "/Assalto-Reale/").
const APP_SHELL = ["./", "./manifest.webmanifest"];

// Never cache release metadata: it must always reflect the live deployment.
const NO_CACHE = /release-metadata\.json$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (NO_CACHE.test(new URL(event.request.url).pathname)) return; // network-only

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache genuinely successful, non-opaque responses. This avoids
        // storing 404.html (returned with a 404 status for SPA deep links) or
        // other error responses as if they were valid application assets.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === "navigate") return caches.match("./");
          return Response.error();
        }),
      ),
  );
});
