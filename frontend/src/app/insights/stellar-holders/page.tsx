import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
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
    <InsightPageShell
      id="stellar-holders"
      title="Stellar holder distribution"
      description="Issued supply on Stellar classic sits in trustlines, liquidity pools, and claimable balances. This page measures that split for one CODE:ISSUER on one network, including top-holder share, Gini, and Herfindahl from exact integer amounts. The issuer and distribution accounts declared in stellar.toml are marked apart from the public float. A partial page says what fraction of issued supply was covered. It only reads."
    >
      <HolderDistribution initialAsset={params.asset ?? ""} initialNetwork={params.network ?? "stellar-testnet"} />
    </InsightPageShell>
  );
}
