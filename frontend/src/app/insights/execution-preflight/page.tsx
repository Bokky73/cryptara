import Link from "next/link";
import { PreflightPanel } from "@/components/research/execution-preflight/PreflightPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Execution preflight budget",
  description: "Explain fee, slippage, and reserve limits before approval without signing.",
};

export default async function ExecutionPreflightPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Execution</p>
        <h1 className="text-3xl font-semibold">Execution preflight budget</h1>
        <p className="max-w-3xl text-sm text-muted">
          Combine a prepared transaction&apos;s quoted spend, network fees, minimum receive, and account reserve into a
          read-only worst-case budget. Stale simulations, network mismatches, and plan-hash mismatches refuse a
          complete/safe claim. This view never signs or sends.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <PreflightPanel account={params.account ?? null} network={params.network ?? null} />
    </main>
  );
}
