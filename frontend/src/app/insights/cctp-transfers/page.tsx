import Link from "next/link";
import { CctpTracker } from "@/components/research/cctp-transfers/CctpTracker";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "CCTP transfer tracker",
  description: "Track a Circle CCTP V2 USDC transfer from the source-chain burn, through attestation, to the destination mint, including Stellar.",
};

export default function CctpTransfersPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">CCTP transfer tracker</h1>
        <p className="max-w-3xl text-sm text-muted">
          Cross-chain USDC transfers involve two chains and an off-chain attestation. When funds do not arrive,
          this tracker shows which step stalled: the source burn, Circle&apos;s attestation, or the destination
          receipt, including Stellar via its CCTP forwarder. Each step is evidence, with timestamps and raw
          identifiers — never a verdict on whether funds are safe.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/insights/package-provenance" className="underline underline-offset-2">
            Package provenance inspector
          </Link>
          {" · "}
          <Link href="/insights/policy-changes" className="underline underline-offset-2">
            Policy change tracker
          </Link>
        </p>
      </header>

      <CctpTracker />
    </main>
  );
}
