import { SkeletonCard, SkeletonMetric, SkeletonChart } from "@/components/layout/Skeleton";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
        <div className="h-8 w-64 animate-pulse rounded bg-white/10" />
        <div className="h-4 w-96 animate-pulse rounded bg-white/10" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <SkeletonCard className="min-h-[380px]" />
        <SkeletonChart className="min-h-[380px]" />
      </div>
    </div>
  );
}
