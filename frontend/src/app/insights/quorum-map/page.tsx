import Link from "next/link";
import { QuorumExplorer } from "@/components/research/quorum-map/QuorumExplorer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Validator quorum map",
  description: "Show validator quorum sets, organization overlap, and threshold dependence.",
};

export default async function QuorumMapPage({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const params = await searchParams;
  const initialNetwork = params.network === "stellar-pubnet" ? "stellar-pubnet" : "stellar-testnet";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Validator quorum map</h1>
        <p className="max-w-3xl text-sm text-muted">
          Validator home domains and quorum sets are published separately. This page loads a recorded directory and each
          stellar.toml VALIDATORS table, then counts how many top-level quorum sets name an organization and whether removing
          that organization drops a set below its threshold. Unknown node keys stay visible. Stale sources show their age.
          The page reports that dependence only. It does not prove network safety, recommend validators, or run a node.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">Back to dashboard</Link>
        </p>
      </header>
      <QuorumExplorer initialNetwork={initialNetwork} />
    </main>
  );
}
