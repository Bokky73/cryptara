import { CACHE_VERSION } from "./cacheVersion";
import { APP_SHELL_URLS, cacheFirst, isNetworkOnlyApi, isNeverCached, networkOnly, shellNavigation } from "./strategies";

declare const self: ServiceWorkerGlobalScope;

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
    event.respondWith(networkOnly(request));
    return;
  }

  if (isNeverCached(request)) return;

  if (request.mode === "navigate") {
    event.respondWith(shellNavigation(request));
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/"))) {
    event.respondWith(cacheFirst(request));
  }
});
