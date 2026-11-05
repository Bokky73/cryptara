import Link from "next/link";
import { LiquidityWorkbench } from "@/components/research/liquidity-depth/LiquidityWorkbench";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Liquidity depth workbench",
  description: "Inspect visible depth, price impact across trade sizes, and where coverage ends.",
};

export default async function LiquidityDepthPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; network?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Liquidity depth workbench</h1>
        <p className="max-w-3xl text-sm text-muted">
          A quote describes one proposed size. This workbench describes the shape behind it: visible depth, price impact
          across a ladder of sizes, and exactly where the data stops. Order-book and constant-product figures are
          calculated separately and labelled as such, and a venue whose model is not implemented is shown as such rather
          than approximated. It is informational only — it never creates an executable quote, selects a route, or prepares
          a transaction.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/dashboard" className="underline underline-offset-2">
            Back to dashboard
          </Link>
        </p>
      </header>

      <LiquidityWorkbench account={params.account ?? null} network={params.network ?? null} />
    </main>
  );
}
