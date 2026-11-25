import { AppShell } from "@/components/AppShell";
import { TokenScanClient } from "@/components/TokenScanClient";

export default async function ScanPage({
  searchParams,
}: {
  searchParams?: Promise<{ query?: string; chain?: string; run?: string }>;
}) {
  const { query, chain, run } = (await searchParams) ?? {};

  return (
    <AppShell>
      {/* Keyed so a palette scan started while already on /scan replaces the form. */}
      <TokenScanClient key={JSON.stringify([query, chain, run])} initialQuery={query} initialChain={chain} autoRun={Boolean(query && run)} />
    </AppShell>
  );
}
