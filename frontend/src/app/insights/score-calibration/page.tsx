import Link from "next/link";
import { CalibrationReport } from "@/components/research/score-calibration/CalibrationReport";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Score calibration report",
  description: "Compare risk scores this app produced in the past with outcomes observed afterwards, bucketed with sample sizes and confidence intervals.",
};

export default function ScoreCalibrationPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-subtle">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Score calibration report</h1>
        <p className="max-w-3xl text-sm text-muted">
          A score explains why it was given, not whether similar scores turned out to be right. This report reads
          historical score snapshots, checks a documented outcome within a stated horizon, and shows the observed
          rate per score bucket with its sample size and confidence interval — never a comment on whether the
          current scoring model is good.
        </p>
        <p className="text-xs text-subtle">
          <Link href="/insights/risk-explanations" className="underline underline-offset-2">
            Risk explanations
          </Link>
        </p>
      </header>

      <CalibrationReport />
    </main>
  );
}
