import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
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
    <InsightPageShell
      id="tx-failure-diagnostics"
      title="Failed transaction diagnostics"
      description="A failed hash only says that the network rejected the transaction. This page reads the result codes and any ledger state recorded for that ledger, then separates fee-bump results from the inner transaction. It does not sign, retry, or rebuild the transaction. Missing historical state stays labelled partial."
    >
      <FailureDiagnosisWorkbench initialNetwork={initialNetwork} />
    </InsightPageShell>
  );
}
