import Link from "next/link";
import { PackageProvenance } from "@/components/research/package-provenance/PackageProvenance";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Package provenance inspector",
  description: "Inspect a published npm or crates.io SDK package for build provenance, maintainer changes, lifecycle scripts, and tag coverage.",
};

export default function PackageProvenancePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Package provenance inspector</h1>
        <p className="max-w-3xl text-sm text-muted">
          Users install a project&apos;s SDK on trust. This inspector reads a package&apos;s published npm or
          crates.io metadata, verifies build provenance attestations where present, detects maintainer changes and
          new install-time scripts across releases, and compares release versions against tags in the declared
          source repository — as evidence, never as a safety verdict.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/insights/policy-changes" className="underline underline-offset-2">
            Policy change tracker
          </Link>
          {" · "}
          <Link href="/insights/metadata-integrity" className="underline underline-offset-2">
            Metadata integrity
          </Link>
        </p>
      </header>

      <PackageProvenance />
    </main>
  );
}
