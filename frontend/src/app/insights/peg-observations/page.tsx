import Link from "next/link";
import { PegWorkspace } from "@/components/research/peg-observations/PegWorkspace";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Peg deviation workspace",
  description: "Inspect observed peg deviations against a declared target and reference currency.",
};

export default async function PegObservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Peg deviation workspace</h1>
        <p className="max-w-3xl text-sm text-muted">
          Inspects observed deviations of a stable asset from <em>its own declared peg</em> — a reference currency and a
          target value, with a stated source. A stable-sounding symbol is not a declaration, and an asset without one is
          listed as undefined rather than measured against an assumed dollar. Observations are sparse by nature, so
          unobserved intervals are named rather than drawn over.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <PegWorkspace account={params.account ?? null} network={params.network ?? null} />
    </main>
  );
}
