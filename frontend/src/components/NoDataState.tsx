"use client";

import Link from "next/link";
import { AlertCircle, AlertTriangle, ArrowRight, RefreshCw, ShieldAlert, WifiOff, WalletCards } from "lucide-react";

type NoDataReason = "wallet_missing" | "provider_timeout" | "missing_contract" | "rate_limited" | "generic";

type NoDataStateProps = {
  title: string;
  detail: string;
  action?: string;
  reason?: NoDataReason;
  actionButton?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  onRetry?: () => void;
};

export function NoDataState({
  title,
  detail,
  action = "Manual review required. No mock data used.",
  reason,
  actionButton,
  onRetry,
}: NoDataStateProps) {
  // Infer reason if not explicitly provided
  const inferredReason: NoDataReason = reason ?? (
    title.toLowerCase().includes("wallet") || title.toLowerCase().includes("portfolio")
      ? "wallet_missing"
      : title.toLowerCase().includes("timeout") || title.toLowerCase().includes("unavailable") || title.toLowerCase().includes("provider")
        ? "provider_timeout"
        : "generic"
  );

  const isWallet = inferredReason === "wallet_missing";
  const isTimeout = inferredReason === "provider_timeout";

  const Icon = isWallet ? WalletCards : isTimeout ? WifiOff : ShieldAlert;
  const containerBorder = isWallet
    ? "border-sky-400/30 bg-sky-500/[0.04]"
    : isTimeout
      ? "border-amber-400/30 bg-amber-500/[0.04]"
      : "border-[#d9a441]/25 bg-[#d9a441]/8";

  const badgeColor = isWallet
    ? "text-sky-300 border-sky-400/30 bg-sky-400/10"
    : isTimeout
      ? "text-amber-300 border-amber-400/30 bg-amber-400/10"
      : "text-[#d9a441] border-[#d9a441]/30 bg-[#d9a441]/10";

  return (
    <section
      className={`rounded-[24px] border p-6 transition-all ${containerBorder}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${badgeColor}`}>
          <Icon className="h-3.5 w-3.5" />
          <span>{isWallet ? "Optional Input Needed" : isTimeout ? "Provider Unavailable" : "Data Unavailable"}</span>
        </div>
        <span className="text-[11px] text-white/40">Zero-Mock Enforcement</span>
      </div>

      <h3 className="mt-3 text-xl font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-white/60">{detail}</p>

      {isWallet ? (
        <div className="mt-4 rounded-xl border border-sky-400/20 bg-sky-950/20 p-3 text-xs text-sky-200/90">
          Portfolio analysis requires a connected EVM or Stellar wallet to inspect token balance concentration and liquidity risk. It never generates speculative mock balances.
        </div>
      ) : isTimeout ? (
        <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-950/20 p-3 text-xs text-amber-200/90">
          Upstream RPC or external provider timed out. In production live mode, mock fallbacks are strictly blocked to prevent misleading security audits.
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/70">
        <span className="text-xs leading-5 text-white/55">{action}</span>

        <div className="flex flex-wrap items-center gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry Agent
            </button>
          ) : null}

          {actionButton ? (
            actionButton.href ? (
              <Link
                href={actionButton.href}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#d9a441] px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-[#f2c86d]"
              >
                {actionButton.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={actionButton.onClick}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#d9a441] px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-[#f2c86d]"
              >
                {actionButton.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )
          ) : isWallet ? (
            <Link
              href="/#connect"
              className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-400"
            >
              Connect Wallet
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
