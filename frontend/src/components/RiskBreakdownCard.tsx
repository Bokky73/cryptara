import type { RiskBreakdownItem } from "@/server/types";
import Link from "next/link";

type RiskTier = "critical" | "warning" | "strength";

function tierFor(score: number): RiskTier {
  if (score >= 70) return "critical";
  if (score >= 40) return "warning";
  return "strength";
}

const tierMeta: Record<RiskTier, { label: string; icon: string; bar: string; text: string; dot: string }> = {
  critical: {
    label: "Critical flag",
    icon: "\u26A0",
    bar: "bg-red-300",
    text: "text-red-200",
    dot: "bg-red-300",
  },
  warning: {
    label: "Warning",
    icon: "\u25B2",
    bar: "bg-[#d9a441]",
    text: "text-[#e6c47a]",
    dot: "bg-[#d9a441]",
  },
  strength: {
    label: "Strength",
    icon: "\u2713",
    bar: "bg-emerald-300",
    text: "text-emerald-200",
    dot: "bg-emerald-300",
  },
};

const tierOrder: RiskTier[] = ["critical", "warning", "strength"];

function isMissing(item: RiskBreakdownItem) {
  return item.score === 0 && /missing|unavailable|no data|not available|unknown/i.test(item.finding);
}

export function RiskBreakdownCard({ items }: { items: RiskBreakdownItem[] }) {
  const grouped = tierOrder.map((tier) => ({
    tier,
    items: items.filter((item) => tierFor(item.score) === tier),
  }));

  return (
    <section className="glass-panel rounded-[28px] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Why this is risky</h2>
          <p className="mt-1 text-sm text-white/54">Top drivers in plain language, grouped by severity.</p>
        </div>
        <Link href="/insights/proxy-inspector" className="inline-flex shrink-0 rounded-full border border-white/15 px-4 py-2 text-sm">
          Inspect proxy implementation
        </Link>
      </div>
      <div className="mt-6 space-y-6">
        {grouped.map(({ tier, items: tierItems }) => {
          if (tierItems.length === 0) return null;
          const meta = tierMeta[tier];
          return (
            <div key={tier}>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/54">
                <span aria-hidden="true" className={meta.text}>{meta.icon}</span>
                <span>{meta.label}s</span>
              </div>
              <ul className="space-y-3">
                {tierItems.slice(0, 5).map((item) => {
                  const missing = isMissing(item);
                  return (
                    <li key={item.key} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                      <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                        <span className="flex items-center gap-2 font-medium text-white/78">
                          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${missing ? "bg-white/30" : meta.dot}`} />
                          {item.label}
                        </span>
                        {missing ? (
                          <span className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/54">Data missing</span>
                        ) : (
                          <span className="text-white/54">{item.score}/100</span>
                        )}
                      </div>
                      {!missing && (
                        <div className="h-2 overflow-hidden rounded-full bg-white/8">
                          <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${item.score}%` }} />
                        </div>
                      )}
                      <div className="mt-2 text-xs leading-5 text-white/42">{item.finding}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
