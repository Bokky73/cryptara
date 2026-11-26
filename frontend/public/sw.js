const CACHE_VERSION = "gr-shell-v1";
const APP_SHELL_URLS = [
  "/",
  "/dashboard",
  "/scan",
  "/strategy",
  "/offline",
  "/manifest.webmanifest",
  "/brand/logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const NETWORK_ONLY_API_PREFIXES = [
  "/api/execute",
  "/api/auto-mode",
  "/api/wallet",
  "/api/session",
  "/api/x402",
];

function isNetworkOnlyApi(pathname) {
  return pathname.startsWith("/api/") || NETWORK_ONLY_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isNeverCached(request) {
  const url = new URL(request.url);
  return isNetworkOnlyApi(url.pathname) || url.pathname.startsWith("/api/") || request.method !== "GET";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (isNetworkOnlyApi(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
  if (isNeverCached(request)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.open(CACHE_VERSION).then((cache) => cache.match("/offline"))) || Response.error()),
    );
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/"))) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
  }
});
