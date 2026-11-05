import Link from "next/link";
import { SpamDustPanel } from "@/components/research/spam-dust-review/SpamDustPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Spam and dust review",
  description: "Isolate spam and dust assets with explainable signals and reversible local visibility.",
};

export default async function SpamDustReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Portfolio</p>
        <h1 className="text-3xl font-semibold">Spam and dust review</h1>
        <p className="max-w-3xl text-sm text-muted">
          Unexpected airdrops and dust balances can make portfolio views noisy. This workspace classifies holdings with
          explainable signals and local show/hide preferences. A high-value unpriced asset is never treated as dust, and
          hiding never mutates on-chain holdings.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <SpamDustPanel account={params.account ?? null} network={params.network ?? null} />
    </main>
  );
}
