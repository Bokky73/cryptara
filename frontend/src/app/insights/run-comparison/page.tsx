import Link from "next/link";
import { RunComparisonWorkspace } from "@/components/research/run-comparison/RunComparisonWorkspace";
import { listAgentRunRecords } from "@/server/storage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Saved run comparison",
  description: "Investigate what differs between two saved agent runs, without re-running either.",
};

export default async function RunComparisonPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;
  const account = params.account ?? null;

  const runs = account
    ? listAgentRunRecords(account)
        .slice(0, 50)
        .map((record) => ({
          id: record.id,
          label: `${record.createdAt?.slice(0, 16) ?? record.id} · ${record.targetToken?.symbol ?? record.mode ?? "run"} · ${record.recommendation}`,
        }))
    : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Saved run comparison</h1>
        <p className="max-w-3xl text-sm text-muted">
          Two runs of the same check rarely agree exactly, and the interesting question is which part moved. This aligns two
          saved runs by agent and by finding — not by position, so a reordered list is not reported as wholesale change — and
          shows what differs in the inputs, the observations, the recommendation and the provider coverage behind them. It
          reports what changed and declines to say why: a saved record does not contain that, and a score that moved while
          sources went dark is two facts, not one explanation. Nothing is re-run, no provider is called and no record is
          changed.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/history" className="underline underline-offset-2">
            Back to the agent timeline
          </Link>
        </p>
      </header>

      <RunComparisonWorkspace account={account} network={params.network ?? null} runs={runs} />
    </main>
  );
}
