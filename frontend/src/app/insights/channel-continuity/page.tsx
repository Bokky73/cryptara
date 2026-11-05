import Link from "next/link";
import { ChannelContinuityInspector } from "@/components/research/channel-continuity/ChannelContinuityInspector";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Channel continuity inspector",
  description:
    "Inspect historical observations of project websites and social links, with redirects, domain churn and identity uncertainty preserved as evidence.",
};

export default async function ChannelContinuityPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Channel continuity inspector</h1>
        <p className="max-w-3xl text-sm text-muted">
          Current social links cannot tell you when an official channel redirected, changed domain, or began pointing
          elsewhere. This inspector compares bounded historical observations from canonical token and issuer references,
          records redirects, handle changes, broken links and cross-links with timestamps, and keeps ambiguous or
          user-supplied claims labelled. A change is evidence, not proof of takeover.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
          {" · "}
          <Link href="/insights/social-coordination" className="underline underline-offset-2">
            Social pattern workbench
          </Link>
        </p>
      </header>

      <ChannelContinuityInspector account={params.account ?? null} network={params.network ?? null} />
    </main>
  );
}
