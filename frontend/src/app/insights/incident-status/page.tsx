import Link from "next/link";
import { IncidentStatusPanel } from "@/components/research/incident-status/IncidentStatusPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Incident status evidence",
  description: "Reconcile security incident claims with official advisories without treating rumours as acknowledgements.",
};

export default async function IncidentStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Incident status evidence</h1>
        <p className="max-w-3xl text-sm text-muted">
          News lineage finds copied stories. This view asks a different question: was a security incident acknowledged,
          patched, compensated, or still disputed? Status labels are source claims. An unverified rumour cannot become
          an official acknowledgement, and same-name projects on different networks stay distinct.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
          {" · "}
          <Link href="/insights/news-lineage" className="underline underline-offset-2">
            News lineage
          </Link>
        </p>
      </header>

      <IncidentStatusPanel account={params.account ?? null} network={params.network ?? null} />
    </main>
  );
}
