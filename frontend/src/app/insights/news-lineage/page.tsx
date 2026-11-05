import Link from "next/link";
import { NewsLineagePanel } from "@/components/research/news-lineage/NewsLineagePanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Story lineage",
  description: "See which news reports are independent and which are copies of one another.",
};

export default async function NewsLineagePage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Story lineage</h1>
        <p className="max-w-3xl text-sm text-muted">
          One wire story republished across ten domains looks like ten confirmations. This view separates independent
          reporting from copies of it, records the reason behind every grouping decision, and keeps uncertainty where the
          evidence is thin. It adds structure over evidence the news agent already produced — it changes no score and
          offers no confirmation guarantee.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <NewsLineagePanel account={params.account ?? null} network={params.network ?? null} />
    </main>
  );
}
