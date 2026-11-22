import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CommandTrigger } from "@/components/commandPalette/CommandTrigger";
import type { SessionAsset } from "@/lib/commandPalette/schema";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/agents", label: "Agents" },
  { href: "/scan", label: "Scan" },
  { href: "/strategy", label: "Strategy" },
  { href: "/alerts", label: "Alerts" },
  { href: "/history", label: "History" },
  { href: "/recovery", label: "Recovery" },
];

const navLinkClassName =
  "rounded-full px-4 py-2 text-sm text-[var(--color-nav-fg)] transition hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-fg)] focus-visible:bg-white/8 focus-visible:text-white";
const mobileNavLinkClassName =
  "shrink-0 rounded-full px-3 py-2 text-sm text-[var(--color-nav-fg)] hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-fg)] focus-visible:bg-white/8 focus-visible:text-white";

// WCAG 2.2 AA target size (2.5.8): interactive controls must be at least
// 24x24 CSS px, and 44x44 on touch/mobile. Applied to the header controls.
const headerControlClassName =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]";

export function AppShell({ children, commandAssets }: { children: ReactNode; commandAssets?: readonly SessionAsset[] }) {
  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      {/*
        Skip link: first focusable element on the page. Visually hidden until
        focused, then revealed so keyboard users can jump past the header nav
        straight to the main landmark.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-full focus:bg-[var(--color-fg)] focus:px-5 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--color-bg)] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[var(--color-focus)]"
      >
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
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={navLinkClassName}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className={headerControlClassName}>
              <CommandTrigger assets={commandAssets} />
            </div>
            <div className={headerControlClassName}>
              <ThemeToggle />
            </div>
            <div className={headerControlClassName}>
              <WalletConnectButton />
            </div>
          </div>
        </div>
        {/*
          A second landmark cannot share the first one's name: a screen-reader
          user listing landmarks would see "Primary" twice with no way to tell
          them apart. The compact bar also scrolls, so it is reachable by
          keyboard rather than by drag alone.
        */}
        <nav
          aria-label="Primary, compact"
          tabIndex={0}
          className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-5 pb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] md:hidden"
        >
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className={mobileNavLinkClassName}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <OfflineBanner />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-7xl px-5 py-6 outline-none sm:px-8 sm:py-8">
        {children}
      </main>
    </div>
  );
}
