import Link from "next/link";
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
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Balance reconciliation</h1>
        <p className="max-w-3xl text-sm text-muted">
          Effects, trades, pools, claimable balances, clawbacks, and fees each move a balance. This page rebuilds those moves
          in stroops for a ledger window and compares the result with the recorded end balance. Assets stay keyed as
          CODE:ISSUER, so the same code from two issuers is never one balance. A gap in the history is an unexplained delta or
          a partial report, never a claimed match. Fees on a fee-bump are charged to the sponsor. Prices, tax, and cost basis
          are out of scope.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">Back to dashboard</Link>
        </p>
      </header>
      <ReconciliationWorkbench initialNetwork={initialNetwork} />
    </main>
  );
}
