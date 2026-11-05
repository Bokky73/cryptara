import Link from "next/link";
import { SocialPatternWorkbench } from "@/components/research/social-coordination/SocialPatternWorkbench";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Social pattern workbench",
  description: "Inspect whether a social spike is repeated messages from a small group, with published thresholds.",
};

export default async function SocialCoordinationPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Social pattern workbench</h1>
        <p className="max-w-3xl text-sm text-muted">
          An aggregate social signal cannot tell you whether a spike is a hundred people reacting or four accounts posting
          the same sentence twenty-five times. This workbench measures repetition, synchronization and participation
          concentration in observations you supply, publishes the threshold behind every flag, and states plainly what
          each measurement does not establish. It never calls an account a bot, never identifies anyone, and changes no
          social score.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <SocialPatternWorkbench account={params.account ?? null} network={params.network ?? null} />
    </main>
  );
}
