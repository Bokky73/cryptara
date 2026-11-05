import Link from "next/link";
import { ExposureMap } from "@/components/research/exposure-map/ExposureMap";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shared exposure map",
  description: "See which holdings depend on the same issuer, protocol or underlying asset.",
};

export default async function ExposureMapPage({
  searchParams,
}: {
  searchParams: Promise<{ wallet?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Shared exposure map</h1>
        <p className="max-w-3xl text-sm text-muted">
          An allocation can look diversified while several positions depend on the same issuer, protocol or underlying
          asset. This map shows those shared dependencies and, just as clearly, the portion it could not resolve. A
          relationship exists only when it was declared with a stated source — a matching symbol is never treated as
          evidence of common ownership.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <ExposureMap walletAddress={params.wallet ?? null} network={params.network ?? null} />
    </main>
  );
}
