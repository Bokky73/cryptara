import Link from "next/link";
import { FeeAnalysisWorkspace } from "@/components/research/fee-analysis/FeeAnalysisWorkspace";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Network fee analysis",
  description: "Attribute the network fees this wallet has already paid, by payer, operation and period.",
};

export default async function FeeAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; stellarAccount?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Network fee analysis</h1>
        <p className="max-w-3xl text-sm text-muted">
          Transaction history shows what happened but not what it cost, or who paid. This attributes network fees to the
          account the chain actually charged, grouped by network, fee asset, operation and period. A failed transaction that
          was still charged stays in the totals; a transaction that was replaced is counted once, against the hash that
          landed. Arithmetic is exact — sums are integer base units, never floating point. A charge that could not be read is
          counted as unknown and never as zero, and a fiat figure appears only where there is a price and the moment it was
          true. It reads finalized records; it changes no lifecycle state and no fee policy.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/history" className="underline underline-offset-2">
            Back to transaction history
          </Link>
        </p>
      </header>

      <FeeAnalysisWorkspace
        account={params.account ?? null}
        stellarAccount={params.stellarAccount ?? null}
        network={params.network ?? null}
      />
    </main>
  );
}
