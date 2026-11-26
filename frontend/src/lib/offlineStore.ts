import type { PortfolioSnapshot, TokenScanResult } from "@/server/types";

const STORE_KEY = "cryptara:offline-readonly:v1";

export type OfflineCapture<T> = {
  id: string;
  capturedAt: string;
  source: string;
  data: T;
};

export type OfflineReadOnlyState = {
  scans: OfflineCapture<TokenScanResult>[];
  portfolios: OfflineCapture<PortfolioSnapshot>[];
};

const emptyState: OfflineReadOnlyState = { scans: [], portfolios: [] };

function loadState(): OfflineReadOnlyState {
  if (typeof window === "undefined") return emptyState;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "");
    return {
      scans: Array.isArray(parsed?.scans) ? parsed.scans : [],
      portfolios: Array.isArray(parsed?.portfolios) ? parsed.portfolios : [],
    };
  } catch {
    return emptyState;
  }
}

function saveState(state: OfflineReadOnlyState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function upsert<T>(items: OfflineCapture<T>[], item: OfflineCapture<T>) {
  return [item, ...items.filter((entry) => entry.id !== item.id)].slice(0, 8);
}

export function readOfflineState() {
  return loadState();
}

export function captureOfflineScan(scan: TokenScanResult, source = "token scan") {
  const state = loadState();
  saveState({
    ...state,
    scans: upsert(state.scans, {
      id: `${scan.chain}:${scan.symbol}:${scan.normalizedInput?.contractAddress ?? scan.normalizedInput?.assetKey ?? Date.now()}`,
      capturedAt: new Date().toISOString(),
      source,
      data: scan,
    }),
  });
}

export function captureOfflinePortfolio(portfolio: PortfolioSnapshot, source = "portfolio") {
  const state = loadState();
  saveState({
    ...state,
    portfolios: upsert(state.portfolios, {
      id: portfolio.walletAddress,
      capturedAt: new Date().toISOString(),
      source,
      data: portfolio,
    }),
  });
}

function mentionsWallet(value: unknown, wallet: string) {
  return (JSON.stringify(value) ?? "").toLowerCase().includes(wallet);
}

/**
 * Drop every offline capture that carries the given wallet address. Captures of
 * public token data that never mention the wallet are kept.
 */
export function clearWalletOfflineEntries(walletAddress: string) {
  if (typeof window === "undefined") return;
  const wallet = walletAddress.trim().toLowerCase();
  if (!wallet) return;

  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw || !raw.toLowerCase().includes(wallet)) return;

    const state = loadState();
    const next: OfflineReadOnlyState = {
      scans: state.scans.filter((entry) => !mentionsWallet(entry, wallet)),
      portfolios: state.portfolios.filter((entry) => !mentionsWallet(entry, wallet)),
    };

    // Removing first means a failed rewrite still leaves no wallet data behind.
    window.localStorage.removeItem(STORE_KEY);
    if (next.scans.length + next.portfolios.length > 0) saveState(next);
  } catch {
    // Storage can be unavailable; there is nothing left to clear in that case.
  }
}

/** Remove service-worker page copies whose URL contains the wallet address. */
export async function clearWalletPageCache(walletAddress: string) {
  if (typeof window === "undefined" || !("caches" in window)) return;
  const wallet = walletAddress.trim().toLowerCase();
  if (!wallet) return;

  try {
    for (const name of await window.caches.keys()) {
      const cache = await window.caches.open(name);
      for (const request of await cache.keys()) {
        if (request.url.toLowerCase().includes(wallet)) await cache.delete(request);
      }
    }
  } catch {
    // Cache Storage is unavailable in private or insecure contexts.
  }
}
