import { SkeletonCard } from "@/components/layout/Skeleton";

export default function AlertsLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
        <div className="h-8 w-60 animate-pulse rounded bg-white/10" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
