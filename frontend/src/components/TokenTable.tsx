import Link from "next/link";
import type { TokenHolding } from "@/server/types";
import { formatPercent, formatUsd } from "@/lib/format";
import { DataTable } from "@/components/layout/DataTable";

export function TokenTable({ holdings }: { holdings: TokenHolding[] }) {
  return (
    <section className="glass-panel rounded-[28px] p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Token exposure</h2>
        </div>
        <Link
          href="/insights/liquidity-depth"
          className="text-xs text-muted underline underline-offset-2 transition hover:text-[var(--color-fg)]"
        >
          Liquidity depth workbench
        </Link>
      </div>
      <DataTable caption="Token exposure by holding" minWidth={680}>
          <thead className="text-xs uppercase tracking-[0.16em] text-white/36">
            <tr>
              <th className="pb-3 font-medium">Token</th>
              <th className="pb-3 text-right font-medium">Balance</th>
              <th className="pb-3 text-right font-medium">Value</th>
              <th className="pb-3 text-right font-medium">Exposure</th>
              <th className="pb-3 text-right font-medium">Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/8">
            {holdings.map((holding) => (
              <tr key={holding.tokenAddress}>
                <td className="py-4">
                  <div className="font-semibold">{holding.symbol}</div>
                  <div className="text-xs text-white/42">{holding.name}</div>
                </td>
                <td className="py-4 text-right tabular-nums text-white/72">
                  {holding.balance.toLocaleString("en-US")}
                </td>
                <td className="py-4 text-right tabular-nums text-white/72">{formatUsd(holding.valueUsd)}</td>
                <td className="py-4 text-right tabular-nums text-white/72">
                  {formatPercent(holding.allocationPercent)}
                </td>
                <td className="py-4 text-right">
                  <span className="rounded-full border border-white/10 bg-white/7 px-3 py-1 text-xs tabular-nums">
                    {holding.riskScore}/100
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
      </DataTable>
    </section>
  );
}
