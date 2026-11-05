import Link from "next/link";
import { VestingUnlockWorkbench } from "@/components/research/vesting-unlock/VestingUnlockWorkbench";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Vesting and unlock workbench",
  description: "Normalize supported vesting contracts and issuer-published schedules into dated unlock tranches.",
};

export default async function VestingUnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ network?: string; chainFamily?: string }>;
}) {
  const params = await searchParams;
  const chainFamily = params.chainFamily === "stellar" ? "stellar" : "evm";
  const network = params.network ?? (chainFamily === "stellar" ? "stellar-testnet" : "ethereum");

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Vesting and unlock schedules</h1>
        <p className="max-w-3xl text-sm text-muted">
          Holder snapshots show balances today. They do not show contractual unlocks still ahead. This workbench normalizes
          supported EVM and Stellar vesting contracts, plus issuer-published schedules, into dated tranches with exact units,
          network-aware identity, and explicit published-only versus onchain-enforced labels. A cancelled or amended revision
          is kept as evidence and never double-counted into future unlocks. It reads evidence only — it never claims tokens or
          schedules transactions.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <VestingUnlockWorkbench network={network} chainFamily={chainFamily} />
    </main>
  );
}
