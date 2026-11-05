import Link from "next/link";
import { CongestionWorkbench } from "@/components/research/network-congestion/CongestionWorkbench";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ledger capacity and fee surges",
  description: "Explain Stellar ledger operation capacity, surge-pricing periods, and separated inclusion fees over a window.",
};

export default function NetworkCongestionPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Ledger capacity and fee surges</h1>
        <p className="max-w-3xl text-sm text-muted">
          A transaction that fails for an insufficient fee, or that waits to be included, does not say whether the network was
          full at the time. This reads a bounded ledger window and shows operation capacity, the runs where that capacity was
          full, and the inclusion fees that were charged. Classic inclusion fees and Soroban resource fees are different charges
          and stay in different figures. A ledger the provider did not return is shown as a gap and left out of the statistics.
          The page only reads closed ledgers. It does not recommend a fee and it does not build a transaction.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/" className="underline underline-offset-2">
            Back to overview
          </Link>
        </p>
      </header>
      <CongestionWorkbench />
    </main>
  );
}
