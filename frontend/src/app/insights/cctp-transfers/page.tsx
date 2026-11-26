import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
import Link from "next/link";
import { CctpTracker } from "@/components/research/cctp-transfers/CctpTracker";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "CCTP transfer tracker",
  description: "Track a Circle CCTP V2 USDC transfer from the source-chain burn, through attestation, to the destination mint, including Stellar.",
};

export default function CctpTransfersPage() {
  return (
    <InsightPageShell
      id="cctp-transfers"
      title="CCTP transfer tracker"
      description="Cross-chain USDC transfers involve two chains and an off-chain attestation. When funds do not arrive, this tracker shows which step stalled: the source burn, Circle's attestation, or the destination receipt, including Stellar via its CCTP forwarder. Each step is evidence, with timestamps and raw identifiers — never a verdict on whether funds are safe."
    >
      <p className="text-xs text-subtle">
        <Link href="/insights/package-provenance" className="underline underline-offset-2">
          Package provenance inspector
        </Link>
        {" · "}
        <Link href="/insights/policy-changes" className="underline underline-offset-2">
          Policy change tracker
        </Link>
      </p>
      <CctpTracker />
    </InsightPageShell>
  );
}
