import { SkeletonCard, SkeletonMetric } from "@/components/layout/Skeleton";

export default function ScanLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
        <div className="h-8 w-72 animate-pulse rounded bg-white/10" />
        <div className="h-4 w-80 animate-pulse rounded bg-white/10" />
      </div>
      <div className="h-12 w-full animate-pulse rounded-lg bg-white/10" />
      <div className="grid gap-4 sm:grid-cols-3">
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
      </div>
      <SkeletonCard className="min-h-[320px]" />
    </div>
  );
}
