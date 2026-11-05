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
