import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import { QuorumExplorer } from "@/components/research/quorum-map/QuorumExplorer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Validator quorum map",
  description: "Show validator quorum sets, organization overlap, and threshold dependence.",
};

export default async function QuorumMapPage({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const params = await searchParams;
  const initialNetwork = params.network === "stellar-pubnet" ? "stellar-pubnet" : "stellar-testnet";

  return (
    <InsightPageShell
      id="quorum-map"
      title="Validator quorum map"
      description="Validator home domains and quorum sets are published separately. This page loads a recorded directory and each stellar.toml VALIDATORS table, then counts how many top-level quorum sets name an organization and whether removing that organization drops a set below its threshold. Unknown node keys stay visible. Stale sources show their age. The page reports that dependence only. It does not prove network safety, recommend validators, or run a node."
    >
      <QuorumExplorer initialNetwork={initialNetwork} />
    </InsightPageShell>
  );
}
