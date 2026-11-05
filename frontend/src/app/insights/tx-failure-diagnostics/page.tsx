import Link from "next/link";
import { FailureDiagnosisWorkbench } from "@/components/research/tx-failure-diagnostics/FailureDiagnosisWorkbench";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Failed transaction diagnostics",
  description: "Explain a failed Stellar transaction from its result codes and recorded ledger state.",
};

export default async function TxFailureDiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<{ network?: string }>;
}) {
  const params = await searchParams;
  const initialNetwork = params.network === "stellar-pubnet" ? "stellar-pubnet" : "stellar-testnet";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Failed transaction diagnostics</h1>
        <p className="max-w-3xl text-sm text-muted">
          A failed hash only says that the network rejected the transaction. This page reads the result codes and any ledger
          state recorded for that ledger, then separates fee-bump results from the inner transaction. It does not sign, retry,
          or rebuild the transaction. Missing historical state stays labelled partial.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>
      <FailureDiagnosisWorkbench initialNetwork={initialNetwork} />
    </main>
  );
}
