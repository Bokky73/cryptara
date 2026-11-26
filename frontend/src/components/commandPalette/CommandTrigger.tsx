"use client";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWalletSessionContext } from "@/providers/WalletSessionProvider";
import { isPaletteShortcut } from "@/lib/commandPalette/shortcuts";
import { insightSlugFromPath } from "@/lib/commandPalette/insights";
import { recordInsightVisit } from "@/lib/commandPalette/persistedRecents";
import { scopeKey } from "@/lib/commandPalette/scope";
import type { PaletteScope, SessionAsset } from "@/lib/commandPalette/schema";
const LazyPalette = dynamic(() => import("./CommandPalette").then(module => module.CommandPalette), { ssr: false,
  loading: () => <span role="status">Opening search…</span> });
const EMPTY: readonly SessionAsset[] = [];
function ScopedTrigger({ scope, assets }: { scope: PaletteScope | null; assets: readonly SessionAsset[] }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => { const slug = insightSlugFromPath(pathname); if (slug) recordInsightVisit(slug); }, [pathname]);
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => { if (isPaletteShortcut(event)) { event.preventDefault(); setLoaded(true); setOpen(value => !value); } };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, []);
  return <><button type="button" aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts="Control+k Meta+k" aria-label="Search routes and insights" onClick={() => { setLoaded(true); setOpen(true); }}
    className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]">Search</button>
    {loaded && <LazyPalette open={open} scope={scope} assets={assets} close={() => setOpen(false)} navigate={href => router.push(href)} />}</>;
}
export function CommandTrigger({ assets = EMPTY }: { assets?: readonly SessionAsset[] }) {
  // The read-only context avoids the challenge/signature side effects of useWalletSession().
  const session = useWalletSessionContext();
  const scope: PaletteScope | null = session.isConnected && session.address && session.family
    ? { wallet: session.address, family: session.family, network: session.family === "stellar" ? session.stellar.network : String(session.chainId ?? "") } : null;
  return <ScopedTrigger key={scopeKey(scope)} scope={scope} assets={assets} />;
}
