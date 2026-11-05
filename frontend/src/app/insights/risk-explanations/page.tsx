import Link from "next/link";
import { ExplanationWorkbench } from "@/components/research/risk-explanations/ExplanationWorkbench";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Risk explanation workbench",
  description: "Trace how a risk report's recorded factors relate to the result it displayed.",
};

export default async function RiskExplanationsPage({
  searchParams,
}: {
  searchParams: Promise<{ handoff?: string; account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Risk explanation workbench</h1>
        <p className="max-w-3xl text-sm text-muted">
          A read-only lens over a risk report you already hold. It links every recorded factor to the source the report
          named, separates scored contributions from descriptive ones, and states plainly where the scoring model does not
          permit an exact decomposition. It never changes a score, a verdict or a recommendation.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <ExplanationWorkbench
        handoffToken={params.handoff ?? null}
        account={params.account ?? null}
        network={params.network ?? null}
      />
    </main>
  );
}
