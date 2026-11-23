"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CommandTrigger } from "@/components/commandPalette/CommandTrigger";
import type { SessionAsset } from "@/lib/commandPalette/schema";

type NavItem = { href: string; label: string };
type NavPillar = { id: string; label: string; items: NavItem[] };

const navPillars: NavPillar[] = [
  {
    id: "scan",
    label: "Scan",
    items: [
      { href: "/scan", label: "Scan" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
  {
    id: "portfolio",
    label: "Portfolio & Watchlist",
    items: [
      { href: "/watchlist", label: "Watchlist" },
      { href: "/alerts", label: "Alerts" },
    ],
  },
  {
    id: "insights",
    label: "Insights Hub",
    items: [{ href: "/insights", label: "Insights Hub" }],
  },
  {
    id: "strategy",
    label: "Strategy & Execution",
    items: [
      { href: "/strategy", label: "Strategy" },
      { href: "/rules", label: "Rules" },
      { href: "/agents", label: "Agents" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { href: "/history", label: "History" },
      { href: "/operations", label: "Operations" },
      { href: "/recovery", label: "Recovery" },
    ],
  },
];

const navLinkClassName =
  "rounded-full px-4 py-2 text-sm text-[var(--color-nav-fg)] transition hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-fg)] focus-visible:bg-white/8 focus-visible:text-white";
const activeNavLinkClassName =
  "rounded-full bg-[var(--color-nav-hover-bg)] px-4 py-2 text-sm font-semibold text-[var(--color-fg)] underline decoration-2 underline-offset-4";
const mobileNavLinkClassName =
  "shrink-0 rounded-full px-3 py-2 text-sm text-[var(--color-nav-fg)] hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-fg)] focus-visible:bg-white/8 focus-visible:text-white";
const activeMobileNavLinkClassName =
  "shrink-0 rounded-full bg-[var(--color-nav-hover-bg)] px-3 py-2 text-sm font-semibold text-[var(--color-fg)] underline decoration-2 underline-offset-4";

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children, commandAssets }: { children: ReactNode; commandAssets?: readonly SessionAsset[] }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const node = drawerRef.current;
    if (!node) return;

    const focusable = node.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, closeDrawer]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-header-bg)] backdrop-blur-2xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/brand/logo.png"
              alt="Cryptara guardian emblem"
              width={44}
              height={44}
              className="rounded-2xl border border-[var(--color-border)]"
              priority
            />
            <div>
              <div className="text-sm font-semibold tracking-[0.18em] text-brand">CRYPTARA</div>
            </div>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-bg)] p-1 md:flex">
            {navPillars.map((pillar) => {
              const pillarActive = pillar.items.some((item) => isActive(pathname, item.href));
              return (
                <div key={pillar.id} className="group relative">
                  <Link
                    href={pillar.items[0].href}
                    className={pillarActive ? activeNavLinkClassName : navLinkClassName}
                    aria-current={pillarActive ? "page" : undefined}
                  >
                    {pillar.label}
                  </Link>
                  {pillar.items.length > 1 ? (
                    <div className="invisible absolute left-0 top-full z-40 min-w-48 rounded-2xl border border-[var(--color-border)] bg-[var(--color-header-bg)] p-1 opacity-0 shadow-xl transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                      {pillar.items.map((item) => {
                        const active = isActive(pathname, item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={`block rounded-xl px-3 py-2 text-sm transition hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-fg)] ${active ? "font-semibold text-[var(--color-fg)]" : "text-[var(--color-nav-fg)]"}`}
                            aria-current={active ? "page" : undefined}
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <CommandTrigger assets={commandAssets} />
            <ThemeToggle />
            <WalletConnectButton />
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              aria-controls="mobile-nav-drawer"
              aria-label="Open navigation menu"
              className="rounded-full border border-[var(--color-border)] p-2 text-[var(--color-nav-fg)] hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] md:hidden"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <div
            id="mobile-nav-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="absolute right-0 top-0 flex h-full w-80 max-w-[85vw] flex-col gap-4 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-header-bg)] p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold tracking-[0.18em] text-brand">CRYPTARA</span>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close navigation menu"
                className="rounded-full border border-[var(--color-border)] p-2 text-[var(--color-nav-fg)] hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <nav aria-label="Primary, mobile" className="flex flex-col gap-4">
              {navPillars.map((pillar) => (
                <div key={pillar.id} className="flex flex-col gap-1">
                  <span className="px-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-nav-fg)]">
                    {pillar.label}
                  </span>
                  {pillar.items.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={active ? activeMobileNavLinkClassName : mobileNavLinkClassName}
                        aria-current={active ? "page" : undefined}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
      <OfflineBanner />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-7xl px-5 py-6 outline-none sm:px-8 sm:py-8">
        {children}
      </main>
    </div>
  );
}
