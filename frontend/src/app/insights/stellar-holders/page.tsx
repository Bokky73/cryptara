import { HolderDistribution } from "@/components/research/stellar-holders/HolderDistribution";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Stellar holder distribution",
  description: "Measure how an issued Stellar asset is split across trustlines, liquidity pools, and claimable balances.",
};

export default async function StellarHoldersPage({
  searchParams,
}: {
  searchParams: Promise<{ asset?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-white/45">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Stellar holder distribution</h1>
        <p className="max-w-3xl text-sm text-white/70">
          Issued supply on Stellar classic sits in trustlines, liquidity pools, and claimable balances. This page measures
          that split for one CODE:ISSUER on one network, including top-holder share, Gini, and Herfindahl from exact integer
          amounts. The issuer and distribution accounts declared in stellar.toml are marked apart from the public float.
          A partial page says what fraction of issued supply was covered. It only reads.
        </p>
      </header>
      <HolderDistribution initialAsset={params.asset ?? ""} initialNetwork={params.network ?? "stellar-testnet"} />
    </main>
  );
}
