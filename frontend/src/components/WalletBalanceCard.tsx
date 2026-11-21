import Link from "next/link";
import type { PortfolioSnapshot } from "@/server/types";
import { formatUsd } from "@/lib/format";
import { Orbit, Wallet } from "lucide-react";

export function WalletBalanceCard({ portfolio }: { portfolio: PortfolioSnapshot }) {
  const isDown = portfolio.dayChangePercent < 0;
  const isStellar = portfolio.nativeSymbol === "XLM";

  return (
    <section className="glass-panel rounded-[28px] p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          {isStellar ? (
            <Orbit className="h-4 w-4 text-purple-400" />
          ) : (
            <Wallet className="h-4 w-4 text-sky-400" />
          )}
          <span className="text-xs uppercase tracking-wider text-white/50">
            {isStellar ? "Stellar Native Balance" : "EVM Native Balance"}
          </span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase ${
            isStellar
              ? "bg-purple-400/20 text-purple-200 border border-purple-400/40"
              : "bg-sky-400/20 text-sky-200 border border-sky-400/40"
          }`}
        >
          {isStellar ? "Soroban / Stellar" : "EVM Compatible"}
        </span>
      </div>

      <div className="flex items-end gap-3">
        <div className="text-4xl font-semibold tracking-tight text-white">
          {portfolio.nativeBalance.toLocaleString("en-US")}
        </div>
        <div className="pb-1 text-lg font-medium text-[#d9a441]">{portfolio.nativeSymbol}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl border border-white/5 bg-white/6 p-4">
          <div className="text-white/45 text-xs">Total Portfolio Value</div>
          <div className="mt-1 text-2xl font-semibold text-white">{formatUsd(portfolio.totalValueUsd)}</div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-white/6 p-4">
          <div className="text-white/45 text-xs">24h Performance</div>
          <div className={isDown ? "mt-1 text-2xl font-semibold text-red-300" : "mt-1 text-2xl font-semibold text-emerald-300"}>
            {portfolio.dayChangePercent > 0 ? `+${portfolio.dayChangePercent}` : portfolio.dayChangePercent}%
          </div>
        </div>
      </div>

      {isStellar ? (
        <Link
          href="/insights/reserve-planner"
          className="inline-flex items-center gap-1.5 rounded-full border border-[#d9a441]/35 px-4 py-2 text-xs font-medium text-[#f2c86d] transition hover:bg-[#d9a441]/10"
        >
          Plan reserve and sponsorship changes →
        </Link>
      ) : null}
    </section>
  );
}
