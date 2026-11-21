import Link from "next/link";
import { ArrowRight, Bot, CheckCircle2, Newspaper, RadioTower, Search, ShieldCheck, WalletCards } from "lucide-react";

type AgentContribution = {
  agent: string;
  role: string;
  weight: number;
  riskImpact: number | null; // null if skipped
  status: "active" | "skipped" | "ready";
  statusText: string;
  color: string;
  icon: typeof ShieldCheck;
  href: string;
};

const AGENT_CONTRIBUTIONS: AgentContribution[] = [
  {
    agent: "Onchain Agent",
    role: "Contract Guard",
    weight: 40,
    riskImpact: 42,
    status: "active",
    statusText: "+42 risk points (Liquidity & Permissions)",
    color: "bg-red-400",
    icon: ShieldCheck,
    href: "/scan",
  },
  {
    agent: "Social Agent",
    role: "Hype & Shill Monitor",
    weight: 25,
    riskImpact: 12,
    status: "active",
    statusText: "+12 risk points (Bot farm volume)",
    color: "bg-amber-400",
    icon: RadioTower,
    href: "/scan",
  },
  {
    agent: "News Agent",
    role: "Catalyst Auditor",
    weight: 15,
    riskImpact: 5,
    status: "active",
    statusText: "+5 risk points (Unverified story)",
    color: "bg-sky-400",
    icon: Newspaper,
    href: "/scan",
  },
  {
    agent: "Portfolio Agent",
    role: "Portfolio Keeper",
    weight: 20,
    riskImpact: null,
    status: "skipped",
    statusText: "Skipped (Connect wallet to enable)",
    color: "bg-purple-400",
    icon: WalletCards,
    href: "/#connect",
  },
];

export function AgentNetworkSummaryCard() {
  return (
    <section className="glass-panel rounded-[28px] p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d9a441]">Agent Pipeline</div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Factor Weights &amp; Risk Contribution</h2>
          <p className="mt-1 text-xs text-white/50">
            How parallel agents feed into the deterministic Decision Core (Total Weight: 100%).
          </p>
        </div>
        <Link
          href="/agents"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          Inspect Network
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Factor Weight Bar Overview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-white/60">
          <span>Weighted Risk Synthesis</span>
          <span className="font-mono text-[#f2c86d]">Sum: 100% Weight</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10 flex" role="progressbar" aria-label="Agent weights">
          <div style={{ width: "40%" }} className="bg-[#ef4444]" title="Contract Guard: 40%" />
          <div style={{ width: "25%" }} className="bg-[#f59e0b]" title="Social Monitor: 25%" />
          <div style={{ width: "15%" }} className="bg-[#38bdf8]" title="Catalyst Auditor: 15%" />
          <div style={{ width: "20%" }} className="bg-[#a855f7]" title="Portfolio Keeper: 20%" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/45">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#ef4444]" /> Contract 40%</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#f59e0b]" /> Social 25%</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#38bdf8]" /> News 15%</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#a855f7]" /> Portfolio 20%</span>
        </div>
      </div>

      {/* Per-Agent Contribution Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {AGENT_CONTRIBUTIONS.map((item) => {
          const Icon = item.icon;
          const isSkipped = item.status === "skipped";

          return (
            <Link
              key={item.role}
              href={item.href}
              className={`flex flex-col justify-between rounded-2xl border p-4 transition ${
                isSkipped
                  ? "border-white/10 bg-white/[0.02] hover:border-white/20"
                  : "border-white/10 bg-white/[0.045] hover:border-[#d9a441]/40"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-[#d9a441]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="rounded-md border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] font-mono text-white/60">
                    {item.weight}% Wt
                  </span>
                </div>

                <div className="mt-3">
                  <div className="text-sm font-semibold text-white">{item.role}</div>
                  <div className="text-[11px] text-white/40">{item.agent}</div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-white/5">
                {isSkipped ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-purple-300/80">
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                    Skipped (No wallet)
                  </span>
                ) : (
                  <div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/45">Contribution</span>
                      <span className="font-mono font-semibold text-white">+{item.riskImpact} pts</span>
                    </div>
                    <div className="mt-1 h-1 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        style={{ width: `${item.riskImpact}%` }}
                        className={`h-full ${item.color}`}
                      />
                    </div>
                  </div>
                )}
                <div className="mt-2 text-[10px] leading-4 text-white/40 line-clamp-1">{item.statusText}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
