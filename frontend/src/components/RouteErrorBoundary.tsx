"use client";

import { AppShell } from "@/components/AppShell";
import { ErrorRecoveryPanel, type ErrorRecoveryProps } from "@/components/ErrorRecoveryPanel";

/**
 * Body of a route-level error.tsx. Pages render AppShell themselves, so a failed
 * page takes the navigation with it unless the fallback renders it again.
 */
export function RouteErrorBoundary(props: ErrorRecoveryProps) {
  return (
    <AppShell>
      <ErrorRecoveryPanel {...props} />
    </AppShell>
  );
}
