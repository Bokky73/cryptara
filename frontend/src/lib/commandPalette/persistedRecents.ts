import type { ScanRequest } from "./scanTarget";

const STORE_KEY = "cryptara:palette-recents:v1";
const CHANGED_EVENT = "cryptara:palette-recents-changed";
const MAX_RECENTS = 5;

export type PaletteRecents = { insights: string[]; scans: ScanRequest[] };

export function recentsSnapshot(): string {
  try { return window.localStorage.getItem(STORE_KEY) ?? ""; } catch { return ""; }
}

export function parseRecents(raw: string): PaletteRecents {
  try {
    const value = JSON.parse(raw);
    return {
      insights: (Array.isArray(value?.insights) ? value.insights : []).filter((item: unknown) => typeof item === "string").slice(0, MAX_RECENTS),
      scans: (Array.isArray(value?.scans) ? value.scans : []).filter((item: Partial<ScanRequest> | null) =>
        typeof item?.query === "string" && typeof item.chain === "string").slice(0, MAX_RECENTS),
    };
  } catch { return { insights: [], scans: [] }; }
}

export function readPaletteRecents(): PaletteRecents { return parseRecents(recentsSnapshot()); }

function write(next: PaletteRecents) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { return; }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function recordInsightVisit(slug: string) {
  const current = readPaletteRecents();
  write({ ...current, insights: [slug, ...current.insights.filter(item => item !== slug)].slice(0, MAX_RECENTS) });
}

export function recordScannedAsset(request: ScanRequest) {
  const current = readPaletteRecents();
  const others = current.scans.filter(item => item.query !== request.query || item.chain !== request.chain);
  write({ ...current, scans: [{ query: request.query, chain: request.chain }, ...others].slice(0, MAX_RECENTS) });
}

/** Part of wallet data erasure. */
export function clearPaletteRecents() {
  try { window.localStorage.removeItem(STORE_KEY); } catch { return; }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function subscribeRecents(listener: () => void) {
  window.addEventListener(CHANGED_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(CHANGED_EVENT, listener); window.removeEventListener("storage", listener); };
}
