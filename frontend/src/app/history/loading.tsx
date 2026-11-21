import { SkeletonTableRow } from "@/components/layout/Skeleton";

export default function HistoryLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
        <div className="h-8 w-64 animate-pulse rounded bg-white/10" />
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonTableRow key={i} />
        ))}
      </div>
    </div>
  );
}
