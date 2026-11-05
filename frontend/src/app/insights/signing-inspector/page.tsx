import Link from "next/link";
import { SigningInspector } from "@/components/research/signing-inspector/SigningInspector";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Signing payload inspector",
  description: "See what an unsigned payload requests before you open a wallet prompt.",
};

export default async function SigningInspectorPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Signing payload inspector</h1>
        <p className="max-w-3xl text-sm text-muted">
          A wallet prompt is a poor place to read a transaction for the first time. Paste the unsigned payload here first: this
          decodes allowlisted ERC-20 calls, ERC-2612 permits and Stellar envelopes entirely offline, shows every recipient,
          spender, amount and deadline with the raw field it came from, and lists in full whatever it would not guess at. It
          checks the payload against the account, chain and contract you expect, and says plainly where a payload is bound to
          nothing at all. It never signs, never broadcasts, never contacts a chain and never keeps a payload. Decoding is not
          approval: readable bytes are not safe bytes.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <SigningInspector account={params.account ?? null} network={params.network ?? null} />
    </main>
  );
}
