import { InsightPageShell } from "@/components/research/shared/InsightPageShell";
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
    <InsightPageShell
      id="signing-inspector"
      title="Signing payload inspector"
      description="A wallet prompt is a poor place to read a transaction for the first time. Paste the unsigned payload here first: this decodes allowlisted ERC-20 calls, ERC-2612 permits and Stellar envelopes entirely offline, shows every recipient, spender, amount and deadline with the raw field it came from, and lists in full whatever it would not guess at. It checks the payload against the account, chain and contract you expect, and says plainly where a payload is bound to nothing at all. It never signs, never broadcasts, never contacts a chain and never keeps a payload. Decoding is not approval: readable bytes are not safe bytes."
    >
      <SigningInspector account={params.account ?? null} network={params.network ?? null} />
    </InsightPageShell>
  );
}
