"use client";

import { createContext, useContext, useEffect } from "react";

export type InsightPageStatus = {
  /** When the displayed data was captured (ISO 8601). */
  capturedAt?: string;
  /** Set when a request succeeded but returned nothing to show. */
  empty?: { title: string; detail: string };
};

export const InsightStatusContext = createContext<((status: InsightPageStatus | null) => void) | null>(null);

/** Report a view's freshness and empty state to the surrounding shell, if any. */
export function useInsightPageStatus({ capturedAt, empty }: InsightPageStatus) {
  const report = useContext(InsightStatusContext);
  const emptyTitle = empty?.title;
  const emptyDetail = empty?.detail;

  useEffect(() => {
    if (!report) return;
    report({
      capturedAt,
      empty: emptyTitle && emptyDetail ? { title: emptyTitle, detail: emptyDetail } : undefined,
    });
    return () => report(null);
  }, [capturedAt, emptyDetail, emptyTitle, report]);
}
