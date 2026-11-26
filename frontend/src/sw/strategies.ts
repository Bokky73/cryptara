import { CACHE_VERSION } from "./cacheVersion";

export const APP_SHELL_URLS = [
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

export const NETWORK_ONLY_API_PREFIXES = [
  "/api/execute",
  "/api/auto-mode",
  "/api/wallet",
  "/api/session",
  "/api/x402",
];

export function isNetworkOnlyApi(pathname: string) {
  return pathname.startsWith("/api/") || NETWORK_ONLY_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isNeverCached(request: Request) {
  const url = new URL(request.url);
  return isNetworkOnlyApi(url.pathname) || url.pathname.startsWith("/api/") || request.method !== "GET";
}

export async function networkOnly(request: Request) {
  return fetch(request, { cache: "no-store" });
}

export async function cacheFirst(request: Request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

export async function shellNavigation(request: Request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(CACHE_VERSION);
    return (await cache.match("/offline")) ?? Response.error();
  }
}
