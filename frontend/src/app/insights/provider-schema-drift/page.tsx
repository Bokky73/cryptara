import Link from "next/link";
import { ProviderDriftPanel } from "@/components/research/provider-schema-drift/ProviderDriftPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Provider schema drift",
  description: "Operator-only replayable probes for upstream provider contract drift.",
};

export default function ProviderSchemaDriftPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Operations</p>
        <h1 className="text-3xl font-semibold">Provider schema drift</h1>
        <p className="max-w-3xl text-sm text-muted">
          Reachability is not enough: a 200 response with renamed fields or shifted units can silently corrupt risk
          evidence. This operator view replays redacted fixtures against versioned contracts. Failed probes are
          unavailable, not passes. Runtime adapters are not auto-adapted.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <ProviderDriftPanel />
    </main>
  );
}
