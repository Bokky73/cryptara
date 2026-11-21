import React from "react";

export function Skeleton({
  className = "",
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-white/10 motion-reduce:animate-none motion-reduce:opacity-60 ${className}`}
      style={style}
      {...props}
    />
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading card..."
      className={`rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4 ${className}`}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-4 w-48" />
      <div className="space-y-2 pt-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-9 flex-1 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
    </div>
  );
}

export function SkeletonMetric({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-white/10 bg-black/20 p-4 space-y-2 ${className}`}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-3 w-36" />
    </div>
  );
}

export function SkeletonTableRow({ columns = 5 }: { columns?: number }) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-white/5">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i === 0 ? "w-32" : i === 1 ? "w-20" : "flex-1"}`} />
      ))}
    </div>
  );
}

export function SkeletonChart({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex items-end gap-2 h-44 pt-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-t-sm"
            style={{ height: `${20 + ((i * 19) % 70)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
