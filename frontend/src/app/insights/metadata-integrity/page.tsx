import Link from "next/link";
import { MetadataIntegrityWorkspace } from "@/components/research/metadata-integrity/MetadataIntegrityWorkspace";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Metadata integrity",
  description:
    "Compare issuer home-domain and SEP-1 stellar.toml declarations over time without claiming ownership or fraud.",
};

export default async function MetadataIntegrityPage({
  searchParams,
}: {
  searchParams: Promise<{ assetCode?: string; issuer?: string; network?: string }>;
}) {
  const params = await searchParams;
  const network =
    params.network === "testnet" || params.network === "pubnet" ? params.network : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Metadata integrity</h1>
        <p className="max-w-3xl text-sm text-muted">
          An issuer&apos;s home domain and asset metadata can change after a user first sees an asset. This inspector
          reads the issuer account, fetches <code className="text-xs">stellar.toml</code> with bounded HTTPS guards, and
          compares asset code plus issuer against CURRENCIES entries. Matching is an observation. A change between
          snapshots is an observation. Neither is a legitimacy verdict, a risk score, or proof of domain ownership.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/insights/fee-analysis" className="underline underline-offset-2">
            Network fee analysis
          </Link>
          {" · "}
          <Link href="/insights/signing-inspector" className="underline underline-offset-2">
            Signing inspector
          </Link>
        </p>
      </header>

      <MetadataIntegrityWorkspace
        assetCode={params.assetCode ?? null}
        issuer={params.issuer ?? null}
        network={network}
      />
    </main>
  );
}
