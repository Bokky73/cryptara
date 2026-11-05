import Link from "next/link";
import { PolicyChangeTracker } from "@/components/research/policy-changes/PolicyChangeTracker";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Policy change tracker",
  description: "Snapshot a project's published terms, fee schedule, and risk disclosures, and show what changed between snapshots.",
};

export default function PolicyChangesPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Policy change tracker</h1>
        <p className="max-w-3xl text-sm text-muted">
          Projects quietly change withdrawal fees, custody terms, or liability language. This tracker fetches a
          registry-listed project&apos;s terms, fee schedule, or privacy page, extracts its readable text, and
          compares it against prior snapshots held in this session. A changed paragraph is a recorded difference —
          never a legal opinion about what it means.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/insights/metadata-integrity" className="underline underline-offset-2">
            Metadata integrity
          </Link>
          {" · "}
          <Link href="/insights/evidence-coverage" className="underline underline-offset-2">
            Evidence coverage
          </Link>
        </p>
      </header>

      <PolicyChangeTracker />
    </main>
  );
}
