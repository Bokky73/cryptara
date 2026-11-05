import Link from "next/link";
import { DataEntryInspector } from "@/components/research/account-data-entries/DataEntryInspector";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Account data entries",
  description: "Inspect Stellar manageData entries, their decoded values, and their change history.",
};

export default async function AccountDataEntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ network?: string }>;
}) {
  const params = await searchParams;
  const initialNetwork = params.network === "stellar-pubnet" ? "stellar-pubnet" : "stellar-testnet";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Account data entries</h1>
        <p className="max-w-3xl text-sm text-muted">
          Horizon stores manageData values as base64. This page decodes each value to hex and, only when the bytes are valid
          text, to UTF-8. It also lists set, change, and delete events with the ledger and source account. Binary values stay
          hex. Deleted keys keep the last value found in the fetched history. Nothing is written or signed.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>
      <DataEntryInspector initialNetwork={initialNetwork} />
    </main>
  );
}
