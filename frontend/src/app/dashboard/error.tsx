"use client";

import type { ErrorRecoveryProps } from "@/components/ErrorRecoveryPanel";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export default function DashboardError(props: ErrorRecoveryProps) {
  return <RouteErrorBoundary {...props} boundary="dashboard" />;
}
