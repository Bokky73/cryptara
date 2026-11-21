import { SkeletonCard } from "@/components/layout/Skeleton";

export default function WatchlistLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
        <div className="h-8 w-64 animate-pulse rounded bg-white/10" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-full bg-white/10" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
