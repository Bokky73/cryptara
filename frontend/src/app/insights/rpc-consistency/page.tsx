import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { ConsistencyWorkbench } from "@/components/research/rpc-consistency/ConsistencyWorkbench";
import type { NetworkId } from "@/server/research/rpc-consistency/schema";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Horizon and RPC consistency",
  description: "Compare Horizon and Stellar RPC answers for the same account or contract, and separate lag from conflict.",
};

function networkFromQuery(value: string | undefined): NetworkId | null {
  if (value === "testnet" || value === "mainnet") return value;

  return null;
}

export default async function RpcConsistencyPage({
  searchParams,
}: {
  searchParams: Promise<{ network?: string; target?: string }>;
}) {
  const params = await searchParams;

  return (
    <InsightPageShell
      id="rpc-consistency"
      title="Horizon and RPC consistency"
      description="Horizon and Stellar RPC can answer the same question at different ledgers. This check reads balances, sequence, trustlines, and contract data from both, records the ledger on each answer, and classifies the result. A gap between ledgers is lag. A different value at the same ledger is a conflict, shown with both raw values. If one provider is down, the page says the result is single-source. Testnet and mainnet are never mixed."
    >
      <ConsistencyWorkbench initialNetwork={networkFromQuery(params.network)} initialTarget={params.target ?? null} />
    </InsightPageShell>
  );
}
