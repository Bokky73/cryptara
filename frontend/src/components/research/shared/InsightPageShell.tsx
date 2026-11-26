"use client";

import Link from "next/link";
import { Component, Suspense, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { ErrorRecoveryPanel } from "@/components/ErrorRecoveryPanel";
import { Page } from "@/components/layout/Page";
import { NoDataState } from "@/components/NoDataState";
import { StalenessStamp } from "@/components/StalenessStamp";
import { InsightStatusContext, type InsightPageStatus } from "./insightPageStatus";

type BoundaryProps = { boundary: string; children: ReactNode };

/** Keeps the page header and navigation when only the workbench fails. */
class InsightErrorBoundary extends Component<BoundaryProps, { failure: { error: unknown } | null }> {
  state: { failure: { error: unknown } | null } = { failure: null };

  static getDerivedStateFromError(error: unknown) {
    return { failure: { error } };
  }

  render() {
    if (!this.state.failure) return this.props.children;
    return (
      <ErrorRecoveryPanel
        error={this.state.failure.error}
        reset={() => this.setState({ failure: null })}
        boundary={this.props.boundary}
      />
    );
  }
}

/** Shared frame for insights views. See docs/features/insight-page-shell.md. */
export function InsightPageShell({
  id,
  title,
  description,
  backHref = "/insights",
  backLabel = "Back to insights",
  children,
}: {
  /** Route slug; names the error boundary in diagnostics. */
  id: string;
  /** Omit when the view renders its own level-one heading. */
  title?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<InsightPageStatus | null>(null);
  const content = useMemo(() => (
    <InsightErrorBoundary boundary={`insights/${id}`}>
      {/* URL state reads the search params, which may be unknown while prerendering. */}
      <Suspense fallback={<p role="status">Loading insight…</p>}>{children}</Suspense>
    </InsightErrorBoundary>
  ), [children, id]);

  return (
    <AppShell>
      <Page title={title} description={description}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <Link href={backHref} className="underline underline-offset-2">{backLabel}</Link>
            {status?.capturedAt ? <StalenessStamp capturedAt={status.capturedAt} label="Data captured" /> : null}
          </div>
          <InsightStatusContext.Provider value={setStatus}>{content}</InsightStatusContext.Provider>
          {status?.empty ? <NoDataState {...status.empty} reason="generic" /> : null}
        </div>
      </Page>
    </AppShell>
  );
}
