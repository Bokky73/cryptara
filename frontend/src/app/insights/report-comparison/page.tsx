import Link from "next/link";
import { ReportComparison } from "@/components/research/report-comparison/ReportComparison";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Snapshot comparison",
  description: "Compare two saved risk snapshots and separate real changes from lost evidence.",
};

export default async function ReportComparisonPage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string; right?: string; account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Snapshot comparison</h1>
        <p className="max-w-3xl text-sm text-muted">
          Compares two immutable risk snapshots of the same asset on the same network. Narrative items are matched by
          content rather than list position, and a source that stopped reporting is shown as lost coverage — never as a
          resolved risk. The comparison is read-only: it writes no snapshot, extends no expiry and bypasses no revocation.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <ReportComparison
        initialLeftId={params.left}
        initialRightId={params.right}
        account={params.account ?? null}
        network={params.network ?? null}
      />
    </main>
  );
}
