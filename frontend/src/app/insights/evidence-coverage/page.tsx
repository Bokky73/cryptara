import Link from "next/link";
import { EvidenceExplorer } from "@/components/research/evidence-coverage/EvidenceExplorer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Evidence coverage explorer",
  description: "See which claims have independent coverage and which rest on one source family.",
};

export default async function EvidenceCoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Evidence coverage explorer</h1>
        <p className="max-w-3xl text-sm text-muted">
          A report can hold connected, stale, missing and contradictory evidence at once. This explorer consolidates it
          into two questions: which claims have genuinely independent backing, and which apparent disagreements are
          actually provable. Repeating one source family is not corroboration, and a difference in units or observation
          windows is not a contradiction.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <EvidenceExplorer account={params.account ?? null} network={params.network ?? null} />
    </main>
  );
}
