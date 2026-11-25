import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { ReconciliationWorkbench } from "@/components/research/balance-reconciliation/ReconciliationWorkbench";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Balance reconciliation",
  description: "Rebuild a Stellar account balance from effects and compare it with the recorded end balance.",
};

export default async function BalanceReconciliationPage({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const params = await searchParams;
  const initialNetwork = params.network === "stellar-pubnet" ? "stellar-pubnet" : "stellar-testnet";

  return (
    <InsightPageShell
      id="balance-reconciliation"
      title="Balance reconciliation"
      description="Effects, trades, pools, claimable balances, clawbacks, and fees each move a balance. This page rebuilds those moves in stroops for a ledger window and compares the result with the recorded end balance. Assets stay keyed as CODE:ISSUER, so the same code from two issuers is never one balance. A gap in the history is an unexplained delta or a partial report, never a claimed match. Fees on a fee-bump are charged to the sponsor. Prices, tax, and cost basis are out of scope."
    >
      <ReconciliationWorkbench initialNetwork={initialNetwork} />
    </InsightPageShell>
  );
}
